package app.smartcourse.courses.nativeproto

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import platform.Foundation.NSURL
import platform.UIKit.UIApplication

/*
 * Achats iPhone (StoreKit) : partie PROPRE À L'IPHONE de l'écran commun « Mes Courses Famille » (PlanUi.kt).
 * Étape actuelle : StoreKit pas encore branché — aucune offre n'est proposée (jamais de prix écrit dans l'application) ; la gestion
 * de l'abonnement ouvre la page Apple des abonnements. Le branchement StoreKit 2 (côté Swift) suit (lot 4).
 */
@Composable
fun rememberStoreHost(): StoreHost = remember {
    object : StoreHost {
        override val storeName = "l'App Store"
        override val manageHint = "Réglages › votre nom › Abonnements"
        override suspend fun offers(): List<StoreOffer> = emptyList()
        override suspend fun buy(productId: String): BuyResult = BuyResult.Failed("Les achats ne sont pas encore ouverts.")
        override suspend fun restore(): Int = 0
        override fun manageSubscription() {
            NSURL.URLWithString("https://apps.apple.com/account/subscriptions")?.let { UIApplication.sharedApplication.openURL(it, emptyMap<Any?, Any>(), null) }
        }
    }
}
