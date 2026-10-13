package app.smartcourse.courses.nativeproto.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PricingTest {
    @Test fun lineAmountMatchesTypeScript() {
        assertTrue(PRICE_VECTORS.size > 200)
        for (v in PRICE_VECTORS) {
            val a = lineAmount(v.price, v.qty, v.unit)
            if (v.ok) assertEquals("${v.price} × ${v.qty} ${v.unit}", LineAmount.Ok(v.cents), a)
            else assertEquals("${v.price} × ${v.qty} ${v.unit}", LineAmount.No(v.reason), a)
        }
    }

    @Test fun formatMatchesTypeScript() {
        for ((p, expected) in FMT_VECTORS) assertEquals(expected, fmtPrice(p))
    }

    @Test fun parsingMatchesTypeScript() {
        for ((s, c, m) in PARSE_VECTORS) {
            assertEquals("cents $s", c, parseCents(s))
            assertEquals("milli $s", m, parseMilli(s))
        }
    }

    @Test fun noPriceIsNeverZero() {
        assertEquals(LineAmount.No("no_price"), lineAmount(null, "1", "kg"))
        val s = summarize(listOf(Triple(null, "1", "kg"), Triple(PriceRef("2.00", "1", "kg"), "1.5", "kg")))
        assertEquals(300L, s.cents); assertEquals(1, s.priced); assertEquals(1, s.unpriced); assertTrue(s.incomplete)
    }
}
