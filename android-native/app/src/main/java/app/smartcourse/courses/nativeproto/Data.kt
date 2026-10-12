package app.smartcourse.courses.nativeproto

import android.os.Bundle
import androidx.annotation.DrawableRes
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import java.util.Locale

/** Paramètres de lancement (adb) : servent uniquement à ouvrir un écran dans un état précis pour les captures. */
object Launch {
    var extras: Bundle? = null
    private val used = mutableSetOf<String>()
    fun str(k: String): String? = extras?.getString(k)
    fun flag(k: String): Boolean = extras?.let { it.getBoolean(k, false) || it.getString(k) == "true" } ?: false
    private val usedStr = mutableSetOf<String>()
    fun strOnce(k: String): String? { if (k in usedStr) return null; usedStr += k; return str(k) }
    /** Vrai une seule fois : l'état de lancement n'est appliqué qu'à la première ouverture de l'écran. */
    fun once(k: String): Boolean {
        if (!flag(k) || k in used) return false
        used += k
        return true
    }
}

/* ───────────── Unités et quantités ───────────── */

/** Quantités stockées en entier dans la plus petite unité : g, ml ou pièce. kg↔g et L↔ml sont exacts ; aucune conversion vers « pièce ». */
enum class UnitKind(val big: String?, val small: String) { MASS("kg", "g"), VOLUME("L", "ml"), COUNT(null, "pièce") }

data class Product(
    val id: String,
    val name: String,
    @DrawableRes val photo: Int,
    val category: String,
    val unit: UnitKind,
    val countLabel: String = "pièce",
    val basePrice: Int?,       // centimes de DH par kg / L / pièce — valeurs fictives
    val inCatalog: Boolean,
)

fun fmtNum(v: Double): String {
    val s = String.format(Locale.US, "%.3f", v).trimEnd('0').trimEnd('.')
    return s.replace('.', ',')
}

fun refLabel(p: Product): String = when (p.unit) { UnitKind.MASS -> "kg"; UnitKind.VOLUME -> "L"; UnitKind.COUNT -> p.countLabel }

fun qtyText(p: Product, q: Int): String = when (p.unit) {
    UnitKind.MASS -> if (q >= 1000) "${fmtNum(q / 1000.0)} kg" else "$q g"
    UnitKind.VOLUME -> if (q >= 1000) "${fmtNum(q / 1000.0)} L" else "$q ml"
    UnitKind.COUNT -> if (q <= 1) "$q ${p.countLabel}" else "$q ${p.countLabel}s"
}

fun priceText(cents: Int, p: Product): String {
    val s = String.format(Locale.US, "%d,%02d", cents / 100, cents % 100)
    return "$s DH / ${refLabel(p)}"
}

/** Pas du bouton +/− dans l'unité affichée. */
fun stepOf(p: Product, big: Boolean): Int = when (p.unit) {
    UnitKind.MASS -> if (big) 500 else 100
    UnitKind.VOLUME -> if (big) 500 else 100
    UnitKind.COUNT -> 1
}

fun defaultQty(p: Product): Int = when (p.unit) { UnitKind.MASS -> 1000; UnitKind.VOLUME -> 1000; UnitKind.COUNT -> 1 }

/* ───────────── Données fictives ───────────── */

enum class Role { ADMIN, STAFF }
enum class SelMode(val label: String) { LIST("Liste"), GRID("Carrés"), CARDS("Grandes cartes") }
enum class ProfRole(val label: String) { ADMIN("Administrateur"), PARENT("Parent"), STAFF("Personnel") }

data class Line(val productId: String, val qty: Int, val bought: Boolean)
data class Profile(val name: String, val role: ProfRole, val primary: Boolean = false, val active: Boolean = true, val color: Color)
data class Order(val id: String, val date: String, val lines: List<Pair<String, Int>>)
data class Toast(val message: String, val undoLabel: String? = null, val undo: (() -> Unit)? = null)

class Demo(initialRole: Role? = null) {
    private val long = Launch.flag("long")

