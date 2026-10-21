package app.smartcourse.courses.nativeproto

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import java.security.SecureRandom

/**
 * Partage de l'accès d'un membre. Les codes d'accès ne sont conservés par le serveur que sous forme d'empreinte : un code n'est
 * connu qu'au moment où il est créé (création du profil ou nouveau code). Il n'est jamais écrit dans un journal ni stocké sur le téléphone ;
 * il ne vit que dans l'écran ouvert, le temps de le partager.
 */
object AccessShare {
    const val APP = "Mes Courses"
    private val WHATSAPP = listOf("com.whatsapp", "com.whatsapp.w4b")

    /** Accès d'un nouveau membre : identifiant famille, identifiant personnel et code d'accès PROVISOIRE (7 jours, usage unique). */
    fun accessMessage(displayName: String, familyId: String, login: String, code: String): String =
        "$APP — accès de $displayName\n" +
            "Identifiant famille : $familyId\n" +
            "Identifiant personnel : $login\n" +
            "Code d'accès provisoire : $code (valable 7 jours)\n\n" +
            // « mettez à jour » : une ancienne version de l'application refuse un code provisoire sans pouvoir l'expliquer elle-même.
            "Installez ou mettez à jour $APP depuis Google Play, touchez « Se connecter » et saisissez ces informations. Vous choisirez ensuite votre propre code d'accès personnel."

    fun familyMessage(familyId: String): String =
        "Rejoignez notre famille sur $APP.\nIdentifiant famille : $familyId\n\n" +
            "Votre identifiant personnel et votre code d'accès personnel vous seront donnés par un administrateur."

    /** Même règle que le serveur : 6 à 8 chiffres, ni le même chiffre partout, ni une suite (123456, 654321, 1234567…). */
    fun isWeak(s: String): Boolean {
        if (s.length in 6..8 && s.all { it == s[0] }) return true
        if (s.length !in 6..8 || !s.all(Char::isDigit)) return false
        val d = s.map { it - '0' }
        val step = d[1] - d[0]
        return kotlin.math.abs(step) == 1 && (1 until d.size).all { d[it] - d[it - 1] == step }
    }

    /** Nouveau code tiré au hasard (générateur cryptographique), zéros initiaux conservés. */
    fun generateCode(rnd: SecureRandom = SecureRandom()): String {
        while (true) {
            val c = rnd.nextInt(1_000_000).toString().padStart(6, '0')
            if (!isWeak(c)) return c
        }
    }

    /**
     * Ouvre WhatsApp avec le message prêt : l'administrateur choisit le destinataire et envoie lui-même (rien n'est envoyé automatiquement).
     * Sans WhatsApp, le partage Android s'ouvre. Renvoie le moyen utilisé.
     */
    fun share(ctx: Context, text: String, title: String): String {
        val base = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
        for (pkg in WHATSAPP) {
            try {
                ctx.startActivity(Intent(base).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return "whatsapp"
            } catch (_: ActivityNotFoundException) { }
        }
        return try {
            ctx.startActivity(Intent.createChooser(base, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); "android"
        } catch (_: ActivityNotFoundException) { "none" }
    }

    /** Copie marquée « sensible » : Android n'affiche pas son contenu dans l'aperçu du presse-papiers. */
    fun copy(ctx: Context, label: String, text: String) {
        val clip = ClipData.newPlainText(label, text)
        if (Build.VERSION.SDK_INT >= 33) clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
    }
}

/** Accès d'un membre à transmettre : nom, identifiant famille (ou code famille), identifiant personnel et code provisoire (connu seulement ici). */
data class AccessToShare(val displayName: String, val familyCode: String, val login: String, val code: String, val intro: String)

@Composable
fun ShareAccessSheet(a: AccessToShare, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val demo = LocalDemo.current
    var copied by remember { mutableStateOf(false) }
    val text = AccessShare.accessMessage(a.displayName, a.familyCode, a.login, a.code)
    AppSheet(onDismiss) {
        Text("Partager l'accès de ${a.displayName}", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(6.dp))
        Text(a.intro, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(12.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.Bg).padding(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(12.dp))
        PrimaryButton("Partager l'accès (WhatsApp)", {
            if (AccessShare.share(ctx, text, "Partager l'accès de ${a.displayName}") == "none") demo.say("Aucune application de partage disponible.")
        }, Modifier.fillMaxWidth(), leading = Icons.Rounded.Share)
        Spacer(Modifier.height(8.dp))
        SecondaryButton(if (copied) "Informations copiées" else "Copier les informations", { AccessShare.copy(ctx, "Accès ${AccessShare.APP}", text); copied = true }, Modifier.fillMaxWidth(), leading = Icons.Rounded.ContentCopy)
        if (copied) { Spacer(Modifier.height(6.dp)); Text("Copié dans le presse-papiers.", style = MaterialTheme.typography.bodySmall, color = C.TealDark) }
        Spacer(Modifier.height(8.dp))
        SecondaryButton("Fermer", onDismiss, Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.AmberSoft).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                "Valable 7 jours et une seule fois : il ne fonctionne plus dès que ${a.displayName} a choisi son code. Il n'est plus affiché après fermeture. " +
                    "Expiré ou perdu : Réglages → Profils → ${a.displayName} → « Nouveau code provisoire ». Un code personnel n'est jamais réaffiché.",
                style = MaterialTheme.typography.bodySmall, color = C.Ink,
            )
        }
    }
}

/** Identifiant famille (ou, à défaut, code famille) seul, sans aucun code d'accès : partager ou copier. */
@Composable
fun FamilyCodeCard(familyCode: String) {
    val ctx = LocalContext.current
    val demo = LocalDemo.current
    var copied by remember { mutableStateOf(false) }
    SCard(padding = PaddingValues(14.dp)) {
        Text("Identifiant famille : $familyCode", style = MaterialTheme.typography.titleSmall)
        Text("À donner aux membres avec leur identifiant personnel et leur code d'accès. Ce message ne contient aucun code d'accès.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryButton("Partager", {
                if (AccessShare.share(ctx, AccessShare.familyMessage(familyCode), "Partager l'identifiant famille") == "none") demo.say("Aucune application de partage disponible.")
            }, Modifier.weight(1.4f), leading = Icons.Rounded.Share)
            SecondaryButton(if (copied) "Copié" else "Copier", {
                AccessShare.copy(ctx, "Identifiant famille ${AccessShare.APP}", familyCode); copied = true
            }, Modifier.weight(1f), leading = Icons.Rounded.ContentCopy)
        }
    }
}
