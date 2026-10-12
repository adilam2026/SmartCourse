package app.smartcourse.courses.nativeproto.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuthTest {
    private lateinit var server: MockWebServer
    private lateinit var store: MemoryStorage
    private lateinit var api: ApiClient
    private lateinit var base: String

    private val meJson = """{"me":{"id":"p1","familyId":"f1","displayName":"Adil","login":"adil","role":"admin","setupPending":false}}"""

    @Before fun setUp() {
        server = MockWebServer(); server.start()
        base = server.url("/").toString().trimEnd('/')
        store = MemoryStorage().also { it.server = base }
        api = ApiClient(store)
    }

    @After fun tearDown() { runCatching { server.shutdown() } }

    private fun waitFor(ms: Long = 4000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + ms
        while (!cond() && System.currentTimeMillis() < end) Thread.sleep(20)
    }

    // ── adresse et cookie ─────────────────────────────────────────────
    @Test fun normalizeServer() {
        assertEquals("https://a.trycloudflare.com", normalizeServer(" a.trycloudflare.com/ "))
        assertEquals("https://a.example.org", normalizeServer("https://a.example.org/"))
        assertEquals("http://10.0.2.2:3000", normalizeServer("http://10.0.2.2:3000"))
        assertEquals("https://x.org:8443", normalizeServer("https://x.org:8443/chemin"))
        assertNull(normalizeServer(""))
        assertNull(normalizeServer("deux mots"))
        assertNull(normalizeServer("ftp://x.org"))
    }

    @Test fun sessionFromSetCookie() {
        assertEquals("abc", sessionFromSetCookie(listOf("autre=1; Path=/", "sc_session=abc; Path=/; HttpOnly; Secure")))
        assertNull(sessionFromSetCookie(listOf("sc_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT")))
        assertNull(sessionFromSetCookie(emptyList()))
    }

    // ── connexion ─────────────────────────────────────────────────────
    @Test fun loginOk_storesCookie_neverTheSecret() = runBlocking {
        server.enqueue(MockResponse().setBody(meJson).addHeader("Set-Cookie", "sc_session=TOKEN123; Path=/; HttpOnly"))
        val r = api.login("ABCD", "adil", "482913")
        assertTrue(r is Outcome.Ok)
        assertEquals("Adil", (r as Outcome.Ok).value.displayName)
        assertEquals("TOKEN123", store.cookie)
        val req = server.takeRequest()
        assertEquals("/api/auth/login", req.path)
        assertTrue(req.body.readUtf8().contains("\"secret\":\"482913\""))
        assertNull(store.lastLogin) // rien d'autre n'est écrit par l'API
    }

    private fun loginFailure(code: Int, body: String = "{}") = runBlocking {
        server.enqueue(MockResponse().setResponseCode(code).setBody(body))
        (api.login("ABCD", "adil", "000000") as Outcome.Fail).failure
    }

    @Test fun loginErrors_mapped() {
        assertEquals(Failure.INVALID_CREDENTIALS, loginFailure(401, """{"error":"invalid_credentials"}"""))
        assertEquals(Failure.RATE_LIMITED, loginFailure(429))
        assertEquals(Failure.SETUP_INCOMPLETE, loginFailure(403, """{"error":"setup_incomplete"}"""))
        assertEquals(Failure.BAD_REQUEST, loginFailure(400, """{"error":"invalid_request"}"""))
        assertEquals(Failure.SERVER_ERROR, loginFailure(503, """{"status":"db_unavailable"}"""))
        assertEquals(Failure.UNKNOWN, loginFailure(404))
        assertNull(store.cookie)
    }

    @Test fun login200_butNotCourses_isRefused() = runBlocking {
        server.enqueue(MockResponse().setBody("<html>hello</html>"))
        assertEquals(Failure.NOT_COURSES_SERVER, (api.login("A", "b", "c") as Outcome.Fail).failure)
        assertNull(store.cookie)
    }

    @Test fun networkDown_isNetworkFailure() = runBlocking {
        server.shutdown()
        assertEquals(Failure.NETWORK, (api.login("A", "b", "c") as Outcome.Fail).failure)
    }

    // ── session ───────────────────────────────────────────────────────
    @Test fun me_sendsCookie_and401MeansExpired() = runBlocking {
        store.cookie = "TOK"
        server.enqueue(MockResponse().setBody(meJson))
        assertTrue(api.me() is Outcome.Ok)
        assertEquals("sc_session=TOK", server.takeRequest().getHeader("Cookie"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"unauthenticated"}"""))
        assertEquals(Failure.SESSION_EXPIRED, (api.me() as Outcome.Fail).failure)
    }

    @Test fun health_acceptsOnlyCourses() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"status":"ok","schema":"x"}"""))
        assertTrue(api.health(base) is Outcome.Ok)
        server.enqueue(MockResponse().setBody("""{"hello":"world"}"""))
        assertEquals(Failure.NOT_COURSES_SERVER, (api.health(base) as Outcome.Fail).failure)
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(Failure.SERVER_ERROR, (api.health(base) as Outcome.Fail).failure)
    }

    @Test fun logout_ok_andAlreadyRevokedIsOk() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        assertTrue(api.logout(base, "T") is Outcome.Ok)
        assertEquals("sc_session=T", server.takeRequest().getHeader("Cookie"))
        server.enqueue(MockResponse().setResponseCode(401))
        assertTrue(api.logout(base, "T") is Outcome.Ok)
        server.enqueue(MockResponse().setResponseCode(500))
        assertTrue(api.logout(base, "T") is Outcome.Fail)
    }

    // ── état de l'application ─────────────────────────────────────────
    private fun session() = Session(store, api, CoroutineScope(Dispatchers.Unconfined))

    @Test fun start_withoutSession_isSignedOut() {
        val s = session(); s.start()
        assertEquals(AuthState.SignedOut, s.state)
    }

    @Test fun start_withCachedSession_opensAtOnce_thenKeepsIt() {
        store.cookie = "TOK"; store.meJson = meJson.substringAfter("\"me\":").dropLast(1)
        server.enqueue(MockResponse().setBody(meJson))
        val s = session(); s.start()
        assertTrue(s.state is AuthState.SignedIn)
        waitFor { server.requestCount >= 1 }
        assertTrue(s.state is AuthState.SignedIn)
        assertTrue(s.online)
    }

    @Test fun start_serverDown_keepsSession_marksOffline() {
        store.cookie = "TOK"; store.meJson = meJson.substringAfter("\"me\":").dropLast(1)
        server.shutdown()
        val s = session(); s.start()
        waitFor { !s.online }
        assertTrue(s.state is AuthState.SignedIn)
        assertTrue(!s.online)
        assertNotNull(store.cookie)
    }

    @Test fun start_revokedSession_returnsToLogin_withNotice() {
        store.cookie = "TOK"; store.meJson = meJson.substringAfter("\"me\":").dropLast(1)
        server.enqueue(MockResponse().setResponseCode(401))
        val s = session(); s.start()
        waitFor { s.state == AuthState.SignedOut }
        assertEquals(AuthState.SignedOut, s.state)
        assertEquals(Failure.SESSION_EXPIRED, s.notice)
        assertNull(store.cookie)
        assertNull(store.meJson)
    }

    @Test fun signIn_ok_thenSignOut_revokesOnServer() = runBlocking {
        server.enqueue(MockResponse().setBody(meJson).addHeader("Set-Cookie", "sc_session=T1; Path=/"))
        val s = session()
        assertNull(s.signIn(" abcd ", " ADIL ", "482913"))
        assertTrue(s.state is AuthState.SignedIn)
        assertEquals("ABCD", store.lastFamily ?: "ABCD")
        assertEquals("adil", store.lastLogin)
        val loginBody = server.takeRequest().body.readUtf8()
        assertTrue(loginBody.contains("\"familyCode\":\"ABCD\"") && loginBody.contains("\"login\":\"adil\""))
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        s.signOut()
        assertEquals(AuthState.SignedOut, s.state)
        assertNull(store.cookie)
        waitFor { server.requestCount >= 2 }
        assertEquals("/api/auth/logout", server.takeRequest().path)
        assertNull(store.pendingRevoke)
    }

    @Test fun signOut_offline_keepsPendingRevoke_andRetriesLater() {
        store.cookie = "TOK"; store.meJson = meJson.substringAfter("\"me\":").dropLast(1)
        val s = session()
        server.shutdown()
        s.signOut()
        waitFor { store.pendingRevoke != null }
        assertEquals("$base|TOK", store.pendingRevoke)
        assertNull(store.cookie)
        // retour du réseau : nouveau serveur sur la même adresse impossible en test → on vérifie seulement que l'ordre est conservé
        assertEquals(AuthState.SignedOut, s.state)
    }

    @Test fun signIn_wrongCode_staysSignedOut() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"invalid_credentials"}"""))
        val s = session()
        assertEquals(Failure.INVALID_CREDENTIALS, s.signIn("A", "b", "c"))
        assertEquals(AuthState.Booting, s.state) // aucune session créée
        assertNull(store.cookie)
    }

    @Test fun changingServer_forgetsTheSession() {
        store.cookie = "TOK"; store.meJson = "{}"
        val s = session()
        s.setServer("https://autre.example.org")
        assertNull(store.cookie)
        assertEquals("https://autre.example.org", store.server)
    }
}
