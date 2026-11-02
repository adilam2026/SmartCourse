@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import app.smartcourse.courses.nativeproto.net.KeyValueStore
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp

/*
 * Écran « Notifications et rappels », COMMUN à Android et à l'iPhone (même présentation, mêmes réglages par profil). Ce qui dépend du
 * système (autorisation, réglages du téléphone, programmation des rappels, transport des notifications de demandes) et les phrases qui
 * le décrivent sont fournis par la plateforme : NotificationsAndroid.kt (Android), NotificationsIos.kt (iPhone).
 */
interface NotifHost {
    /** Le système autorise-t-il vraiment les notifications de l'application ? */
    fun canPost(): Boolean
    /** Faut-il demander l'autorisation au système avant d'activer ? */
    fun needsPermission(): Boolean
    /** Demande l'autorisation (fenêtre du système) ; [onResult] reçoit la réponse. */
    fun request(onResult: (Boolean) -> Unit)
    /** Demandes de la famille activées / désactivées pour ce profil (le réglage « on » est déjà enregistré / effacé). */
    fun startRequests()
    fun stopRequests()
    /** Rappels enregistrés pour ce profil : à (re)programmer. */
    fun saveReminders(kv: KeyValueStore, scope: String, p: ReminderPrefs)
    fun openSettings()
    val refusedText: String
    val blockedText: String
    val remindersBlockedText: String
    val requestsInfo: String
    val remindersInfo: String
}

@Composable
fun NotificationsScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val host = rememberNotifHost()
    val kv = Env.kv
    val staff = data?.me?.role == "staff"
    var on by remember { mutableStateOf(if (data != null && kv != null) (kv.get(NotifyKeys.key(data.scopeKey)) == "on") else false) }
    var allowed by remember { mutableStateOf(host.canPost()) }
    fun enable() {
        if (data == null || kv == null) { on = true; demo.simulated("activation des notifications"); return }
        kv.put(NotifyKeys.key(data.scopeKey), "on"); host.startRequests(); on = true
        demo.say("Notifications activées.")
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("Notifications et rappels", "Réglages propres à ce profil", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SCard(padding = PaddingValues(vertical = 4.dp)) {
                val toggle: (Boolean) -> Unit = { want ->
                    if (!want) {
                        on = false
                        if (data != null && kv != null) { kv.remove(NotifyKeys.key(data.scopeKey)); host.stopRequests() }
                        demo.say("Notifications désactivées.")
                    } else if (host.needsPermission()) host.request { ok ->
                        allowed = host.canPost()
                        if (ok) enable() else { on = false; demo.say(host.refusedText) }
                    } else enable()
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
                Text(host.blockedText, style = MaterialTheme.typography.titleSmall, color = C.Amber)
                Spacer(Modifier.height(8.dp))
                SecondaryButton("Ouvrir les réglages du téléphone", { host.openSettings() }, Modifier.fillMaxWidth(), height = 52.dp)
            }
            ReminderSettings(host, allowed) { allowed = host.canPost() }
            InfoRow(host.requestsInfo)
            InfoRow("Une notification n'affiche que le prénom de la personne et le nombre de demandes, jamais le contenu de la liste.")
            Spacer(Modifier.height(12.dp))
        }
    }
    LaunchedEffect(Unit) { allowed = host.canPost() }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ReminderSettings(host: NotifHost, allowed: Boolean, refresh: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val kv = Env.kv
    var prefs by remember { mutableStateOf(if (data != null && kv != null) ReminderPrefs.decode(kv.get(ReminderPrefs.key(data.scopeKey))) else ReminderPrefs()) }
    var editing by remember { mutableStateOf<Int?>(null) } // index de l'horaire modifié ; -1 = nouvel horaire
    fun save(p: ReminderPrefs) {
        prefs = p
        if (data != null && kv != null) host.saveReminders(kv, data.scopeKey, p)
    }
    LaunchedEffect(Unit) { refresh() }
    Text("Rappels d'achat (pour moi)", style = MaterialTheme.typography.titleSmall, color = C.Muted, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
    SCard(padding = PaddingValues(vertical = 4.dp)) {
        val toggle: (Boolean) -> Unit = { want ->
            save(prefs.copy(enabled = want))
            if (want && host.needsPermission()) host.request { refresh() }
        }
        Row(Modifier.fillMaxWidth().androidx_toggle(prefs.enabled, true, toggle).heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Me rappeler les articles restants", style = MaterialTheme.typography.titleSmall)
                Text("Seulement s'il reste des articles à acheter dans la liste en cours.", style = MaterialTheme.typography.bodySmall)
            }
            TealSwitch(prefs.enabled, toggle)
        }
        if (prefs.enabled) Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
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
        Text(host.remindersBlockedText, style = MaterialTheme.typography.titleSmall, color = C.Amber)
        Spacer(Modifier.height(8.dp))
        SecondaryButton("Ouvrir les réglages du téléphone", { host.openSettings() }, Modifier.fillMaxWidth(), height = 52.dp)
    }
    if (prefs.enabled) InfoRow(host.remindersInfo)
    editing?.let { idx ->
        val initial = if (idx >= 0) prefs.times.getOrNull(idx)?.let { ReminderPrefs.parseTime(it) } else null
        val state = rememberTimePickerState(initial?.first ?: 18, initial?.second ?: 0, is24Hour = true)
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
