@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

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
internal fun InfoRow(text: String) {
    Row(Modifier.padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.Rounded.Info, null, tint = C.Muted, modifier = Modifier.size(18.dp))
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

private fun ago(iso: String?): String? = try {
    if (iso == null) null else {
        val d = secondsSince(iso)
        when {
            (d / 60) < 1 -> "à l'instant"
            (d / 60) < 60 -> "il y a ${(d / 60)} min"
            (d / 3600) < 48 -> "il y a ${(d / 3600)} h"
            else -> "il y a ${(d / 86400)} jours"
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
                val fresh = last != null && try { secondsSince(last) / 3600 < 36 } catch (_: Exception) { false }
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
    val host = platformHost()
    fun open(path: String) {
        val base = data?.session?.serverAddress ?: run { demo.simulated("ouverture de la page"); return }
        if (!host.openUrl(base + path)) demo.say("Aucun navigateur disponible.")
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("À propos", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SCard(padding = PaddingValues(16.dp)) {
                Text("Mes Courses", style = MaterialTheme.typography.headlineMedium)
                Text("Les courses en famille", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                AboutLine("Version", BuildConfig.VERSION_NAME)
                AboutLine("Application", PLATFORM_LABEL)
                if (!BuildConfig.FINAL) AboutLine("Serveur", data?.session?.serverAddress?.substringAfter("://") ?: "démonstration")
                data?.me?.let { AboutLine("Profil", it.displayName + " · " + when (it.role) { "admin" -> "administrateur"; "parent" -> "parent"; else -> "personnel" }) }
            }
            SCard {
                AboutLink("Politique de confidentialité") { open("/confidentialite") }
                HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(horizontal = 16.dp))
                AboutLink("Supprimer mon compte (page web)") { open("/suppression-compte") }
            }
            InfoRow((if (BuildConfig.FINAL) "Cette application s'installe à côté de l'application web actuelle. " else "Cette version est une version de recette : elle ne remplace pas l'application actuelle. ") + "Données stockées sur le téléphone : la dernière liste, le catalogue, vos brouillons et les demandes en attente d'envoi ; jamais votre code d'accès.")
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

/* ───────────── Supprimer toute la famille (administrateur principal) ───────────── */

@Composable
fun ResetFamilySheet(onDismiss: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val scope = rememberCoroutineScope()
    var preview by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var understood by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (data != null) when (val r = data.session.api.call("GET", "/api/family/reset-preview")) {
            is Outcome.Ok -> preview = r.value
            is Outcome.Fail -> error = if (r.failure == app.smartcourse.courses.nativeproto.net.Failure.FORBIDDEN) "Seul l'administrateur principal peut supprimer toute la famille." else explain(r)
        }
    }
    AppSheet(onDismiss) {
      // Hauteur stable (le contenu arrive après le chargement de l'aperçu) et défilement si l'écran est petit ou le clavier ouvert.
      Column(Modifier.heightIn(min = 420.dp).verticalScroll(rememberScrollState())) {
        Text("Supprimer toute la famille", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(6.dp))
        if (data == null) {
            Text("Les listes et l'historique de la famille seront effacés. Cette action est définitive.", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
            PrimaryButton("Supprimer (simulation)", { onDismiss(); demo.simulated("suppression (rien n'est effacé dans ce prototype)") }, Modifier.fillMaxWidth())
        } else {
        error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
        preview?.let { p ->
            val fam = p["family"]?.jsonObject
            val counts = p["counts"]?.jsonObject
            val ready = p["ready"]?.jsonObject?.get("recoveryEmailVerified")?.jsonPrimitive?.booleanOrNull == true
            fun n(k: String) = counts?.get(k)?.jsonPrimitive?.contentOrNull ?: "?"
            Text("Conséquences, définitives :", style = MaterialTheme.typography.titleSmall)
            Text(
                "• La famille « ${fam?.get("name")?.jsonPrimitive?.contentOrNull ?: ""} » et ses ${n("profiles")} profils sont supprimés : plus personne ne peut s'y connecter, sur aucun téléphone.\n" +
                "• Sont effacés : ${n("lists")} listes, ${n("purchases")} achats, ${n("products")} produits, l'historique, les favoris, les prix de la famille et ceux qu'elle a partagés, les photos ajoutées, l'adresse de récupération.\n" +
                "• Rien ne peut être récupéré depuis l'application. Des sauvegardes du serveur, s'il en existe, peuvent encore contenir ces données jusqu'à leur propre suppression.\n" +
                "• Les autres familles ne sont pas touchées.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(10.dp))
            if (!ready) Text("Vérifiez d'abord votre adresse e-mail de récupération (Réglages → Récupération).", color = C.Amber, style = MaterialTheme.typography.bodyMedium)
            else {
                CodeField(password, { password = it }, "Votre code d'accès", legacy = true)
                Spacer(Modifier.height(8.dp))
                FormField(code, { code = it.uppercase() }, "Tapez le code famille ${fam?.get("code")?.jsonPrimitive?.contentOrNull ?: ""}")
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { understood = !understood }) {
                    CheckBox(understood, { understood = it }, label = "Je comprends que toute la famille sera supprimée définitivement")
                    Text("Je comprends que toute la famille sera supprimée définitivement.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                PrimaryButton("Supprimer définitivement la famille", { confirm = true }, Modifier.fillMaxWidth(), enabled = password.isNotBlank() && code.isNotBlank() && understood && !busy)
            }
        }
        }
      }
    }
    if (confirm && data != null) ConfirmDialog("Supprimer toute la famille ?", "Tous les profils, listes et historiques seront effacés. Cette action est définitive et ne peut pas être annulée.", "Supprimer la famille", {
        confirm = false; busy = true
        scope.launch {
            when (val r = data.session.api.call("POST", "/api/family/reset", buildJsonObject { put("password", password); put("confirmCode", code.trim()) })) {
                is Outcome.Ok -> { data.wipeLocal(); onDismiss(); data.session.accountDeleted("La famille a été supprimée définitivement. Plus aucun membre ne peut s'y connecter.") }
                is Outcome.Fail -> demo.say(when {
                    r.code == "code_mismatch" -> "Le code famille saisi ne correspond pas."
                    r.code == "reset_not_ready" -> "Vérifiez d'abord votre adresse e-mail de récupération."
                    r.failure == app.smartcourse.courses.nativeproto.net.Failure.FORBIDDEN || r.code == "invalid_credentials" -> "Code d'accès incorrect."
                    else -> explain(r)
                })
            }
            busy = false
        }
    }, { confirm = false }, danger = true)
}


/** Rappels d'achat personnels : jours, horaires (ajout, modification, suppression). État réel d'Android affiché. */
