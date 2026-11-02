package app.smartcourse.courses.nativeproto.net

import kotlin.jvm.Synchronized

/**
 * Stockage local du téléphone (cache hors connexion, brouillons, « Envoi en attente »).
 * Un fichier par clé, écriture atomique (fichier temporaire puis renommage) : une coupure en cours d'écriture ne laisse jamais un fichier tronqué.
 * Rien de sensible : ni code d'accès ni cookie de session (ceux-ci restent dans le stockage chiffré).
 */
interface KeyValueStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
}

class MemoryKv : KeyValueStore {
    private val m = HashMap<String, String>()
    @Synchronized override fun get(key: String) = m[key]
    @Synchronized override fun put(key: String, value: String) { m[key] = value }
    @Synchronized override fun remove(key: String) { m.remove(key) }
}
