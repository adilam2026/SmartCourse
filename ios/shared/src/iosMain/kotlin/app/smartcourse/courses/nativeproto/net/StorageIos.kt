@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package app.smartcourse.courses.nativeproto.net

import com.liftric.kvault.KVault
import platform.Foundation.NSFileManager
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.stringWithContentsOfFile
import platform.Foundation.writeToFile

/*
 * Stockages PROPRES À L'IPHONE (Android : StorageAndroid.kt). Session dans le Trousseau (chiffré par le système, accessible
 * après le premier déverrouillage) ; cache local dans des fichiers écrits de façon atomique. Jamais le code d'accès.
 */

class KeychainStorage : SessionStorage {
    private val kv = KVault(serviceName = "app.smartcourse.courses.session")
    private fun get(k: String): String? = kv.string(forKey = k)
    private fun put(k: String, v: String?) { if (v == null) kv.deleteObject(forKey = k) else kv.set(key = k, stringValue = v) }

    override var server: String? get() = get("server"); set(v) = put("server", v)
    override var cookie: String? get() = get("cookie"); set(v) = put("cookie", v)
    override var meJson: String? get() = get("me"); set(v) = put("me", v)
    override var lastFamily: String? get() = get("lastFamily"); set(v) = put("lastFamily", v)
    override var lastLogin: String? get() = get("lastLogin"); set(v) = put("lastLogin", v)
    override var pendingRevoke: String? get() = get("pendingRevoke"); set(v) = put("pendingRevoke", v)
    override fun clearSession() { put("cookie", null); put("me", null) }
}

/** Un fichier par clé, écriture atomique : une coupure en cours d'écriture ne laisse jamais un fichier tronqué. */
class FileKv(private val dir: String) : KeyValueStore {
    init { NSFileManager.defaultManager.createDirectoryAtPath(dir, withIntermediateDirectories = true, attributes = null, error = null) }

    private fun file(key: String) = dir + "/" + key.map { if (it.isLetterOrDigit() || it == '-' || it == '_') it else '~' }.joinToString("") + ".json"

    override fun get(key: String): String? = NSString.stringWithContentsOfFile(file(key), NSUTF8StringEncoding, null)

    override fun put(key: String, value: String) {
        NSString.create(string = value).writeToFile(file(key), atomically = true, encoding = NSUTF8StringEncoding, error = null)
    }

    override fun remove(key: String) { NSFileManager.defaultManager.removeItemAtPath(file(key), null) }
}
