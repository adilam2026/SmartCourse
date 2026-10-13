package app.smartcourse.courses.nativeproto.net

import java.math.BigDecimal
import java.math.BigInteger

/*
 * Prix indicatifs : calcul décimal exact, port fidèle de server/src/pricing.ts (aucun nombre à virgule flottante dans un montant).
 * Les cas de test sont générés à partir du code TypeScript lui-même (scripts/gen-pricing-vectors.mjs).
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

private val COUNT_UNITS = setOf("piece", "paquet", "bouteille", "brique", "pot", "boite")
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

private fun refBase(p: PriceRef): BigInteger? {
    val m = parseMilli(p.refQty) ?: return null
    if (m <= 0) return null
    if (p.refUnit == "g" || p.refUnit == "ml") return if (m % 1000 == 0L) BigInteger.valueOf(m / 1000) else null
    return BigInteger.valueOf(m)
}

private fun half(n: BigInteger, d: BigInteger): Long {
    val two = BigInteger.TWO
    return two.multiply(n).add(d).divide(two.multiply(d)).toLong()
}

/** Montant d'une ligne en centimes, ou la raison pour laquelle il n'est pas calculé (jamais 0 par défaut). [qty] en unités du serveur (kg, litre, pièces…). */
fun lineAmount(price: PriceRef?, qty: String, unit: String): LineAmount {
    if (price == null) return LineAmount.No("no_price")
    val cents = parseCents(price.amount)
    val q = parseMilli(qty)
    val ref = refBase(price)
    if (cents == null || q == null || q <= 0 || ref == null) return LineAmount.No("incompatible")
    val pk = kindOfRef(price.refUnit)
    val uk = kindOfUnit(unit)
    val c = BigInteger.valueOf(cents)
    val bq = BigInteger.valueOf(q)
    if (pk == uk) return LineAmount.Ok(half(c.multiply(bq), ref))
    val w = if (price.pieceWeightG.isNullOrEmpty()) null else parseCents(price.pieceWeightG)
    if (w == null || w <= 0) return LineAmount.No("incompatible")
    val bw = BigInteger.valueOf(w)
    if (pk == "mass" && unit == "piece") return LineAmount.Ok(half(c.multiply(bq).multiply(bw), ref.multiply(BigInteger.valueOf(100000))))
    if (price.refUnit == "piece" && unit == "kg") return LineAmount.Ok(half(c.multiply(bq).multiply(BigInteger.valueOf(100)).multiply(BigInteger.valueOf(1000)), bw.multiply(ref)))
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

fun fmtMoney(cents: Long): String = "${cents / 100},${(cents % 100).toString().padStart(2, '0')} DH"

private val UNIT_SINGULAR = mapOf("piece" to "pièce", "paquet" to "paquet", "bouteille" to "bouteille", "brique" to "brique", "pot" to "pot", "boite" to "boîte", "kg" to "kg", "litre" to "litre", "g" to "g", "ml" to "ml")
private val CONTAINER = Regex("^(flacon|bidon|bombe|rouleau|barquette|sachet|petit pain|quantité)\\b", RegexOption.IGNORE_CASE)

private fun numOf(v: String): BigDecimal = BigDecimal(v.trim().replace(",", "."))
private fun trimNum(v: String): String = numOf(v).stripTrailingZeros().toPlainString().replace('.', ',')

/** « 9,90 DH / kg », « 12,50 DH / 500 g », « 14,00 DH / paquet de 250 g ». */
fun fmtPrice(p: PriceRef): String {
    val cents = parseCents(p.amount)
    val head = if (cents == null) p.amount else fmtMoney(cents)
    val q = numOf(p.refQty)
    val u = UNIT_SINGULAR[p.refUnit] ?: p.refUnit
    val one = q.compareTo(BigDecimal.ONE) == 0
    val metric = p.refUnit == "kg" || p.refUnit == "g" || p.refUnit == "ml" || p.refUnit == "litre"
    val per = if (one) u else "${trimNum(p.refQty)} ${if (metric) u else u + (if (q > BigDecimal.ONE) "s" else "")}"
    if (!p.packaging.isNullOrEmpty() && CONTAINER.containsMatchIn(p.packaging)) return "$head / ${p.packaging}"
    val pack = if (!p.packaging.isNullOrEmpty()) (if (p.refUnit in COUNT_UNITS) " de ${p.packaging}" else " (${p.packaging})") else ""
    return "$head / $per$pack"
}
