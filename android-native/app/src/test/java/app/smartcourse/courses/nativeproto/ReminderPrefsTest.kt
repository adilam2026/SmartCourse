package app.smartcourse.courses.nativeproto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/** Réglages de rappels (communs Android / iPhone) et calcul du prochain horaire (Android). */
class ReminderPrefsTest {
    @Test fun encodeDecode() {
        val p = ReminderPrefs(true, setOf(1, 3, 7), listOf("08:30", "18:00"))
        assertEquals(p, ReminderPrefs.decode(p.encode()))
        assertEquals("1|1,3,7|08:30,18:00", p.encode())
        assertEquals(ReminderPrefs(), ReminderPrefs.decode(null))
        assertEquals(listOf("18:00"), ReminderPrefs.decode("1|1,9|18:00,25:00,abc").times)
        assertEquals(setOf(1), ReminderPrefs.decode("1|1,9|18:00").days)
    }

    @Test fun parseTime() {
        assertEquals(8 to 30, ReminderPrefs.parseTime("08:30"))
        assertEquals(23 to 59, ReminderPrefs.parseTime(" 23:59:00 "))
        assertNull(ReminderPrefs.parseTime("24:00"))
        assertNull(ReminderPrefs.parseTime("8:30"))
        assertEquals("remind|f|p", ReminderPrefs.key("f|p"))
    }

    @Test fun nextSlot() {
        val z = ZoneId.of("Africa/Casablanca")
        val monday = ZonedDateTime.of(2026, 11, 2, 19, 0, 0, 0, z) // lundi 19 h
        val p = ReminderPrefs(true, setOf(1, 3), listOf("18:00", "08:30"))
        assertEquals(ZonedDateTime.of(2026, 11, 4, 8, 30, 0, 0, z), p.next(monday)) // mercredi 8 h 30
        assertNull(p.copy(enabled = false).next(monday))
        assertEquals(ZonedDateTime.of(2026, 11, 2, 18, 0, 0, 0, z), p.next(monday.withHour(17)))
    }
}
