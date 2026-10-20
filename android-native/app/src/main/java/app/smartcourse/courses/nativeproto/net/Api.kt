package app.smartcourse.courses.nativeproto.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/** Profil connecté, tel que renvoyé par /api/auth/login et /api/me. */
@Serializable
/** [loginId] : identifiant famille choisi (null tant qu'aucun n'est choisi) ; [code] : code famille d'origine, toujours valable. */
data class FamilyInfo(val code: String, val name: String, val loginId: String? = null)

@Serializable
data class Me(
    val id: String,
    val familyId: String = "",
    val displayName: String,
    val login: String,
    val role: String,
    val setupPending: Boolean = false,
    /** Connecté avec un code provisoire : il faut d'abord choisir son propre code d'accès personnel. */
    val mustChangeSecret: Boolean = false,
    val city: String? = null,
    val family: FamilyInfo? = null,
    val primary: Boolean? = null,
    val prefs: Prefs? = null,
    val location: FamilyLocation? = null,
    val features: FamilyFeatures? = null,
)

/** Pays et ville DE LA FAMILLE. [pricesAvailable] : prix indicatifs (Maroc, ou pays non encore confirmé). */
@Serializable
data class FamilyLocation(
    val country: String? = null, val city: String? = null, val confirmed: Boolean = false,
    val pricesAvailable: Boolean = true, val suggestion: LocationSuggestion? = null,
)

/** Paramètres avancés de la famille (désactivés par défaut). */
@Serializable
data class FamilyFeatures(val multiLists: Boolean = false, val budget: Boolean = false)

@Serializable
data class LocationSuggestion(val country: String, val city: String)

@Serializable
data class Prefs(val showPrices: Boolean = false, val showTotals: Boolean = false, val rev: Long = 0)

enum class Failure {
    INVALID_CREDENTIALS, RATE_LIMITED, SETUP_INCOMPLETE, SESSION_EXPIRED,
    NETWORK, TIMEOUT, TLS, CLEARTEXT, SERVER_ERROR, NOT_COURSES_SERVER, BAD_REQUEST, BAD_ADDRESS, UNKNOWN,
    FORBIDDEN, NOT_FOUND, CONFLICT,
}

sealed interface Outcome<out T> {
    data class Ok<T>(val value: T) : Outcome<T>
    data class Fail(val failure: Failure, val status: Int? = null, val code: String? = null) : Outcome<Nothing>
}

val json = Json { ignoreUnknownKeys = true }

const val COOKIE_NAME = "sc_session"

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

/** Extrait la valeur du cookie de session d'un en-tête Set-Cookie ; null si absent ou effacé (valeur vide). */
fun sessionFromSetCookie(headers: List<String>): String? {
    for (h in headers) {
        val first = h.substringBefore(';').trim()
        if (first.startsWith("$COOKIE_NAME=")) {
            val v = first.substringAfter('=').trim()
            return v.ifEmpty { null }
        }
    }
    return null
}

