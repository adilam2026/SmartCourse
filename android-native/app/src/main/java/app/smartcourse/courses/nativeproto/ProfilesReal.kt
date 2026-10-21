@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.AuthState
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.ProfileDto
import app.smartcourse.courses.nativeproto.net.ProfilesRepo
import app.smartcourse.courses.nativeproto.net.Session
import kotlinx.coroutines.launch

private val AVATAR_COLORS = listOf(Color(0xFF14B5AE), Color(0xFF6C8EF5), Color(0xFFF2994A), Color(0xFF9B7EDC), Color(0xFFE76F8A), Color(0xFF4DA3C7))
private fun avatarColor(id: String) = AVATAR_COLORS[(id.hashCode() and 0x7fffffff) % AVATAR_COLORS.size]
private val ROLES = listOf("Parent" to "parent", "Personnel" to "staff", "Administrateur" to "admin")

/** Profils réels de la famille : liste, création, modification du nom et du rôle, code d'accès, désactivation, suppression. */
@Composable
fun ProfilesScreenReal(session: Session, onBack: () -> Unit) {
    val demo = LocalDemo.current
    val me = (session.state as? AuthState.SignedIn)?.me
    val repo = remember { ProfilesRepo(session.api) }
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<ProfileDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<String?>(null) }
    var editFor by remember { mutableStateOf<ProfileDto?>(null) }
    var codeFor by remember { mutableStateOf<ProfileDto?>(null) }
    var deleteFor by remember { mutableStateOf<ProfileDto?>(null) }
    var deactivateFor by remember { mutableStateOf<ProfileDto?>(null) }
    var create by remember { mutableStateOf(false) }
    // Accès à partager : le code n'est connu qu'ici, juste après sa création ; il n'est ni journalisé ni enregistré.
    var shareFor by remember { mutableStateOf<AccessToShare?>(null) }
    var regenFor by remember { mutableStateOf<ProfileDto?>(null) }
    // Identifiant famille s'il est choisi, sinon le code famille (toujours valable) : c'est ce que le membre saisira.
    val familyCode = me?.family?.let { it.loginId ?: it.code }

    suspend fun reload() {
        when (val r = repo.list()) {
            is Outcome.Ok -> { items = r.value; error = null }
            is Outcome.Fail -> error = explain(r)
        }
        loading = false
    }
    LaunchedEffect(Unit) { reload() }

    fun <T> act(done: String?, block: suspend () -> Outcome<T>) {
        scope.launch {
            busy = true
            when (val r = block()) {
                is Outcome.Ok -> { reload(); done?.let { demo.say(it) } }
                is Outcome.Fail -> demo.say(explain(r))
            }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Profils", if (loading) "Chargement…" else "${items.size} profils", onBack = onBack, actions = {
            IconButton({ scope.launch { loading = true; reload() } }) { Icon(Icons.Rounded.Refresh, "Actualiser", tint = C.TealDark) }
            IconButton({ create = true }) { Icon(Icons.Rounded.PersonAdd, "Ajouter un profil", tint = C.TealDark) }
        })
        if (error != null && items.isEmpty()) {
            Column(Modifier.weight(1f).fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(error!!, style = MaterialTheme.typography.bodyMedium, color = C.Ink)
                Spacer(Modifier.height(16.dp))
                SecondaryButton("Réessayer", { scope.launch { loading = true; reload() } })
            }
        } else Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
            if (familyCode != null) { FamilyCodeCard(familyCode); Spacer(Modifier.height(10.dp)) }
            SCard {
                items.forEachIndexed { i, pr ->
                    if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(start = 64.dp))
                    Row(
                        Modifier.fillMaxWidth().padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 2.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(pr.displayName.take(1).uppercase(), avatarColor(pr.id), 40.dp, dim = !pr.active)
                        Column(Modifier.weight(1f)) {
                            Text(pr.displayName, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = if (pr.active) C.Ink else C.Muted)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 3.dp)) {
                                Pill(ProfileRules.roleLabel(pr), C.TealDark, C.TealSoft)
                                if (!pr.active) Pill("Désactivé", C.Muted, Color(0xFFE4EDF5))
                                if (pr.id == me?.id) Pill("Vous", C.Amber, C.AmberSoft)
                            }
                        }
                        Box {
                            IconButton({ menuFor = pr.id }, enabled = !busy) { Icon(Icons.Rounded.MoreVert, "Actions pour ${pr.displayName}", tint = C.Ink) }
                            DropdownMenu(menuFor == pr.id, { menuFor = null }, containerColor = Color.White, shape = RoundedCornerShape(16.dp)) {
                                val canShare = ProfileRules.canShareAccess(pr, me?.id) && familyCode != null
                                // Code oublié, code provisoire expiré ou perdu : nouveau code provisoire (l'ancien cesse aussitôt de fonctionner).
                                if (pr.id != me?.id) DropdownMenuItem(
                                    text = { Text(if (canShare) "Nouveau code provisoire" else "Nouveau code impossible", color = if (canShare) C.Ink else C.Muted) },
                                    leadingIcon = { Icon(Icons.Rounded.Share, null, tint = if (canShare) C.Ink else C.Muted) },
                                    enabled = canShare, onClick = { menuFor = null; regenFor = pr },
                                )
                                DropdownMenuItem(text = { Text("Modifier") }, leadingIcon = { Icon(Icons.Rounded.Edit, null, tint = C.Ink) },
                                    onClick = { menuFor = null; editFor = pr })
                                // Un code personnel n'est choisi que par la personne elle-même.
                                if (pr.id == me?.id) DropdownMenuItem(text = { Text("Modifier mon code d'accès") }, leadingIcon = { Icon(Icons.Rounded.Key, null, tint = C.Ink) },
                                    onClick = { menuFor = null; codeFor = pr })
                                if (!pr.active) DropdownMenuItem(
                                    text = { Text("Réactiver") }, leadingIcon = { Icon(Icons.Rounded.CheckCircle, null, tint = C.Ink) },
                                    onClick = { menuFor = null; act("Profil réactivé.") { repo.update(pr.id, active = true) } },
                                ) else DropdownMenuItem(
                                    text = { Text(if (ProfileRules.canDeactivate(pr)) "Désactiver" else "Désactivation impossible", color = if (ProfileRules.canDeactivate(pr)) C.Ink else C.Muted) },
                                    leadingIcon = { Icon(Icons.Rounded.Block, null, tint = if (ProfileRules.canDeactivate(pr)) C.Ink else C.Muted) },
                                    enabled = ProfileRules.canDeactivate(pr), onClick = { menuFor = null; deactivateFor = pr },
                                )
                                val canDelete = ProfileRules.canDelete(pr, me?.id)
                                DropdownMenuItem(
                                    text = { Text(if (canDelete) "Supprimer le profil" else "Suppression impossible", color = if (canDelete) C.Danger else C.Muted) },
                                    leadingIcon = { Icon(Icons.Rounded.Delete, null, tint = if (canDelete) C.Danger else C.Muted) },
                                    enabled = canDelete, onClick = { menuFor = null; deleteFor = pr },
                                )
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.Shield, null, tint = C.Muted, modifier = Modifier.size(18.dp))
                Text("L'administrateur principal et le dernier administrateur actif sont protégés ; un administrateur ne se désactive ni ne se supprime sans perdre d'abord son rôle. Désactiver un profil n'est pas le supprimer.", style = MaterialTheme.typography.bodySmall)
            }
        }
    }

    editFor?.let { p -> EditProfileSheet(p, ProfileRules.canChangeRole(p, items, me?.id), onDismiss = { editFor = null }) { name, role ->
        editFor = null
        act("Profil modifié.") { repo.update(p.id, displayName = name.takeIf { it != p.displayName }, role = role.takeIf { it != p.role }) }
    } }
    codeFor?.let { p -> ResetCodeSheet(p, onDismiss = { codeFor = null }) { a, b ->
        codeFor = null
        act("Code d'accès modifié : ${p.displayName} est déconnecté de ses téléphones.") { repo.resetSecret(p.id, a, b) }
    } }
    if (create) CreateProfileSheet(defaultCity = me?.city, familyLocated = me?.location?.confirmed == true, onDismiss = { create = false }) { name, login, role, city ->
        create = false
        scope.launch {
            busy = true
            when (val r = repo.createWithProvisional(name, login, role, city)) {
                is Outcome.Ok -> {
                    reload()
                    // Partage proposé tout de suite : c'est le seul moment où le code provisoire est connu.
                    if (familyCode != null) shareFor = AccessToShare(name, familyCode, login, r.value.second, "Profil créé avec un code d'accès provisoire. $name choisira son propre code à sa première connexion.")
                    else demo.say("Profil créé : $name.")
                }
                is Outcome.Fail -> demo.say(if (r.code == "invalid_request" && !serverSupports(demo.serverSchema, 26)) SERVER_UPDATE_MSG else explain(r))
            }
            busy = false
        }
    }
    regenFor?.let { p -> ConfirmDialog(
        "Nouveau code provisoire pour ${p.displayName}",
        "Son code d'accès n'est jamais affiché. Un code provisoire valable 7 jours va être généré : l'ancien code de ${p.displayName} cessera aussitôt de fonctionner " +
            "et ses téléphones seront déconnectés. À sa prochaine connexion, ${p.displayName} choisira son propre code.",
        "Générer et partager",
        {
            regenFor = null
            val fc = familyCode
            if (fc != null) scope.launch {
                busy = true
                when (val r = repo.provisionalCode(p.id)) {
                    is Outcome.Ok -> { reload(); shareFor = AccessToShare(p.displayName, fc, p.login, r.value, "Nouveau code provisoire : l'ancien code ne fonctionne plus. ${p.displayName} choisira son propre code à sa prochaine connexion.") }
                    is Outcome.Fail -> demo.say(settingFailure(r) { explain(it) })
                }
                busy = false
            }
        },
        { regenFor = null },
    ) }
    shareFor?.let { a -> ShareAccessSheet(a) { shareFor = null } }
    deactivateFor?.let { p -> ConfirmDialog(
        "Désactiver ${p.displayName} ?",
        "Cette personne sera déconnectée de tous ses téléphones et ne pourra plus se connecter. Son historique est conservé ; vous pourrez la réactiver.",
        "Désactiver", { deactivateFor = null; act("Profil désactivé.") { repo.update(p.id, active = false) } }, { deactivateFor = null },
    ) }
    deleteFor?.let { p -> ConfirmDialog(
        "Supprimer ${p.displayName} ?",
        "Ses achats restent dans les listes et l'historique partagés ; ils s'afficheront sous « Ancien profil ». Cette action est définitive.",
        "Supprimer", { deleteFor = null; act("Profil supprimé.") { repo.delete(p.id) } }, { deleteFor = null }, danger = true,
    ) }
}

