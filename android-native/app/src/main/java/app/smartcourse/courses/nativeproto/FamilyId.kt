package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.ApiClient
import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.Session
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Identifiant famille de connexion (ex. LesTaha04) : choisi par l'administrateur, unique, sans distinction de majuscules.
 * Même règle que le serveur : lettres sans accents, chiffres et « _ », de 4 à 30 caractères. La disponibilité est toujours
 * vérifiée par le serveur (ici pendant la saisie, puis de nouveau à l'enregistrement).
 */
object FamilyIdRules {
    const val RULE = "Lettres sans accents, chiffres et « _ », de 4 à 30 caractères"
    const val TAKEN = "Cet identifiant famille est déjà utilisé"
    private val PATTERN = Regex("^[A-Za-z0-9_]{4,30}$")
    fun valid(s: String) = PATTERN.matches(s)

    /** Saisie : seuls les caractères permis sont gardés (accents retirés), 30 au plus. */
    fun clean(s: String): String = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
        .filter { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' }.take(30)

    /** Proposition d'après le nom affiché (même calcul que le serveur) : « Famille Hélène » → « FamilleHelene ». */
    fun propose(name: String): String {
        val words = java.text.Normalizer.normalize(name, java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
            .split(Regex("[^A-Za-z0-9]+")).filter { it.isNotEmpty() }
        var id = words.joinToString("") { it.first().uppercaseChar() + it.substring(1) }
        if (id.length < 4) id = "Famille$id"
        return id.take(30)
    }
}

/** État du contrôle de disponibilité. [Unsupported] : serveur plus ancien, sans identifiant famille (le code famille reste utilisé). */
sealed interface FamilyIdStatus {
    data object Empty : FamilyIdStatus
    data object Checking : FamilyIdStatus
    data object Available : FamilyIdStatus
    data object Invalid : FamilyIdStatus
    data class Taken(val suggestions: List<String>) : FamilyIdStatus
    data object Unsupported : FamilyIdStatus
    data class Error(val message: String) : FamilyIdStatus
}

/** Contrôle auprès du serveur. [withSession] : depuis les réglages (les identifiants de sa propre famille restent libres pour elle). */
suspend fun checkFamilyId(api: ApiClient, id: String, withSession: Boolean): FamilyIdStatus {
    if (id.isEmpty()) return FamilyIdStatus.Empty
    if (!FamilyIdRules.valid(id)) return FamilyIdStatus.Invalid
    val body = buildJsonObject { put("id", id) }
    val r = if (withSession) api.call("POST", "/api/family-id/check", body) else api.callPublic("POST", "/api/family-id/check", body)
    return when (r) {
        is Outcome.Ok -> {
            if (r.value["available"]?.jsonPrimitive?.booleanOrNull == true) FamilyIdStatus.Available
            else if (r.value["valid"]?.jsonPrimitive?.booleanOrNull == false) FamilyIdStatus.Invalid
            else FamilyIdStatus.Taken((r.value["suggestions"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList())
        }
        is Outcome.Fail -> when (r.failure) {
            Failure.NOT_FOUND -> FamilyIdStatus.Unsupported
            Failure.RATE_LIMITED -> FamilyIdStatus.Error("Trop de vérifications : patientez une minute.")
            Failure.NETWORK, Failure.TIMEOUT, Failure.TLS -> FamilyIdStatus.Error("Pas de connexion : la disponibilité sera vérifiée quand le réseau revient.")
            else -> FamilyIdStatus.Error("Vérification impossible pour le moment : réessayez.")
        }
    }
}

/**
 * Champ « Identifiant famille (pour se connecter) » : contrôle de disponibilité pendant la saisie (après une courte pause),
 * message « déjà utilisé » et propositions disponibles à toucher.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FamilyIdField(value: String, onChange: (String) -> Unit, status: FamilyIdStatus, hint: String) {
    Text("Identifiant famille (pour se connecter)", style = MaterialTheme.typography.labelLarge, color = C.Ink)
    Spacer(Modifier.height(6.dp))
    val bad = status is FamilyIdStatus.Taken || status is FamilyIdStatus.Invalid
    FormField(
        value, { onChange(FamilyIdRules.clean(it)) }, "Ex. LesTaha04", leading = Icons.Rounded.Groups,
        keyboard = KeyboardOptions(keyboardType = KeyboardType.Ascii, capitalization = KeyboardCapitalization.None),
        trailing = {
            when (status) {
                FamilyIdStatus.Checking -> CircularProgressIndicator(Modifier.size(20.dp), color = C.TealDark, strokeWidth = 2.dp)
                FamilyIdStatus.Available -> Row(Modifier.padding(end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Check, null, tint = C.TealDark, modifier = Modifier.size(18.dp))
                    Text("Disponible", color = C.TealDark, style = MaterialTheme.typography.labelMedium)
                }
                is FamilyIdStatus.Taken, FamilyIdStatus.Invalid -> Icon(Icons.Rounded.ErrorOutline, if (bad) "Indisponible" else null, tint = C.Danger)
                else -> {}
            }
        },
    )
    Spacer(Modifier.height(6.dp))
    when (status) {
        is FamilyIdStatus.Taken -> {
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.DangerSoft).padding(horizontal = 12.dp, vertical = 10.dp)) {
                Text(FamilyIdRules.TAKEN, color = C.Danger, style = MaterialTheme.typography.titleSmall)
            }
            if (status.suggestions.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("Identifiants disponibles :", style = MaterialTheme.typography.bodySmall, color = C.Ink)
                Spacer(Modifier.height(6.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    status.suggestions.forEach { s ->
                        Box(
                            Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(C.TealSoft).border(1.dp, C.Teal.copy(alpha = 0.5f), RoundedCornerShape(22.dp))
                                .clickable { onChange(s) }.padding(horizontal = 16.dp, vertical = 10.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text(s, color = C.TealDark, style = MaterialTheme.typography.titleSmall) }
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            Text("Touchez une proposition ou modifiez l'identifiant. La disponibilité est vérifiée par le serveur, puis de nouveau à l'enregistrement.", style = MaterialTheme.typography.bodySmall)
        }
        FamilyIdStatus.Invalid -> Text(FamilyIdRules.RULE + ".", style = MaterialTheme.typography.bodySmall, color = C.Danger)
        FamilyIdStatus.Unsupported -> Text("Le serveur ne propose pas encore l'identifiant famille : votre famille recevra un code famille, et vous pourrez choisir l'identifiant plus tard dans Réglages.", style = MaterialTheme.typography.bodySmall)
        is FamilyIdStatus.Error -> Text(status.message, style = MaterialTheme.typography.bodySmall, color = C.Amber)
        else -> Text(hint, style = MaterialTheme.typography.bodySmall)
    }
}

/** Contrôle de disponibilité automatique : relancé 500 ms après la dernière frappe. */
@Composable
fun rememberFamilyIdCheck(api: ApiClient?, value: String, withSession: Boolean, current: String? = null): FamilyIdStatus {
    var status by remember { mutableStateOf<FamilyIdStatus>(FamilyIdStatus.Empty) }
    LaunchedEffect(value, api) {
        if (value.isEmpty()) { status = FamilyIdStatus.Empty; return@LaunchedEffect }
        if (!FamilyIdRules.valid(value)) { status = FamilyIdStatus.Invalid; return@LaunchedEffect }
        if (current != null && value == current) { status = FamilyIdStatus.Empty; return@LaunchedEffect }
        if (api == null) { status = FamilyIdStatus.Available; return@LaunchedEffect }
        status = FamilyIdStatus.Checking
        delay(500)
        status = checkFamilyId(api, value, withSession)
    }
    return status
}

/* ───────────── Réglages → Identifiant famille (administrateurs) ───────────── */

@Composable
fun FamilyIdScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val session = data?.session
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var loaded by remember { mutableStateOf(false) }
    var loginId by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var name by remember { mutableStateOf(data?.me?.family?.name ?: "") }
    var editing by remember { mutableStateOf(false) }
    var value by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var takenAfterSave by remember { mutableStateOf<FamilyIdStatus.Taken?>(null) }
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val api = session?.api ?: return@LaunchedEffect
        when (val r = api.call("GET", "/api/family/login-id")) {
            is Outcome.Ok -> {
                loginId = r.value["loginId"]?.jsonPrimitive?.contentOrNull
                code = r.value["code"]?.jsonPrimitive?.contentOrNull ?: ""
                name = r.value["name"]?.jsonPrimitive?.contentOrNull ?: name
                editing = loginId == null
                value = loginId ?: (r.value["proposal"]?.jsonPrimitive?.contentOrNull ?: FamilyIdRules.propose(name))
            }
            is Outcome.Fail -> error = settingFailure(r) { explain(it) }
        }
        loaded = true
    }
    val checked = rememberFamilyIdCheck(session?.api, value, withSession = true, current = loginId?.takeIf { it == value })
    val status = takenAfterSave ?: checked
    LaunchedEffect(value) { takenAfterSave = null }

    Column(Modifier.fillMaxSize()) {
        TopBar("Identifiant famille", name.ifBlank { null }, onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { NoteCard(it) }
            if (!loaded) Text("Chargement…", color = C.Muted, modifier = Modifier.padding(16.dp))
            else if (error == null && !editing && loginId != null) {
                // Identifiant choisi : affichage, partage et modification (avec confirmation).
                SCard(padding = PaddingValues(16.dp)) {
                    Text("Identifiant famille", style = MaterialTheme.typography.bodyLarge)
                    Text(loginId!!, style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold), color = C.Navy)
                    Text("Ancien code accepté : $code", style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryButton("Partager", {
                            if (AccessShare.share(ctx, AccessShare.familyMessage(loginId!!), "Partager l'identifiant famille") == "none") demo.say("Aucune application de partage disponible.")
                        }, Modifier.weight(1f), leading = Icons.Rounded.Share)
                        SecondaryButton("Modifier", { editing = true; value = loginId!! }, Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(6.dp))
                    SecondaryButton(if (copied) "Copié" else "Copier", { AccessShare.copy(ctx, "Identifiant famille", loginId!!); copied = true }, Modifier.fillMaxWidth(), leading = if (copied) Icons.Rounded.Check else Icons.Rounded.ContentCopy)
                    Spacer(Modifier.height(10.dp))
                    Text("Modifier : même contrôle de disponibilité et même confirmation. L'identifiant remplacé devient un alias permanent : il permet toujours de se connecter et n'est jamais réattribué à une autre famille.", style = MaterialTheme.typography.bodySmall)
                }
            } else if (error == null) {
                SCard(padding = PaddingValues(16.dp)) {
                    FamilyIdField(value, { value = it }, status, "Proposé : ${FamilyIdRules.propose(name)}. ${FamilyIdRules.RULE} ; majuscules et minuscules équivalentes.")
                }
                SCard(padding = PaddingValues(16.dp)) {
                    Text("Ce qui ne change pas", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(8.dp))
                    listOf(
                        "L'ancien code famille $code permet toujours de se connecter.",
                        "Même famille : membres, listes, budget et historique restent identiques. Aucun nouveau compte.",
                        "Chaque membre garde son identifiant personnel et son code d'accès personnel.",
                    ).forEach { t ->
                        Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(Icons.Rounded.Check, null, tint = C.TealDark, modifier = Modifier.size(20.dp))
                            Text(t, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.TealSoft).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Rounded.Info, null, tint = C.TealDark, modifier = Modifier.size(20.dp))
                    Text("Modifiable plus tard dans Réglages, avec confirmation. Chaque identifiant remplacé reste un alias permanent de votre famille : il fonctionne toujours et ne sera jamais attribué à une autre famille.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                }
                if (loginId != null) SecondaryButton("Annuler", { editing = false; value = loginId!! }, Modifier.fillMaxWidth())
            }
            Spacer(Modifier.height(8.dp))
        }
        if (loaded && error == null && editing) Box(Modifier.padding(16.dp)) {
            PrimaryButton(if (busy) "Enregistrement…" else "Enregistrer $value", { confirm = true }, Modifier.fillMaxWidth(), enabled = !busy && status == FamilyIdStatus.Available)
        }
    }
    if (confirm) ConfirmDialog(
        "Enregistrer $value ?",
        "Les membres pourront se connecter avec $value. L'ancien code famille $code reste valable.\n\nVous pourrez le modifier plus tard, toujours avec confirmation.",
        "Enregistrer",
        {
            confirm = false
            val api = session?.api
            if (api != null) scope.launch {
                busy = true
                when (val r = api.call("PUT", "/api/family/login-id", buildJsonObject { put("loginId", value) })) {
                    is Outcome.Ok -> {
                        loginId = r.value["loginId"]?.jsonPrimitive?.contentOrNull ?: value
                        editing = false; copied = false
                        session?.verify()
                        demo.say("Identifiant famille enregistré : $loginId.")
                    }
                    is Outcome.Fail -> if (r.code == "family_id_taken") {
                        // Pris entre-temps par une autre famille : rien n'est enregistré, nouvelles propositions.
                        takenAfterSave = (checkFamilyId(api, value, true) as? FamilyIdStatus.Taken) ?: FamilyIdStatus.Taken(emptyList())
                    } else demo.say(settingFailure(r) { explain(it) })
                }
                busy = false
            }
        },
        { confirm = false },
    )
}

/* ───────────── Première connexion avec un code provisoire ───────────── */

/** Le membre choisit son propre code d'accès personnel ; rien d'autre n'est possible avant (le serveur le refuse aussi). */
@Composable
fun FirstCodeScreen(session: Session, displayName: String, familyName: String?) {
    val scope = rememberCoroutineScope()
    var a by remember { mutableStateOf("") }
    var b by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Bienvenue $displayName", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Vous êtes connecté${familyName?.let { " à $it" } ?: ""} avec un code provisoire. Choisissez maintenant votre code d'accès personnel.",
            style = MaterialTheme.typography.bodyLarge,
        )
        SCard(padding = PaddingValues(16.dp)) {
            CodeField(a, { a = it; error = null }, "Nouveau code d'accès personnel", rule = true)
            Spacer(Modifier.height(4.dp))
            Text("6 à 8 chiffres, différent du code provisoire.", style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(10.dp))
            CodeField(b, { b = it; error = null }, "Confirmez le code")
            if (b.isNotEmpty() && a != b) Text("Les deux codes ne sont pas identiques.", color = C.Danger, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
        }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.TealSoft).padding(14.dp)) {
            Text("Ce code est à vous seul", style = MaterialTheme.typography.titleSmall, color = C.Navy)
            Spacer(Modifier.height(4.dp))
            Text("Personne ne pourra le revoir, pas même un administrateur. Le code provisoire cesse de fonctionner dès que vous enregistrez le vôtre. Code provisoire expiré (7 jours) : demandez-en un nouveau à un administrateur.", style = MaterialTheme.typography.bodyMedium)
        }
        error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
        PrimaryButton(if (busy) "Enregistrement…" else "Enregistrer mon code", {
            busy = true; error = null
            scope.launch {
                when (val r = session.api.call("POST", "/api/me/secret", buildJsonObject { put("secret", a); put("secretConfirm", b) })) {
                    is Outcome.Ok -> session.verify()
                    is Outcome.Fail -> error = when (r.code) {
                        "same_as_provisional" -> "Choisissez un code différent du code provisoire."
                        "weak_secret" -> "Code d'accès trop simple (évitez 123456, 111111…)."
                        "secret_mismatch" -> "Les deux codes ne sont pas identiques."
                        "invalid_secret" -> "Le code d'accès doit contenir entre 6 et 8 chiffres."
                        "no_provisional_code" -> { session.verify(); null }
                        else -> explain(r)
                    }
                }
                busy = false
            }
        }, Modifier.fillMaxWidth(), enabled = !busy && isNewCode(a) && a == b)
        Text("Étape obligatoire : la liste s'ouvre une fois le code enregistré.", style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Text(
            "Se déconnecter", color = C.TealDark, style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { session.signOut() }.padding(12.dp),
        )
    }
}
