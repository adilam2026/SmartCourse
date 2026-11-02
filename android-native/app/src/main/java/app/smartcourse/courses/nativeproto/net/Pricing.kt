package app.smartcourse.courses.nativeproto.net

/*
 * Prix indicatifs : calcul décimal exact, port fidèle de server/src/pricing.ts (aucun nombre à virgule flottante dans un montant).
 * Les cas de test sont générés à partir du code TypeScript lui-même (scripts/gen-pricing-vectors.mjs).
 * Calcul en entiers 64 bits commun à Android et à l'iPhone : chaque produit est vérifié (dépassement = montant non calculé, jamais faux).
 */

data class PriceRef(
    val amount: String,
    val refQty: String,
    val refUnit: String,
    val packaging: String? = null,
    val pieceWeightG: String? = null,
    val source: String = "family",
)

sealed interface LineAmount {
    data class Ok(val cents: Long) : LineAmount
    data class No(val reason: String) : LineAmount
}

private val COUNT_UNITS = setOf("piece", "paquet", "bouteille", "brique", "pot", "boite", "botte", "rouleau", "sachet", "cube")
private val CENTS_RE = Regex("^\\d+(\\.\\d{1,2})?$")
private val MILLI_RE = Regex("^\\d+(\\.\\d{1,3})?$")

fun parseCents(v: String): Long? {
    val s = v.trim().replace(",", ".")
    if (!CENTS_RE.matches(s)) return null
    val i = s.substringBefore('.')
    val d = if (s.contains('.')) s.substringAfter('.') else ""
    return i.toLong() * 100 + (d + "00").take(2).toLong()
}

fun parseMilli(v: String): Long? {
    val s = v.trim().replace(",", ".")
    if (!MILLI_RE.matches(s)) return null
    val i = s.substringBefore('.')
    val d = if (s.contains('.')) s.substringAfter('.') else ""
    return i.toLong() * 1000 + (d + "000").take(3).toLong()
}

private fun kindOfRef(u: String): String = when (u) { "kg", "g" -> "mass"; "litre", "ml" -> "volume"; else -> "count:$u" }
private fun kindOfUnit(u: String): String = when (u) { "kg" -> "mass"; "litre" -> "volume"; else -> "count:$u" }

private fun refBase(p: PriceRef): Long? {
    val m = parseMilli(p.refQty) ?: return null
    if (m <= 0) return null
    if (p.refUnit == "g" || p.refUnit == "ml") return if (m % 1000 == 0L) m / 1000 else null
    return m
}

/** Produit exact de nombres positifs ; null au-delà des entiers 64 bits. */
private fun mul(vararg xs: Long): Long? {
    var r = 1L
    for (x in xs) {
        if (x != 0L && r > Long.MAX_VALUE / x) return null
        r *= x
    }
    return r
}

/** Arrondi au plus proche, demi vers le haut : (2n + d) / 2d. */
private fun half(n: Long?, d: Long?): Long? {
    if (n == null || d == null) return null
    val num = mul(2, n) ?: return null
    if (num > Long.MAX_VALUE - d) return null
    val den = mul(2, d) ?: return null
    return (num + d) / den
}

private fun ok(v: Long?): LineAmount = if (v == null) LineAmount.No("incompatible") else LineAmount.Ok(v)

/** Montant d'une ligne en centimes, ou la raison pour laquelle il n'est pas calculé (jamais 0 par défaut). [qty] en unités du serveur (kg, litre, pièces…). */
fun lineAmount(price: PriceRef?, qty: String, unit: String): LineAmount {
    if (price == null) return LineAmount.No("no_price")
    val cents = parseCents(price.amount)
    val q = parseMilli(qty)
    val ref = refBase(price)
    if (cents == null || q == null || q <= 0 || ref == null) return LineAmount.No("incompatible")
    val pk = kindOfRef(price.refUnit)
    val uk = kindOfUnit(unit)
    if (pk == uk) return ok(half(mul(cents, q), ref))
    val w = if (price.pieceWeightG.isNullOrEmpty()) null else parseCents(price.pieceWeightG)
    if (w == null || w <= 0) return LineAmount.No("incompatible")
    if (pk == "mass" && unit == "piece") return ok(half(mul(cents, q, w), mul(ref, 100000)))
    if (price.refUnit == "piece" && unit == "kg") return ok(half(mul(cents, q, 100, 1000), mul(w, ref)))
    return LineAmount.No("incompatible")
}

data class Summary(val cents: Long, val priced: Int, val unpriced: Int) { val incomplete get() = unpriced > 0 }

fun summarize(lines: List<Triple<PriceRef?, String, String>>): Summary {
    var cents = 0L; var priced = 0; var unpriced = 0
    for ((p, q, u) in lines) {
        when (val a = lineAmount(p, q, u)) {
            is LineAmount.Ok -> { cents += a.cents; priced++ }
            is LineAmount.No -> unpriced++
        }
    }
    return Summary(cents, priced, unpriced)
}

/** Pluriel d'une unité comptée : « rouleaux », « pots ». */
fun pluralOf(label: String): String = if (label.endsWith("eau")) label + "x" else label + "s"

fun fmtMoney(cents: Long): String = "${cents / 100},${(cents % 100).toString().padStart(2, '0')} DH"

private val UNIT_SINGULAR = mapOf("piece" to "pièce", "paquet" to "paquet", "bouteille" to "bouteille", "brique" to "brique", "pot" to "pot", "boite" to "boîte", "botte" to "botte", "rouleau" to "rouleau", "sachet" to "sachet", "cube" to "cube", "kg" to "kg", "litre" to "litre", "g" to "g", "ml" to "ml")
private val CONTAINER = Regex("^(flacon|bidon|bombe|rouleau|barquette|sachet|petit pain|quantité)\\b", RegexOption.IGNORE_CASE)

/** Millièmes → nombre décimal sans zéros inutiles : 1500 → « 1.5 », 1000 → « 1 », 250 → « 0.25 ». */
fun milliToPlain(m: Long): String {
    val a = if (m < 0) -m else m
    val frac = (a % 1000).toString().padStart(3, '0').trimEnd('0')
    return (if (m < 0) "-" else "") + (a / 1000).toString() + if (frac.isEmpty()) "" else ".$frac"
}

private fun trimNum(v: String): String = (parseMilli(v)?.let(::milliToPlain) ?: v.trim()).replace('.', ',')

/** « 9,90 DH / kg », « 12,50 DH / 500 g », « 14,00 DH / paquet de 250 g ». */
fun fmtPrice(p: PriceRef): String {
    val cents = parseCents(p.amount)
    val head = if (cents == null) p.amount else fmtMoney(cents)
    val q = parseMilli(p.refQty)
    val u = UNIT_SINGULAR[p.refUnit] ?: p.refUnit
    val one = q == 1000L
    val metric = p.refUnit == "kg" || p.refUnit == "g" || p.refUnit == "ml" || p.refUnit == "litre"
    val per = if (one) u else "${trimNum(p.refQty)} ${if (metric) u else if (q != null && q > 1000L) pluralOf(u) else u}"
    if (!p.packaging.isNullOrEmpty() && CONTAINER.containsMatchIn(p.packaging)) return "$head / ${p.packaging}"
    val pack = if (!p.packaging.isNullOrEmpty()) (if (p.refUnit in COUNT_UNITS) " de ${p.packaging}" else " (${p.packaging})") else ""
    return "$head / $per$pack"
}
