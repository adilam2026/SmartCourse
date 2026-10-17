package app.smartcourse.courses.nativeproto

import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.Outcome

/**
 * Niveau du serveur réellement utilisé (dernière migration, lue sur /health). Les fonctions récentes ne sont proposées que si le
 * serveur les connaît : sinon un message clair remplace « Élément introuvable ».
 */
const val SERVER_UPDATE_MSG = "Cette fonction nécessite la mise à jour du serveur de Mes Courses (en préparation). Rien n'a été modifié."

/** « 022_family_products_proposals.sql » → 22 ; null si inconnu. */
fun schemaNumber(s: String?): Int? = s?.takeWhile { it.isDigit() }?.toIntOrNull()

/** Migrations nécessaires : 23 pays et ville, 24 paramètres avancés et plusieurs listes, 25 budget. Niveau inconnu (hors connexion) : on laisse essayer. */
fun serverSupports(schema: String?, migration: Int): Boolean = schemaNumber(schema)?.let { it >= migration } ?: true

/** Réponse d'un appel de réglage : une route absente (404) signifie un serveur trop ancien, pas un élément supprimé. */
fun settingFailure(r: Outcome.Fail, other: (Outcome.Fail) -> String): String = if (r.failure == Failure.NOT_FOUND) SERVER_UPDATE_MSG else other(r)

/** Devises proposées par l'application elle-même (le choix ne dépend pas d'une réponse du serveur). */
val LOCAL_CURRENCIES: Map<String, Int> = COUNTRIES.associate { it.currency to it.decimals }
fun currencyCountries(code: String): String = COUNTRIES.filter { it.currency == code }.joinToString(", ") { it.name }
