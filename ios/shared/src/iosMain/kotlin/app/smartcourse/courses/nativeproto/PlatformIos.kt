@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.layout.ContentScale
import app.smartcourse.courses.nativeproto.net.COOKIE_NAME
import app.smartcourse.courses.nativeproto.net.IosTransport
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import kotlinx.cinterop.UIntVar
import platform.Foundation.NSCalendar
import platform.Foundation.NSCalendarIdentifierGregorian
import platform.Foundation.NSCalendarUnitMonth
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSISO8601DateFormatWithFractionalSeconds
import platform.Foundation.NSISO8601DateFormatWithInternetDateTime
import platform.Foundation.NSISO8601DateFormatter
import platform.Foundation.NSLocale
import platform.Foundation.NSString
import platform.Foundation.NSTimeZone
import platform.Foundation.NSURL
import platform.Foundation.NSUUID
import platform.Foundation.create
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.Foundation.decomposedStringWithCanonicalMapping
import platform.Foundation.localTimeZone
import platform.Foundation.stringWithFormat
import platform.Foundation.timeIntervalSince1970
import platform.Foundation.timeIntervalSinceNow
import platform.Foundation.timeZoneForSecondsFromGMT
import platform.Network.nw_path_get_status
import platform.Network.nw_path_monitor_cancel
import platform.Network.nw_path_monitor_create
import platform.Network.nw_path_monitor_set_queue
import platform.Network.nw_path_monitor_set_update_handler
import platform.Network.nw_path_monitor_start
import platform.Network.nw_path_status_satisfied
import platform.Security.SecRandomCopyBytes
import platform.Security.kSecRandomDefault
import platform.UIKit.UIActivityViewController
import platform.UIKit.UIApplication
import platform.UIKit.UIPasteboard
import platform.darwin.dispatch_get_main_queue

/*
 * Équivalents iPhone des fonctions PROPRES À ANDROID utilisées par les écrans communs (Android : PlatformAndroid.kt).
 * Mêmes noms, mêmes paramètres, même résultat attendu.
 */

/* ───── Images du serveur (avec le cookie de session), gardées en mémoire ───── */

private object ImageCache {
    private val mem = LinkedHashMap<String, ImageBitmap>()
    fun get(url: String): ImageBitmap? = mem[url]
    fun put(url: String, img: ImageBitmap) {
        mem[url] = img
        if (mem.size > 300) mem.remove(mem.keys.first())
    }
}

@Composable
fun ServerImage(url: String, contentScale: ContentScale, modifier: Modifier) {
    val session = LocalSession.current ?: return
    var img by remember(url) { mutableStateOf(ImageCache.get(url)) }
    LaunchedEffect(url) {
        if (img != null) return@LaunchedEffect
        val transport = session.api.transport as? IosTransport ?: return@LaunchedEffect
        val headers = session.storage.cookie?.let { mapOf("Cookie" to "$COOKIE_NAME=$it") } ?: emptyMap()
        val bytes = transport.bytes(url, headers) ?: return@LaunchedEffect
        val decoded = try { org.jetbrains.skia.Image.makeFromEncoded(bytes).toComposeImageBitmap() } catch (_: Throwable) { null } ?: return@LaunchedEffect
        ImageCache.put(url, decoded)
        img = decoded
    }
    img?.let { Image(it, null, modifier, contentScale = contentScale) }
}

/* ───── Dates : fuseau du téléphone, noms des jours et des mois en français (mêmes motifs que DateTimeFormatter) ───── */

private val FRENCH = NSLocale(localeIdentifier = "fr")
private val POSIX = NSLocale(localeIdentifier = "en_US_POSIX")
private val UTC = NSTimeZone.timeZoneForSecondsFromGMT(0)

private fun dayParser(): NSDateFormatter = NSDateFormatter().apply {
    dateFormat = "yyyy-MM-dd"; locale = POSIX; timeZone = UTC; lenient = false
    calendar = NSCalendar(calendarIdentifier = NSCalendarIdentifierGregorian)
}

private fun parseDay(date: String): NSDate = dayParser().dateFromString(date) ?: throw IllegalArgumentException("date illisible : $date")

private fun parseInstant(iso: String): NSDate {
    for (opts in listOf(NSISO8601DateFormatWithInternetDateTime or NSISO8601DateFormatWithFractionalSeconds, NSISO8601DateFormatWithInternetDateTime)) {
        NSISO8601DateFormatter().apply { formatOptions = opts }.dateFromString(iso)?.let { return it }
    }
    throw IllegalArgumentException("instant illisible : $iso")
}

private fun fmt(d: NSDate, pattern: String, tz: NSTimeZone, locale: NSLocale = FRENCH): String = NSDateFormatter().apply {
    dateFormat = pattern; this.locale = locale; timeZone = tz
    calendar = NSCalendar(calendarIdentifier = NSCalendarIdentifierGregorian)
}.stringFromDate(d)

fun todayIso(): String = fmt(NSDate(), "yyyy-MM-dd", NSTimeZone.localTimeZone, POSIX)
fun isToday(date: String): Boolean { parseDay(date); return date == todayIso() }
fun currentMonth(): String = fmt(NSDate(), "yyyy-MM", NSTimeZone.localTimeZone, POSIX)
fun formatDate(date: String, pattern: String): String = fmt(parseDay(date), pattern, UTC)
fun formatInstant(iso: String, pattern: String): String = fmt(parseInstant(iso), pattern, NSTimeZone.localTimeZone)

