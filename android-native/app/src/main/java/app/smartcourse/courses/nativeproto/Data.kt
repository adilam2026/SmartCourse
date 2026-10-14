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
import app.smartcourse.courses.nativeproto.net.PriceRef
import app.smartcourse.courses.nativeproto.net.fmtPrice
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
    val photoUrl: String? = null,     // données réelles : photo du serveur
    val serverUnit: String = "",      // données réelles : unité du serveur (kg, litre, piece, paquet…)
    val price: PriceRef? = null,      // données réelles : prix indicatif en vigueur
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
/** Présentation des articles à choisir (le nom interne GRID est conservé : préférences déjà enregistrées). */
enum class SelMode(val label: String) {
    LIST("Liste"), GRID("Cartes");
    companion object {
        /** Préférence enregistrée → présentation. L'ancienne « Grandes cartes » (CARDS) devient « Cartes ». */
        fun parse(s: String?): SelMode = if (s == "CARDS") GRID else entries.firstOrNull { it.name == s } ?: GRID
    }
}
/** GLOBAL : tout le catalogue sur une page, en blocs titrés par catégorie. CATEGORY : grille de catégories, puis les articles d'une catégorie. */
enum class SelOrg(val label: String) {
    GLOBAL("Tous les articles"), CATEGORY("Par catégories");
    companion object { fun parse(s: String?): SelOrg = entries.firstOrNull { it.name == s } ?: CATEGORY }
}
enum class ProfRole(val label: String) { ADMIN("Administrateur"), PARENT("Parent"), STAFF("Personnel") }

data class Line(
    val productId: String, val qty: Int, val bought: Boolean,
    val itemId: String? = null, val rev: Int = 0, val purchaseId: String? = null,
    val buyer: String? = null, val boughtAt: String? = null, val pending: Boolean = false, val price: PriceRef? = null,
)
data class Profile(val name: String, val role: ProfRole, val primary: Boolean = false, val active: Boolean = true, val color: Color)
data class Order(val id: String, val date: String, val lines: List<Pair<String, Int>>)
data class Toast(val message: String, val undoLabel: String? = null, val undo: (() -> Unit)? = null)

class Demo(initialRole: Role? = null, val live: Boolean = false) {
    private val long = Launch.flag("long")

    var products: List<Product> by mutableStateOf(buildList<Product> {
        if (live) return@buildList
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
    })
    var byId: Map<String, Product> by mutableStateOf(products.associateBy { it.id })

    var role by mutableStateOf(initialRole ?: if (Launch.str("role") == "staff") Role.STAFF else Role.ADMIN)
    var showPrices by mutableStateOf(Launch.flag("prices"))
    var showTotals by mutableStateOf(false)
    var selMode by mutableStateOf(
        when (Launch.str("mode")) { "list" -> SelMode.LIST; else -> SelMode.GRID }
    )
    var selOrg by mutableStateOf(SelOrg.CATEGORY)
    var toast by mutableStateOf<Toast?>(null)
    var pendingSheet: String? = null

    val inCatalog = mutableStateMapOf<String, Boolean>().apply { products.forEach { put(it.id, it.inCatalog) } }
    val prices = mutableStateMapOf<String, Int>().apply { products.forEach { p -> p.basePrice?.let { put(p.id, it) } } }
    val selection = mutableStateMapOf<String, Int>()