@Composable
private fun EditProfileSheet(p: ProfileDto, roleEditable: Boolean, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var name by remember { mutableStateOf(p.displayName) }
    var role by remember { mutableStateOf(p.role) }
    AppSheet(onDismiss) {
        Text("Modifier le profil", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text("Identifiant : ${p.login}", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))
        FormField(name, { name = it }, "Nom affiché", leading = Icons.Rounded.Person)
        Spacer(Modifier.height(12.dp))
        Text("Rôle", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(6.dp))
        if (roleEditable) SegTabs(ROLES.map { it.first }, ROLES.indexOfFirst { it.second == role }.coerceAtLeast(0), { role = ROLES[it].second })
        else Text(if (p.primary) "Le rôle de l'administrateur principal ne peut pas être modifié." else "Ce rôle ne peut pas être modifié ici (dernier administrateur actif ou votre propre profil).", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(16.dp))
        PrimaryButton("Enregistrer", { onSave(name.trim(), role) }, Modifier.fillMaxWidth(), enabled = name.isNotBlank() && (name.trim() != p.displayName || role != p.role))
    }
}

@Composable
private fun ResetCodeSheet(p: ProfileDto, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var a by remember { mutableStateOf("") }
    var b by remember { mutableStateOf("") }
    val ok = isNewCode(a) && a == b
    AppSheet(onDismiss) {
        Text("Code d'accès de ${p.displayName}", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text("Entre 6 et 8 chiffres, saisis deux fois. Les téléphones de cette personne seront déconnectés.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))
        CodeField(a, { a = it }, "Nouveau code d'accès", rule = true)
        Spacer(Modifier.height(10.dp))
        CodeField(b, { b = it }, "Confirmer le code")
        if (b.isNotEmpty() && a != b) Text("Les deux codes ne sont pas identiques.", color = C.Danger, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(16.dp))
        PrimaryButton("Enregistrer le code", { onSave(a, b) }, Modifier.fillMaxWidth(), enabled = ok)
    }
}

@Composable
private fun CreateProfileSheet(defaultCity: String?, familyLocated: Boolean, onDismiss: () -> Unit, onSave: (String, String, String, String?) -> Unit) {
    var name by remember { mutableStateOf("") }
    var login by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("staff") }
    var city by remember { mutableStateOf(defaultCity) }
    var pickCity by remember { mutableStateOf(false) }
    val loginOk = Regex("^[a-z0-9._-]{2,30}$").matches(login)
    // Pays et ville confirmés pour la famille : le nouveau membre en hérite (aucune ville à choisir).
    val ok = name.isNotBlank() && loginOk && (familyLocated || city != null)
    AppSheet(onDismiss) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Text("Nouveau profil", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(12.dp))
            FormField(name, { name = it }, "Nom affiché (ex. Marie)", leading = Icons.Rounded.Person)
            Spacer(Modifier.height(10.dp))
            FormField(login, { login = it.lowercase().filter { c -> c.isLetterOrDigit() || c in "._-" }.take(30) }, "Identifiant personnel (ex. marie)", leading = Icons.Rounded.Person,
                keyboard = KeyboardOptions(keyboardType = KeyboardType.Ascii))
            if (login.isNotEmpty() && !loginOk) Text("2 à 30 caractères : lettres, chiffres, point, tiret.", color = C.Danger, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(12.dp))
            Text("Rôle", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(6.dp))
            SegTabs(ROLES.map { it.first }, ROLES.indexOfFirst { it.second == role }, { role = ROLES[it].second })
            Spacer(Modifier.height(12.dp))
            if (!familyLocated) {
                SecondaryButton(city?.let { "Ville : $it" } ?: "Choisir la ville", { pickCity = true }, Modifier.fillMaxWidth(), height = 52.dp)
                Spacer(Modifier.height(10.dp))
            }
            // Pas de code à choisir ici : un code provisoire (7 jours, usage unique) est généré et à partager ; le membre choisira le sien.
            Text("Un code d'accès provisoire sera créé, à partager avec ce membre. Il choisira son propre code à sa première connexion.", style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(16.dp))
            PrimaryButton("Créer le profil", { onSave(name.trim(), login, role, if (familyLocated) null else city) }, Modifier.fillMaxWidth(), enabled = ok)
        }
    }
    if (pickCity) CityPickerSheet(city, { city = it; pickCity = false }, { pickCity = false })
}
