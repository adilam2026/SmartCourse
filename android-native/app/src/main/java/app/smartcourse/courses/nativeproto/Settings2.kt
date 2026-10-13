@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
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
import java.time.Duration
import java.time.Instant

/** Les écrans « Récupération », « Notifications », « Sauvegarde » et « À propos » (démonstration : exemples ; connecté : données réelles). */
@Composable
fun StubScreen(title: String, onBack: () -> Unit) {
    when (title.lowercase().replace("é", "e").replace("à", "a").replace(" ", "")) {
        "recuperation" -> RecoveryScreen(onBack)
        "notifications" -> NotificationsScreen(onBack)
        "sauvegarde" -> BackupScreen(onBack)
        "apropos" -> AboutScreen(onBack)
        else -> Column(Modifier.fillMaxSize()) {
            TopBar(title, onBack = onBack)
            Text("Cet écran n'existe pas.", color = C.Muted, modifier = Modifier.padding(24.dp))
        }
    }
}

@Composable
private fun InfoRow(text: String) {
    Row(Modifier.padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.Rounded.Info, null, tint = C.Muted, modifier = Modifier.size(18.dp))
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

private fun ago(iso: String?): String? = try {
    if (iso == null) null else {
        val d = Duration.between(Instant.parse(iso), Instant.now())
        when {
            d.toMinutes() < 1 -> "à l'instant"
            d.toMinutes() < 60 -> "il y a ${d.toMinutes()} min"
            d.toHours() < 48 -> "il y a ${d.toHours()} h"
            else -> "il y a ${d.toDays()} jours"
        }
    }
} catch (_: Exception) { null }

/* ───────────── Récupération ───────────── */

@Composable
fun RecoveryScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<JsonObject?>(if (data == null) buildJsonObject { put("canEdit", true); put("email", "famille@exemple.ma"); put("verified", true); put("resendInSeconds", 0) } else null) }
    var error by remember { mutableStateOf<String?>(null) }
    var email by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var wait by remember { mutableIntStateOf(0) }

    fun apply(o: JsonObject) { state = o; wait = o["resendInSeconds"]?.jsonPrimitive?.intOrNull ?: 0; if (email.isEmpty()) email = o["email"]?.jsonPrimitive?.contentOrNull ?: "" }
    LaunchedEffect(Unit) {
        if (data != null) when (val r = data.session.api.call("GET", "/api/recovery-email")) {
            is Outcome.Ok -> apply(r.value)
            is Outcome.Fail -> error = if (r.failure == app.smartcourse.courses.nativeproto.net.Failure.FORBIDDEN) "Réservé aux administrateurs." else "Indisponible hors connexion."
        } else email = "famille@exemple.ma"
    }
    LaunchedEffect(wait) { if (wait > 0) { delay(1000); wait-- } }

    fun act(path: String, method: String, body: JsonObject?, okMsg: String) {
        if (data == null) { demo.simulated(okMsg); return }
        busy = true
        scope.launch {
            when (val r = data.session.api.call(method, path, body)) {
                is Outcome.Ok -> { apply(r.value); demo.say(okMsg) }
                is Outcome.Fail -> demo.say(when (r.code) {
                    "mail_unavailable", "mail_not_configured" -> "L'envoi d'e-mails n'est pas disponible sur ce serveur."
                    "invalid_email" -> "Cette adresse e-mail n'est pas valable."
                    "too_many_requests", "rate_limited" -> "Trop de demandes : réessayez plus tard."
                    else -> if (r.failure == app.smartcourse.courses.nativeproto.net.Failure.RATE_LIMITED) "Trop de demandes : réessayez plus tard." else explain(r)
                })
            }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Récupération", "Retrouver l'accès à la famille", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { Text(it, color = C.Muted, modifier = Modifier.padding(vertical = 24.dp)) }
            val st = state
            if (st == null && error == null) Text("Chargement…", color = C.Muted, modifier = Modifier.padding(vertical = 24.dp))
            if (st != null) {
                val canEdit = st["canEdit"]?.jsonPrimitive?.booleanOrNull == true
                val verified = st["verified"]?.jsonPrimitive?.booleanOrNull == true
                val current = st["email"]?.jsonPrimitive?.contentOrNull
                SCard(padding = PaddingValues(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Rounded.Email, null, tint = C.TealDark)
                        Text("Adresse de récupération", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        if (current == null) Pill("Aucune", C.Muted, androidx.compose.ui.graphics.Color(0xFFE4EDF5))
                        else if (verified) Pill("Vérifiée", C.TealDark, C.TealSoft) else Pill("À vérifier", C.Amber, C.AmberSoft)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(current ?: "Ajoutez une adresse pour pouvoir retrouver le code famille ou choisir un nouveau code d'accès.", style = MaterialTheme.typography.bodyMedium)
                    st["lastMail"]?.let { it as? JsonObject }?.let { m ->
                        val s = m["status"]?.jsonPrimitive?.contentOrNull
                        Text("Dernier e-mail : " + when (s) { "sent" -> "envoyé"; "sending" -> "en cours d'envoi"; else -> "non envoyé" } + (ago(m["at"]?.jsonPrimitive?.contentOrNull)?.let { " ($it)" } ?: ""),
                            style = MaterialTheme.typography.bodySmall, color = if (s == "failed") C.Danger else C.Muted, modifier = Modifier.padding(top = 4.dp))
                    }
                }
                if (canEdit) {
                    SCard(padding = PaddingValues(16.dp)) {
                        Text(if (current == null) "Ajouter une adresse" else "Changer d'adresse", style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(8.dp))
                        FormField(email, { email = it.trim() }, "Adresse e-mail", leading = Icons.Rounded.Email, keyboard = KeyboardOptions(keyboardType = KeyboardType.Email))
                        Spacer(Modifier.height(10.dp))
                        PrimaryButton("Enregistrer et envoyer le lien", { act("/api/recovery-email", "PUT", buildJsonObject { put("email", email) }, "Adresse enregistrée : un e-mail de vérification est envoyé.") },
                            Modifier.fillMaxWidth(), enabled = email.contains("@") && email != current && !busy)
                        if (current != null && !verified) {
                            Spacer(Modifier.height(8.dp))
                            SecondaryButton(if (wait > 0) "Renvoyer le lien (${wait} s)" else "Renvoyer le lien", { act("/api/recovery-email/resend", "POST", null, "Lien renvoyé.") }, Modifier.fillMaxWidth(), height = 52.dp)
                        }
                        if (current != null && verified) {
                            Spacer(Modifier.height(8.dp))
                            SecondaryButton("Envoyer un e-mail de test", { act("/api/recovery-email/test", "POST", null, "E-mail de test envoyé.") }, Modifier.fillMaxWidth(), height = 52.dp)
                        }
                    }
                } else InfoRow("Seul l'administrateur principal gère l'adresse de récupération.")
                InfoRow("Les liens reçus par e-mail s'ouvrent dans le navigateur du téléphone : ils vous permettent de retrouver le code famille ou de choisir un nouveau code d'accès. L'ancien code n'est jamais envoyé.")
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

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
        TopBar("Notifications", "Réglages propres à ce profil", onBack = onBack)
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
            InfoRow("Les notifications ne sont pas instantanées : l'application vérifie le serveur environ toutes les 15 minutes (Android choisit le moment exact) et à chaque ouverture. Aucun service tiers n'est utilisé.")
            InfoRow("Une notification n'affiche que le prénom de la personne et le nombre de demandes, jamais le contenu de la liste.")
            Spacer(Modifier.height(12.dp))
        }
    }
    LaunchedEffect(Unit) { allowed = Notifier.canPost(ctx) }
}

/* ───────────── Sauvegarde ───────────── */

@Composable
fun BackupScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    var st by remember { mutableStateOf<JsonObject?>(if (data == null) buildJsonObject { put("configured", true); put("schedule", "Une sauvegarde chiffrée par jour, suivie d'une restauration de vérification."); put("lastBackupAt", Instant.now().minusSeconds(7200).toString()); put("lastVerifiedOkAt", Instant.now().minusSeconds(7000).toString()) } else null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        if (data != null) when (val r = data.session.api.call("GET", "/api/admin/backup-status")) {
            is Outcome.Ok -> st = r.value
            is Outcome.Fail -> error = if (r.failure == app.smartcourse.courses.nativeproto.net.Failure.FORBIDDEN) "Réservé aux administrateurs." else "Indisponible hors connexion."
        }
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("Sauvegarde", "État des sauvegardes du serveur", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { Text(it, color = C.Muted, modifier = Modifier.padding(vertical = 24.dp)) }
            if (st == null && error == null) Text("Chargement…", color = C.Muted, modifier = Modifier.padding(vertical = 24.dp))
            st?.let { s ->
                val configured = s["configured"]?.jsonPrimitive?.booleanOrNull == true
                val last = s["lastBackupAt"]?.jsonPrimitive?.contentOrNull
                val ver = s["lastVerifiedOkAt"]?.jsonPrimitive?.contentOrNull
                val failed = s["lastVerifyFailedAt"]?.jsonPrimitive?.contentOrNull
                val fresh = last != null && try { Duration.between(Instant.parse(last), Instant.now()).toHours() < 36 } catch (_: Exception) { false }
                val healthy = configured && fresh && ver != null && (failed == null || failed < ver)
                SCard(padding = PaddingValues(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Sauvegardes", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        if (!configured) Pill("Non configurées", C.Danger, androidx.compose.ui.graphics.Color(0xFFFDE8E8))
                        else if (healthy) Pill("À jour", C.TealDark, C.TealSoft) else Pill("À surveiller", C.Amber, C.AmberSoft)
                    }
                    Spacer(Modifier.height(10.dp))
                    Text("Dernière sauvegarde : " + (ago(last) ?: "jamais"), style = MaterialTheme.typography.bodyMedium)
                    Text("Dernière restauration de contrôle réussie : " + (ago(ver) ?: "jamais"), style = MaterialTheme.typography.bodyMedium)
                    if (failed != null && (ver == null || failed > ver)) Text("Le dernier contrôle a échoué ${ago(failed) ?: ""}.", style = MaterialTheme.typography.bodyMedium, color = C.Danger)
                }
                s["schedule"]?.jsonPrimitive?.contentOrNull?.let { InfoRow(it) }
            }
            InfoRow("Cet écran est en lecture seule : les sauvegardes sont gérées par le serveur. L'application ne peut ni les lancer, ni les restaurer, ni les effacer.")
            Spacer(Modifier.height(12.dp))
        }
    }
}

/* ───────────── À propos ───────────── */

@Composable
fun AboutScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val ctx = LocalContext.current
    fun open(path: String) {
        val base = data?.session?.serverAddress ?: run { demo.simulated("ouverture de la page"); return }
        try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(base + path)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { demo.say("Aucun navigateur disponible.") }
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("À propos", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SCard(padding = PaddingValues(16.dp)) {
                Text("Courses", style = MaterialTheme.typography.headlineMedium)
                Text("Les courses en famille", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                AboutLine("Version", BuildConfig.VERSION_NAME)
                AboutLine("Application", "native (Android)")
                AboutLine("Serveur", data?.session?.serverAddress?.substringAfter("://") ?: "démonstration")
                data?.me?.let { AboutLine("Profil", it.displayName + " · " + when (it.role) { "admin" -> "administrateur"; "parent" -> "parent"; else -> "personnel" }) }
            }
            SCard {
                AboutLink("Politique de confidentialité") { open("/confidentialite") }
                HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(horizontal = 16.dp))
                AboutLink("Supprimer mon compte (page web)") { open("/suppression-compte") }
            }
            InfoRow("Cette version est une version de recette : elle ne remplace pas l'application actuelle. Données stockées sur le téléphone : la dernière liste, le catalogue, vos brouillons et les demandes en attente d'envoi ; jamais votre code d'accès.")
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable private fun AboutLine(k: String, v: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(k, style = MaterialTheme.typography.bodyMedium, color = C.Muted, modifier = Modifier.width(110.dp))
        Text(v, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

@Composable private fun AboutLink(text: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickableRow(onClick).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleSmall, color = C.TealDark)
    }
}

private fun Modifier.clickableRow(onClick: () -> Unit) = this.then(Modifier.clickable(onClick = onClick))

/* ───────────── Réinitialiser la famille ───────────── */

@Composable
fun ResetFamilySheet(onDismiss: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val scope = rememberCoroutineScope()
    var preview by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (data != null) when (val r = data.session.api.call("GET", "/api/family/reset-preview")) {
            is Outcome.Ok -> preview = r.value
            is Outcome.Fail -> error = if (r.failure == app.smartcourse.courses.nativeproto.net.Failure.FORBIDDEN) "Seul l'administrateur principal peut réinitialiser la famille." else explain(r)
        }
    }
    AppSheet(onDismiss) {
        Text("Réinitialiser la famille", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(6.dp))
        if (data == null) {
            Text("Les listes et l'historique de la famille seront effacés. Cette action est définitive.", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
            PrimaryButton("Réinitialiser (simulation)", { onDismiss(); demo.simulated("réinitialisation (rien n'est effacé dans ce prototype)") }, Modifier.fillMaxWidth())
            return@AppSheet
        }
        error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
        preview?.let { p ->
            val fam = p["family"]?.jsonObject
            val counts = p["counts"]?.jsonObject
            val ready = p["ready"]?.jsonObject?.get("recoveryEmailVerified")?.jsonPrimitive?.booleanOrNull == true
            Text("Seront effacés définitivement pour « ${fam?.get("name")?.jsonPrimitive?.contentOrNull ?: ""} » : ${counts?.get("profiles")?.jsonPrimitive?.contentOrNull ?: "?"} profils, ${counts?.get("lists")?.jsonPrimitive?.contentOrNull ?: "?"} listes, ${counts?.get("purchases")?.jsonPrimitive?.contentOrNull ?: "?"} achats, ${counts?.get("products")?.jsonPrimitive?.contentOrNull ?: "?"} produits. Les autres familles ne sont pas touchées.", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(10.dp))
            if (!ready) Text("Vérifiez d'abord votre adresse e-mail de récupération (écran Récupération).", color = C.Amber, style = MaterialTheme.typography.bodyMedium)
            else {
                FormField(password, { password = it }, "Votre code d'accès", leading = Icons.Rounded.Lock, visual = PasswordVisualTransformation(), keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                Spacer(Modifier.height(8.dp))
                FormField(code, { code = it.uppercase() }, "Tapez le code famille ${fam?.get("code")?.jsonPrimitive?.contentOrNull ?: ""}")
                Spacer(Modifier.height(12.dp))
                PrimaryButton("Réinitialiser définitivement", { confirm = true }, Modifier.fillMaxWidth(), enabled = password.isNotBlank() && code.isNotBlank() && !busy)
            }
        }
    }
    if (confirm && data != null) ConfirmDialog("Effacer toute la famille ?", "Cette action est définitive et ne peut pas être annulée.", "Effacer", {
        confirm = false; busy = true
        scope.launch {
            when (val r = data.session.api.call("POST", "/api/family/reset", buildJsonObject { put("password", password); put("confirmCode", code.trim()) })) {
                is Outcome.Ok -> { demo.say("Famille réinitialisée."); onDismiss(); data.session.signOut() }
                is Outcome.Fail -> demo.say(when (r.code) { "invalid_credentials", "wrong_password" -> "Code d'accès incorrect."; "reset_not_ready" -> "Vérifiez d'abord votre adresse e-mail de récupération."; "confirm_mismatch", "wrong_confirmation" -> "Le code famille saisi ne correspond pas."; else -> explain(r) })
            }
            busy = false
        }
    }, { confirm = false }, danger = true)
}
