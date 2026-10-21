@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.ShoppingBasket
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.Session
import app.smartcourse.courses.nativeproto.net.normalizeServer
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp

/** Message clair pour chaque cause d'échec réseau ou serveur. */
fun failureMessage(f: Failure): String = when (f) {
    Failure.INVALID_CREDENTIALS -> "Identifiants incorrects ou accès temporairement bloqué. Vérifiez l'identifiant famille, l'identifiant personnel et le code d'accès personnel."
    Failure.RATE_LIMITED -> "Trop de tentatives. Patientez une minute avant de réessayer."
    Failure.SETUP_INCOMPLETE -> "Installation à terminer : l'administrateur doit d'abord vérifier son adresse e-mail de récupération."
    Failure.SESSION_EXPIRED -> "Votre session a expiré ou a été fermée. Reconnectez-vous."
    Failure.NETWORK -> "Impossible de joindre le serveur. Vérifiez la connexion Internet et l'adresse du serveur."
    Failure.TIMEOUT -> "Le serveur met trop de temps à répondre. Réessayez."
    Failure.TLS -> "Connexion sécurisée refusée par le téléphone (certificat ou date incorrects)."
    Failure.CLEARTEXT -> "Adresse non sécurisée : utilisez une adresse en https://."
    Failure.SERVER_ERROR -> "Le serveur rencontre un problème. Réessayez dans quelques instants."
    Failure.NOT_COURSES_SERVER -> "Cette adresse ne correspond pas à un serveur Courses."
    Failure.BAD_REQUEST -> "Les informations saisies ne sont pas valides. Vérifiez-les."
    Failure.BAD_ADDRESS -> "Aucun serveur n'est configuré. Renseignez l'adresse du serveur."
    Failure.FORBIDDEN -> "Action réservée aux administrateurs."
    Failure.NOT_FOUND -> "Élément introuvable : il a peut-être été supprimé. Actualisez l'écran."
    Failure.CONFLICT -> "Action impossible dans l'état actuel. Actualisez l'écran."
    Failure.UNKNOWN -> "Une erreur inattendue est survenue. Réessayez."
}

