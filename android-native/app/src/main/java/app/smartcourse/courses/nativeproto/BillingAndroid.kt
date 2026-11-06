package app.smartcourse.courses.nativeproto

import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/*
 * Achats Android (Google Play Billing) : partie PROPRE À ANDROID de l'écran commun « Mes Courses Famille » (PlanUi.kt).
 * Étape actuelle : aucune bibliothèque de paiement branchée — aucune offre n'est proposée (jamais de prix écrit dans l'application) ;
 * la gestion de l'abonnement ouvre la page Google Play. Le branchement Google Play Billing suit (lot 4).
 */
@Composable
fun rememberStoreHost(): StoreHost {
    val ctx = LocalContext.current
    return remember(ctx) {
        object : StoreHost {
            override val storeName = "Google Play"
            override val manageHint = "Google Play › Paiements et abonnements › Abonnements"
            override suspend fun offers(): List<StoreOffer> = emptyList()
            override suspend fun buy(productId: String): BuyResult = BuyResult.Failed("Les achats ne sont pas encore ouverts.")
            override suspend fun restore(): Int = 0
            override fun manageSubscription() {
                val uri = Uri.parse("https://play.google.com/store/account/subscriptions?sku=$PRODUCT_ANNUAL&package=${ctx.packageName}")
                runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
        }
    }
}