    val products: List<Product> = buildList {
        if (long) add(Product("long", "Boisson végétale à l'avoine sans sucres ajoutés, grande bouteille familiale", R.drawable.p_lait, "Boissons", UnitKind.VOLUME, basePrice = 2490, inCatalog = true))
        add(Product("tomates", "Tomates", R.drawable.p_tomates, "Fruits et légumes", UnitKind.MASS, basePrice = 290, inCatalog = true))
        add(Product("pommes-de-terre", "Pommes de terre", R.drawable.p_pommes_de_terre, "Fruits et légumes", UnitKind.MASS, basePrice = 350, inCatalog = true))
        add(Product("oignons", "Oignons", R.drawable.p_oignons, "Fruits et légumes", UnitKind.MASS, basePrice = 280, inCatalog = true))
        add(Product("carottes", "Carottes", R.drawable.p_carottes, "Fruits et légumes", UnitKind.MASS, basePrice = 290, inCatalog = true))
        add(Product("courgettes", "Courgettes", R.drawable.p_courgettes, "Fruits et légumes", UnitKind.MASS, basePrice = 400, inCatalog = true))
        add(Product("concombres", "Concombres", R.drawable.p_concombres, "Fruits et légumes", UnitKind.MASS, basePrice = 330, inCatalog = true))
        add(Product("poivrons-verts", "Poivrons verts", R.drawable.p_poivrons_verts, "Fruits et légumes", UnitKind.MASS, basePrice = 500, inCatalog = true))
        add(Product("persil", "Persil", R.drawable.p_persil, "Fruits et légumes", UnitKind.COUNT, "botte", null, true))
        add(Product("menthe", "Menthe", R.drawable.p_menthe, "Fruits et légumes", UnitKind.COUNT, "botte", null, true))
        add(Product("pommes", "Pommes", R.drawable.p_pommes, "Fruits et légumes", UnitKind.MASS, basePrice = 1200, inCatalog = false))
        add(Product("bananes", "Bananes", R.drawable.p_bananes, "Fruits et légumes", UnitKind.MASS, basePrice = 1000, inCatalog = false))
        add(Product("citrons", "Citrons", R.drawable.p_citrons, "Fruits et légumes", UnitKind.MASS, basePrice = 800, inCatalog = true))
        add(Product("oranges", "Oranges", R.drawable.p_oranges, "Fruits et légumes", UnitKind.MASS, basePrice = 600, inCatalog = false))
        add(Product("lait", "Lait", R.drawable.p_lait, "Produits laitiers et œufs", UnitKind.VOLUME, basePrice = 380, inCatalog = true))
        add(Product("oeufs", "Œufs", R.drawable.p_oeufs, "Produits laitiers et œufs", UnitKind.COUNT, "œuf", 150, true))
        add(Product("fromage-blanc", "Fromage blanc", R.drawable.p_fromage_blanc, "Produits laitiers et œufs", UnitKind.COUNT, "pot", null, false))
        add(Product("riz", "Riz", R.drawable.p_riz, "Épicerie", UnitKind.MASS, basePrice = 1100, inCatalog = true))
        add(Product("pates", "Pâtes", R.drawable.p_pates, "Épicerie", UnitKind.MASS, basePrice = 1500, inCatalog = true))
        add(Product("huile", "Huile d'olive", R.drawable.p_huile_d_olive, "Épicerie", UnitKind.VOLUME, basePrice = 6500, inCatalog = true))
        add(Product("sucre", "Sucre", R.drawable.p_sucre, "Épicerie", UnitKind.MASS, basePrice = 950, inCatalog = true))
        add(Product("lentilles", "Lentilles", R.drawable.p_lentilles, "Épicerie", UnitKind.MASS, basePrice = null, inCatalog = true))
        add(Product("cafe", "Café", R.drawable.p_cafe, "Épicerie", UnitKind.MASS, basePrice = 9000, inCatalog = false))
        add(Product("baguette", "Baguette", R.drawable.p_baguette, "Boulangerie", UnitKind.COUNT, "baguette", null, true))
        add(Product("poulet", "Poulet", R.drawable.p_poulet, "Viandes et poissons", UnitKind.MASS, basePrice = 3500, inCatalog = false))
        add(Product("eau", "Eau minérale", R.drawable.p_eau_minerale, "Boissons", UnitKind.VOLUME, basePrice = 250, inCatalog = true))
        add(Product("the", "Thé", R.drawable.p_the, "Boissons", UnitKind.COUNT, "boîte", 1800, false))
    }
    val byId: Map<String, Product> = products.associateBy { it.id }

