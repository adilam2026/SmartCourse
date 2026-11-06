package app.smartcourse.courses.nativeproto

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/** Mise à jour : partie PROPRE À ANDROID (fiche Google Play, niveau d'API, bouton Retour). Logique et écrans communs : AppUpdate.kt. */
object UpdatePlatform {
    const val NAME = "android"
    const val PACKAGE = "app.smartcourse.courses.natif"
    const val DEFAULT_STORE_URL = "https://play.google.com/store/apps/details?id=$PACKAGE"

    /** Niveau d'API Android (ex. 34) : un appareil trop ancien pour la version exigée n'est jamais bloqué (côté serveur). */
    fun osLevel(): Int = Build.VERSION.SDK_INT

    /** Fiche Mes Courses dans Google Play, sinon dans le navigateur. */
    fun openStore(url: String) {
        val context = AndroidEnv.context ?: return
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$PACKAGE")).setPackage("com.android.vending").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(market)
            android.util.Log.i("CoursesUpdate", "Google Play ouverte : market://details?id=$PACKAGE")
        } catch (_: ActivityNotFoundException) {
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                android.util.Log.i("CoursesUpdate", "navigateur, fiche ouverte : $url")
            } catch (_: ActivityNotFoundException) {
                android.util.Log.w("CoursesUpdate", "ni Google Play ni navigateur disponibles")
            }
        }
    }
}

fun nowMillis(): Long = System.currentTimeMillis()

/** Écran bloquant : le bouton Retour met l'application en arrière-plan au lieu de contourner l'écran. */
@Composable
fun UpdateBackGuard() {
    val context = LocalContext.current
    androidx.activity.compose.BackHandler { (context as? android.app.Activity)?.moveTaskToBack(true) }
}
