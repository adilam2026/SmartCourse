@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Outcome
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/*
 * Réglages des notifications et des rappels PROPRES À ANDROID (autorisation POST_NOTIFICATIONS, réglages du téléphone,
 * vérification périodique par WorkManager). Déplacés tels quels depuis Settings2.kt ; la version iPhone (APNs) est préparée à part.
 */

/* ───────────── Notifications ───────────── */

@Composable
fun NotificationsScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val ctx = LocalContext.current
    val kv = Env.kv
    val staff = data?.me?.role == "staff"
    var on by remember { mutableStateOf(if (data != null && kv != null) Notifier.enabled(kv, data.scopeKey) else false) }
    var allowed by remember { mutableStateOf(Notifier.canPost(ctx)) }
    fun enable() {
        if (data == null || kv == null) { on = true; demo.simulated("activation des notifications"); return }
        kv.put(Notifier.key(data.scopeKey), "on"); Notifier.ensureChannel(ctx); Notifier.schedule(ctx); on = true
        demo.say("Notifications activées.")
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        allowed = Notifier.canPost(ctx)
        if (ok) enable() else { on = false; demo.say("Android a refusé les notifications. Vous pouvez les autoriser dans les réglages du téléphone.") }
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("Notifications et rappels", "Réglages propres à ce profil", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SCard(padding = PaddingValues(vertical = 4.dp)) {
                val toggle: (Boolean) -> Unit = { want ->
                    if (!want) {
                        on = false
                        if (data != null && kv != null) { kv.remove(Notifier.key(data.scopeKey)); Notifier.cancel(ctx) }
                        demo.say("Notifications désactivées.")
                    } else if (Build.VERSION.SDK_INT >= 33 && !Notifier.canPost(ctx)) ask.launch(Manifest.permission.POST_NOTIFICATIONS) else enable()
                }
                Row(Modifier.fillMaxWidth().androidx_toggle(on, !staff, toggle).heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("Nouvelles demandes", style = MaterialTheme.typography.titleSmall, color = if (staff) C.Muted else C.Ink)
                        Text(if (staff) "Réservé aux parents et aux administrateurs." else "Être prévenu quand quelqu'un ajoute des articles à la liste.", style = MaterialTheme.typography.bodySmall)
                    }
                    TealSwitch(on, toggle, enabled = !staff)
                }
            }
            if (on && !allowed && !staff) SCard(padding = PaddingValues(16.dp)) {
                Text("Android bloque les notifications de cette application.", style = MaterialTheme.typography.titleSmall, color = C.Amber)
                Spacer(Modifier.height(8.dp))
                SecondaryButton("Ouvrir les réglages du téléphone", {
                    ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }, Modifier.fillMaxWidth(), height = 52.dp)
            }
            ReminderSettings(allowed) { allowed = Notifier.canPost(ctx) }
            InfoRow("Les notifications ne sont pas instantanées : l'application vérifie le serveur environ toutes les 15 minutes (Android choisit le moment exact) et à chaque ouverture. Aucun service tiers n'est utilisé.")
            InfoRow("Une notification n'affiche que le prénom de la personne et le nombre de demandes, jamais le contenu de la liste.")
            Spacer(Modifier.height(12.dp))
        }
    }
    LaunchedEffect(Unit) { allowed = Notifier.canPost(ctx) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ReminderSettings(allowed: Boolean, refresh: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val ctx = LocalContext.current
    val kv = Env.kv
    var prefs by remember { mutableStateOf(if (data != null && kv != null) Reminders.load(kv, data.scopeKey) else ReminderPrefs()) }
    var editing by remember { mutableStateOf<Int?>(null) } // index de l'horaire modifié ; -1 = nouvel horaire
    fun save(p: ReminderPrefs) {
        prefs = p
        if (data != null && kv != null) Reminders.save(ctx, kv, data.scopeKey, p)
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    LaunchedEffect(Unit) { refresh() }
    Text("Rappels d'achat (pour moi)", style = MaterialTheme.typography.titleSmall, color = C.Muted, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
    SCard(padding = PaddingValues(vertical = 4.dp)) {
        val toggle: (Boolean) -> Unit = { want ->
            save(prefs.copy(enabled = want))
            if (want && Build.VERSION.SDK_INT >= 33 && !Notifier.canPost(ctx)) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        Row(Modifier.fillMaxWidth().androidx_toggle(prefs.enabled, true, toggle).heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Me rappeler les articles restants", style = MaterialTheme.typography.titleSmall)
                Text("Seulement s'il reste des articles à acheter dans la liste en cours.", style = MaterialTheme.typography.bodySmall)
            }
            TealSwitch(prefs.enabled, toggle)
        }
        if (prefs.enabled) Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                ReminderPrefs.DAY_LABELS.forEach { (d, l) ->
                    ToggleChip(l, d in prefs.days) { save(prefs.copy(days = if (d in prefs.days) prefs.days - d else prefs.days + d)) }
                }
            }
            if (prefs.days.isEmpty()) Text("Choisissez au moins un jour.", color = C.Amber, style = MaterialTheme.typography.bodySmall)
            prefs.times.sorted().forEach { t ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.Bg).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(t, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    IconButton({ editing = prefs.times.indexOf(t) }) { Icon(Icons.Rounded.Edit, "Modifier l'horaire $t", tint = C.Ink) }
                    IconButton({ save(prefs.copy(times = prefs.times - t)) }) { Icon(Icons.Rounded.Delete, "Supprimer l'horaire $t", tint = C.Ink) }
                }
            }
            if (prefs.times.isEmpty()) Text("Ajoutez au moins un horaire.", color = C.Amber, style = MaterialTheme.typography.bodySmall)
            if (prefs.times.size < 6) SecondaryButton("Ajouter un horaire", { editing = -1 }, Modifier.fillMaxWidth(), leading = Icons.Rounded.Add)
        }
    }
    if (prefs.enabled && !allowed) SCard(padding = PaddingValues(16.dp)) {
        Text("Rappels enregistrés, mais Android bloque les notifications : vous ne les recevrez pas.", style = MaterialTheme.typography.titleSmall, color = C.Amber)
        Spacer(Modifier.height(8.dp))
        SecondaryButton("Ouvrir les réglages du téléphone", {
            ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }, Modifier.fillMaxWidth(), height = 52.dp)
    }
    if (prefs.enabled) InfoRow("Heure locale du téléphone. Les rappels peuvent être différés par Android (économie de batterie, mise en veille, mode Ne pas déranger…) : l'heure de réception n'est pas garantie. Un rappel n'affiche jamais de montant.")
    editing?.let { idx ->
        val initial = if (idx >= 0) prefs.times.getOrNull(idx)?.let { ReminderPrefs.parseTime(it) } else null
        val state = rememberTimePickerState(initial?.hour ?: 18, initial?.minute ?: 0, is24Hour = true)
        AlertDialog(
            onDismissRequest = { editing = null },
            confirmButton = { TextButton({
                val t = "${state.hour.toString().padStart(2, '0')}:${state.minute.toString().padStart(2, '0')}"
                val list = prefs.times.toMutableList()
                if (idx >= 0 && idx < list.size) list[idx] = t else list += t
                save(prefs.copy(times = list.distinct()))
                editing = null
            }) { Text("Enregistrer", color = C.TealDark) } },
            dismissButton = { TextButton({ editing = null }) { Text("Annuler", color = C.Ink) } },
            title = { Text(if (idx >= 0) "Modifier l'horaire" else "Nouvel horaire") },
            text = { TimePicker(state) },
        )
    }
}
