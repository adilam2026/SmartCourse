package app.smartcourse.courses.nativeproto.net

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File

/* Stockages PROPRES À ANDROID (équivalents iPhone : ios/shared/src/iosMain) : session chiffrée et fichiers du cache local. */

/** Stockage Android chiffré (AES-256, clé dans le Keystore matériel du téléphone). */
class EncryptedStorage(context: Context) : SessionStorage {
    private val prefs: SharedPreferences = open(context.applicationContext)

    private fun open(ctx: Context): SharedPreferences {
        fun create(): SharedPreferences {
            val key = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            return EncryptedSharedPreferences.create(
                ctx, "courses_session", key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
        return try { create() } catch (_: Exception) {
            // Clé du Keystore perdue (restauration, réinitialisation) : on repart d'un stockage vide, l'utilisateur se reconnecte.
            ctx.deleteSharedPreferences("courses_session")
            create()
        }
    }

    private fun get(k: String): String? = prefs.getString(k, null)
    private fun put(k: String, v: String?) { prefs.edit().apply { if (v == null) remove(k) else putString(k, v) }.apply() }

    override var server: String? get() = get("server"); set(v) = put("server", v)
    override var cookie: String? get() = get("cookie"); set(v) = put("cookie", v)
    override var meJson: String? get() = get("me"); set(v) = put("me", v)
    override var lastFamily: String? get() = get("lastFamily"); set(v) = put("lastFamily", v)
    override var lastLogin: String? get() = get("lastLogin"); set(v) = put("lastLogin", v)
    override var pendingRevoke: String? get() = get("pendingRevoke"); set(v) = put("pendingRevoke", v)
    override fun clearSession() { prefs.edit().remove("cookie").remove("me").apply() }
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
