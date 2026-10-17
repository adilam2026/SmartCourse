package app.smartcourse.courses.nativeproto

import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.Outcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerLevelTest {
    @Test fun productionAt022_doesNotOfferNewOptions() {
        val prod = "022_family_products_proposals.sql"
        assertEquals(22, schemaNumber(prod))
        assertFalse(serverSupports(prod, 23)) // pays et ville
        assertFalse(serverSupports(prod, 24)) // plusieurs listes
        assertFalse(serverSupports(prod, 25)) // budget
        assertTrue(serverSupports("025_budget.sql", 25))
        assertTrue(serverSupports(null, 25)) // niveau inconnu (hors connexion) : on laisse essayer
    }

    @Test fun missingRoute_isExplainedAsServerUpdate_notAsDeletedItem() {
        assertEquals(SERVER_UPDATE_MSG, settingFailure(Outcome.Fail(Failure.NOT_FOUND, 404, "not_found")) { "autre" })
        assertEquals("autre", settingFailure(Outcome.Fail(Failure.CONFLICT, 409, "multiple_active_lists")) { "autre" })
    }

    @Test fun currencies_availableWithoutServer() {
        assertEquals(2, LOCAL_CURRENCIES["MAD"])
        assertEquals(3, LOCAL_CURRENCIES["TND"])
        assertTrue(currencyCountries("EUR").contains("France"))
    }
}
