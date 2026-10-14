package app.smartcourse.courses.nativeproto.net

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

sealed interface AuthState {
    data object Booting : AuthState
    data object SignedOut : AuthState
    data class SignedIn(val me: Me) : AuthState
}

/** État de connexion de l'application : session conservée, vérifiée auprès du serveur, jamais devinée. */
class Session(val storage: SessionStorage, val api: ApiClient, private val scope: CoroutineScope) {
    var state: AuthState by mutableStateOf(AuthState.Booting)
        private set
    /** Message à montrer sur l'écran de connexion (session expirée, déconnexion…). */
    var notice: Failure? by mutableStateOf(null)
        private set
    /** Faux quand le dernier contrôle n'a pas pu joindre le serveur : la session est conservée, l'application reste ouverte. */
    var online: Boolean by mutableStateOf(true)
        private set
    var serverAddress: String? by mutableStateOf(storage.server)
        private set
    /** Message d'adieu montré sur l'écran de connexion après la suppression du compte (ou de la famille) par cette personne. */
    var farewell: String? by mutableStateOf(null)
    /** Famille tout juste créée depuis l'application : son code est montré une fois (Copier / Partager) après la connexion. */
    var welcomeFamilyCode: String? by mutableStateOf(null)

    /** Code de vérification exact : la famille est créée côté serveur et l'utilisateur est connecté directement. */
    suspend fun completeSignup(signupId: String, code: String): Outcome.Fail? {
        notice = null
        return when (val r = api.signupVerify(signupId, code.trim())) {
            is Outcome.Ok -> {
                val (me, familyCode) = r.value
                val full = (api.me() as? Outcome.Ok)?.value ?: me
                online = true; remember(full); welcomeFamilyCode = familyCode; state = AuthState.SignedIn(full); null
            }
            is Outcome.Fail -> r
        }
    }

    init {
        // Toute requête authentifiée refusée en 401 (session révoquée, profil désactivé) ramène à la connexion.
        api.onSessionExpired = { scope.launch { if (state is AuthState.SignedIn) endSession(Failure.SESSION_EXPIRED) } }
    }

    fun setServer(address: String) {
        if (address != storage.server) {
            // Changer de serveur invalide la session conservée : un cookie n'a de sens que pour son serveur.
            if (storage.cookie != null) forgetSessionLocally()
        }
        storage.server = address
        serverAddress = address
    }

    private fun parseCached(): Me? = storage.meJson?.let { try { json.decodeFromString(Me.serializer(), it) } catch (_: Exception) { null } }

    private fun remember(me: Me) {
        storage.meJson = json.encodeToString(Me.serializer(), me)
        storage.lastLogin = me.login
        me.family?.code?.let { storage.lastFamily = it }
    }

    private fun forgetSessionLocally() {
        storage.clearSession()
    }

    /** Démarrage : ouvre tout de suite avec le dernier profil connu, puis vérifie auprès du serveur. */
    fun start() {
        retryPendingRevoke()
        val cached = parseCached()
        if (storage.cookie != null && storage.server != null && cached != null) {
            state = AuthState.SignedIn(cached)
            verify()
        } else {
            if (storage.cookie != null) forgetSessionLocally()
            state = AuthState.SignedOut
        }
    }

    /** À rappeler au retour au premier plan. */
    fun verify() {
        if (state !is AuthState.SignedIn) return
        scope.launch {
            when (val r = api.me()) {
                is Outcome.Ok -> {
                    if (r.value.setupPending) endSession(Failure.SETUP_INCOMPLETE)
                    else { online = true; remember(r.value); state = AuthState.SignedIn(r.value) }
                }
                is Outcome.Fail -> when (r.failure) {
                    Failure.SESSION_EXPIRED -> endSession(Failure.SESSION_EXPIRED)
                    Failure.SETUP_INCOMPLETE -> endSession(Failure.SETUP_INCOMPLETE)
                    else -> online = false // réseau ou serveur indisponible : la session reste conservée
                }
            }
        }
    }

    /** Connexion. Renvoie null en cas de succès, sinon la cause. */
    suspend fun signIn(familyCode: String, login: String, secret: String): Failure? {
        notice = null
        return when (val r = api.login(familyCode.trim().uppercase(), login.trim().lowercase(), secret)) {
            is Outcome.Ok -> {
                if (r.value.setupPending) {
                    storage.clearSession()
                    return Failure.SETUP_INCOMPLETE
                }
                // /api/auth/login ne renvoie ni la famille ni le rang « principal » : on complète tout de suite avec /api/me.
                val full = (api.me() as? Outcome.Ok)?.value ?: r.value
                online = true; remember(full); state = AuthState.SignedIn(full); null
            }
            is Outcome.Fail -> r.failure
        }
    }

    private fun endSession(why: Failure) {
        forgetSessionLocally()
        notice = why
        online = true
        state = AuthState.SignedOut
    }

    /** Déconnexion : l'application se ferme tout de suite ; la révocation côté serveur est tentée, puis rejouée si le réseau manque. */
    fun signOut() {
        val server = storage.server
        val cookie = storage.cookie
        forgetSessionLocally()
        notice = null
        online = true
        state = AuthState.SignedOut
        if (server != null && cookie != null) {
            scope.launch {
                if (api.logout(server, cookie) is Outcome.Fail) storage.pendingRevoke = "$server|$cookie"
            }
        }
    }

    private fun retryPendingRevoke() {
        val p = storage.pendingRevoke ?: return
        val server = p.substringBefore('|'); val cookie = p.substringAfter('|')
        scope.launch { if (api.logout(server, cookie) is Outcome.Ok) storage.pendingRevoke = null }
    }

    fun clearNotice() { notice = null; farewell = null }

    /**
     * Compte (ou famille) supprimé côté serveur : la session y est déjà fermée. Rien n'est renvoyé au serveur (aucune déconnexion à
     * rejouer) ; la session locale est oubliée et l'écran de connexion affiche [message].
     */
    fun accountDeleted(message: String) {
        forgetSessionLocally()
        storage.pendingRevoke = null
        notice = null
        online = true
        farewell = message
        state = AuthState.SignedOut
    }
}
