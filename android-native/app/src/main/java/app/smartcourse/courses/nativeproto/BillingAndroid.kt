package app.smartcourse.courses.nativeproto

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.resume

/*
 * Achats Android (Google Play Billing) : partie PROPRE À ANDROID de l'écran commun « Mes Courses Famille » (PlanUi.kt).
 * - Offres et prix : ceux de Google Play (ProductDetails), jamais écrits dans l'application.
 * - Achat : transmis à Google avec le jeton store de la famille (obfuscatedAccountId), puis présenté au serveur, qui le vérifie
 *   auprès de Google et le confirme (acknowledge) : l'application ne débloque jamais rien elle-même.
 * - Restaurer : achats connus de Google Play pour ce compte, présentés à nouveau au serveur.
 */
private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

private class PlayBilling(private val ctx: Context, private val server: () -> PurchaseServer?) : StoreHost, PurchasesUpdatedListener {
    private val client = BillingClient.newBuilder(ctx.applicationContext)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()
    private var details = mapOf<String, ProductDetails>()
    private var waiting: CompletableDeferred<Pair<BillingResult, List<Purchase>?>>? = null

    override val storeName = "Google Play"
    override val manageHint = "Google Play › Paiements et abonnements › Abonnements"

    private suspend fun ready(): Boolean {
        if (client.isReady) return true
        return suspendCancellableCoroutine { c ->
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (c.isActive) c.resume(result.responseCode == BillingResponseCode.OK)
                }
                override fun onBillingServiceDisconnected() {
                    if (c.isActive) c.resume(false)
                }
            })
        }
    }

    private suspend fun query(type: String, id: String): ProductDetails? = suspendCancellableCoroutine { c ->
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(type).build()))
            .build()
        client.queryProductDetailsAsync(params) { r, res ->
            if (c.isActive) c.resume(if (r.responseCode == BillingResponseCode.OK) res.productDetailsList.firstOrNull() else null)
        }
    }

    /** Offre de base de l'abonnement (sans offre d'essai ni promotion). */
    private fun baseOffer(pd: ProductDetails) = pd.subscriptionOfferDetails?.let { o -> o.firstOrNull { it.offerId == null } ?: o.firstOrNull() }

    override suspend fun offers(): List<StoreOffer> {
        if (!ready()) return emptyList()
        val annual = query(BillingClient.ProductType.SUBS, PRODUCT_ANNUAL)
        val lifetime = query(BillingClient.ProductType.INAPP, PRODUCT_LIFETIME)
        details = listOfNotNull(annual, lifetime).associateBy { it.productId }
        return listOfNotNull(
            annual?.let(::baseOffer)?.pricingPhases?.pricingPhaseList?.lastOrNull()?.let { StoreOffer(PRODUCT_ANNUAL, "Abonnement annuel", it.formattedPrice, "par an") },
            lifetime?.oneTimePurchaseOfferDetails?.let { StoreOffer(PRODUCT_LIFETIME, "Mes Courses Famille à vie", it.formattedPrice, null) },
        )
    }

    override suspend fun buy(productId: String): BuyResult {
        val srv = server() ?: return BuyResult.Failed("Connexion au serveur requise.")
        val token = srv.accountToken ?: return BuyResult.Failed("Seuls les administrateurs de la famille peuvent acheter.")
        val act = ctx.activity() ?: return BuyResult.Failed("Achat impossible depuis cet écran.")
        if (!ready()) return BuyResult.Failed("Google Play ne répond pas. Réessayez plus tard.")
        val pd = details[productId] ?: run { offers(); details[productId] } ?: return BuyResult.Failed("Offre indisponible pour le moment.")
        val pp = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd)
        baseOffer(pd)?.let { pp.setOfferToken(it.offerToken) }
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(pp.build())).setObfuscatedAccountId(token).build()
        val w = CompletableDeferred<Pair<BillingResult, List<Purchase>?>>()
        waiting = w
        val launched = client.launchBillingFlow(act, params)
        val (r, list) = if (launched.responseCode == BillingResponseCode.OK) w.await() else launched to null
        waiting = null
        return when (r.responseCode) {
            BillingResponseCode.OK -> deliver(srv, list.orEmpty().filter { productId in it.products })
            BillingResponseCode.USER_CANCELED -> BuyResult.Cancelled
            // Déjà acheté avec ce compte Google (achat non encore transmis, ou autre appareil) : on le présente au serveur.
            BillingResponseCode.ITEM_ALREADY_OWNED -> if (restore() > 0) BuyResult.Done else BuyResult.Failed("Cet achat existe déjà sur ce compte Google Play.")
            else -> BuyResult.Failed("L'achat n'a pas abouti (Google Play). Réessayez plus tard.")
        }
    }

    private fun body(p: Purchase) = buildJsonObject {
        put("platform", "google")
        put("productId", p.products.first())
        put("purchaseToken", p.purchaseToken)
    }

    private suspend fun deliver(srv: PurchaseServer, list: List<Purchase>): BuyResult {
        if (list.isEmpty()) return BuyResult.Failed("Achat non reçu de Google Play. Touchez « Restaurer les achats ».")
        var out: BuyResult = BuyResult.Done
        for (p in list) {
            val r = srv.submit(body(p))
            out = if (p.purchaseState == Purchase.PurchaseState.PENDING && r == BuyResult.Done) BuyResult.Pending else r
        }
        return out
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        // Hors parcours d'achat (paiement en attente devenu effectif…) : le serveur l'apprend par la notification Google,
        // et l'application le présente à la prochaine ouverture de l'écran.
        waiting?.complete(result to purchases?.toList())
    }

    private suspend fun owned(type: String): List<Purchase> = suspendCancellableCoroutine { c ->
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build()) { r, list ->
            if (c.isActive) c.resume(if (r.responseCode == BillingResponseCode.OK) list else emptyList())
        }
    }

    override suspend fun restore(): Int {
        val srv = server() ?: return 0
        if (!ready()) return 0
        val mine = (owned(BillingClient.ProductType.SUBS) + owned(BillingClient.ProductType.INAPP))
            .filter { p -> p.purchaseState == Purchase.PurchaseState.PURCHASED && p.products.any { it == PRODUCT_ANNUAL || it == PRODUCT_LIFETIME } }
        return mine.count { srv.submit(body(it)) == BuyResult.Done }
    }

    /** Achats encore non confirmés (le serveur ne les a pas reçus) : présentés sans rien demander. */
    override suspend fun syncSilently() {
        val srv = server() ?: return
        if (!ready()) return
        (owned(BillingClient.ProductType.SUBS) + owned(BillingClient.ProductType.INAPP))
            .filter { it.purchaseState == Purchase.PurchaseState.PURCHASED && !it.isAcknowledged }
            .forEach { srv.submit(body(it)) }
    }

    override fun manageSubscription() {
        val uri = Uri.parse("https://play.google.com/store/account/subscriptions?sku=$PRODUCT_ANNUAL&package=${ctx.packageName}")
        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    fun close() = runCatching { client.endConnection() }
}

@Composable
fun rememberStoreHost(server: PurchaseServer?): StoreHost {
    val ctx = LocalContext.current
    val current = rememberUpdatedState(server)
    val host = remember(ctx) { PlayBilling(ctx) { current.value } }
    DisposableEffect(host) { onDispose { host.close() } }
    return host
}
