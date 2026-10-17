package app.smartcourse.courses.nativeproto.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/* ───────────── Profils ───────────── */

@Serializable
data class ProfileDto(
    val id: String,
    val displayName: String,
    val login: String,
    val role: String,
    val active: Boolean = true,
    val primary: Boolean = false,
    val city: String? = null,
)

private fun <T> Outcome<JsonObject>.map(f: (JsonObject) -> T?): Outcome<T> = when (this) {
    is Outcome.Ok -> f(value)?.let { Outcome.Ok(it) } ?: Outcome.Fail(Failure.NOT_COURSES_SERVER)
    is Outcome.Fail -> this
}

private fun parseProfile(o: JsonObject): ProfileDto? = try { json.decodeFromJsonElement(ProfileDto.serializer(), o) } catch (_: Exception) { null }

class ProfilesRepo(private val api: ApiClient) {
    suspend fun list(): Outcome<List<ProfileDto>> = api.call("GET", "/api/profiles").map { o ->
        o["profiles"]?.jsonArray?.let { arr ->
            val l = arr.mapNotNull { parseProfile(it.jsonObject) }
            if (l.size == arr.size) l else null
        }
    }

    suspend fun create(displayName: String, login: String, role: String, secret: String, confirm: String, city: String?): Outcome<ProfileDto> =
        api.call("POST", "/api/profiles", buildJsonObject {
            put("displayName", displayName); put("login", login); put("role", role)
            put("secret", secret); put("secretConfirm", confirm)
            if (city != null) put("city", city)
        }).map { o -> o["profile"]?.jsonObject?.let(::parseProfile) }

    suspend fun update(id: String, displayName: String? = null, role: String? = null, active: Boolean? = null): Outcome<ProfileDto> =
        api.call("PATCH", "/api/profiles/$id", buildJsonObject {
            displayName?.let { put("displayName", it) }
            role?.let { put("role", it) }
            active?.let { put("active", it) }
        }).map { o -> o["profile"]?.jsonObject?.let(::parseProfile) }

    suspend fun delete(id: String): Outcome<Unit> = api.call("DELETE", "/api/profiles/$id").map { Unit }

    suspend fun resetSecret(id: String, secret: String, confirm: String): Outcome<Unit> =
        api.call("POST", "/api/profiles/$id/reset-secret", buildJsonObject { put("secret", secret); put("secretConfirm", confirm) }).map { Unit }

    suspend fun setMyCity(city: String): Outcome<String> =
        api.call("PUT", "/api/me/city", buildJsonObject { put("city", city) }).map { o -> o["city"]?.jsonPrimitive?.contentOrNull }
}

/* ───────────── Catalogue ───────────── */

data class CatCategory(val key: String, val label: String)

/** Une entrée du catalogue complet, avec son état chez la famille : active (dans mon catalogue), inactive (retirée), absent. */
data class CatalogEntry(
    val key: String,
    val origin: String,
    val name: String,
    val brand: String?,
    val category: String,
    val photoUrl: String?,
    val status: String,
    val productId: String?,
)

data class CatalogCounts(val active: Int, val inactive: Int, val absent: Int) {
    val all get() = active + inactive + absent
    val todo get() = inactive + absent
}

data class CatalogPage(val total: Int, val items: List<CatalogEntry>, val counts: CatalogCounts?)

class CatalogRepo(private val api: ApiClient) {
    suspend fun categories(): Outcome<List<CatCategory>> = api.call("GET", "/api/catalog").map { o ->
        o["categories"]?.jsonArray?.map { c -> CatCategory(c.jsonObject["key"]!!.jsonPrimitive.content, c.jsonObject["label"]!!.jsonPrimitive.content) }
    }