    /*
     * Personnel : l'écran « Choisir mes articles » montre ce qui est déjà enregistré dans la liste du jour (quantité comprise) ;
     * [selection] ne garde que les MODIFICATIONS (nouvelle quantité, ou 0 = à retirer). Administrateur : rien d'enregistré n'est montré,
     * la sélection s'ajoute à la liste comme avant.
     */
    fun savedQty(pid: String): Int? = if (role == Role.STAFF) lines.firstOrNull { it.productId == pid && !it.bought }?.qty else null
    fun selQty(pid: String): Int? { val s = selection[pid] ?: return savedQty(pid); return if (s <= 0) null else s }
    fun setSel(pid: String, q: Int) { if (q == savedQty(pid)) selection.remove(pid) else selection[pid] = q }
    fun selRemove(pid: String) { if (savedQty(pid) != null) selection[pid] = 0 else selection.remove(pid) }
    /** Appui sur la carte : ajoute, annule la modification en cours, ou ouvre la quantité d'un article déjà enregistré. */
    fun selToggle(p: Product, open: () -> Unit) {
        when {
            selection[p.id] != null -> selection.remove(p.id)
            savedQty(p.id) != null -> open()
            else -> selection[p.id] = defaultQty(p)
        }
    }
    /** Nombre de modifications réelles (le bouton « Terminer » reste désactivé à 0). */
    val selChanges: Int get() = selection.count { (pid, q) -> val s = savedQty(pid); if (q <= 0) s != null else q != s }
    val lines = mutableStateListOf<Line>().apply {
        val allBought = Launch.str("state") == "allbought"
        val empty = Launch.str("state") == "empty" || live
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

    /** Données réelles (null : écrans de démonstration, données fictives). */
    var data: AppData? = null
    var pendingOps by mutableStateOf(0)
    var orphanCount by mutableStateOf(0)
    var listLoaded by mutableStateOf(!live)
    var hasList by mutableStateOf(true)
    var listDate by mutableStateOf("Lundi 12 mai")

    fun say(msg: String, undoLabel: String? = null, undo: (() -> Unit)? = null) { toast = Toast(msg, undoLabel, undo) }
    fun simulated(what: String) = say("Action simulée : $what")

    val boughtCount get() = lines.count { it.bought }
    fun setBought(id: String, v: Boolean) { data?.let { it.setBought(id, v); return }; val i = lines.indexOfFirst { it.productId == id }; if (i >= 0) lines[i] = lines[i].copy(bought = v) }
    fun setLineQty(id: String, q: Int) { data?.let { it.setQty(id, q); return }; val i = lines.indexOfFirst { it.productId == id }; if (i >= 0) lines[i] = lines[i].copy(qty = q) }
    fun removeLine(id: String) { data?.let { it.remove(id); return }; lines.removeAll { it.productId == id } }

    /** Texte du prix indicatif d'un produit (ou null s'il n'y en a pas). */
    fun priceLabel(p: Product, line: Line? = null): String? =
        if (live) (line?.price ?: p.price)?.let { fmtPrice(it) } else prices[p.id]?.let { priceText(it, p) }
}

val LocalDemo = compositionLocalOf<Demo> { error("Demo manquant") }

/** Estimation indicative de la liste : (montant en centimes de DH, nombre d'articles sans prix). Jamais un montant payé. */
fun Demo.estimate(): Pair<Long, Int> {
    data?.let { return it.estimate() }
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


/* ───────────── Conversion des unités du serveur ───────────── */

fun unitKindOf(serverUnit: String): UnitKind = when (serverUnit) { "kg" -> UnitKind.MASS; "litre" -> UnitKind.VOLUME; else -> UnitKind.COUNT }

fun countLabelOf(serverUnit: String): String = when (serverUnit) { "piece" -> "pièce"; "boite" -> "boîte"; else -> serverUnit }

/** Quantité du serveur (kg, litres ou unités) → entier de l'application (g, ml ou unités). */
fun toBase(serverUnit: String, q: Double): Int = if (unitKindOf(serverUnit) == UnitKind.COUNT) Math.round(q).toInt() else Math.round(q * 1000).toInt()

fun toServer(serverUnit: String, base: Int): Double = if (unitKindOf(serverUnit) == UnitKind.COUNT) base.toDouble() else base / 1000.0

/** Quantité en texte décimal exact pour le calcul des prix. */
fun serverQtyText(serverUnit: String, base: Int): String =
    if (unitKindOf(serverUnit) == UnitKind.COUNT) base.toString() else java.math.BigDecimal(base).movePointLeft(3).stripTrailingZeros().toPlainString()
