package app.smartcourse.courses.nativeproto.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/*
 * Partie PROPRE À ANDROID du réseau (l'équivalent iPhone est dans ios/shared/src/iosMain) : transport OkHttp, analyse d'adresse,
 * client des photos (Coil). Mêmes réglages et même comportement qu'avant la séparation.
 */

/** Adresse saisie → adresse normalisée (sans « / » final), ou null si inutilisable. https:// par défaut ; http:// accepté pour la syntaxe, le système le refusera hors émulateur. */
fun normalizeServer(raw: String): String? {
    var s = raw.trim()
    if (s.isEmpty() || s.any { it.isWhitespace() }) return null
    if (!s.contains("://")) s = "https://$s"
    val u = s.toHttpUrlOrNull() ?: return null
    if (u.scheme != "https" && u.scheme != "http") return null
    if (u.host.isEmpty()) return null
    val port = if ((u.scheme == "https" && u.port == 443) || (u.scheme == "http" && u.port == 80)) "" else ":${u.port}"
    return "${u.scheme}://${u.host}$port"
}

class OkHttpTransport(client: OkHttpClient? = null) : HttpTransport {
    val http: OkHttpClient = client ?: OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).writeTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()
    private val media = "application/json; charset=utf-8".toMediaType()

    private fun request(method: String, url: String, headers: Map<String, String>, body: String?): Request {
        val b = Request.Builder().url(url)
        headers.forEach { (k, v) -> b.header(k, v) }
        return b.method(method, body?.toRequestBody(media)).build()
    }

    private fun map(e: Exception): Failure = when {
        e is SocketTimeoutException -> Failure.TIMEOUT
        e is SSLException -> Failure.TLS
        e is IOException && (e.message ?: "").contains("Cleartext", ignoreCase = true) -> Failure.CLEARTEXT
        e is IOException -> Failure.NETWORK
        else -> Failure.UNKNOWN
    }

    override suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): HttpResponse = withContext(Dispatchers.IO) {
        try {
            http.newCall(request(method, url, headers, body)).execute().use { r -> HttpResponse(r.code, r.body?.string().orEmpty(), r.headers("Set-Cookie")) }
        } catch (e: Exception) {
            throw TransportException(map(e))
        }
    }

    override suspend fun stream(url: String, headers: Map<String, String>, onStatus: (Int) -> Boolean, onLine: (String) -> Unit) = coroutineScope {
        val client = http.newBuilder().readTimeout(70, TimeUnit.SECONDS).build()
        val call = client.newCall(request("GET", url, headers, null))
        // La lecture du flux est bloquante : à l'annulation (application en arrière-plan), la connexion est fermée explicitement,
        // sinon le flux resterait ouvert et continuerait de recevoir les événements.
        val watcher = launch { try { awaitCancellation() } finally { call.cancel() } }
        try {
            withContext(Dispatchers.IO) {
                try {
                    call.execute().use { r ->
                        if (!onStatus(r.code)) return@withContext
                        val src = r.body!!.source()
                        while (true) onLine(src.readUtf8Line() ?: break)
                    }
                } catch (e: Exception) {
                    throw TransportException(map(e))
                }
            }
        } finally {
            watcher.cancel()
        }
    }
}

/** Client de l'API avec le transport Android (OkHttp). [client] : client OkHttp imposé (tests). */
fun ApiClient(store: SessionStorage, client: OkHttpClient? = null): ApiClient = ApiClient(store, OkHttpTransport(client))

/** Client pour le chargement des photos (Coil) : mêmes réglages, avec le cookie de session sur chaque requête. */
fun ApiClient.imageClient(): OkHttpClient = (transport as OkHttpTransport).http.newBuilder().addInterceptor { chain ->
    val b = chain.request().newBuilder()
    store.cookie?.let { b.header("Cookie", "$COOKIE_NAME=$it") }
    chain.proceed(b.build())
}.build()
