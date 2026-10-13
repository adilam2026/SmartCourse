package app.smartcourse.courses.nativeproto

import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.smartcourse.courses.nativeproto.net.normalizeServer

/**
 * Lien d'installation (« coursesnatif://installer?serveur=…&jeton=… ») remis par la personne qui installe le serveur.
 * L'utilisateur n'a aucun jeton à saisir : le lien ouvre l'application sur « Créer ma famille », le jeton reste en mémoire (jamais écrit sur le disque,
 * jamais affiché) et c'est toujours le serveur qui le vérifie, une seule fois.
 */
object PendingInstall {
    var server: String? by mutableStateOf(null)
    var token: String? by mutableStateOf(null)

    /** Renvoie vrai si l'intention contenait un lien d'installation valable. */
    fun accept(intent: Intent?): Boolean {
        val u = intent?.data ?: return false
        if (u.scheme != "coursesnatif" || u.host != "installer") return false
        val s = u.getQueryParameter("serveur")?.let(::normalizeServer)
        val t = u.getQueryParameter("jeton")?.trim()
        if (s == null || t == null || t.length < 16 || t.length > 200 || !t.all { it.isLetterOrDigit() || it == '-' || it == '_' }) return false
        server = s; token = t
        return true
    }

    fun clear() { token = null; server = null }
}