    /** status : null (tous), "active" (dans mon catalogue) ou "todo" (à ajouter : retirés et absents). */
    suspend fun page(status: String?, category: String?, query: String, offset: Int, limit: Int = 30, withCounts: Boolean = false, presentFirst: Boolean = false): Outcome<CatalogPage> {
        val qs = buildList {
            add("offset=$offset"); add("limit=$limit")
            status?.let { add("status=$it") }
            category?.let { add("category=" + java.net.URLEncoder.encode(it, "UTF-8")) }
            if (query.isNotBlank()) add("q=" + java.net.URLEncoder.encode(query.trim(), "UTF-8"))
            if (withCounts) add("counts=1")
            if (presentFirst) add("presentFirst=1")
        }.joinToString("&")
        return api.call("GET", "/api/catalog/all?$qs").map { o ->
            val items = o["items"]!!.jsonArray.map { e ->
                val x = e.jsonObject
                CatalogEntry(
                    key = x["key"]!!.jsonPrimitive.content, origin = x["origin"]!!.jsonPrimitive.content,
                    name = x["name"]!!.jsonPrimitive.content, brand = x["brand"]?.jsonPrimitive?.contentOrNull,
                    category = x["category"]!!.jsonPrimitive.content, photoUrl = x["photoUrl"]?.jsonPrimitive?.contentOrNull,
                    status = x["status"]!!.jsonPrimitive.content, productId = x["productId"]?.jsonPrimitive?.contentOrNull,
                )
            }
            val c = o["counts"]?.jsonObject?.let { CatalogCounts(it["active"]!!.jsonPrimitive.intOrNull ?: 0, it["inactive"]!!.jsonPrimitive.intOrNull ?: 0, it["absent"]!!.jsonPrimitive.intOrNull ?: 0) }
            CatalogPage(o["total"]!!.jsonPrimitive.intOrNull ?: 0, items, c)
        }
    }

    /** Retirer / remettre : le produit reste en base (historique, listes archivées et prix intacts). */
    suspend fun setActive(productId: String, active: Boolean): Outcome<Unit> =
        api.call("PATCH", "/api/products/$productId", buildJsonObject { put("active", active) }).map { Unit }

    /** Ajoute depuis le catalogue (initial ou étendu) ; réactive plutôt que de recréer. Renvoie l'identifiant du produit de la famille. */
    suspend fun addFromCatalog(origin: String, key: String): Outcome<String> =
        api.call("POST", "/api/products/from-catalog", buildJsonObject { put("origin", origin); put("key", key) })
            .map { o -> o["product"]?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull }
}

/* ───────────── Messages ───────────── */

/** Message clair pour un refus du serveur : le code précis d'abord, sinon la cause générale. */
fun serverMessage(f: Outcome.Fail, general: (Failure) -> String): String = when (f.code) {
    "last_admin" -> "Impossible : c'est le dernier administrateur actif."
    "primary_admin_protected" -> "Le rôle de l'administrateur principal ne peut pas être modifié."
    "admin_cannot_deactivate" -> "Un administrateur ne peut pas être désactivé : retirez-lui d'abord le rôle administrateur."
    "admin_cannot_delete" -> "Retirez d'abord le rôle administrateur de ce profil avant de le supprimer."
    "primary_cannot_delete" -> "L'administrateur principal ne peut pas être supprimé."
    "use_own_deletion" -> "Pour supprimer votre propre compte, utilisez « Supprimer mon compte »."
    "login_taken" -> "Cet identifiant existe déjà dans la famille."
    "city_required" -> "Choisissez une ville."
    "invalid_city" -> "Choisissez une ville dans la liste."
    "invalid_secret" -> "Le code d'accès doit contenir entre 6 et 8 chiffres."
    "secret_mismatch" -> "Les deux codes d'accès ne sont pas identiques."
    "weak_secret" -> "Code d'accès trop simple (évitez 123456, 111111…)."
    "product_exists" -> "Cet article existe déjà dans le catalogue."
    "forbidden" -> "Action réservée aux administrateurs."
    else -> when (f.failure) {
        Failure.FORBIDDEN -> "Action réservée aux administrateurs."
        Failure.NOT_FOUND -> "Élément introuvable : il a peut-être été supprimé. Actualisez l'écran."
        Failure.CONFLICT -> "Action impossible dans l'état actuel. Actualisez l'écran."
        else -> general(f.failure)
    }
}