fun plusMonths(date: String, by: Long): String {
    val cal = NSCalendar(calendarIdentifier = NSCalendarIdentifierGregorian).apply { timeZone = UTC }
    val d = cal.dateByAddingUnit(NSCalendarUnitMonth, by, parseDay(date), 0u) ?: throw IllegalArgumentException(date)
    return fmt(d, "yyyy-MM-dd", UTC, POSIX)
}

fun dateToUtcMillis(date: String): Long = (parseDay(date).timeIntervalSince1970 * 1000).toLong()
fun utcMillisToDate(ms: Long): String = fmt(NSDate.dateWithTimeIntervalSince1970(ms / 1000.0), "yyyy-MM-dd", UTC, POSIX)
fun secondsSince(iso: String): Long = (-parseInstant(iso).timeIntervalSinceNow).toLong()

fun nowInstantIso(): String =
    NSISO8601DateFormatter().apply { formatOptions = NSISO8601DateFormatWithInternetDateTime or NSISO8601DateFormatWithFractionalSeconds }.stringFromDate(NSDate())
fun nowOffsetIso(): String = nowInstantIso()
fun isoSecondsAgo(s: Long): String =
    NSISO8601DateFormatter().apply { formatOptions = NSISO8601DateFormatWithInternetDateTime or NSISO8601DateFormatWithFractionalSeconds }
        .stringFromDate(NSDate(timeIntervalSinceReferenceDate = NSDate().timeIntervalSinceReferenceDate - s))

/* ───── Texte ───── */

fun randomUuid(): String = NSUUID().UUIDString.lowercase()

/** Même encodage que java.net.URLEncoder (formulaire) : espace → « + », lettres, chiffres et « .-*_ » conservés. */
fun urlEncode(s: String): String = buildString {
    for (b in s.encodeToByteArray()) {
        val c = (b.toInt() and 0xFF).toChar()
        when {
            c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '.' || c == '-' || c == '*' || c == '_' -> append(c)
            c == ' ' -> append('+')
            else -> append('%').append((b.toInt() and 0xFF).toString(16).uppercase().padStart(2, '0'))
        }
    }
}

/** Texte sans accents ni autres signes diacritiques (décomposition NFD, signes retirés). */
fun stripMarks(s: String): String {
    @Suppress("CAST_NEVER_SUCCEEDS")
    val nfd = (NSString.create(string = s)).decomposedStringWithCanonicalMapping
    return nfd.filter { it.category != CharCategory.NON_SPACING_MARK && it.category != CharCategory.COMBINING_SPACING_MARK && it.category != CharCategory.ENCLOSING_MARK }
}

/** Nombre à trois décimales, point décimal (« %.3f »). */
fun fixed3(v: Double): String = NSString.stringWithFormat("%.3f", v)

/** Générateur cryptographique (SecRandomCopyBytes) pour les codes d'accès. */
private object SecureRandomIos : kotlin.random.Random() {
    override fun nextBits(bitCount: Int): Int {
        val v = memScoped { val x = alloc<UIntVar>(); SecRandomCopyBytes(kSecRandomDefault, 4u, x.ptr); x.value }
        return if (bitCount == 0) 0 else (v.toInt() ushr (32 - bitCount))
    }
}
fun secureRandom(): kotlin.random.Random = SecureRandomIos

/* ───── Journal et réseau ───── */

fun logInfo(tag: String, msg: String) { println("[$tag] $msg") }

/** Prévient à chaque retour du réseau (NWPathMonitor) ; renvoie la fonction qui arrête la surveillance. */
fun watchNetwork(onAvailable: () -> Unit): (() -> Unit)? {
    val monitor = nw_path_monitor_create()
    var wasUp: Boolean? = null
    nw_path_monitor_set_update_handler(monitor) { path ->
        val up = nw_path_get_status(path) == nw_path_status_satisfied
        if (up && wasUp != true) onAvailable()
        wasUp = up
    }
    nw_path_monitor_set_queue(monitor, dispatch_get_main_queue())
    nw_path_monitor_start(monitor)
    return { nw_path_monitor_cancel(monitor) }
}

/* ───── Actions du système (partage, presse-papiers, navigateur) ───── */

const val PLATFORM_LABEL = "native (iPhone)"

class IosHost : PlatformHost {
    private fun present(text: String): Boolean {
        val root = UIApplication.sharedApplication.keyWindow?.rootViewController ?: return false
        var top = root
        while (top.presentedViewController != null) top = top.presentedViewController!!
        top.presentViewController(UIActivityViewController(listOf(text), null), animated = true, completion = null)
        return true
    }

    /** Sur iPhone, la feuille de partage propose WhatsApp quand il est installé : même message, même choix du destinataire. */
    override fun share(text: String, title: String): String = if (present(text)) "ios" else "none"
    override fun shareSheet(text: String, title: String): Boolean = present(text)
    override fun copy(label: String, text: String) { UIPasteboard.generalPasteboard.string = text }
    override fun openUrl(url: String): Boolean {
        val u = NSURL.URLWithString(url) ?: return false
        UIApplication.sharedApplication.openURL(u, emptyMap<Any?, Any>(), null)
        return true
    }
}

@Composable
fun platformHost(): PlatformHost = remember { IosHost() }

/* ───── Rappels et notifications : version iPhone préparée à part (APNs), hors de cette première étape ───── */

@Composable
fun RemindersEffect(profileId: String?) { }

@Composable
fun NotificationsScreen(onBack: () -> Unit) = StubScreen("Notifications et rappels", onBack)

/** Pas de bouton « Retour » système sur iPhone : le retour passe par les boutons de l'écran (même parcours). */
@Composable
fun PlatformBackHandler(enabled: Boolean = true, onBack: () -> Unit) { }