    var role by mutableStateOf(initialRole ?: if (Launch.str("role") == "staff") Role.STAFF else Role.ADMIN)
    var showPrices by mutableStateOf(Launch.flag("prices"))
    var showTotals by mutableStateOf(false)
    var selMode by mutableStateOf(
        when (Launch.str("mode")) { "list" -> SelMode.LIST; "cards" -> SelMode.CARDS; else -> SelMode.GRID }
    )
    var toast by mutableStateOf<Toast?>(null)
    var pendingSheet: String? = null

    val inCatalog = mutableStateMapOf<String, Boolean>().apply { products.forEach { put(it.id, it.inCatalog) } }
    val prices = mutableStateMapOf<String, Int>().apply { products.forEach { p -> p.basePrice?.let { put(p.id, it) } } }
    val selection = mutableStateMapOf<String, Int>()
    val lines = mutableStateListOf<Line>().apply {
        val allBought = Launch.str("state") == "allbought"
        val empty = Launch.str("state") == "empty"
        if (!empty) {
            if (long) add(Line("long", 1000, false))
            add(Line("tomates", 2000, true))
            add(Line("concombres", 1000, allBought))
            add(Line("persil", 1, allBought))
            add(Line("menthe", 1, allBought))
            add(Line("oignons", 1500, allBought))
            add(Line("lait", 2000, allBought))
            add(Line("oeufs", 12, true))
            add(Line("riz", 1000, allBought))
        }
    }
    val profiles = mutableStateListOf(
        Profile("Adil", ProfRole.ADMIN, primary = true, color = Color(0xFF14B5AE)),
        Profile("Lamiaa", ProfRole.PARENT, color = Color(0xFF6C8EF5)),
        Profile("Marie", ProfRole.STAFF, color = Color(0xFFF2994A)),
        Profile(if (long) "Abdelkrim-Mohammed Ben Salah El Idrissi" else "Karim", ProfRole.STAFF, active = false, color = Color(0xFF9B7EDC)),
    )
    val history = listOf(
        Order("o3", "Lundi 5 mai", listOf("tomates" to 2000, "concombres" to 1000, "lait" to 2000, "oeufs" to 12, "riz" to 1000, "oignons" to 1500)),
        Order("o2", "Lundi 28 avril", listOf("pommes-de-terre" to 3000, "carottes" to 1000, "pates" to 1000, "huile" to 1000, "sucre" to 1000)),
        Order("o1", "Lundi 21 avril", listOf("courgettes" to 1500, "poivrons-verts" to 500, "lentilles" to 1000, "baguette" to 3)),
    )
    val deletedOrders = mutableStateListOf<String>()

    fun say(msg: String, undoLabel: String? = null, undo: (() -> Unit)? = null) { toast = Toast(msg, undoLabel, undo) }
    fun simulated(what: String) = say("Action simulée : $what")

    val boughtCount get() = lines.count { it.bought }
    fun setBought(id: String, v: Boolean) { val i = lines.indexOfFirst { it.productId == id }; if (i >= 0) lines[i] = lines[i].copy(bought = v) }
    fun setLineQty(id: String, q: Int) { val i = lines.indexOfFirst { it.productId == id }; if (i >= 0) lines[i] = lines[i].copy(qty = q) }
    fun removeLine(id: String) { lines.removeAll { it.productId == id } }
}

val LocalDemo = compositionLocalOf<Demo> { error("Demo manquant") }

/** Estimation indicative de la liste : (montant en centimes de DH, nombre d'articles sans prix). Jamais un montant payé. */
fun Demo.estimate(): Pair<Long, Int> {
    var total = 0L
    var missing = 0
    lines.forEach { l ->
        val p = byId[l.productId] ?: return@forEach
        val price = prices[p.id]
        if (price == null) { missing++; return@forEach }
        total += if (p.unit == UnitKind.COUNT) price.toLong() * l.qty else Math.round(price.toDouble() * l.qty / 1000.0)
    }
    return total to missing
}
