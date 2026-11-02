package app.smartcourse.courses.nativeproto.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

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

/**
 * Client de l'API existante, commun à Android et à l'iPhone. Le transport HTTP est propre à chaque plateforme ([HttpTransport] :
 * OkHttp sur Android, NSURLSession sur iPhone) ; les règles (codes de réponse, erreurs, session, cookie) sont les mêmes partout.
 */
class ApiClient(internal val store: SessionStorage, internal val transport: HttpTransport) {
    /** Appelé quand le serveur répond 401 à une requête authentifiée : la session n'existe plus. */
    var onSessionExpired: (() -> Unit)? = null

    /**
     * Requête authentifiée générique vers l'API existante. 2xx : le corps JSON ; sinon la cause, avec le code d'erreur du serveur
     * (par exemple « last_admin », « login_taken ») que l'écran traduit en message clair.
     */
    suspend fun call(method: String, path: String, body: JsonObject? = null): Outcome<JsonObject> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        if (store.cookie == null) return Outcome.Fail(Failure.SESSION_EXPIRED)
        val rb = body?.toString() ?: if (method == "GET" || method == "DELETE") null else "{}"
        val out = exec(method, base + path, true, rb) { r -> classify(r) }
        if (out is Outcome.Fail && out.failure == Failure.SESSION_EXPIRED) onSessionExpired?.invoke()
        return out
    }

    /**
     * Flux d'événements du serveur (SSE) : appelle [onEvent] pour chaque événement (« ready », « list.updated »…) jusqu'à la coupure.
     * Se termine par Ok quand le serveur ferme proprement, sinon par la cause. Annulable : l'annulation de la coroutine ferme la connexion.
     */
    suspend fun stream(path: String, onOpen: () -> Unit, onEvent: (String) -> Unit): Outcome<Unit> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        if (store.cookie == null) return Outcome.Fail(Failure.SESSION_EXPIRED)
        val headers = headers(true) + ("Accept" to "text/event-stream")
        var status = 0
        var ev: String? = null
        return try {
            transport.stream(base + path, headers, onStatus = { code ->
                status = code
                if (code == 200) onOpen()
                code == 200
            }) { line ->
                if (line.startsWith("event:")) ev = line.substring(6).trim()
                else if (line.isEmpty()) { ev?.let(onEvent); ev = null }
            }
            when {
                status == 401 -> { onSessionExpired?.invoke(); Outcome.Fail(Failure.SESSION_EXPIRED, 401) }
                status != 200 -> Outcome.Fail(if (status in 500..599) Failure.SERVER_ERROR else Failure.UNKNOWN, status)
                else -> Outcome.Ok(Unit)
            }
        } catch (e: TransportException) {
            Outcome.Fail(e.failure)
        }
    }

    private fun classify(r: HttpResponse): Outcome<JsonObject> {
        val text = r.text
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
    /** Lecture publique (sans session), ex. la vérification de mise à jour, possible avant comme après la connexion. */
    suspend fun getPublic(path: String): Outcome<JsonObject> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        return exec("GET", base + path, false, null) { r -> classify(r) }
    }

    suspend fun callPublic(method: String, path: String, body: JsonObject): Outcome<JsonObject> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        return exec(method, base + path, false, body.toString()) { r -> classify(r) }
    }

    private fun errorCode(body: String?): String? = try {
        body?.let { json.parseToJsonElement(it).jsonObject["error"]?.jsonPrimitive?.contentOrNull }
    } catch (_: Exception) { null }

    private fun headers(withSession: Boolean, cookie: String? = store.cookie): Map<String, String> {
        val h = linkedMapOf("Accept" to "application/json")
        if (withSession) cookie?.let { h["Cookie"] = "$COOKIE_NAME=$it" }
        return h
    }

    private suspend fun <T> exec(method: String, url: String, withSession: Boolean, body: String?, cookie: String? = store.cookie, parse: (HttpResponse) -> Outcome<T>): Outcome<T> =
        try {
            parse(transport.send(method, url, headers(withSession, cookie), body))
        } catch (e: TransportException) {
            Outcome.Fail(e.failure)
        }

    /** GET /health sur une adresse à tester (sans session). Un serveur qui ne répond pas comme Courses est refusé. */
    suspend fun health(base: String): Outcome<Unit> = exec("GET", "$base/health", false, null) { r ->
        when {
            r.code == 200 -> {
                val ok = try { json.parseToJsonElement(r.text).jsonObject["status"]?.jsonPrimitive?.contentOrNull == "ok" } catch (_: Exception) { false }
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
        return exec("POST", "$base/api/auth/login", false, payload) { r ->
            val body = r.text
            when {
                r.code == 200 -> {
                    val cookie = sessionFromSetCookie(r.setCookies)
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
        return exec("POST", "$base/api/signup/verify", false, payload) { r ->
            if (r.code == 201) {
                val cookie = sessionFromSetCookie(r.setCookies)
                val o = try { json.parseToJsonElement(r.text).jsonObject } catch (_: Exception) { null }
                val me = try { json.decodeFromJsonElement(Me.serializer(), o?.get("me") as JsonObject) } catch (_: Exception) { null }
                val fc = (o?.get("familyCode") as? JsonPrimitive)?.content
                val lid = (o?.get("loginId") as? JsonPrimitive)?.takeIf { it.isString }?.content
                if (cookie == null || me == null || fc == null) Outcome.Fail(Failure.NOT_COURSES_SERVER, r.code)
                else { store.cookie = cookie; Outcome.Ok(SignupDone(me, fc, lid)) }
            } else (classify(r) as? Outcome.Fail) ?: Outcome.Fail(Failure.UNKNOWN, r.code)
        }
    }

    /** Vérifie la session auprès du serveur (désactivation, révocation et expiration prennent effet ici). */
    suspend fun me(): Outcome<Me> {
        val base = store.server ?: return Outcome.Fail(Failure.BAD_ADDRESS)
        if (store.cookie == null) return Outcome.Fail(Failure.SESSION_EXPIRED)
        return exec("GET", "$base/api/me", true, null) { r ->
            when {
                r.code == 200 -> {
                    val me = try { json.decodeFromJsonElement(Me.serializer(), json.parseToJsonElement(r.text).jsonObject["me"] as JsonObject) } catch (_: Exception) { null }
                    if (me == null) Outcome.Fail(Failure.NOT_COURSES_SERVER, r.code) else Outcome.Ok(me)
                }
                r.code == 401 -> Outcome.Fail(Failure.SESSION_EXPIRED, r.code)
                r.code == 403 && errorCode(r.text) == "setup_incomplete" -> Outcome.Fail(Failure.SETUP_INCOMPLETE, r.code)
                r.code in 500..599 -> Outcome.Fail(Failure.SERVER_ERROR, r.code)
                else -> Outcome.Fail(Failure.UNKNOWN, r.code)
            }
        }
    }

    /** Révoque côté serveur la session portée par [cookie] (déconnexion). 401 = déjà révoquée : succès. */
    suspend fun logout(base: String, cookie: String): Outcome<Unit> =
        exec("POST", "$base/api/auth/logout", true, "{}", cookie) { r ->
            when {
                r.code == 200 || r.code == 401 -> Outcome.Ok(Unit)
                r.code in 500..599 -> Outcome.Fail(Failure.SERVER_ERROR, r.code)
                else -> Outcome.Fail(Failure.UNKNOWN, r.code)
            }
        }
}
