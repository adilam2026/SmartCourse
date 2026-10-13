package app.smartcourse.courses.nativeproto.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

class ListEngineTest {
    private lateinit var server: MockWebServer
    private lateinit var api: ApiClient
    private lateinit var kv: MemoryKv
    private var seq = 0

    @Before fun setUp() {
        server = MockWebServer(); server.start()
        val st = MemoryStorage().also { it.server = server.url("/").toString().trimEnd('/'); it.cookie = "TOK" }
        api = ApiClient(st, okhttp3.OkHttpClient.Builder().retryOnConnectionFailure(false).followRedirects(false).build()); kv = MemoryKv()
    }
    @After fun tearDown() { runCatching { server.shutdown() } }

    private fun engine(scope: String = "f1|p1") = ListEngine(api, kv, scope, now = { Instant.parse("2026-05-12T09:00:00Z") }, newId = { "00000000-0000-4000-8000-" + (++seq).toString().padStart(12, '0') })

    private fun item(id: String, pid: String, name: String, status: String = "to_buy", rev: Int = 1, q: Double = 1.0, unit: String = "kg", purchase: Boolean = false) =
        """{"id":"$id","productId":"$pid","category":"legumes","name":"$name","brand":null,"photoUrl":null,"productActive":true,"status":"$status","rev":$rev,"quantity":$q,"unit":"$unit","price":{"amount":"2.90","refQty":"1","refUnit":"kg","source":"base"},"priceFrozen":true${if (purchase) ""","purchase":{"id":"pu-$id","at":"2026-05-12T08:00:00Z","by":{"id":"u","displayName":"Lamiaa"},"quantity":$q,"unit":"$unit"}""" else ""}}"""
    private fun list(id: String = "L1", status: String = "active", vararg items: String) = """{"id":"$id","status":"$status","createdAt":"2026-05-12T07:00:00Z","closedAt":null,"items":[${items.joinToString(",")}]}"""
    private fun active(l: String?) = """{"list":${l ?: "null"},"catalogRev":3,"prefsRev":1}"""
    private fun json(body: String, code: Int = 200) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))
    private fun nextRequest() = server.takeRequest(10, java.util.concurrent.TimeUnit.SECONDS) ?: error("aucune requête reçue")
    private fun down() = server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))

    @Test fun refresh_parsesListAndCachesIt() = runBlocking {
        json(active(list("L1", "active", item("i1", "tom", "Tomates", q = 2.0), item("i2", "lait", "Lait", "purchased", q = 1.5, unit = "litre", purchase = true))))
        val e = engine()
        assertTrue(e.refresh() is Outcome.Ok)
        val lines = e.effective()
        assertEquals(2, lines.size)
        assertEquals(2.0, lines[0].quantity, 0.0); assertFalse(lines[0].bought)
        assertTrue(lines[1].bought); assertEquals("Lamiaa", lines[1].buyer); assertEquals("pu-i2", lines[1].purchaseId)
        assertEquals(3L, e.catalogRev)
        // Nouveau démarrage sans réseau : la dernière liste connue est relue.
        val e2 = engine()
        assertEquals(2, e2.effective().size); assertEquals("L1", e2.list?.id)
    }

    @Test fun offlineBatch_isKeptThenSentOnceWithSameIds() = runBlocking {
        json(active(list("L1", "active", item("i1", "tom", "Tomates"))))
        val e = engine(); e.refresh()
        e.enqueue(listOf(e.op("add", productId = "oig", quantity = 1.5, name = "Oignons", unit = "kg", category = "Fruits et légumes")))
        assertEquals(1, e.pendingOps)
        val pending = e.effective().first { it.productId == "oig" }
        assertTrue(pending.pending); assertEquals(1.5, pending.quantity, 0.0)

        down()
        val r1 = e.flush()
        assertTrue(r1.networkDown); assertEquals(1, e.pendingOps); assertFalse(e.online)
        nextRequest() // GET /api/lists/active
        val first = nextRequest(); val firstBody = first.body.readUtf8()
        // Restart: the batch survives on the disk
        val e2 = engine(); assertEquals(1, e2.pendingOps)

        json("""{"results":[{"opId":"00000000-0000-4000-8000-000000000001","status":"applied"}],"list":${list("L1", "active", item("i1", "tom", "Tomates"), item("i3", "oig", "Oignons", q = 1.5))}}""")
        val r2 = e2.flush()
        assertEquals(1, r2.sent); assertEquals(0, e2.pendingOps); assertTrue(e2.online)
        val second = nextRequest()
        assertEquals("/api/lists/L1/ops", second.path)
        assertEquals("Same operation ids and same batch on the second try", firstBody, second.body.readUtf8())
        assertEquals(2, e2.effective().size); assertFalse(e2.effective().any { it.pending })
    }

    @Test fun closedList_keepsRequestedItemsAsOrphans_andAddsNothingElsewhere() = runBlocking {
        json(active(list("L1", "active", item("i1", "tom", "Tomates"))))
        val e = engine(); e.refresh()
        val b = e.enqueue(listOf(e.op("add", productId = "oig", quantity = 2.0, name = "Oignons", unit = "kg")))
        json("""{"results":[{"opId":"${b.ops[0].opId}","status":"rejected","reason":"list_closed"}],"list":${list("L1", "archived")}}""")
        val r = e.flush()
        assertEquals(0, e.pendingOps); assertEquals(1, r.orphaned)
        assertTrue(r.messages.single().contains("Reprendre"))
        assertEquals("Oignons", e.orphans.single().name)
        // The archived list is never shown as the active one
        assertEquals("L1", e.list?.id); assertTrue(e.list?.status == "active")
        val back = e.takeOrphans()
        assertEquals(1, back.size); assertTrue(e.orphans.isEmpty())
    }

    @Test fun deletedList_isNeverRecreated_requestsAreKept() = runBlocking {
        json(active(list("L1", "active")))
        val e = engine(); e.refresh()
        e.enqueue(listOf(e.op("add", productId = "oig", quantity = 1.0, name = "Oignons")))
        json("""{"error":"not_found","message":"Liste introuvable"}""", 404)
        val r = e.flush()
        assertEquals(0, e.pendingOps); assertEquals(1, e.orphans.size); assertEquals(1, r.orphaned)
        assertEquals(2, server.requestCount) // lecture + un seul envoi : aucune création de liste
        nextRequest()
        assertEquals("/api/lists/L1/ops", nextRequest().path)
    }

    @Test fun noActiveList_usesActiveOpsEndpoint() = runBlocking {
        json(active(null))
        val e = engine(); e.refresh()
        e.enqueue(listOf(e.op("add", productId = "oig", quantity = 1.0, name = "Oignons")))
        json("""{"results":[{"opId":"x","status":"applied"}],"list":${list("L9", "active", item("i9", "oig", "Oignons"))}}""")
        e.flush()
        nextRequest()
        assertEquals("/api/lists/active/ops", nextRequest().path)
        assertEquals("L9", e.list?.id)
    }

    @Test fun staleRejection_isExplainedWithName() = runBlocking {
        json(active(list("L1", "active", item("i1", "tom", "Tomates", rev = 1, q = 2.0))))
        val e = engine(); e.refresh()
        val b = e.enqueue(listOf(e.op("set_qty", productId = "tom", quantity = 3.0, baseRev = 1)))
        assertEquals(3.0, e.effective().single().quantity, 0.0)
        json("""{"results":[{"opId":"${b.ops[0].opId}","status":"rejected","reason":"stale"}],"list":${list("L1", "active", item("i1", "tom", "Tomates", rev = 2, q = 2.5))}}""")
        val r = e.flush()
        assertTrue(r.messages.single().contains("Tomates"))
        assertEquals(2.5, e.effective().single().quantity, 0.0)
    }

    @Test fun drafts_areIsolatedPerFamilyProfileAndList() {
        val a = engine("f1|p1"); val b = engine("f1|p2"); val c = engine("f2|p1")
        a.saveDraft("L1", mapOf("tom" to 2.0)); a.saveDraft(null, mapOf("oig" to 1.0))
        assertEquals(mapOf("tom" to 2.0), a.loadDraft("L1")); assertEquals(mapOf("oig" to 1.0), a.loadDraft(null))
        assertTrue(a.loadDraft("L2").isEmpty()); assertTrue(b.loadDraft("L1").isEmpty()); assertTrue(c.loadDraft("L1").isEmpty())
        a.saveDraft("L1", emptyMap()); assertTrue(engine("f1|p1").loadDraft("L1").isEmpty())
    }

    @Test fun draftOfAnotherList_isStashedNotAppended() {
        val e = engine()
        e.saveDraft("L1", mapOf("tom" to 2.0))
        e.stashDraftIfListChanged("L1", "L2") { id -> (if (id == "tom") "Tomates" else "?") to "kg" }
        assertEquals("Tomates", e.orphans.single().name); assertTrue(e.loadDraft("L1").isEmpty())
        e.stashDraftIfListChanged("L2", "L2") { "?" to null }
        assertEquals(1, e.orphans.size)
    }

    @Test fun purchase_requiresNetwork_andIsNeverQueued() = runBlocking {
        json(active(list("L1", "active", item("i1", "tom", "Tomates"))))
        val e = engine(); e.refresh()
        down()
        val r = e.strict("purchase", itemId = "i1")
        assertTrue(r is Outcome.Fail); assertEquals(0, e.pendingOps); assertFalse(e.online)
        json("""{"results":[{"opId":"x","status":"applied"}],"list":${list("L1", "active", item("i1", "tom", "Tomates", "purchased", 2, purchase = true))}}""")
        assertTrue(e.strict("purchase", itemId = "i1") is Outcome.Ok)
        assertTrue(e.effective().single().bought); assertNotNull(e.effective().single().purchaseId)
        assertNull(e.orphans.firstOrNull())
    }
}
