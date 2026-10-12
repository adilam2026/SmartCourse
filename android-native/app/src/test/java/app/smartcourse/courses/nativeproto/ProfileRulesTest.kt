package app.smartcourse.courses.nativeproto

import app.smartcourse.courses.nativeproto.net.ProfileDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ProfileRulesTest {
    private fun p(id: String, role: String, active: Boolean = true, primary: Boolean = false) = ProfileDto(id, id, id, role, active, primary)
    private val adil = p("adil", "admin", primary = true)
    private val second = p("second", "admin")
    private val marie = p("marie", "staff")
    private val lamiaa = p("lamiaa", "parent")
    private val off = p("karim", "staff", active = false)

    @Test fun primaryAdmin_isFullyProtected() {
        val all = listOf(adil, second, marie)
        assertFalse(ProfileRules.canChangeRole(adil, all, "second"))
        assertFalse(ProfileRules.canDeactivate(adil))
        assertFalse(ProfileRules.canDelete(adil, "second"))
    }

    @Test fun admin_cannotBeDeactivatedNorDeleted_untilRoleRemoved() {
        assertFalse(ProfileRules.canDeactivate(second))
        assertFalse(ProfileRules.canDelete(second, "adil"))
        assertTrue(ProfileRules.canChangeRole(second, listOf(adil, second), "adil"))
        // une fois parent, les actions s'ouvrent
        val demoted = second.copy(role = "parent")
        assertTrue(ProfileRules.canDeactivate(demoted))
        assertTrue(ProfileRules.canDelete(demoted, "adil"))
    }

    @Test fun lastActiveAdmin_cannotBeDemoted() {
        val onlyAdmin = p("solo", "admin")
        assertFalse(ProfileRules.canChangeRole(onlyAdmin, listOf(onlyAdmin, marie), "marie"))
        // un administrateur désactivé ne compte pas
        assertEquals(1, ProfileRules.activeAdmins(listOf(adil, second.copy(active = false))))
    }

    @Test fun staffAndParent_actions() {
        val all = listOf(adil, marie, lamiaa, off)
        assertTrue(ProfileRules.canChangeRole(marie, all, "adil"))
        assertTrue(ProfileRules.canDeactivate(marie))
        assertTrue(ProfileRules.canDelete(lamiaa, "adil"))
        assertFalse(ProfileRules.canDeactivate(off)) // déjà désactivé : on réactive
        assertFalse(ProfileRules.canDelete(marie, "marie")) // pas soi-même
        assertFalse(ProfileRules.canChangeRole(marie, all, "marie"))
    }

    @Test fun roleLabels() {
        assertEquals("Administrateur principal", ProfileRules.roleLabel(adil))
        assertEquals("Administrateur", ProfileRules.roleLabel(second))
        assertEquals("Parent", ProfileRules.roleLabel(lamiaa))
        assertEquals("Personnel", ProfileRules.roleLabel(marie))
    }

    // ── liste des villes : identique à celle du serveur ──
    @Test fun cities_matchServerList() {
        val ts = File("../../server/src/cities.ts").takeIf { it.exists() } ?: File("../server/src/cities.ts")
        val body = ts.readText().substringAfter("CITIES: readonly string[] = [").substringBefore("];")
        val server = Regex("\"((?:[^\"\\\\]|\\\\.)*)\"").findAll(body).map { it.groupValues[1] }.toList()
        assertEquals(146, server.size)
        assertEquals(server, CITIES)
    }

    @Test fun flatCity_sameRulesAsServer() {
        assertEquals("fes", flatCity("Fès"))
        assertEquals("ait melloul", flatCity("Aït Melloul"))
        assertEquals("kelaat m gouna", flatCity("Kelaât M'Gouna"))
        assertEquals("tan tan", flatCity("Tan-Tan"))
        assertEquals("sale", flatCity("  Salé "))
    }
}
