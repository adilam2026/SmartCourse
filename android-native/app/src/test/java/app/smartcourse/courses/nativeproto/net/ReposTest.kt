package app.smartcourse.courses.nativeproto.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ReposTest {
    private lateinit var server: MockWebServer
    private lateinit var store: MemoryStorage
    private lateinit var api: ApiClient

    @Before fun setUp() {
        server = MockWebServer(); server.start()
        store = MemoryStorage().also { it.server = server.url("/").toString().trimEnd('/'); it.cookie = "TOK" }
        api = ApiClient(store)
    }
    @After fun tearDown() { runCatching { server.shutdown() } }

    private fun ok(body: String, code: Int = 200) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))

    private val profilesJson = """{"profiles":[
        {"id":"p1","displayName":"Adil","login":"adil","role":"admin","active":true,"primary":true,"city":"Casablanca"},
        {"id":"p2","displayName":"Marie","login":"marie","role":"staff","active":false,"primary":false,"city":null}]}"""

    @Test fun profiles_list_parsesAndSendsCookie() = runBlocking {
        ok(profilesJson)
        val r = ProfilesRepo(api).list() as Outcome.Ok
        assertEquals(2, r.value.size)
        assertTrue(r.value[0].primary); assertEquals("Casablanca", r.value[0].city)
        assertTrue(!r.value[1].active); assertNull(r.value[1].city)
        val req = server.takeRequest()
        assertEquals("GET", req.method); assertEquals("/api/profiles", req.path); assertEquals("sc_session=TOK", req.getHeader("Cookie"))
    }

    @Test fun profiles_create_sendsEveryField() = runBlocking {
        ok("""{"profile":{"id":"p3","displayName":"Karim","login":"karim","role":"staff","active":true,"primary":false,"city":"Rabat"}}""", 201)
        val r = ProfilesRepo(api).create("Karim", "karim", "staff", "135792", "135792", "Rabat")
        assertTrue(r is Outcome.Ok)
        val req = server.takeRequest()
        assertEquals("POST", req.method); assertEquals("/api/profiles", req.path)
        val b = req.body.readUtf8()
        for (f in listOf("\"displayName\":\"Karim\"", "\"login\":\"karim\"", "\"role\":\"staff\"", "\"secret\":\"135792\"", "\"secretConfirm\":\"135792\"", "\"city\":\"Rabat\"")) assertTrue(f, b.contains(f))
    }

    @Test fun profiles_update_sendsOnlyChangedFields() = runBlocking {
        ok("""{"profile":{"id":"p2","displayName":"Marie","login":"marie","role":"parent","active":true,"primary":false}}""")
        ProfilesRepo(api).update("p2", role = "parent")
        val req = server.takeRequest()
        assertEquals("PATCH", req.method); assertEquals("/api/profiles/p2", req.path)
        assertEquals("""{"role":"parent"}""", req.body.readUtf8())
    }

    @Test fun serverRefusals_areMappedToClearMessages() = runBlocking {
        val repo = ProfilesRepo(api)
        val cases = mapOf(
            "last_admin" to "dernier administrateur", "primary_admin_protected" to "administrateur principal", "admin_cannot_deactivate" to "ne peut pas être désactivé",
            "admin_cannot_delete" to "Retirez d'abord", "primary_cannot_delete" to "ne peut pas être supprimé", "login_taken" to "existe déjà", "weak_secret" to "trop simple",
            "invalid_secret" to "6 chiffres", "secret_mismatch" to "pas identiques",
        )
        for ((code, frag) in cases) {
            ok("""{"error":"$code","message":"x"}""", 409)
            val f = repo.update("p", active = false) as Outcome.Fail
            assertEquals(code, f.code)
            assertEquals(Failure.CONFLICT, f.failure)
            assertTrue("$code → ${serverMessage(f) { "?" }}", serverMessage(f) { "?" }.contains(frag))
        }
    }

    @Test fun forbidden_notFound_andSessionExpiry() = runBlocking {
        val repo = ProfilesRepo(api)
        ok("""{"error":"forbidden"}""", 403)
        assertEquals(Failure.FORBIDDEN, (repo.list() as Outcome.Fail).failure)
        ok("""{"error":"not_found"}""", 404)
        assertEquals(Failure.NOT_FOUND, (repo.delete("x") as Outcome.Fail).failure)
        var expired = 0
        api.onSessionExpired = { expired++ }
        ok("""{"error":"unauthenticated"}""", 401)
        assertEquals(Failure.SESSION_EXPIRED, (repo.list() as Outcome.Fail).failure)
        assertEquals(1, expired)
    }

    @Test fun resetSecret_andCity() = runBlocking {
        ok("""{"ok":true}""")
        assertTrue(ProfilesRepo(api).resetSecret("p2", "246801", "246801") is Outcome.Ok)
        val a = server.takeRequest(); assertEquals("/api/profiles/p2/reset-secret", a.path); assertTrue(a.body.readUtf8().contains("\"secretConfirm\":\"246801\""))
        ok("""{"city":"Rabat"}""")
        assertEquals("Rabat", (ProfilesRepo(api).setMyCity("Rabat") as Outcome.Ok).value)
        val b = server.takeRequest(); assertEquals("PUT", b.method); assertEquals("/api/me/city", b.path)
    }

    private val pageJson = """{"total":3,"counts":{"active":80,"inactive":2,"absent":140},"items":[
        {"key":"tomates","origin":"initial","name":"Tomates","brand":null,"category":"legumes","photoUrl":"/api/photos/ph1","status":"active","productId":"pr1","unit":"kg"},
        {"key":"x1","origin":"extended","name":"Quinoa","brand":"Bio","category":"epicerie","photoUrl":null,"status":"absent","productId":null,"unit":"paquet"},
        {"key":"pr9","origin":"family","name":"Mon pain","brand":null,"category":"boulangerie","photoUrl":null,"status":"inactive","productId":"pr9","unit":"piece"}]}"""

    @Test fun catalog_page_parsesAndBuildsQuery() = runBlocking {
        ok(pageJson)
        val r = CatalogRepo(api).page("todo", "fruits", "pêche à", 30, 30, withCounts = true, presentFirst = true) as Outcome.Ok
        assertEquals(3, r.value.items.size); assertEquals(222, r.value.counts!!.all); assertEquals(142, r.value.counts!!.todo)
        assertEquals("pr1", r.value.items[0].productId); assertNull(r.value.items[1].productId); assertEquals("inactive", r.value.items[2].status)
        val path = server.takeRequest().path!!
        assertTrue(path, path.startsWith("/api/catalog/all?offset=30&limit=30&status=todo&category=fruits&q=p%C3%AAche+%C3%A0"))
        assertTrue(path.contains("counts=1") && path.contains("presentFirst=1"))
    }

    @Test fun catalog_actions() = runBlocking {
        val repo = CatalogRepo(api)
        ok("""{"product":{"id":"pr1","active":false}}""")
        assertTrue(repo.setActive("pr1", false) is Outcome.Ok)
        val a = server.takeRequest(); assertEquals("PATCH", a.method); assertEquals("/api/products/pr1", a.path); assertEquals("""{"active":false}""", a.body.readUtf8())
        ok("""{"product":{"id":"new1"},"created":true,"reactivated":false}""", 201)
        assertEquals("new1", (repo.addFromCatalog("extended", "x1") as Outcome.Ok).value)
        val b = server.takeRequest(); assertEquals("/api/products/from-catalog", b.path)
        assertTrue(b.body.readUtf8().let { it.contains("\"origin\":\"extended\"") && it.contains("\"key\":\"x1\"") })
        ok("""{"categories":[{"key":"legumes","label":"Légumes","products":[]},{"key":"fruits","label":"Fruits","products":[]}]}""")
        assertEquals(listOf("Légumes", "Fruits"), (repo.categories() as Outcome.Ok).value.map { it.label })
    }
}
