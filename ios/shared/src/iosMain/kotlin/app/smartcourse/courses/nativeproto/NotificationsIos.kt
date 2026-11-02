package app.smartcourse.courses.nativeproto

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import app.smartcourse.courses.nativeproto.net.AuthState
import app.smartcourse.courses.nativeproto.net.KeyValueStore
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.json
import app.smartcourse.courses.nativeproto.net.parseList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import platform.Foundation.NSDateComponents
import platform.Foundation.NSURL
import platform.UIKit.UIApplication
import platform.UIKit.UIApplicationOpenNotificationSettingsURLString
import platform.UIKit.registerForRemoteNotifications
import platform.UserNotifications.UNAuthorizationOptionAlert
import platform.UserNotifications.UNAuthorizationOptionBadge
import platform.UserNotifications.UNAuthorizationOptionSound
import platform.UserNotifications.UNAuthorizationStatusAuthorized
import platform.UserNotifications.UNAuthorizationStatusEphemeral
import platform.UserNotifications.UNAuthorizationStatusNotDetermined
import platform.UserNotifications.UNAuthorizationStatusProvisional
import platform.UserNotifications.UNCalendarNotificationTrigger
import platform.UserNotifications.UNMutableNotificationContent
import platform.UserNotifications.UNNotificationRequest
import platform.UserNotifications.UNNotificationSound
import platform.UserNotifications.UNUserNotificationCenter
import platform.darwin.dispatch_async
import platform.darwin.dispatch_get_main_queue

/*
 * Notifications et rappels : partie PROPRE À L'IPHONE de l'écran commun (NotificationsUi.kt).
 *  - Demandes de la famille : APNs. L'iPhone reçoit d'Apple un jeton d'appareil, envoyé au serveur (/api/push/apns) ; le serveur y
 *    envoie la même notification qu'aux autres appareils (mêmes destinataires, même texte). Retiré à la déconnexion.
 *  - Rappels d'achat : notifications locales programmées (jours et horaires choisis), sans serveur. L'iPhone ne laisse pas une
 *    application vérifier la liste à l'heure du rappel : le nombre d'articles est celui de la liste connue quand l'application est
 *    quittée (reprogrammé à chaque sortie) ; aucun rappel s'il ne restait rien à acheter.
 */
object NotifIos {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val center get() = UNUserNotificationCenter.currentNotificationCenter()
    /** Dernier état connu de l'autorisation (lu de façon asynchrone auprès du système, rafraîchi au premier plan). */
    var status: Long = UNAuthorizationStatusNotDetermined
        private set

    fun refreshStatus(then: () -> Unit = {}) {
        center.getNotificationSettingsWithCompletionHandler { s ->
            dispatch_async(dispatch_get_main_queue()) { status = s?.authorizationStatus ?: UNAuthorizationStatusNotDetermined; then() }
        }
    }

    fun canPost() = status == UNAuthorizationStatusAuthorized || status == UNAuthorizationStatusProvisional || status == UNAuthorizationStatusEphemeral

    fun request(onResult: (Boolean) -> Unit) {
        center.requestAuthorizationWithOptions(UNAuthorizationOptionAlert or UNAuthorizationOptionSound or UNAuthorizationOptionBadge) { ok, _ ->
            dispatch_async(dispatch_get_main_queue()) { refreshStatus { onResult(ok) } }
        }
    }

    private fun signedIn() = (CoursesIos.current?.state as? AuthState.SignedIn)?.me
    private fun scopeKey() = signedIn()?.let { "${it.familyId.ifEmpty { "f" }}|${it.id}" }
    private fun requestsOn(): Boolean {
        val me = signedIn() ?: return false
        val key = scopeKey() ?: return false
        return me.role != "staff" && Env.kv?.get(NotifyKeys.key(key)) == "on"
    }

    /* ───── APNs ───── */

    private const val TOKEN = "apns-jeton"
    /** Version installée par la recette (signature de développement) : environnement « sandbox » d'Apple ; TestFlight et App Store : « production ». */
    private val environment get() = if (BuildConfig.FINAL) "production" else "sandbox"

    /** Premier plan, connexion, activation : l'iPhone (re)demande son jeton à Apple si les demandes sont activées pour ce profil. */
    fun syncRegistration() {
        val token = Env.kv?.get(TOKEN)
        val session = CoursesIos.current ?: return
        if (signedIn() == null) return
        // Cet iPhone utilisé par un autre profil, ou par le personnel : le serveur retire l'ancien enregistrement.
        if (token != null) scope.launch { session.api.call("POST", "/api/push/apns/check", buildJsonObject { put("token", token) }) }
        if (requestsOn() && canPost()) UIApplication.sharedApplication.registerForRemoteNotifications()
    }

