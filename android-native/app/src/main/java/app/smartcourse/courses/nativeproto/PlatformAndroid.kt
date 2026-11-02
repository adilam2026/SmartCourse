package app.smartcourse.courses.nativeproto

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.util.Log
import android.os.Build
import android.os.PersistableBundle
import androidx.annotation.DrawableRes
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import java.security.SecureRandom
import kotlin.random.asKotlinRandom
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import coil.ImageLoader
import coil.compose.AsyncImage
import java.net.URLEncoder
import java.text.Normalizer
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

/*
 * Éléments d'interface PROPRES À ANDROID utilisés par les écrans communs (équivalents iPhone : ios/shared/src/iosMain).
 * Comportement identique à avant la séparation.
 */

/** Chargeur de photos (Coil, client OkHttp avec le cookie de session), fourni par MainActivity. */
val LocalImageLoader = compositionLocalOf<ImageLoader?> { null }

/** Photo du serveur (adresse complète), mise en cache sur le téléphone ; rien tant que le chargeur n'est pas prêt. */
@Composable
fun ServerImage(url: String, contentScale: ContentScale, modifier: Modifier) {
    val loader = LocalImageLoader.current ?: return
    AsyncImage(model = url, imageLoader = loader, contentDescription = null, contentScale = contentScale, modifier = modifier)
}

/** Image fournie avec l'application (écrans de démonstration et de connexion). */
@Composable
fun localPainter(@DrawableRes res: Int): Painter = painterResource(res)

/* ───── Dates : fuseau du téléphone, noms des jours et des mois en français (mêmes motifs que DateTimeFormatter) ───── */

/** Date du jour « aaaa-mm-jj ». */
fun todayIso(): String = LocalDate.now(ZoneId.systemDefault()).toString()

fun isToday(date: String): Boolean = LocalDate.parse(date) == LocalDate.now()

/** Mois en cours « aaaa-mm ». */
fun currentMonth(): String = YearMonth.now().toString()

/** Date « aaaa-mm-jj » écrite selon [pattern] en français. Lève une exception si la date est illisible. */
fun formatDate(date: String, pattern: String): String = LocalDate.parse(date).format(DateTimeFormatter.ofPattern(pattern, Locale.FRENCH))

/** Instant ISO 8601 du serveur, ramené au fuseau du téléphone, écrit selon [pattern] en français. */
fun formatInstant(iso: String, pattern: String): String =
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern(pattern, Locale.FRENCH))

/** « aaaa-mm-jj » décalée de [by] mois. */
fun plusMonths(date: String, by: Long): String = LocalDate.parse(date).plusMonths(by).toString()

fun dateToUtcMillis(date: String): Long = LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
fun utcMillisToDate(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()

/** Secondes écoulées depuis l'instant ISO [iso]. */
fun secondsSince(iso: String): Long = Duration.between(Instant.parse(iso), Instant.now()).seconds

fun nowInstantIso(): String = Instant.now().toString()
fun nowOffsetIso(): String = OffsetDateTime.now().toString()
fun isoSecondsAgo(s: Long): String = Instant.now().minusSeconds(s).toString()

/* ───── Texte ───── */

fun randomUuid(): String = UUID.randomUUID().toString()
fun urlEncode(s: String): String = URLEncoder.encode(s, "UTF-8")

/** Texte sans accents ni autres signes diacritiques (décomposition NFD, signes retirés). */
fun stripMarks(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")

/** Nombre à trois décimales, point décimal (« %.3f »). */
fun fixed3(v: Double): String = String.format(Locale.US, "%.3f", v)

/* ───── Actions du système (partage, presse-papiers, navigateur) ───── */

const val PLATFORM_LABEL = "native (Android)"

private val WHATSAPP = listOf("com.whatsapp", "com.whatsapp.w4b")

class AndroidHost(private val ctx: Context) : PlatformHost {
    /** Ouvre WhatsApp avec le message prêt (l'administrateur choisit le destinataire et envoie lui-même) ; sinon le partage Android. */
    override fun share(text: String, title: String): String {
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

    override fun shareSheet(text: String, title: String): Boolean {
        val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
        return try { ctx.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Exception) { false }
    }

    /** Copie marquée « sensible » : Android n'affiche pas son contenu dans l'aperçu du presse-papiers. */
    override fun copy(label: String, text: String) {
        val clip = ClipData.newPlainText(label, text)
        if (Build.VERSION.SDK_INT >= 33) clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
    }

    override fun openUrl(url: String): Boolean =
        try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Exception) { false }
}

@Composable
fun platformHost(): PlatformHost {
    val ctx = LocalContext.current
    return remember(ctx) { AndroidHost(ctx) }
}

/** Générateur cryptographique des codes d'accès. */
fun secureRandom(): kotlin.random.Random = SecureRandom().asKotlinRandom()

/** Compatibilité des tests : générateur imposé. */
fun AccessShare.generateCode(rnd: SecureRandom): String = generateCode(rnd.asKotlinRandom())

/* ───── Contexte, journal et réseau ───── */

/** Contexte de l'application Android, renseigné au démarrage par MainActivity. */
object AndroidEnv { var context: Context? = null }

fun logInfo(tag: String, msg: String) { Log.i(tag, msg) }

/** Prévient à chaque retour du réseau ; renvoie la fonction qui arrête la surveillance (null si impossible). */
fun watchNetwork(onAvailable: () -> Unit): (() -> Unit)? {
    val cm = AndroidEnv.context?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
    val cb = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { onAvailable() }
    }
    return try {
        cm.registerDefaultNetworkCallback(cb)
        val stop: () -> Unit = { try { cm.unregisterNetworkCallback(cb) } catch (_: Exception) { } }
        stop
    } catch (_: Exception) { null }
}

/** Rappels d'achat du profil connecté : reprogrammés à chaque connexion (annulés à la déconnexion). */
@Composable
fun RemindersEffect(profileId: String?) {
    val appCtx = LocalContext.current
    androidx.compose.runtime.LaunchedEffect(profileId) { Reminders.schedule(appCtx) }
}

/** Bouton ou geste « Retour » du système (Android) ; sur iPhone, le retour passe par les boutons de l'écran. */
@Composable
fun PlatformBackHandler(enabled: Boolean = true, onBack: () -> Unit) = androidx.activity.compose.BackHandler(enabled, onBack)
