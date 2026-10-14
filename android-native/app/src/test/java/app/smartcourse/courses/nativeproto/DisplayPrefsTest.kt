package app.smartcourse.courses.nativeproto

import org.junit.Assert.assertEquals
import org.junit.Test

class DisplayPrefsTest {
    @Test fun presentation_onlyListAndCards_oldBigCardsBecomeCards() {
        assertEquals(listOf("Liste", "Cartes"), SelMode.entries.map { it.label })
        assertEquals(SelMode.GRID, SelMode.parse("CARDS"))   // ancienne « Grandes cartes »
        assertEquals(SelMode.GRID, SelMode.parse("GRID"))    // ancienne « Petites cartes »
        assertEquals(SelMode.LIST, SelMode.parse("LIST"))
        assertEquals(SelMode.GRID, SelMode.parse(null))
    }

    @Test fun organisation_existingPreferencesKept() {
        assertEquals(listOf("Tous les articles", "Par catégories"), SelOrg.entries.map { it.label })
        assertEquals(SelOrg.CATEGORY, SelOrg.parse("CATEGORY"))
        assertEquals(SelOrg.GLOBAL, SelOrg.parse("GLOBAL"))
        assertEquals(SelOrg.CATEGORY, SelOrg.parse(null))
    }
}
