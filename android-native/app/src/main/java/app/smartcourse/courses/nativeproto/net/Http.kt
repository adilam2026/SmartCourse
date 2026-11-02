package app.smartcourse.courses.nativeproto.net

/** Réponse HTTP brute, telle que l'a reçue le transport de la plateforme. */
class HttpResponse(val code: Int, val text: String, val setCookies: List<String>)

/** Échec du transport (pas de réponse du serveur), déjà classé : réseau, délai, TLS, HTTP en clair refusé… */
class TransportException(val failure: Failure) : Exception(failure.name)

/**
 * Transport HTTP propre à chaque plateforme (Android : OkHttp ; iPhone : NSURLSession). Mêmes réglages partout : délais de
 * 10 s (connexion) et 15 s (lecture et écriture), aucune redirection suivie, corps JSON en UTF-8.
 */
interface HttpTransport {
    /** Requête complète. [body] non nul : envoyé en « application/json; charset=utf-8 ». Lève [TransportException]. */
    suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): HttpResponse

    /**
     * Flux d'événements (GET, délai de lecture 70 s). [onStatus] reçoit le code HTTP : s'il renvoie false, rien n'est lu.
     * Sinon [onLine] reçoit chaque ligne jusqu'à la fin du flux. L'annulation de la coroutine ferme la connexion. Lève [TransportException].
     */
    suspend fun stream(url: String, headers: Map<String, String>, onStatus: (Int) -> Boolean, onLine: (String) -> Unit)
}
