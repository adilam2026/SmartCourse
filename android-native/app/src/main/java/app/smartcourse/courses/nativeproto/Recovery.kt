@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.Session
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Messages communs des demandes sans session (l'adresse est vérifiée côté serveur, la réponse est la même qu'elle soit connue ou non). */
private fun publicMessage(r: Outcome.Fail): String = when {
    r.failure == Failure.RATE_LIMITED -> "Trop de demandes : réessayez dans une heure."
    r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT || r.failure == Failure.TLS -> "Serveur injoignable. Vérifiez la connexion et l'adresse du serveur."
    r.failure == Failure.BAD_ADDRESS -> "Définissez d'abord l'adresse du serveur."
    r.code == "invalid_email" || r.failure == Failure.BAD_REQUEST -> "Cette adresse e-mail n'est pas valable."
    else -> "La demande n'a pas pu être envoyée. Réessayez."
}

/** « J'ai oublié mon code d'accès » (administrateur principal) et « Récupérer ma famille » : un e-mail est envoyé, le lien s'ouvre dans le navigateur. */
@Composable
fun RecoveryHelpSheet(session: Session, forPassword: Boolean, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var family by remember { mutableStateOf(session.storage.lastFamily ?: "") }
    var busy by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    AppSheet(onDismiss) {
        Text(if (forPassword) "Choisir un nouveau code d'accès" else "Récupérer ma famille", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text(
            if (forPassword) "Réservé à l'administrateur principal : saisissez l'adresse de récupération de la famille. Vous recevrez un lien (valable peu de temps) pour choisir un nouveau code."
            else "Saisissez l'adresse de récupération de la famille : vous recevrez le code famille par e-mail.",
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(12.dp))
        if (done != null) {
            Text(done!!, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
            PrimaryButton("Fermer", onDismiss, Modifier.fillMaxWidth())
        } else {
            FormField(email, { email = it.trim() }, "Adresse e-mail de récupération", leading = Icons.Rounded.Email, keyboard = KeyboardOptions(keyboardType = KeyboardType.Email), focus = true)
            if (forPassword) { Spacer(Modifier.height(8.dp)); FormField(family, { family = it.uppercase() }, "Code famille (facultatif)", leading = Icons.Rounded.Group) }
            error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
            Spacer(Modifier.height(12.dp))
            PrimaryButton(if (busy) "Envoi…" else "Envoyer le lien", {
                busy = true; error = null
                scope.launch {
                    val body = buildJsonObject { put("email", email); if (forPassword && family.isNotBlank()) put("familyCode", family.trim()) }
                    when (val r = session.api.callPublic("POST", if (forPassword) "/api/auth/forgot-password" else "/api/auth/forgot-family-code", body)) {
                        is Outcome.Ok -> done = r.value["message"]?.jsonPrimitive?.contentOrNull ?: "Si cette adresse est enregistrée et vérifiée, un e-mail vient d'être envoyé."
                        is Outcome.Fail -> error = publicMessage(r)
                    }
                    busy = false
                }
            }, Modifier.fillMaxWidth(), enabled = email.contains("@") && !busy)
        }
    }
}

/** Réponse aux autres cas d'aide : seul un administrateur de la famille peut agir. */
@Composable
fun AskAdminSheet(title: String, text: String, onDismiss: () -> Unit) {
    AppSheet(onDismiss) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(14.dp))
        PrimaryButton("Compris", onDismiss, Modifier.fillMaxWidth())
    }
}

/**
 * « Créer ma famille » : autonome, sans lien, jeton ni serveur à saisir.
 * 1. Le formulaire est vérifié par le serveur, qui envoie un code à 6 chiffres à l'adresse (rien n'est encore créé).
 * 2. Code exact : la famille et son administrateur principal sont créés, l'utilisateur est connecté directement.
 * Un double appui ne crée jamais deux demandes : chaque envoi porte un identifiant de demande, gardé tant qu'il est en cours.
 */
