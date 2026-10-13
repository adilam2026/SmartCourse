package app.smartcourse.courses.nativeproto.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Format de stockage local : champs absents si inutiles, tolérant aux champs inconnus d'une version plus récente. */
val storeJson = Json { ignoreUnknownKeys = true; encodeDefaults = false; explicitNulls = false }

/* ───────────── Unités ───────────── */

val SERVER_UNITS = listOf("piece", "paquet", "bouteille", "brique", "pot", "boite", "kg", "litre")
fun isFractionalUnit(u: String) = u == "kg" || u == "litre"
fun unitLabel(u: String): String = when (u) { "piece" -> "pièce"; "boite" -> "boîte"; "litre" -> "L"; else -> u }

/* ───────────── Prix ───────────── */

fun parsePrice(o: JsonElement?): PriceRef? {
    val x = (o as? JsonObject) ?: return null
    val amount = x["amount"]?.jsonPrimitive?.contentOrNull ?: return null
    return PriceRef(
        amount = amount,
        refQty = x["refQty"]?.jsonPrimitive?.contentOrNull ?: "1",
        refUnit = x["refUnit"]?.jsonPrimitive?.contentOrNull ?: "kg",
        packaging = x["packaging"]?.jsonPrimitive?.contentOrNull,
        pieceWeightG = x["pieceWeightG"]?.jsonPrimitive?.contentOrNull,
        source = x["source"]?.jsonPrimitive?.contentOrNull ?: "family",
    )
}

/* ───────────── Catalogue de la famille ───────────── */

data class CatProduct(
    val id: String, val category: String, val categoryLabel: String, val name: String, val brand: String?,
    val active: Boolean, val unit: String, val photoUrl: String?, val price: PriceRef?,
)

data class CatalogData(val rev: Long, val products: List<CatProduct>)

fun parseCatalog(o: JsonObject): CatalogData? = try {
    val out = ArrayList<CatProduct>()
    for (c in o["categories"]!!.jsonArray) {
        val co = c.jsonObject
        val key = co["key"]!!.jsonPrimitive.content
        val label = co["label"]!!.jsonPrimitive.content
        for (p in co["products"]!!.jsonArray) {
            val x = p.jsonObject
            out += CatProduct(
                id = x["id"]!!.jsonPrimitive.content, category = key, categoryLabel = label,
                name = x["name"]!!.jsonPrimitive.content, brand = x["brand"]?.jsonPrimitive?.contentOrNull,
                active = x["active"]?.jsonPrimitive?.booleanOrNull ?: true, unit = x["unit"]?.jsonPrimitive?.contentOrNull ?: "piece",
                photoUrl = x["photoUrl"]?.jsonPrimitive?.contentOrNull, price = parsePrice(x["price"]),
            )
        }
    }
    CatalogData(o["rev"]?.jsonPrimitive?.doubleOrNull?.toLong() ?: 0L, out)
} catch (_: Exception) { null }

/* ───────────── Liste ───────────── */

data class ListItem(
    val id: String, val productId: String, val category: String, val name: String, val brand: String?, val photoUrl: String?,
    val productActive: Boolean, val status: String, val rev: Int, val quantity: Double, val unit: String, val price: PriceRef?,
    val purchaseId: String?, val purchasedAt: String?, val purchasedBy: String?, val addedBy: String?,
)

data class ListData(val id: String, val status: String, val createdAt: String, val closedAt: String?, val items: List<ListItem>, val validations: List<ValidationInfo>)

data class ValidationInfo(val id: String, val at: String, val by: String)

fun parseList(o: JsonObject): ListData? = try {
    val items = o["items"]!!.jsonArray.map { e ->
        val x = e.jsonObject
        val pu = x["purchase"] as? JsonObject
        ListItem(
            id = x["id"]!!.jsonPrimitive.content, productId = x["productId"]!!.jsonPrimitive.content,
            category = x["category"]?.jsonPrimitive?.contentOrNull ?: "", name = x["name"]!!.jsonPrimitive.content,
            brand = x["brand"]?.jsonPrimitive?.contentOrNull, photoUrl = x["photoUrl"]?.jsonPrimitive?.contentOrNull,
            productActive = x["productActive"]?.jsonPrimitive?.booleanOrNull ?: true, status = x["status"]!!.jsonPrimitive.content,
            rev = x["rev"]?.jsonPrimitive?.intOrNull ?: 1, quantity = x["quantity"]!!.jsonPrimitive.doubleOrNull ?: 1.0,
            unit = x["unit"]?.jsonPrimitive?.contentOrNull ?: "piece", price = parsePrice(x["price"]),
            purchaseId = pu?.get("id")?.jsonPrimitive?.contentOrNull, purchasedAt = pu?.get("at")?.jsonPrimitive?.contentOrNull,
            purchasedBy = (pu?.get("by") as? JsonObject)?.get("displayName")?.jsonPrimitive?.contentOrNull,
            addedBy = (x["addedBy"] as? JsonObject)?.get("displayName")?.jsonPrimitive?.contentOrNull,
        )
    }
    val vals = (o["validations"] as? JsonArray)?.mapNotNull { v ->
        val x = v.jsonObject
        ValidationInfo(x["id"]!!.jsonPrimitive.content, x["at"]!!.jsonPrimitive.content, (x["by"] as? JsonObject)?.get("displayName")?.jsonPrimitive?.contentOrNull ?: "")
    } ?: emptyList()
    ListData(o["id"]!!.jsonPrimitive.content, o["status"]!!.jsonPrimitive.content, o["createdAt"]!!.jsonPrimitive.content, o["closedAt"]?.jsonPrimitive?.contentOrNull, items, vals)
} catch (_: Exception) { null }

/* ───────────── Opérations en attente ───────────── */

/**
 * Une demande de modification de la liste. Les champs name/unit/category/photoUrl restent sur le téléphone (affichage d'une ligne « en attente »
 * avant l'envoi) ; seuls l'identifiant, le type, le produit, la quantité et la révision de base partent au serveur.
 */
@Serializable
data class Op(
    val opId: String, val type: String, val productId: String? = null, val itemId: String? = null, val purchaseId: String? = null,
    val quantity: Double? = null, val baseRev: Int? = null,
    val name: String? = null, val unit: String? = null, val category: String? = null, val photoUrl: String? = null,
)

@Serializable
data class Batch(val id: String, val at: String, val listId: String?, val ops: List<Op>)

@Serializable
data class Orphan(val productId: String, val name: String, val quantity: Double, val unit: String? = null)

fun Op.wire(): JsonObject = buildJsonObject {
    put("opId", opId); put("type", type)
    productId?.let { put("productId", it) }
    itemId?.let { put("itemId", it) }
    purchaseId?.let { put("purchaseId", it) }
    quantity?.let { put("quantity", it) }
    baseRev?.let { put("baseRev", it) }
}

fun Batch.wire(): JsonObject = buildJsonObject {
    put("ops", buildJsonArray { ops.forEach { add(it.wire()) } })
    put("batch", buildJsonObject { put("id", id); put("at", at) })
}

data class OpResult(val opId: String, val status: String, val reason: String?)

fun parseResults(o: JsonObject): List<OpResult> = (o["results"] as? JsonArray)?.mapNotNull { r ->
    val x = r as? JsonObject ?: return@mapNotNull null
    OpResult(x["opId"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null, x["status"]?.jsonPrimitive?.contentOrNull ?: "applied", x["reason"]?.jsonPrimitive?.contentOrNull)
} ?: emptyList()
