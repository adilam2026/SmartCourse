package app.smartcourse.courses.nativeproto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CodeRuleTest {
    @Test fun newCodes_sixToEightDigits_leadingZerosKept() {
        for (ok in listOf("047193", "0472915", "00472915")) assertTrue(ok, isNewCode(ok))
        for (bad in listOf("", "47193", "408213412", "40 8213", "40821a", "Ab3\$xy")) assertFalse(bad, isNewCode(bad))
        assertEquals("00472915", codeDigits("0 0472-915 99"))
    }

    @Test fun enteredCodes_acceptLegacySixCharacters() {
        assertTrue(isEnteredCode("Ab3\$xy"))
        assertTrue(isEnteredCode("00472915"))
        assertFalse(isEnteredCode("Ab3\$xyz"))
        assertFalse(isEnteredCode("12345"))
    }

    @Test fun preciseErrorMessage() {
        assertNull(newCodeError(""))
        assertNull(newCodeError("0472915"))
        assertEquals("Le code doit contenir entre 6 et 8 chiffres (5 saisis).", newCodeError("12345"))
    }

    @Test fun weakRule_matchesServerOnSixToEightDigits() {
        for (w in listOf("111111", "1234567", "87654321", "22222222")) assertTrue(w, AccessShare.isWeak(w))
        for (ok in listOf("0472915", "48291305")) assertFalse(ok, AccessShare.isWeak(ok))
    }
}