class ApiClient(private val store: SessionStorage, client: OkHttpClient? = null) {
    private val http: OkHttpClient = client ?: OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).writeTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    private val media = "application/json; charset=utf-8".toMediaType()

    /** Appelé quand le serveur répond 401 à une requête authentifiée : la session n'existe plus. */
    var onSessionExpired: (() -> Unit)? = null

    /** Client pour le chargement des photos (Coil) : mêmes réglages, avec le cookie de session sur chaque requête. */
    fun imageClient(): OkHttpClient = http.newBuilder().addInterceptor { chain ->
        val b = chain.request().newBuilder()
        store.cookie?.let { b.header("Cookie", "$COOKIE_NAME=$it") }
        chain.proceed(b.build())
    }.build()

    /**
     * Requête authentifiée générique vers l'API existante. 2xx : le corps JSON ; sinon la cause, avec le code d'erreur du serveur
     * (par exemple « last_admin », « login_taken ») que l'écran traduit en message clair.
     */
    suspend fun call(method: String, path: String, body: JsonObject? = null): Outcome<JsonObject> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        if (store.cookie == null) return Outcome.Fail(Failure.SESSION_EXPIRED)
        val rb = body?.toString()?.toRequestBody(media) ?: if (method == "GET" || method == "DELETE") null else "{}".toRequestBody(media)
        val req = builder(base, path, true).method(method, rb).build()
        val out = exec(req) { r, text -> classify(r, text) }
        if (out is Outcome.Fail && out.failure == Failure.SESSION_EXPIRED) onSessionExpired?.invoke()
        return out
    }

    /**
     * Flux d'événements du serveur (SSE) : appelle [onEvent] pour chaque événement (« ready », « list.updated »…) jusqu'à la coupure.
     * Se termine par Ok quand le serveur ferme proprement, sinon par la cause. Annulable : l'annulation de la coroutine ferme la connexion.
     */
    suspend fun stream(path: String, onOpen: () -> Unit, onEvent: (String) -> Unit): Outcome<Unit> = coroutineScope {
        val base = store.server ?: return@coroutineScope Outcome.Fail(Failure.BAD_ADDRESS)
        if (store.cookie == null) return@coroutineScope Outcome.Fail(Failure.SESSION_EXPIRED)
        val client = http.newBuilder().readTimeout(70, TimeUnit.SECONDS).build()
        val call = client.newCall(builder(base, path, true).header("Accept", "text/event-stream").get().build())
        // La lecture du flux est bloquante : à l'annulation (application en arrière-plan), la connexion est fermée explicitement,
        // sinon le flux resterait ouvert et continuerait de recevoir les événements.
        val watcher = launch { try { awaitCancellation() } finally { call.cancel() } }
        try {
            withContext(Dispatchers.IO) {
                try {
                    call.execute().use { r ->
                        if (r.code == 401) { onSessionExpired?.invoke(); return@withContext Outcome.Fail(Failure.SESSION_EXPIRED, 401) }
                        if (r.code != 200) return@withContext Outcome.Fail(if (r.code in 500..599) Failure.SERVER_ERROR else Failure.UNKNOWN, r.code)
                        onOpen()
                        val src = r.body!!.source()
                        var ev: String? = null
                        while (true) {
                            val line = src.readUtf8Line() ?: break
                            if (line.startsWith("event:")) ev = line.substring(6).trim()
                            else if (line.isEmpty()) { ev?.let(onEvent); ev = null }
                        }
                        Outcome.Ok(Unit)
                    }
                } catch (e: Exception) {
                    Outcome.Fail(map(e))
                }
            }
        } finally {
            watcher.cancel()
        }
    }

    private fun classify(r: Response, text: String): Outcome<JsonObject> {
        val code = errorCode(text)
        return when {
            r.code in 200..299 -> {
                val obj = try { if (text.isBlank()) JsonObject(emptyMap()) else json.parseToJsonElement(text).jsonObject } catch (_: Exception) { null }
                if (obj == null) Outcome.Fail(Failure.NOT_COURSES_SERVER, r.code) else Outcome.Ok(obj)
            }
            r.code == 401 -> Outcome.Fail(Failure.SESSION_EXPIRED, r.code, code)
            r.code == 403 -> Outcome.Fail(if (code == "setup_incomplete") Failure.SETUP_INCOMPLETE else Failure.FORBIDDEN, r.code, code)
            r.code == 404 -> Outcome.Fail(Failure.NOT_FOUND, r.code, code)
            r.code == 409 -> Outcome.Fail(Failure.CONFLICT, r.code, code)
            r.code == 429 -> Outcome.Fail(Failure.RATE_LIMITED, r.code, code)
            r.code in 400..499 -> Outcome.Fail(Failure.BAD_REQUEST, r.code, code)
            r.code in 500..599 -> Outcome.Fail(Failure.SERVER_ERROR, r.code, code)
            else -> Outcome.Fail(Failure.UNKNOWN, r.code, code)
        }
    }

    /** Requête sans session (récupération par e-mail, création de famille) : le cookie n'est jamais envoyé ni conservé. */
    suspend fun callPublic(method: String, path: String, body: JsonObject): Outcome<JsonObject> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        val req = builder(base, path, false).method(method, body.toString().toRequestBody(media)).build()
        return exec(req) { r, text -> classify(r, text) }
    }

    private fun map(e: Exception): Failure = when {
        e is SocketTimeoutException -> Failure.TIMEOUT
        e is SSLException -> Failure.TLS
        e is IOException && (e.message ?: "").contains("Cleartext", ignoreCase = true) -> Failure.CLEARTEXT
        e is IOException -> Failure.NETWORK
        else -> Failure.UNKNOWN
    }

    private fun errorCode(body: String?): String? = try {
        body?.let { json.parseToJsonElement(it).jsonObject["error"]?.jsonPrimitive?.contentOrNull }
    } catch (_: Exception) { null }

    private suspend fun <T> exec(req: Request, parse: (Response, String) -> Outcome<T>): Outcome<T> = withContext(Dispatchers.IO) {
        try {
            http.newCall(req).execute().use { r -> parse(r, r.body?.string().orEmpty()) }
        } catch (e: Exception) {
            Outcome.Fail(map(e))
        }
    }

    private fun builder(base: String, path: String, withSession: Boolean): Request.Builder {
        val b = Request.Builder().url(base + path).header("Accept", "application/json")
        if (withSession) store.cookie?.let { b.header("Cookie", "$COOKIE_NAME=$it") }
        return b
    }

    /** GET /health sur une adresse à tester (sans session). Un serveur qui ne répond pas comme Courses est refusé. */
    suspend fun health(base: String): Outcome<Unit> = exec(builder(base, "/health", false).get().build()) { r, body ->
        when {
            r.code == 200 -> {
                val ok = try { json.parseToJsonElement(body).jsonObject["status"]?.jsonPrimitive?.contentOrNull == "ok" } catch (_: Exception) { false }
                if (ok) Outcome.Ok(Unit) else Outcome.Fail(Failure.NOT_COURSES_SERVER, r.code)
            }
            r.code in 500..599 -> Outcome.Fail(Failure.SERVER_ERROR, r.code)
            else -> Outcome.Fail(Failure.NOT_COURSES_SERVER, r.code)
        }
    }

    /** Connexion : le cookie de session renvoyé par le serveur est conservé (chiffré) ; jamais le code d'accès. */
    suspend fun login(familyCode: String, login: String, secret: String): Outcome<Me> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        val payload = buildJsonObject {
            put("familyCode", JsonPrimitive(familyCode)); put("login", JsonPrimitive(login)); put("secret", JsonPrimitive(secret))
            // Cette application sait faire choisir le code personnel après un code provisoire (l'APK 1166 et le site, non).
            put("clientFeatures", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive("provisional"))))
        }.toString()
        return exec(builder(base, "/api/auth/login", false).post(payload.toRequestBody(media)).build()) { r, body ->
            when {
                r.code == 200 -> {
                    val cookie = sessionFromSetCookie(r.headers("Set-Cookie"))
                    val me = try { json.decodeFromJsonElement(Me.serializer(), json.parseToJsonElement(body).jsonObject["me"] as JsonObject) } catch (_: Exception) { null }
                    if (cookie == null || me == null) Outcome.Fail(Failure.NOT_COURSES_SERVER, r.code)
                    else { store.cookie = cookie; Outcome.Ok(me) }
                }
                r.code == 401 -> Outcome.Fail(Failure.INVALID_CREDENTIALS, r.code)
                r.code == 429 -> Outcome.Fail(Failure.RATE_LIMITED, r.code)
                r.code == 403 && errorCode(body) == "setup_incomplete" -> Outcome.Fail(Failure.SETUP_INCOMPLETE, r.code)
                r.code == 400 -> Outcome.Fail(Failure.BAD_REQUEST, r.code)
                r.code in 500..599 -> Outcome.Fail(Failure.SERVER_ERROR, r.code)
                else -> Outcome.Fail(Failure.UNKNOWN, r.code)
            }
        }
    }

    /** Création de famille : code de vérification de l'adresse exact → famille créée et session ouverte (cookie gardé comme à la connexion). */
    /** Famille créée : le code famille d'origine et l'identifiant famille choisi (null avec un serveur plus ancien). */
    data class SignupDone(val me: Me, val familyCode: String, val loginId: String?)

    suspend fun signupVerify(signupId: String, code: String): Outcome<SignupDone> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        val payload = buildJsonObject { put("signupId", JsonPrimitive(signupId)); put("code", JsonPrimitive(code)) }.toString()
        return exec(builder(base, "/api/signup/verify", false).post(payload.toRequestBody(media)).build()) { r, body ->
            if (r.code == 201) {
                val cookie = sessionFromSetCookie(r.headers("Set-Cookie"))
                val o = try { json.parseToJsonElement(body).jsonObject } catch (_: Exception) { null }
                val me = try { json.decodeFromJsonElement(Me.serializer(), o?.get("me") as JsonObject) } catch (_: Exception) { null }
                val fc = (o?.get("familyCode") as? JsonPrimitive)?.content
                val lid = (o?.get("loginId") as? JsonPrimitive)?.takeIf { it.isString }?.content
                if (cookie == null || me == null || fc == null) Outcome.Fail(Failure.NOT_COURSES_SERVER, r.code)
                else { store.cookie = cookie; Outcome.Ok(SignupDone(me, fc, lid)) }
            } else (classify(r, body) as? Outcome.Fail) ?: Outcome.Fail(Failure.UNKNOWN, r.code)
        }
    }

    /** Vérifie la session auprès du serveur (désactivation, révocation et expiration prennent effet ici). */
    suspend fun me(): Outcome<Me> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        if (store.cookie == null) return Outcome.Fail(Failure.SESSION_EXPIRED)
        return exec(builder(base, "/api/me", true).get().build()) { r, body ->
            when {
                r.code == 200 -> {
                    val me = try { json.decodeFromJsonElement(Me.serializer(), json.parseToJsonElement(body).jsonObject["me"] as JsonObject) } catch (_: Exception) { null }
                    if (me == null) Outcome.Fail(Failure.NOT_COURSES_SERVER, r.code) else Outcome.Ok(me)
                }
                r.code == 401 -> Outcome.Fail(Failure.SESSION_EXPIRED, r.code)
                r.code == 403 && errorCode(body) == "setup_incomplete" -> Outcome.Fail(Failure.SETUP_INCOMPLETE, r.code)
                r.code in 500..599 -> Outcome.Fail(Failure.SERVER_ERROR, r.code)
                else -> Outcome.Fail(Failure.UNKNOWN, r.code)
            }
        }
    }

    /** Révoque côté serveur la session portée par [cookie] (déconnexion). 401 = déjà révoquée : succès. */
    suspend fun logout(base: String, cookie: String): Outcome<Unit> {
        val req = Request.Builder().url("$base/api/auth/logout").header("Accept", "application/json")
            .header("Cookie", "$COOKIE_NAME=$cookie").post("{}".toRequestBody(media)).build()
        return exec(req) { r, _ ->
            when {
                r.code == 200 || r.code == 401 -> Outcome.Ok(Unit)
                r.code in 500..599 -> Outcome.Fail(Failure.SERVER_ERROR, r.code)
                else -> Outcome.Fail(Failure.UNKNOWN, r.code)
            }
        }
    }
}
