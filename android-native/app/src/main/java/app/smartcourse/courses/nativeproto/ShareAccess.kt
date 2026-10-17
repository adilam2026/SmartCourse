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

    fun accessMessage(displayName: String, familyCode: String, login: String, code: String): String =
        "$APP — accès de $displayName\n" +
            "Code famille : $familyCode\n" +
            "Identifiant : $login\n" +
            "Code d'accès : $code\n\n" +
            "Pour vous connecter : installez $APP, touchez « Se connecter », puis saisissez le code famille, l'identifiant et le code d'accès."

    fun familyMessage(familyCode: String): String =
        "Rejoignez notre famille sur $APP.\nCode famille : $familyCode\n\n" +
            "Votre identifiant et votre code d'accès vous seront donnés par un administrateur de la famille."

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

/** Accès d'un membre à transmettre : nom, code famille, identifiant et code d'accès (connu seulement juste après sa création). */
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
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.TealSoft).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Code famille : ${a.familyCode}", style = MaterialTheme.typography.bodyLarge)
            Text("Identifiant : ${a.login}", style = MaterialTheme.typography.bodyLarge)
            Text("Code d'accès : ${a.code}", style = MaterialTheme.typography.bodyLarge)
        }
        Spacer(Modifier.height(8.dp))
        Text("Rien n'est envoyé automatiquement : vous choisissez le destinataire dans WhatsApp (ou une autre application) et vous envoyez vous-même. Ce code n'est affiché qu'ici : notez-le ou partagez-le maintenant.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))
        PrimaryButton("Partager l'accès", {
            if (AccessShare.share(ctx, text, "Partager l'accès de ${a.displayName}") == "none") demo.say("Aucune application de partage disponible.")
        }, Modifier.fillMaxWidth(), leading = Icons.Rounded.Share)
        Spacer(Modifier.height(8.dp))
        SecondaryButton(if (copied) "Informations copiées" else "Copier les informations", { AccessShare.copy(ctx, "Accès ${AccessShare.APP}", text); copied = true }, Modifier.fillMaxWidth(), leading = Icons.Rounded.ContentCopy)
        if (copied) { Spacer(Modifier.height(6.dp)); Text("Copié dans le presse-papiers.", style = MaterialTheme.typography.bodySmall, color = C.TealDark) }
        Spacer(Modifier.height(8.dp))
        SecondaryButton("Fermer", onDismiss, Modifier.fillMaxWidth())
    }
}

/** Code famille seul (sans aucun code d'accès) : partager ou copier. */
@Composable
fun FamilyCodeCard(familyCode: String) {
    val ctx = LocalContext.current
    val demo = LocalDemo.current
    var copied by remember { mutableStateOf(false) }
    SCard(padding = PaddingValues(14.dp)) {
        Text("Code famille : $familyCode", style = MaterialTheme.typography.titleSmall)
        Text("À donner aux membres avec leur identifiant et leur code d'accès. Ce message ne contient aucun code d'accès.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryButton("Partager le code famille", {
                if (AccessShare.share(ctx, AccessShare.familyMessage(familyCode), "Partager le code famille") == "none") demo.say("Aucune application de partage disponible.")
            }, Modifier.weight(1.4f), leading = Icons.Rounded.Share)
            SecondaryButton(if (copied) "Copié" else "Copier", {
                AccessShare.copy(ctx, "Code famille ${AccessShare.APP}", familyCode); copied = true
            }, Modifier.weight(1f), leading = Icons.Rounded.ContentCopy)
        }
    }
}