@Composable
fun CreateFamilyForm(session: Session) {
    val scope = rememberCoroutineScope()
    var famName by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var login by remember { mutableStateOf("") }
    var city by remember { mutableStateOf<String?>(null) }
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var code2 by remember { mutableStateOf("") }
    var citySheet by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var requestId by remember { mutableStateOf(java.util.UUID.randomUUID().toString()) }
    // Étape 2 : demande enregistrée, code envoyé
    var signupId by remember { mutableStateOf<String?>(null) }
    var masked by remember { mutableStateOf("") }
    var otp by remember { mutableStateOf("") }
    var wait by remember { mutableIntStateOf(0) }
    // Code expiré (ou trop d'essais) : l'action principale devient « Recevoir un nouveau code », sans rien ressaisir.
    var needNew by remember { mutableStateOf(false) }
    // Le service d'envoi n'a pas répondu dans le délai : l'envoi n'est pas confirmé (jamais présenté comme « envoyé »).
    var uncertain by remember { mutableStateOf(false) }
    LaunchedEffect(wait) { if (wait > 0) { kotlinx.coroutines.delay(1000); wait -= 1 } }

    fun startMessage(f: Outcome.Fail): String = when (f.code) {
        "email_in_use" -> "Cette adresse gère déjà une famille. Utilisez « Besoin d'aide ? » puis « Récupérer ma famille »."
        "too_many_signups" -> "Trop de demandes : réessayez plus tard."
        "families_limit" -> "La limite temporaire de créations est atteinte. Réessayez plus tard."
        "signups_paused" -> "Beaucoup de demandes en ce moment : réessayez dans quelques minutes."
        "signups_closed" -> "La création de famille est momentanément fermée : réessayez plus tard."
        "mail_unavailable", "mail_failed" -> "L'e-mail n'a pas pu être envoyé : vérifiez l'adresse ou réessayez dans quelques instants."
        "too_many_mails" -> "Trop d'e-mails envoyés à cette adresse : réessayez dans une heure."
        "weak_secret" -> "Code d'accès trop simple (évitez 123456, 111111…)."
        "secret_mismatch" -> "Les deux codes d'accès ne sont pas identiques."
        "invalid_city", "city_required" -> "Choisissez une ville dans la liste."
        "signup_in_progress" -> "Une demande est déjà en cours pour cette adresse : réessayez dans un instant."
        "invalid_request" -> "Vérifiez les champs : identifiant de 2 à 30 caractères (lettres minuscules, chiffres, point, tiret)."
        else -> if (f.failure == Failure.NETWORK || f.failure == Failure.TIMEOUT || f.failure == Failure.TLS) "Pas de connexion : réessayez quand le réseau revient." else "Création impossible pour le moment : réessayez."
    }
    fun verifyMessage(f: Outcome.Fail): String = when (f.code) {
        "invalid_code" -> "Code incorrect : vérifiez l'e-mail reçu."
        "families_limit" -> "La limite temporaire de créations est atteinte. Réessayez plus tard."
        "too_many_attempts" -> "Trop d'essais avec ce code : recevez un nouveau code, vos informations sont conservées."
        "code_expired" -> "Ce code a expiré (il est valable 30 minutes) : recevez un nouveau code, vos informations sont conservées."
        "signup_expired", "signup_not_found" -> "Demande expirée : recommencez."
        "already_completed" -> "Cette famille est déjà créée : connectez-vous avec son code famille."
        "email_in_use" -> "Cette adresse gère déjà une famille. Utilisez « Récupérer ma famille »."
        "too_soon" -> "Patientez avant de renvoyer le code."
        "too_many_mails" -> "Trop d'envois : réessayez plus tard."
        "mail_failed" -> "L'e-mail n'a pas pu être envoyé : réessayez dans quelques instants."
        else -> if (f.failure == Failure.NETWORK || f.failure == Failure.TIMEOUT || f.failure == Failure.TLS) "Pas de connexion : réessayez quand le réseau revient." else "Vérification impossible pour le moment : réessayez."
    }

    val sid = signupId
    if (sid != null) {
        SCard(padding = PaddingValues(16.dp)) {
            Text("Vérifiez votre adresse", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(6.dp))
            Text(
                if (uncertain) "L'envoi du code à $masked n'est pas confirmé. S'il n'arrive pas d'ici quelques minutes, recevez un nouveau code."
                else "Un code à 6 chiffres a été envoyé à $masked. Saisissez-le pour créer votre famille.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Spacer(Modifier.height(12.dp))
        FormField(otp, { otp = it.filter { ch -> ch.isDigit() }.take(6) }, "Code reçu par e-mail", leading = Icons.Rounded.Email, keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
        error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.height(16.dp))
        val resend: () -> Unit = {
            if (wait == 0 && !busy) {
                busy = true; error = null
                scope.launch {
                    when (val r = session.api.callPublic("POST", "/api/signup/resend", buildJsonObject { put("signupId", sid) })) {
                        is Outcome.Ok -> {
                            wait = r.value["resendInSeconds"]?.jsonPrimitive?.intOrNull ?: 60; otp = ""; needNew = false
                            uncertain = r.value["delivery"]?.jsonPrimitive?.contentOrNull == "uncertain"
                        }
                        is Outcome.Fail -> error = verifyMessage(r)
                    }
                    busy = false
                }
            }
        }
        if (needNew) PrimaryButton(if (busy) "Envoi du code…" else if (wait > 0) "Recevoir un nouveau code (${wait} s)" else "Recevoir un nouveau code", resend, Modifier.fillMaxWidth(), enabled = wait == 0 && !busy)
        else PrimaryButton(if (busy) "Création de la famille…" else "Créer ma famille", {
            busy = true; error = null
            scope.launch {
                val f = session.completeSignup(sid, otp)
                if (f != null) {
                    error = verifyMessage(f)
                    if (f.code == "code_expired" || f.code == "too_many_attempts") needNew = true
                    if (f.code == "signup_expired" || f.code == "signup_not_found") { signupId = null; requestId = java.util.UUID.randomUUID().toString() }
                }
                busy = false
            }
        }, Modifier.fillMaxWidth(), enabled = otp.length == 6 && !busy)
        Spacer(Modifier.height(10.dp))
        if (!needNew) SecondaryButton(if (wait > 0) "Renvoyer le code (${wait} s)" else "Renvoyer le code", resend, Modifier.fillMaxWidth())
        Spacer(Modifier.height(4.dp))
        Text(
            "Modifier mes informations", color = C.TealDark, style = MaterialTheme.typography.labelLarge, textDecoration = TextDecoration.Underline, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { signupId = null; otp = ""; error = null; requestId = java.util.UUID.randomUUID().toString() }.padding(horizontal = 12.dp, vertical = 14.dp),
        )
        return
    }

    FormField(famName, { famName = it }, "Nom de la famille", leading = Icons.Rounded.Group)
    Spacer(Modifier.height(10.dp))
    FormField(name, { name = it }, "Votre prénom", leading = Icons.Rounded.Person)
    Spacer(Modifier.height(10.dp))
    FormField(login, { login = it.trim().lowercase().filter { ch -> ch.isLetterOrDigit() || ch in "._-" }.take(30) }, "Votre identifiant", leading = Icons.Rounded.Person)
    Spacer(Modifier.height(10.dp))
    SecondaryButton("Ville : ${city ?: "à choisir"}", { citySheet = true }, Modifier.fillMaxWidth(), height = 54.dp)
    Spacer(Modifier.height(10.dp))
    FormField(email, { email = it.trim() }, "E-mail de récupération", leading = Icons.Rounded.Email, keyboard = KeyboardOptions(keyboardType = KeyboardType.Email))
    Spacer(Modifier.height(10.dp))
    FormField(code, { code = it.filter { ch -> ch.isDigit() }.take(6) }, "Code d'accès (6 chiffres)", leading = Icons.Rounded.Lock, visual = PasswordVisualTransformation(), keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
    Spacer(Modifier.height(10.dp))
    FormField(code2, { code2 = it.filter { ch -> ch.isDigit() }.take(6) }, "Confirmez le code d'accès", leading = Icons.Rounded.Lock, visual = PasswordVisualTransformation(), keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
    error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
    Spacer(Modifier.height(16.dp))
    val ready = famName.isNotBlank() && name.isNotBlank() && login.length >= 2 && city != null && email.contains("@") && code.length == 6 && code2.length == 6
    PrimaryButton(if (busy) "Envoi du code…" else "Recevoir le code par e-mail", {
        if (code != code2) { error = "Les deux codes d'accès ne sont pas identiques."; return@PrimaryButton }
        busy = true; error = null
        scope.launch {
            val body = buildJsonObject {
                put("requestId", requestId); put("familyName", famName.trim()); put("displayName", name.trim()); put("login", login)
                put("city", city!!); put("email", email); put("secret", code); put("secretConfirm", code2)
            }
            when (val r = session.api.callPublic("POST", "/api/signup/start", body)) {
                is Outcome.Ok -> {
                    signupId = r.value["signupId"]?.jsonPrimitive?.contentOrNull
                    masked = r.value["email"]?.jsonPrimitive?.contentOrNull ?: email
                    wait = r.value["resendInSeconds"]?.jsonPrimitive?.intOrNull ?: 60
                    uncertain = r.value["delivery"]?.jsonPrimitive?.contentOrNull == "uncertain"; needNew = false
                }
                is Outcome.Fail -> { error = startMessage(r); requestId = java.util.UUID.randomUUID().toString() }
            }
            busy = false
        }
    }, Modifier.fillMaxWidth(), enabled = ready && !busy)
    if (citySheet) CityPickerSheet(city, { city = it; citySheet = false }, { citySheet = false })
}
