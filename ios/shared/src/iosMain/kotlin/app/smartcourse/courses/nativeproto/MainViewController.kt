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
import kotlinx.coroutines.launch
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
    /** Session de l'application (notifications, rappels). */
    val current: Session? get() = session

    private fun boot(): Session = session ?: run {
        val dir = (NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, true).first() as String) + "/store"
        Env.kv = FileKv(dir)
        val storage = KeychainStorage()
        // Le trousseau iPhone survit à la désinstallation (contrairement aux données Android) : au premier lancement après une
        // installation (dossier de l'application vide), la session d'une installation précédente est effacée.
        if (Env.kv?.get("installation") == null) { storage.clearSession(); Env.kv?.put("installation", "1") }
        // Recette seulement : contrôles automatiques qui changent de profil (même compte, même serveur) : session locale effacée au
        // lancement, comme « Effacer les données » sur Android. Les données restent sur le serveur commun.
        if (!BuildConfig.FINAL && platform.Foundation.NSProcessInfo.processInfo.environment["COURSES_RESET"] == "1") storage.clearSession()
        val s = Session(storage, ApiClient(storage), scope)
        if (BuildConfig.FINAL) s.setServer(BuildConfig.SERVER_URL)
        // Recette seulement : adresse du serveur de recette fournie au lancement par les contrôles automatiques (simulateur).
        else platform.Foundation.NSProcessInfo.processInfo.environment["COURSES_SERVER"]?.let { (it as? String)?.let(::normalizeServer)?.let(s::setServer) }
        s.beforeRevoke = { server, cookie -> NotifIos.forget(server, cookie) }   // déconnexion : cet iPhone ne reçoit plus rien
        s.start()
        logInfo("CoursesIos", "démarrage ; serveur ${if (s.serverAddress != null) "défini" else "absent"}")
        session = s
        s
    }

    /** Application au premier plan (ouverture ou retour) : session vérifiée, flux en direct rouvert. */
    fun onForeground() { session?.verify(); LiveHolder.current?.onForeground(); NotifIos.refreshStatus { NotifIos.syncRegistration() } }

    /** Application en arrière-plan : flux en direct fermé (comme onStop sur Android). */
    fun onBackground() { LiveHolder.current?.onBackground(); NotifIos.scheduleReminders() }

    /** Partie StoreKit 2 (Swift), fournie au lancement par l'application iPhone. */
    var storeKit: IosStoreKit?
        get() = IosStore.kit
        set(v) { IosStore.kit = v }

    /** Transaction App Store conclue hors du parcours d'achat (Transaction.updates, côté Swift) : présentée au serveur si connecté. */
    fun onStoreTransaction(jws: String, transactionId: String) {
        val d = LiveHolder.current ?: return // non connecté : présentée à la prochaine ouverture de « Mes Courses Famille »
        scope.launch {
            IosStore.deliver(object : PurchaseServer {
                override val accountToken get() = d.demo.plan?.storeAccountToken
                override suspend fun submit(body: kotlinx.serialization.json.JsonObject) = d.submitPurchase(body)
            }, jws, transactionId)
        }
    }

    /** Jeton APNs reçu d'Apple (AppDelegate Swift), en hexadécimal. */
    fun onApnsToken(hex: String) = NotifIos.onToken(hex)

    fun viewController(): UIViewController {
        val s = boot()
        return ComposeUIViewController(configure = {
            // Recette : arborescence d'accessibilité toujours transmise (contrôles automatiques XCUITest). En version finale, le
            // réglage par défaut la transmet dès qu'un service d'accessibilité (VoiceOver…) la demande.
            @OptIn(androidx.compose.runtime.ExperimentalComposeApi::class)
            if (!BuildConfig.FINAL) accessibilitySyncOptions = androidx.compose.ui.platform.AccessibilitySyncOptions.Always(debugLogger = null)
        }) {
            CoursesTheme {
                Box(Modifier.fillMaxSize()) { Root(s, false) }
            }
        }
    }
}

fun MainViewController(): UIViewController = CoursesIos.viewController()
