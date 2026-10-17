package app.smartcourse.courses.nativeproto.net

import java.io.File

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

class FileKv(private val dir: File) : KeyValueStore {
    init { dir.mkdirs() }

    private fun file(key: String) = File(dir, key.map { if (it.isLetterOrDigit() || it == '-' || it == '_') it else '~' }.joinToString("") + ".json")

    @Synchronized override fun get(key: String): String? = try { file(key).takeIf { it.exists() }?.readText() } catch (_: Exception) { null }

    @Synchronized override fun put(key: String, value: String) {
        try {
            val f = file(key)
            val tmp = File(dir, f.name + ".tmp")
            tmp.writeText(value)
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        } catch (_: Exception) { /* disque plein : le cache est facultatif, l'action en cours n'est pas bloquée */ }
    }

    @Synchronized override fun remove(key: String) { try { file(key).delete() } catch (_: Exception) { } }
}