    /** Jeton reçu d'Apple (AppDelegate). Envoyé au serveur si les demandes sont activées pour le profil connecté. */
    fun onToken(hex: String) {
        Env.kv?.put(TOKEN, hex)
        val session = CoursesIos.current ?: return
        if (!requestsOn()) return
        scope.launch {
            val r = session.api.call("POST", "/api/push/apns", buildJsonObject { put("token", hex); put("environment", environment) })
            logInfo("CoursesNotif", "iPhone enregistré pour les notifications : ${if (r is Outcome.Ok) "oui" else "non ($r)"}")
        }
    }

    fun stopRequests() {
        val token = Env.kv?.get(TOKEN) ?: return
        val session = CoursesIos.current ?: return
        scope.launch { session.api.call("DELETE", "/api/push/apns", buildJsonObject { put("token", token) }) }
    }

    /** Déconnexion : l'appareil est retiré du serveur avec la session (avant sa révocation). */
    suspend fun forget(server: String, cookie: String) {
        val token = Env.kv?.get(TOKEN) ?: return
        val transport = CoursesIos.current?.api?.transport ?: return
        try {
            transport.send("DELETE", "$server/api/push/apns", mapOf("Cookie" to "sc_session=$cookie", "Content-Type" to "application/json"), """{"token":"$token"}""")
        } catch (_: Throwable) { }
    }

    /* ───── Rappels d'achat (notifications locales) ───── */

    private fun ids() = (1..7).flatMap { d -> (0 until 6).map { i -> "rappel-$d-$i" } }

    /** (Re)programme les rappels du profil connecté ; les retire si désactivés, si personne n'est connecté ou s'il ne reste rien. */
    fun scheduleReminders() {
        center.removePendingNotificationRequestsWithIdentifiers(ids())
        val me = signedIn() ?: return
        val key = scopeKey() ?: return
        val kv = Env.kv ?: return
        val prefs = ReminderPrefs.decode(kv.get(ReminderPrefs.key(key)))
        if (!prefs.enabled || prefs.days.isEmpty() || prefs.times.isEmpty()) return
        val list = kv.get("list|$key")?.let { s -> try { parseList(json.parseToJsonElement(s) as JsonObject) } catch (_: Exception) { null } }
        val remaining = list?.takeIf { it.status == "active" }?.items?.count { it.status == "to_buy" } ?: 0
        if (remaining <= 0) { logInfo("CoursesRappel", "rien à acheter : aucun rappel programmé"); return }
        val content = UNMutableNotificationContent().apply {
            setTitle(if (remaining == 1) "Il reste 1 article à acheter" else "Il reste $remaining articles à acheter")
            setBody(if (me.role == "staff") "Ouvrez la liste du jour." else "Ouvrez votre liste de courses.")
            setSound(UNNotificationSound.defaultSound)
        }
        var n = 0
        for (d in prefs.days) prefs.times.take(6).forEachIndexed { i, t ->
            val (h, m) = ReminderPrefs.parseTime(t) ?: return@forEachIndexed
            // Jours : 1 = lundi … 7 = dimanche (réglage commun) ; iPhone : 1 = dimanche … 7 = samedi.
            val c = NSDateComponents().apply { weekday = (d % 7 + 1).toLong(); hour = h.toLong(); minute = m.toLong() }
            val trigger = UNCalendarNotificationTrigger.triggerWithDateMatchingComponents(c, repeats = true)
            center.addNotificationRequest(UNNotificationRequest.requestWithIdentifier("rappel-$d-$i", content, trigger), null)
            n++
        }
        logInfo("CoursesRappel", "$n rappel(s) programmé(s) ; $remaining article(s) restant(s)")
    }
}

@Composable
fun rememberNotifHost(): NotifHost = remember {
    object : NotifHost {
        override fun canPost() = NotifIos.canPost()
        override fun needsPermission() = NotifIos.status == UNAuthorizationStatusNotDetermined
        override fun request(onResult: (Boolean) -> Unit) = NotifIos.request(onResult)
        override fun startRequests() = NotifIos.syncRegistration()
        override fun stopRequests() = NotifIos.stopRequests()
        override fun saveReminders(kv: KeyValueStore, scope: String, p: ReminderPrefs) { kv.put(ReminderPrefs.key(scope), p.encode()); NotifIos.scheduleReminders() }
        override fun openSettings() {
            NSURL.URLWithString(UIApplicationOpenNotificationSettingsURLString)?.let { UIApplication.sharedApplication.openURL(it, emptyMap<Any?, Any>(), null) }
        }
        override val refusedText = "L'iPhone a refusé les notifications. Vous pouvez les autoriser dans les réglages du téléphone."
        override val blockedText = "L'iPhone bloque les notifications de cette application."
        override val remindersBlockedText = "Rappels enregistrés, mais l'iPhone bloque les notifications : vous ne les recevrez pas."
        override val requestsInfo = "Les notifications de demandes passent par le service de notification d'Apple : elles arrivent en général en quelques secondes, même application fermée."
        override val remindersInfo = "Heure locale du téléphone. Le nombre d'articles indiqué est celui de la liste au moment où vous avez quitté l'application ; aucun rappel s'il ne restait rien à acheter. Un rappel n'affiche jamais de montant."
    }
}
