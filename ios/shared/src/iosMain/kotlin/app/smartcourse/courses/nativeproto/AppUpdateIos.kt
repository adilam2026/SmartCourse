@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.runtime.Composable
import platform.Foundation.NSDate
import platform.Foundation.NSProcessInfo
import platform.Foundation.NSURL
import platform.Foundation.timeIntervalSince1970
import platform.UIKit.UIApplication
import kotlinx.cinterop.useContents

/**
 * Mise à jour : partie PROPRE À L'IPHONE (fiche App Store, version d'iOS). Logique et écrans communs : AppUpdate.kt.
 * Numéro comparé : BuildConfig.VERSION_CODE = numéro de build (CFBundleVersion), jamais la version commerciale « 1.0 ».
 */
object UpdatePlatform {
    const val NAME = "ios"
    /** Aucune fiche par défaut : tant que le serveur n'en donne pas, rien n'est proposé ni imposé. */
    const val DEFAULT_STORE_URL = "https://apps.apple.com/"

    /** Version majeure d'iOS (ex. 17). */
    fun osLevel(): Int = NSProcessInfo.processInfo.operatingSystemVersion.useContents { majorVersion.toInt() }

    fun openStore(url: String) {
        // Lien https://apps.apple.com/… : ouvert directement par l'App Store.
        NSURL.URLWithString(url)?.let { UIApplication.sharedApplication.openURL(it, emptyMap<Any?, Any>(), null) }
        logInfo("CoursesUpdate", "fiche App Store ouverte")
    }
}

fun nowMillis(): Long = (NSDate().timeIntervalSince1970 * 1000).toLong()

/** iPhone : pas de bouton Retour système ; l'écran bloquant couvre toute l'application. */
@Composable
fun UpdateBackGuard() {}
