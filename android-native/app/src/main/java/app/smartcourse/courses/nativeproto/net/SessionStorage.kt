package app.smartcourse.courses.nativeproto.net

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
