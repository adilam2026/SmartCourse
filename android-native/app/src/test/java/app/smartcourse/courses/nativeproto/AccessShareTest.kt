package app.smartcourse.courses.nativeproto

import app.smartcourse.courses.nativeproto.net.ProfileDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom

class AccessShareTest {
    @Test fun accessMessage_containsEverythingNeeded() {
        val m = AccessShare.accessMessage("Nadia", "LesTaha04", "nadia", "047193")
        for (part in listOf("Mes Courses", "Nadia", "Identifiant famille : LesTaha04", "Identifiant personnel : nadia", "Code d'accès provisoire : 047193 (valable 7 jours)", "Se connecter", "votre propre code d'accès personnel")) assertTrue(part, m.contains(part))
        assertFalse(m.contains("Mot de passe") || m.contains("mot de passe"))
    }

    @Test fun familyIdRules_proposalAndInput() {
        assertEquals("FamilleTaha", FamilyIdRules.propose("Famille Taha"))
        assertEquals("LesTaha", FamilyIdRules.propose("Les Taha"))
        assertEquals("FamilleHeleneEa", FamilyIdRules.propose("Famille Hélène-Éa"))
        assertEquals("FamilleAl", FamilyIdRules.propose("Al"))
        assertEquals(30, FamilyIdRules.propose("x".repeat(50)).length)
        assertEquals("LesTaha_04", FamilyIdRules.clean("Les Taha_04 !"))
        assertEquals("Helene", FamilyIdRules.clean("Hélène"))
        assertTrue(FamilyIdRules.valid("super_family"))
        for (bad in listOf("abc", "a".repeat(31), "Les Taha", "taha-04", "Hélène")) assertFalse(bad, FamilyIdRules.valid(bad))
    }

    @Test fun familyMessage_neverContainsAnAccessCode() {
        val m = AccessShare.familyMessage("KD36DY9C")
        assertTrue(m.contains("KD36DY9C") && m.contains("Mes Courses"))
        assertFalse(m.contains("Code d'accès :"))
        assertFalse(Regex("\\b\\d{6}\\b").containsMatchIn(m))
    }

    @Test fun codes_keepLeadingZeros_andAreSixDigits() {
        assertEquals("012345", codeDigits("012345"))
        assertEquals("0047199", codeDigits("0 04-719 9")) // jusqu'à 8 chiffres
        assertEquals("000123", codeDigits("000123abc"))
    }

    @Test fun generatedCodes_areSixDigits_notWeak_andKeepLeadingZeros() {
        val rnd = SecureRandom()
        repeat(2000) {
            val c = AccessShare.generateCode(rnd)
            assertTrue(c, Regex("^\\d{6}$").matches(c))
            assertFalse(c, AccessShare.isWeak(c))
        }
        assertTrue((1..5000).map { AccessShare.generateCode(rnd) }.any { it.startsWith("0") })
    }

    @Test fun weakCodes_matchTheServerRule() {
        for (w in listOf("111111", "000000", "123456", "654321", "012345", "543210")) assertTrue(w, AccessShare.isWeak(w))
        for (ok in listOf("047193", "482913", "102938")) assertFalse(ok, AccessShare.isWeak(ok))
    }

    @Test fun shareAccess_onlyForOtherActiveNonPrimaryProfiles() {
        val primary = ProfileDto("p", "P", "p", "admin", true, true)
        val admin = ProfileDto("a", "A", "a", "admin", true, false)
        val staff = ProfileDto("s", "S", "s", "staff", true, false)
        val off = ProfileDto("o", "O", "o", "staff", false, false)
        assertFalse(ProfileRules.canShareAccess(primary, "a"))
        assertFalse(ProfileRules.canShareAccess(admin, "a")) // soi-même
        assertTrue(ProfileRules.canShareAccess(admin, "p"))
        assertTrue(ProfileRules.canShareAccess(staff, "a"))
        assertFalse(ProfileRules.canShareAccess(off, "a"))
    }
}
