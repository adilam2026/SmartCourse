package app.smartcourse.courses.nativeproto

/**
 * Rappels d'achat personnels (propres à chaque profil, sur ce téléphone) : jours et horaires choisis. Données communes à Android et
 * à l'iPhone ; la programmation des rappels est propre à chaque plateforme (Reminders.kt, RemindersIos.kt).
 */
data class ReminderPrefs(val enabled: Boolean = false, val days: Set<Int> = setOf(1, 2, 3, 4, 5, 6, 7), val times: List<String> = listOf("18:00")) {
    fun encode() = "${if (enabled) 1 else 0}|${days.sorted().joinToString(",")}|${times.joinToString(",")}"

    companion object {
        /** Réglage enregistré pour un profil (même clé sur Android et sur l'iPhone). */
        fun key(scope: String) = "remind|$scope"
        fun decode(s: String?): ReminderPrefs {
            if (s.isNullOrBlank()) return ReminderPrefs()
            val p = s.split("|")
            return ReminderPrefs(
                enabled = p.getOrNull(0) == "1",
                days = p.getOrNull(1)?.split(",")?.mapNotNull { it.toIntOrNull() }?.filter { it in 1..7 }?.toSet() ?: emptySet(),
                times = p.getOrNull(2)?.split(",")?.filter { parseTime(it) != null }?.distinct() ?: emptyList(),
            )
        }
        /** « HH:MM » (ou « HH:MM:SS ») → (heure, minute) ; null si l'horaire est invalide. */
        fun parseTime(s: String): Pair<Int, Int>? {
            val m = Regex("""^(\d{2}):(\d{2})(?::(\d{2}))?$""").matchEntire(s.trim()) ?: return null
            val h = m.groupValues[1].toInt(); val mi = m.groupValues[2].toInt(); val se = m.groupValues[3].ifEmpty { "0" }.toInt()
            return if (h in 0..23 && mi in 0..59 && se in 0..59) h to mi else null
        }
        val DAY_LABELS = listOf(1 to "Lun", 2 to "Mar", 3 to "Mer", 4 to "Jeu", 5 to "Ven", 6 to "Sam", 7 to "Dim")
    }
}
