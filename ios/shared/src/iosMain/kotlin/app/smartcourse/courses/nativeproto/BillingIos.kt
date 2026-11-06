package app.smartcourse.courses.nativeproto

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import platform.Foundation.NSURL
import platform.UIKit.UIApplication
import kotlin.coroutines.resume

/*
 * Achats iPhone (StoreKit 2) : partie PROPRE À L'IPHONE de l'écran commun « Mes Courses Famille » (PlanUi.kt).
 * StoreKit 2 n'existe qu'en Swift : l'application iPhone fournit IosStoreKit (StoreKitBridge.swift) au lancement.
 * - Offres et prix : ceux de l'App Store (Product.displayPrice), jamais écrits dans l'application.
 * - Achat : transmis à Apple avec le jeton store de la famille (appAccountToken), puis la transaction signée par Apple est présentée
 *   au serveur, qui vérifie la signature ; la transaction n'est terminée (finish) qu'une fois acceptée par le serveur.
 * - Restaurer : AppStore.sync() puis Transaction.currentEntitlements, présentés au serveur.
 */

/** Produit tel que décrit par l'App Store. */
class IosStoreProduct(val id: String, val title: String, val displayPrice: String, val periodText: String?)

interface IosProductsCallback { fun done(products: List<IosStoreProduct>) }
/** status : « purchased », « pending », « cancelled » ou « failed ». */
interface IosPurchaseCallback { fun done(status: String, jws: String?, transactionId: String?) }
/** Transactions signées (JWS) et leurs identifiants, dans le même ordre. */
interface IosEntitlementsCallback { fun done(jws: List<String>, transactionIds: List<String>) }

/** Partie Swift (StoreKit 2), enregistrée par l'application iPhone : CoursesIos.shared.storeKit = StoreKitBridge(). */
interface IosStoreKit {
    fun products(ids: List<String>, callback: IosProductsCallback)
    fun purchase(productId: String, accountToken: String, callback: IosPurchaseCallback)
    /** sync : demander d'abord à l'App Store les achats de ce compte (peut demander le mot de passe Apple). */
    fun entitlements(sync: Boolean, callback: IosEntitlementsCallback)
    fun finish(transactionId: String)
    fun manageSubscriptions()
}

object IosStore {
    var kit: IosStoreKit? = null

    private fun body(jws: String) = buildJsonObject {
        put("platform", "apple")
        put("signedTransaction", jws)
    }

    /** Transaction conclue hors du parcours d'achat (accord parental, renouvellement, autre appareil) : présentée au serveur. */
    suspend fun deliver(server: PurchaseServer?, jws: String, transactionId: String): BuyResult {
        val r = server?.submit(body(jws)) ?: return BuyResult.Failed("Connexion au serveur requise.")
        if (r == BuyResult.Done || r == BuyResult.Pending) kit?.finish(transactionId)
        return r
    }
}

private class AppStoreHost(private val server: () -> PurchaseServer?) : StoreHost {
    override val storeName = "l'App Store"
    override val manageHint = "Réglages › votre nom › Abonnements"

    override suspend fun offers(): List<StoreOffer> {
        val kit = IosStore.kit ?: return emptyList()
        val list = suspendCancellableCoroutine { c ->
            kit.products(listOf(PRODUCT_ANNUAL, PRODUCT_LIFETIME), object : IosProductsCallback {
                override fun done(products: List<IosStoreProduct>) { if (c.isActive) c.resume(products) }
            })
        }
        return listOf(PRODUCT_ANNUAL, PRODUCT_LIFETIME).mapNotNull { id ->
            list.firstOrNull { it.id == id }?.let {
                StoreOffer(id, if (id == PRODUCT_ANNUAL) "Abonnement annuel" else "Mes Courses Famille à vie", it.displayPrice, it.periodText)
            }
        }
    }

    override suspend fun buy(productId: String): BuyResult {
        val kit = IosStore.kit ?: return BuyResult.Failed("Les achats ne sont pas disponibles sur cet appareil.")
        val srv = server() ?: return BuyResult.Failed("Connexion au serveur requise.")
        val token = srv.accountToken ?: return BuyResult.Failed("Seuls les administrateurs de la famille peuvent acheter.")
        val (status, jws, id) = suspendCancellableCoroutine { c ->
            kit.purchase(productId, token, object : IosPurchaseCallback {
                override fun done(status: String, jws: String?, transactionId: String?) { if (c.isActive) c.resume(Triple(status, jws, transactionId)) }
            })
        }
        return when {
            status == "purchased" && jws != null && id != null -> IosStore.deliver(srv, jws, id)
            status == "pending" -> BuyResult.Pending
            status == "cancelled" -> BuyResult.Cancelled
            else -> BuyResult.Failed("L'achat n'a pas abouti (App Store). Réessayez plus tard.")
        }
    }

    private suspend fun present(sync: Boolean): Int {
        val kit = IosStore.kit ?: return 0
        val srv = server() ?: return 0
        val (jws, ids) = suspendCancellableCoroutine { c ->
            kit.entitlements(sync, object : IosEntitlementsCallback {
                override fun done(jws: List<String>, transactionIds: List<String>) { if (c.isActive) c.resume(jws to transactionIds) }
            })
        }
        return jws.indices.count { IosStore.deliver(srv, jws[it], ids.getOrElse(it) { "" }) == BuyResult.Done }
    }

    override suspend fun restore(): Int = present(sync = true)
    override suspend fun syncSilently() { present(sync = false) }

    override fun manageSubscription() {
        IosStore.kit?.manageSubscriptions()
            ?: NSURL.URLWithString("https://apps.apple.com/account/subscriptions")?.let { UIApplication.sharedApplication.openURL(it, emptyMap<Any?, Any>(), null) }
    }
}

@Composable
fun rememberStoreHost(server: PurchaseServer?): StoreHost {
    val current = rememberUpdatedState(server)
    return remember { AppStoreHost { current.value } }
}
