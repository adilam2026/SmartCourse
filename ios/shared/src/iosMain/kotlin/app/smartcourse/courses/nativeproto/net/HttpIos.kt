package app.smartcourse.courses.nativeproto.net

import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.engine.darwin.DarwinHttpRequestException
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.timeout
import io.ktor.client.request.headers
import io.ktor.client.request.prepareRequest
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readRawBytes
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.Url
import io.ktor.http.contentType
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.CancellationException
import platform.Foundation.NSHTTPCookieAcceptPolicy

/*
 * Partie PROPRE À L'IPHONE du réseau (Android : HttpAndroid.kt) : transport NSURLSession (Ktor, moteur Darwin), analyse d'adresse.
 * Mêmes réglages qu'Android : 10 s pour se connecter, 15 s sans réponse, aucune redirection suivie, AUCUN cookie géré par le
 * système (le seul cookie envoyé est celui de la session, gardé dans le Trousseau).
 */

/** Adresse saisie → adresse normalisée (sans « / » final), ou null si inutilisable. Mêmes cas que sur Android (tests communs). */
fun normalizeServer(raw: String): String? {
    var s = raw.trim()
    if (s.isEmpty() || s.any { it.isWhitespace() }) return null
    if (!s.contains("://")) s = "https://$s"
    val scheme = s.substringBefore("://").lowercase()
    if (scheme != "https" && scheme != "http") return null
    val u = try { Url(s) } catch (_: Exception) { return null }
    val host = u.host.lowercase()
    if (host.isEmpty() || host.any { it == '/' || it == '@' }) return null
    val port = u.specifiedPort.takeIf { it > 0 } ?: if (scheme == "https") 443 else 80
    val p = if ((scheme == "https" && port == 443) || (scheme == "http" && port == 80)) "" else ":$port"
    return "$scheme://$host$p"
}

class IosTransport : HttpTransport {
    private val client = HttpClient(Darwin) {
        followRedirects = false
        expectSuccess = false
        install(HttpTimeout) { connectTimeoutMillis = 10_000; socketTimeoutMillis = 15_000; requestTimeoutMillis = 30_000 }
        engine {
            configureSession {
                setHTTPCookieStorage(null)
                setHTTPShouldSetCookies(false)
                setHTTPCookieAcceptPolicy(NSHTTPCookieAcceptPolicy.NSHTTPCookieAcceptPolicyNever)
            }
        }
    }

    private fun map(e: Throwable): Failure {
        if (e is HttpRequestTimeoutException || (e.message ?: "").contains("timed out", ignoreCase = true)) return Failure.TIMEOUT
        val m = (e as? DarwinHttpRequestException)?.origin
        val code = m?.code?.toInt()
        return when (code) {
            -1001 -> Failure.TIMEOUT
            -1022 -> Failure.CLEARTEXT
            in -1206..-1200, -2000 -> Failure.TLS
            null -> if (e.message?.contains("SSL", true) == true) Failure.TLS else Failure.NETWORK
            else -> Failure.NETWORK
        }
    }

    /** Plusieurs en-têtes Set-Cookie sont fusionnés par le système (séparés par des virgules) : on les sépare à nouveau. */
    private fun splitCookies(values: List<String>): List<String> =
        values.flatMap { it.split(Regex(",(?=\\s*[A-Za-z0-9_\\-]+=)")).map(String::trim) }

    override suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): HttpResponse = try {
        val r = client.request(url) {
            this.method = HttpMethod.parse(method)
            headers { headers.forEach { (k, v) -> append(k, v) } }
            if (body != null) { contentType(ContentType.Application.Json.withParameter("charset", "utf-8")); setBody(body) }
        }
        HttpResponse(r.status.value, r.bodyAsText(), splitCookies(r.headers.getAll("Set-Cookie") ?: emptyList()))
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        throw TransportException(map(e))
    }

    override suspend fun stream(url: String, headers: Map<String, String>, onStatus: (Int) -> Boolean, onLine: (String) -> Unit) {
        try {
            client.prepareRequest(url) {
                method = HttpMethod.Get
                headers { headers.forEach { (k, v) -> append(k, v) } }
                timeout { socketTimeoutMillis = 70_000; requestTimeoutMillis = Long.MAX_VALUE }
            }.execute { r ->
                if (!onStatus(r.status.value)) return@execute
                val ch = r.bodyAsChannel()
                while (true) onLine(ch.readUTF8Line() ?: break)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            throw TransportException(map(e))
        }
    }

    /** Photo du serveur ; null si indisponible. */
    suspend fun bytes(url: String, headers: Map<String, String>): ByteArray? = try {
        val r = client.request(url) { method = HttpMethod.Get; headers { headers.forEach { (k, v) -> append(k, v) } } }
        if (r.status.value == 200) r.readRawBytes() else null
    } catch (e: CancellationException) {
        throw e
    } catch (_: Throwable) { null }
}

/** Client de l'API avec le transport iPhone. */
fun ApiClient(store: SessionStorage): ApiClient = ApiClient(store, IosTransport())
