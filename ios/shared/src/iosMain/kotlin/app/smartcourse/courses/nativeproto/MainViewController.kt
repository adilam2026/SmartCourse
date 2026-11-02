package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.ComposeUIViewController
import app.smartcourse.courses.nativeproto.net.ApiClient
import app.smartcourse.courses.nativeproto.net.FileKv
import app.smartcourse.courses.nativeproto.net.KeychainStorage
import app.smartcourse.courses.nativeproto.net.Session
import app.smartcourse.courses.nativeproto.net.normalizeServer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import platform.Foundation.NSApplicationSupportDirectory
import platform.Foundation.NSSearchPathForDirectoriesInDomains
import platform.Foundation.NSUserDomainMask
import platform.UIKit.UIViewController

/*
 * Point d'entrée iPhone : l'équivalent de MainActivity.onCreate / onStart / onStop. Même session, même stockage local, mêmes écrans
 * (Root, commun) ; seule l'amorce est propre à la plateforme.
 */
object CoursesIos {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var session: Session? = null

    private fun boot(): Session = session ?: run {
        val dir = (NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, true).first() as String) + "/store"
        Env.kv = FileKv(dir)
        val storage = KeychainStorage()
        val s = Session(storage, ApiClient(storage), scope)
        if (BuildConfig.FINAL) s.setServer(BuildConfig.SERVER_URL)
        // Recette seulement : adresse du serveur de recette fournie au lancement par les contrôles automatiques (simulateur).
        else platform.Foundation.NSProcessInfo.processInfo.environment["COURSES_SERVER"]?.let { (it as? String)?.let(::normalizeServer)?.let(s::setServer) }
        s.start()
        session = s
        s
    }

    /** Application au premier plan (ouverture ou retour) : session vérifiée, flux en direct rouvert. */
    fun onForeground() { session?.verify(); LiveHolder.current?.onForeground() }

    /** Application en arrière-plan : flux en direct fermé (comme onStop sur Android). */
    fun onBackground() { LiveHolder.current?.onBackground() }

    fun viewController(): UIViewController {
        val s = boot()
        return ComposeUIViewController {
            CoursesTheme {
                Box(Modifier.fillMaxSize()) { Root(s, false) }
            }
        }
    }
}

fun MainViewController(): UIViewController = CoursesIos.viewController()