@Composable
fun LoginScreen(session: Session?, onSimulated: (Role) -> Unit) {
    val demo = LocalDemo.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var serverSheet by remember { mutableStateOf(Launch.once("server")) }
    var tab by remember { mutableIntStateOf(if (Launch.str("tab") == "first") 1 else 0) }
    var sub by remember { mutableIntStateOf(if (Launch.str("sub") == "create") 1 else 0) }
    var help by remember { mutableStateOf(Launch.once("help")) }
    var helpKind by remember { mutableIntStateOf(0) }
    var family by remember { mutableStateOf(session?.storage?.lastFamily ?: "") }
    var login by remember { mutableStateOf(session?.storage?.lastLogin ?: "") }
    var code by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var famName by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("Casablanca") }
    val focus = remember { Launch.once("keyboard") }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        // En-tête : logo, accroche et photos de produits
        Box(Modifier.fillMaxWidth().height(176.dp)) {
            Row(Modifier.padding(start = 20.dp, top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(52.dp).shadow(6.dp, RoundedCornerShape(16.dp), ambientColor = C.Navy, spotColor = C.Navy)
                        .clip(RoundedCornerShape(16.dp)).background(Brush.verticalGradient(listOf(Color(0xFF123B66), C.Navy))),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Rounded.ShoppingBasket, null, tint = C.Teal, modifier = Modifier.size(30.dp)) }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Mes Courses", style = MaterialTheme.typography.headlineMedium)
                    Text("Les courses en famille", style = MaterialTheme.typography.bodySmall)
                }
            }
            val ring = Modifier.shadow(8.dp, CircleShape, ambientColor = C.Navy, spotColor = C.Navy)
            Box(Modifier.align(Alignment.TopEnd).padding(end = 14.dp, top = 8.dp).size(width = 196.dp, height = 158.dp)) {
                Photo(R.drawable.p_tomates, 98.dp, ring.align(Alignment.TopEnd), radius = 49.dp)
                Photo(R.drawable.p_carottes, 80.dp, ring.align(Alignment.BottomStart), radius = 40.dp)
                Photo(R.drawable.p_pain, 70.dp, ring.align(Alignment.BottomEnd).padding(end = 10.dp), radius = 35.dp)
            }
        }
        Column(Modifier.padding(horizontal = 20.dp)) {
            Text("Bienvenue", style = MaterialTheme.typography.headlineLarge)
            Text("Accédez à votre liste de courses familiale", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
            Spacer(Modifier.height(16.dp))
            SegTabs(listOf("Se connecter", "Première connexion"), tab, { tab = it })
            Spacer(Modifier.height(14.dp))

            if (tab == 0) {
                // Identifiant famille (ex. LesTaha04) ou ancien code famille : majuscules indifférentes, aucune majuscule imposée.
                FormField(family, { family = it.trim() }, "Identifiant famille", leading = Icons.Rounded.Group, focus = focus,
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Ascii, capitalization = KeyboardCapitalization.None))
                Text("Ex. LesTaha04. L'ancien code famille à 8 caractères reste accepté.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
                Spacer(Modifier.height(10.dp))
                FormField(login, { login = it }, "Identifiant personnel", leading = Icons.Rounded.Person)
                Spacer(Modifier.height(10.dp))
                CodeField(code, { code = it }, "Code d'accès personnel", legacy = true)
                Text("Votre code à vous. Il n'existe pas de mot de passe commun à la famille.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
                Spacer(Modifier.height(16.dp))
                val notice = session?.notice
                val farewell = session?.farewell
                if (farewell != null && error == null) Banner(farewell, info = true)
                else if (notice != null && error == null) Banner(failureMessage(notice), info = true)
                error?.let { Banner(it) }
                if (error != null || notice != null || farewell != null) Spacer(Modifier.height(10.dp))
                PrimaryButton(if (busy) "Connexion…" else "Se connecter", {
                    error = null
                    session?.clearNotice()
                    if (session == null) {
                        demo.simulated("connexion (aucun serveur contacté)")
                        onSimulated(if (login.trim().lowercase() == "marie") Role.STAFF else Role.ADMIN)
                    } else if (session.serverAddress == null) {
                        error = failureMessage(Failure.BAD_ADDRESS); serverSheet = true
                    } else if (family.isBlank()) error = "Renseignez l'identifiant famille."
                    else if (login.isBlank()) error = "Renseignez votre identifiant personnel."
                    else if (code.isBlank()) error = "Renseignez votre code d'accès personnel."
                    else {
                        busy = true
                        scope.launch {
                            val f = session.signIn(family, login, code)
                            busy = false
                            code = ""
                            if (f != null) error = failureMessage(f)
                        }
                    }
                }, Modifier.fillMaxWidth(), trailing = if (busy) null else Icons.AutoMirrored.Rounded.ArrowForward, enabled = !busy)
                Spacer(Modifier.height(12.dp))
                Text(
                    "Besoin d'aide ?", color = C.TealDark, style = MaterialTheme.typography.labelLarge, textDecoration = TextDecoration.Underline,
                    modifier = Modifier.align(Alignment.CenterHorizontally).clip(RoundedCornerShape(8.dp)).clickable { help = true }.padding(horizontal = 12.dp, vertical = 16.dp),
                )
                Text(
                    "Après une connexion réussie, l'identifiant famille et votre identifiant personnel sont retenus sur ce téléphone.",
                    style = MaterialTheme.typography.bodySmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
                if (session != null && !BuildConfig.FINAL) Text(
                    "Serveur : ${session.serverAddress?.substringAfter("://") ?: "à définir"} · Modifier",
                    color = C.Muted, style = MaterialTheme.typography.bodySmall, textDecoration = TextDecoration.Underline,
                    modifier = Modifier.align(Alignment.CenterHorizontally).clip(RoundedCornerShape(8.dp)).clickable { serverSheet = true }.padding(horizontal = 12.dp, vertical = 16.dp),
                )
            } else {
                SegTabs(listOf("Rejoindre une famille", "Créer ma famille"), sub, { sub = it })
                Spacer(Modifier.height(12.dp))
                if (session != null && sub == 0) {
                    SCard(padding = PaddingValues(16.dp)) {
                        Text("Votre profil est créé par un administrateur", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(6.dp))
                        Text("Demandez à un administrateur de la famille de créer votre profil : il vous donnera l'identifiant famille, votre identifiant personnel et un code d'accès provisoire. À la première connexion, vous choisirez votre propre code d'accès personnel.", style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.height(12.dp))
                        PrimaryButton("Aller à la connexion", { tab = 0 }, Modifier.fillMaxWidth())
                    }
                } else if (session != null) {
                    CreateFamilyForm(session)
                } else if (sub == 0) {
                    FormField(family, { family = it }, "Code famille", leading = Icons.Rounded.Group)
                    Spacer(Modifier.height(10.dp))
                    FormField(login, { login = it }, "Votre prénom", leading = Icons.Rounded.Person)
                    Spacer(Modifier.height(10.dp))
                    CodeField(code, { code = it }, "Code d'accès à choisir")
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Rejoindre la famille", { demo.simulated("demande pour rejoindre une famille") }, Modifier.fillMaxWidth())
                } else {
                    FormField(famName, { famName = it }, "Nom de la famille", leading = Icons.Rounded.Group)
                    Spacer(Modifier.height(10.dp))
                    SecondaryButton("Ville : $city", {
                        city = when (city) { "Casablanca" -> "Rabat"; "Rabat" -> "Marrakech"; else -> "Casablanca" }
                    }, Modifier.fillMaxWidth(), height = 54.dp)
                    Spacer(Modifier.height(10.dp))
                    FormField(login, { login = it }, "Votre identifiant (administrateur)", leading = Icons.Rounded.Person)
                    Spacer(Modifier.height(10.dp))
                    CodeField(code, { code = it }, "Code d'accès")
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Créer ma famille", { demo.simulated("création d'une famille") }, Modifier.fillMaxWidth())
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (serverSheet && session != null && !BuildConfig.FINAL) ServerSheet(session) { serverSheet = false }
    if (session != null) when (helpKind) {
        1 -> RecoveryHelpSheet(session, true) { helpKind = 0 }
        2 -> RecoveryHelpSheet(session, false) { helpKind = 0 }
        3 -> AskAdminSheet("Identifiant famille inconnu", "L'identifiant famille se trouve dans Réglages → Identifiant famille d'un administrateur de la famille. Demandez-le lui, ou utilisez « Récupérer ma famille » si vous êtes l'administrateur principal.") { helpKind = 0 }
    }
    if (help) {
        AppSheet({ help = false }) {
            Text("Besoin d'aide ?", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(4.dp))
            Text("Choisissez ce qui vous correspond.", style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(10.dp))
            HelpRow(Icons.Rounded.Key, "J'ai oublié mon code d'accès", "Administrateur principal : lien par e-mail. Sinon, demandez à un administrateur") { help = false; if (session != null) helpKind = 1 else demo.simulated("demande de nouveau code") }
            HelpRow(Icons.Rounded.Email, "Récupérer ma famille", "Recevoir le code famille par e-mail") { help = false; if (session != null) helpKind = 2 else demo.simulated("envoi du lien de récupération") }
            HelpRow(Icons.Rounded.Group, "Je ne connais pas l'identifiant famille", "Le demander à un administrateur de la famille") { help = false; if (session != null) helpKind = 3 else demo.simulated("aide code famille") }
        }
    }
}

@Composable
private fun HelpRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, sub: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(42.dp).clip(CircleShape).background(C.TealSoft), contentAlignment = Alignment.Center) { Icon(icon, null, tint = C.TealDark) }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(sub, style = MaterialTheme.typography.bodySmall)
        }
        Icon(Icons.Rounded.ChevronRight, null, tint = C.Muted)
    }
}

@Composable
private fun Banner(text: String, info: Boolean = false) {
    val bg = if (info) C.AmberSoft else C.DangerSoft
    val fg = if (info) C.Amber else C.Danger
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(bg).padding(12.dp),
        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Rounded.Info, null, tint = fg, modifier = Modifier.size(20.dp))
        Text(text, color = C.Ink, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

/** Adresse du serveur de recette : testée (GET /health) avant d'être enregistrée. */
@Composable
private fun ServerSheet(session: Session, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf(session.serverAddress ?: "") }
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(false) }
    AppSheet(onDismiss) {
        Text("Serveur", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text("Adresse du serveur Courses (https://…). Elle est fournie avec l'environnement de recette.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))
        FormField(text, { text = it; msg = null; ok = false }, "https://…", leading = Icons.Rounded.Link,
            keyboard = KeyboardOptions(keyboardType = KeyboardType.Uri))
        msg?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = if (ok) C.TealDark else C.Danger, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton(if (busy) "Vérification…" else "Tester et enregistrer", {
            val addr = normalizeServer(text)
            if (addr == null) { msg = failureMessage(Failure.BAD_ADDRESS).let { "Adresse invalide." }; ok = false }
            else {
                busy = true; msg = null
                scope.launch {
                    when (val r = session.api.health(addr)) {
                        is Outcome.Ok -> { session.setServer(addr); ok = true; msg = "Serveur Courses joignable. Adresse enregistrée."; busy = false; onDismiss() }
                        is Outcome.Fail -> { ok = false; msg = failureMessage(r.failure); busy = false }
                    }
                }
            }
        }, Modifier.fillMaxWidth(), enabled = !busy && text.isNotBlank())
    }
}
