package app.smartcourse.courses.nativeproto

import app.smartcourse.courses.nativeproto.net.KeyValueStore
import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/*
 * Notifications et rappels : partie PROPRE À ANDROID de l'écran commun (NotificationsUi.kt) — autorisation POST_NOTIFICATIONS,
 * réglages du téléphone, vérification périodique par WorkManager, rappels par AlarmManager. Textes inchangés.
 */
@Composable
fun rememberNotifHost(): NotifHost {
    val ctx = LocalContext.current
    val pending = remember { arrayOfNulls<(Boolean) -> Unit>(1) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> pending[0]?.invoke(ok); pending[0] = null }
    return remember(ctx) {
        object : NotifHost {
            override fun canPost() = Notifier.canPost(ctx)
            override fun needsPermission() = Build.VERSION.SDK_INT >= 33 && !Notifier.canPost(ctx)
            override fun request(onResult: (Boolean) -> Unit) { pending[0] = onResult; ask.launch(Manifest.permission.POST_NOTIFICATIONS) }
            override fun startRequests() { Notifier.ensureChannel(ctx); Notifier.schedule(ctx) }
            override fun stopRequests() { Notifier.cancel(ctx) }
            override fun saveReminders(kv: KeyValueStore, scope: String, p: ReminderPrefs) = Reminders.save(ctx, kv, scope, p)
            override fun openSettings() {
                ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            override val refusedText = "Android a refusé les notifications. Vous pouvez les autoriser dans les réglages du téléphone."
            override val blockedText = "Android bloque les notifications de cette application."
            override val remindersBlockedText = "Rappels enregistrés, mais Android bloque les notifications : vous ne les recevrez pas."
            override val requestsInfo = "Les notifications ne sont pas instantanées : l'application vérifie le serveur environ toutes les 15 minutes (Android choisit le moment exact) et à chaque ouverture. Aucun service tiers n'est utilisé."
            override val remindersInfo = "Heure locale du téléphone. Les rappels peuvent être différés par Android (économie de batterie, mise en veille, mode Ne pas déranger…) : l'heure de réception n'est pas garantie. Un rappel n'affiche jamais de montant."
        }
    }
}
