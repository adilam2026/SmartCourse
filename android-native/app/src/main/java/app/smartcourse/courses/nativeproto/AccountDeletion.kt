package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.Me
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.ProfileDto
import app.smartcourse.courses.nativeproto.net.ProfilesRepo
import app.smartcourse.courses.nativeproto.net.Session
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * « Supprimer mon compte » (menu Compte, tous les rôles). Supprimer SON compte n'est pas désactiver un profil : le profil est
 * anonymisé côté serveur (POST /api/me/delete, code d'accès retapé), ses accès fermés sur tous les téléphones, la famille et les autres
 * membres restent. L'administrateur principal ne peut pas supprimer son seul compte : il confie d'abord ce rôle à un autre administrateur
 * (POST /api/family/transfer-primary), ou supprime toute la famille (parcours existant, conséquences rappelées).
 */
@Composable
fun DeleteAccountSheet(me: Me, session: Session, onDismiss: () -> Unit, onDeleteFamily: () -> Unit) {
    var primary by remember { mutableStateOf(me.primary == true) }
    var transferred by remember { mutableStateOf<String?>(null) }
    AppSheet(onDismiss) {
        Column(Modifier.heightIn(min = 360.dp).verticalScroll(rememberScrollState())) {
            Text("Supprimer mon compte", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            if (primary) PrimaryAdminChoices(me, session, onDeleteFamily) { name -> primary = false; transferred = name }
            else {
                transferred?.let {
                    Note("$it est maintenant l'administrateur principal. Vous pouvez supprimer votre compte : la famille et ses membres restent.", ok = true)
                    Spacer(Modifier.height(10.dp))
                }
                OwnAccountDeletion(me, session, onDone = onDismiss)
                if (me.role == "admin") {
                    Spacer(Modifier.height(14.dp))
                    Text("Supprimer toute la famille est réservé à l'administrateur principal.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun Note(text: String, ok: Boolean = false) {
    Text(
        text, style = MaterialTheme.typography.bodyMedium, color = C.Ink,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (ok) C.TealSoft else C.AmberSoft).padding(12.dp),
    )
}

/** Personne autre que l'administrateur principal : suppression définitive de son seul compte. */
@Composable
private fun OwnAccountDeletion(me: Me, session: Session, onDone: () -> Unit) {
    val demo = LocalDemo.current
    val scope = rememberCoroutineScope()
    var secret by remember { mutableStateOf("") }
    var understood by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Text("Ce qui est supprimé définitivement", style = MaterialTheme.typography.titleSmall)
    Text("Votre nom, votre identifiant, votre code d'accès, votre ville et vos réglages. Vos accès sont fermés sur tous vos téléphones ; ce téléphone oublie aussi vos données.", style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(8.dp))
    Text("Ce qui reste", style = MaterialTheme.typography.titleSmall)
    Text("Votre famille et ses autres membres. Dans les listes et l'historique de la famille, votre nom est remplacé par « Ancien profil ».", style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(12.dp))
    FormField(secret, { secret = it.trim().take(6) }, "Votre code d'accès", leading = Icons.Rounded.Lock,
        visual = PasswordVisualTransformation(), keyboard = KeyboardOptions(keyboardType = KeyboardType.Password))
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { understood = !understood }) {
        CheckBox(understood, { understood = it }, label = "Je comprends que la suppression est définitive")
        Text("Je comprends que la suppression de mon compte est définitive.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
    error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 6.dp)) }
    Spacer(Modifier.height(6.dp))
    PrimaryButton(if (busy) "Suppression…" else "Supprimer mon compte", { confirm = true }, Modifier.fillMaxWidth(), enabled = secret.length == 6 && understood && !busy)
    if (confirm) ConfirmDialog("Supprimer votre compte ?", "Votre compte « ${me.displayName} » sera supprimé définitivement. Cette action ne peut pas être annulée.", "Supprimer", {
        confirm = false; busy = true; error = null
        scope.launch {
            when (val r = session.api.call("POST", "/api/me/delete", buildJsonObject { put("secret", secret) })) {
                is Outcome.Ok -> {
                    demo.data?.wipeLocal()
                    onDone()
                    session.accountDeleted("Votre compte a été supprimé. Vos accès sont fermés ; la famille et ses autres membres n'ont pas changé.")
                }
                is Outcome.Fail -> error = when {
                    r.code == "primary_cannot_delete" -> "L'administrateur principal doit d'abord confier ce rôle à un autre administrateur."
                    r.code == "last_admin" -> "Impossible : vous êtes le dernier administrateur actif."
                    r.failure == Failure.FORBIDDEN || r.failure == Failure.INVALID_CREDENTIALS -> "Code d'accès incorrect."
                    r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT -> "Connexion nécessaire pour supprimer votre compte."
                    else -> explain(r)
                }
            }
            busy = false
        }
    }, { confirm = false }, danger = true)
}

/** Administrateur principal : transférer le rôle (puis supprimer son compte) ou supprimer toute la famille. */
@Composable
private fun PrimaryAdminChoices(me: Me, session: Session, onDeleteFamily: () -> Unit, onTransferred: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val repo = remember { ProfilesRepo(session.api) }
    var admins by remember { mutableStateOf<List<ProfileDto>?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var chosen by remember { mutableStateOf<ProfileDto?>(null) }
    var secret by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        when (val r = repo.list()) {
            is Outcome.Ok -> admins = r.value.filter { it.role == "admin" && it.active && it.id != me.id }
            is Outcome.Fail -> loadError = explain(r)
        }
    }
    Note("Vous êtes l'administrateur principal${me.family?.let { " de « ${it.name} »" } ?: ""}. Ce rôle tient la famille (adresse de récupération, suppression de la famille) : votre compte ne peut pas être supprimé seul tant que vous l'avez.")
    Spacer(Modifier.height(14.dp))
    Text("1. Supprimer seulement mon compte", style = MaterialTheme.typography.titleSmall)
    Text("Confiez d'abord le rôle d'administrateur principal à un autre administrateur de la famille. Votre adresse de récupération sera retirée ; le nouvel administrateur principal enregistrera la sienne (Réglages → Récupération). Vous pourrez ensuite supprimer votre compte ; la famille et ses membres resteront.", style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(8.dp))
    when {
        loadError != null -> Text(loadError!!, color = C.Danger, style = MaterialTheme.typography.bodyMedium)
        admins == null -> Text("Chargement des administrateurs…", style = MaterialTheme.typography.bodySmall, color = C.Muted)
        admins!!.isEmpty() -> Text("Aucun autre administrateur dans la famille. Dans Réglages → Profils, donnez d'abord le rôle Administrateur à une personne de confiance (Modifier → Rôle), puis revenez ici.", style = MaterialTheme.typography.bodyMedium, color = C.Amber)
        else -> {
            Text("Nouvel administrateur principal :", style = MaterialTheme.typography.bodyMedium)
            admins!!.forEach { a ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { chosen = a }) {
                    RadioButton(chosen?.id == a.id, { chosen = a }, colors = RadioButtonDefaults.colors(selectedColor = C.Teal))
                    Text("${a.displayName} (${a.login})", style = MaterialTheme.typography.bodyLarge)
                }
            }
            FormField(secret, { secret = it.trim().take(6) }, "Votre code d'accès", leading = Icons.Rounded.Lock,
                visual = PasswordVisualTransformation(), keyboard = KeyboardOptions(keyboardType = KeyboardType.Password))
            error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 6.dp)) }
            Spacer(Modifier.height(8.dp))
            PrimaryButton(if (busy) "Transfert…" else "Transférer le rôle", { confirm = true }, Modifier.fillMaxWidth(), enabled = chosen != null && secret.length == 6 && !busy)
        }
    }
    Spacer(Modifier.height(20.dp))
    Text("2. Supprimer toute la famille", style = MaterialTheme.typography.titleSmall)
    Text("Efface la famille entière : tous les profils, listes, achats, historique, favoris, prix et photos. Tous les membres perdent l'accès.", style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(8.dp))
    SecondaryButton("Supprimer toute la famille…", onDeleteFamily, Modifier.fillMaxWidth(), danger = true)
    val target = chosen
    if (confirm && target != null) ConfirmDialog("Transférer le rôle ?", "${target.displayName} deviendra l'administrateur principal de la famille. Votre adresse de récupération sera retirée.", "Transférer", {
        confirm = false; busy = true; error = null
        scope.launch {
            when (val r = session.api.call("POST", "/api/family/transfer-primary", buildJsonObject { put("toProfileId", target.id); put("secret", secret) })) {
                is Outcome.Ok -> { session.verify(); onTransferred(target.displayName) }
                is Outcome.Fail -> error = when {
                    r.code == "target_not_admin" -> "Ce profil n'est plus un administrateur actif. Actualisez et choisissez-en un autre."
                    r.failure == Failure.FORBIDDEN || r.failure == Failure.INVALID_CREDENTIALS -> "Code d'accès incorrect."
                    r.failure == Failure.NOT_FOUND -> "Transfert indisponible sur ce serveur."
                    else -> explain(r)
                }
            }
            busy = false
        }
    }, { confirm = false })
}
