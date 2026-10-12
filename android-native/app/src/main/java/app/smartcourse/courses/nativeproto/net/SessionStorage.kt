package app.smartcourse.courses.nativeproto.net

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Ce que l'application garde sur le téléphone. Jamais le code d'accès. */
interface SessionStorage {
    /** Adresse du serveur de recette (https://…). */
    var server: String?
    /** Valeur du cookie de session (secret : stockage chiffré). */
    var cookie: String?
    /** Dernier profil connu (JSON), pour rouvrir l'application hors connexion. */
    var meJson: String?
    /** Facilités de saisie (non secrètes) : dernier code famille et identifiant. */
    var lastFamily: String?
    var lastLogin: String?
    /** Session dont la révocation côté serveur n'a pas pu être envoyée (déconnexion hors connexion) : « adresse|cookie ». */
    var pendingRevoke: String?
    fun clearSession()
}

class MemoryStorage : SessionStorage {
    override var server: String? = null
    override var cookie: String? = null
    override var meJson: String? = null
    override var lastFamily: String? = null
    override var lastLogin: String? = null
    override var pendingRevoke: String? = null
    override fun clearSession() { cookie = null; meJson = null }
}

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
