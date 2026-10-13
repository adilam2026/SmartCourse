package app.smartcourse.courses.nativeproto.net

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import java.time.Instant
import java.util.UUID

/** Ligne affichée : la liste du serveur, plus ce qui attend encore d'être envoyé. */
data class EffLine(
    val productId: String, val name: String, val brand: String?, val category: String, val photoUrl: String?, val unit: String,
    val quantity: Double, val bought: Boolean, val itemId: String?, val rev: Int, val purchaseId: String?,
    val price: PriceRef?, val buyer: String?, val boughtAt: String?, val pending: Boolean,
)

data class FlushReport(val sent: Int = 0, val messages: List<String> = emptyList(), val orphaned: Int = 0, val networkDown: Boolean = false)

/**
 * Moteur de la liste en cours (sans interface) : copie locale de la liste, brouillons, file « Envoi en attente » et articles « à reprendre ».
 *
 * Règles (identiques à celles du site) :
 *  - Valider = un lot d'opérations numérotées (identifiants uniques) : un renvoi après coupure ne s'applique jamais deux fois (le serveur rejoue la même réponse) ;
 *  - hors connexion, le lot est gardé sur le téléphone et envoyé au retour du réseau, dans l'ordre ;
 *  - si la liste a été terminée ou supprimée entre-temps, rien n'est ajouté à l'archive et la liste supprimée n'est jamais recréée :
 *    les articles demandés sont mis de côté (« Reprendre ») ;
 *  - achats et corrections ne se mettent jamais en file : ils exigent le réseau.
 * Tout est rangé par famille ET profil : un autre profil sur le même téléphone ne voit jamais ces données.
 */
class ListEngine(
    private val api: ApiClient,
    private val kv: KeyValueStore,
    private val scope: String,
    private val now: () -> Instant = { Instant.now() },
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    var list: ListData? = null; private set
    var outbox: List<Batch> = emptyList(); private set
    var orphans: List<Orphan> = emptyList(); private set
    var online: Boolean = true; private set
    var catalogRev: Long = 0; private set
    var prefsRev: Long = 0; private set
    private val flushLock = Mutex()
    /** Journal technique facultatif (diagnostic de recette) : jamais de nom d'article ni de donnée personnelle. */
    var trace: ((String) -> Unit)? = null

    private fun key(name: String) = "$name|$scope"

    init {
        list = kv.get(key("list"))?.let { s -> try { parseList(json.parseToJsonElement(s) as kotlinx.serialization.json.JsonObject) } catch (_: Exception) { null } }
        outbox = kv.get(key("outbox"))?.let { s -> try { storeJson.decodeFromString(ListSerializer(Batch.serializer()), s) } catch (_: Exception) { null } } ?: emptyList()
        orphans = kv.get(key("orphans"))?.let { s -> try { storeJson.decodeFromString(ListSerializer(Orphan.serializer()), s) } catch (_: Exception) { null } } ?: emptyList()
    }

    private fun saveOutbox() { if (outbox.isEmpty()) kv.remove(key("outbox")) else kv.put(key("outbox"), storeJson.encodeToString(ListSerializer(Batch.serializer()), outbox)) }
    private fun saveOrphans() { if (orphans.isEmpty()) kv.remove(key("orphans")) else kv.put(key("orphans"), storeJson.encodeToString(ListSerializer(Orphan.serializer()), orphans)) }

    /* ───── Brouillon de sélection (par famille + profil + liste ; « none » quand aucune liste n'existe) ───── */

    private fun draftKey(listId: String?) = "draft|$scope|${listId ?: "none"}"

    fun loadDraft(listId: String?): Map<String, Double> =
        kv.get(draftKey(listId))?.let { s -> try { storeJson.decodeFromString(MapSerializer(String.serializer(), Double.serializer()), s) } catch (_: Exception) { null } } ?: emptyMap()

    fun saveDraft(listId: String?, draft: Map<String, Double>) {
        if (draft.isEmpty()) kv.remove(draftKey(listId)) else kv.put(draftKey(listId), storeJson.encodeToString(MapSerializer(String.serializer(), Double.serializer()), draft))
    }

    /** Un brouillon rangé sous une liste qui n'est plus la liste en cours est mis de côté (« Reprendre »), jamais ajouté à l'autre liste. */
    fun stashDraftIfListChanged(oldListId: String?, newListId: String?, describe: (String) -> Pair<String, String?>) {
        if (oldListId == newListId) return
        val d = loadDraft(oldListId)
        if (d.isEmpty()) return
        val add = d.map { (pid, q) -> val (n, u) = describe(pid); Orphan(pid, n, q, u) }
        orphans = (orphans.filter { o -> add.none { it.productId == o.productId } } + add)
        saveOrphans(); saveDraft(oldListId, emptyMap())
    }

    /** Une opération qui porte une demande d'article (produit + quantité) : jamais perdue si sa liste n'est plus ouverte. */
    private fun keeps(op: Op) = op.productId != null && op.quantity != null && (op.type == "add" || op.type == "request_again" || op.type == "set_qty")

    fun takeOrphans(): List<Orphan> { val o = orphans; orphans = emptyList(); saveOrphans(); return o }

    /* ───── Lecture ───── */

    suspend fun refresh(): Outcome<ListData?> {
        val r = api.call("GET", "/api/lists/active")
        return when (r) {
            is Outcome.Ok -> {
                online = true
                val v = r.value
                catalogRev = (v["catalogRev"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull()?.toLong() ?: catalogRev
                prefsRev = (v["prefsRev"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull()?.toLong() ?: prefsRev
                val o = v["list"] as? kotlinx.serialization.json.JsonObject
                setList(o)
                Outcome.Ok(list)
            }
            is Outcome.Fail -> { noteFailure(r); r }
        }
    }

    /** Garde la liste reçue (et son texte d'origine, relu au prochain démarrage hors connexion). */
    private fun setList(o: kotlinx.serialization.json.JsonObject?) {
        val l = o?.let { parseList(it) }
        list = l
        if (l == null || o == null) kv.remove(key("list")) else kv.put(key("list"), o.toString())
    }

    private fun noteFailure(f: Outcome.Fail) {
        if (f.failure == Failure.NETWORK || f.failure == Failure.TIMEOUT || f.failure == Failure.TLS || f.failure == Failure.SERVER_ERROR) online = false
    }

    /* ───── Affichage : liste du serveur + opérations en attente ───── */

    fun effective(): List<EffLine> {
        val lines = LinkedHashMap<String, EffLine>()
        list?.items?.filter { it.status == "to_buy" || it.status == "purchased" }?.forEach { i ->
            lines[i.productId] = EffLine(i.productId, i.name, i.brand, i.category, i.photoUrl, i.unit, i.quantity, i.status == "purchased", i.id, i.rev, i.purchaseId, i.price, i.purchasedBy, i.purchasedAt, false)
        }
        val forActive = list?.id
        for (b in outbox) {
            if (b.listId != null && b.listId != forActive) continue
            for (op in b.ops) {
                val pid = op.productId ?: continue
                val cur = lines[pid]
                when (op.type) {
                    "add" -> if (cur == null) lines[pid] = EffLine(pid, op.name ?: "Article", null, op.category ?: "", op.photoUrl, op.unit ?: "piece", op.quantity ?: 1.0, false, null, 0, null, null, null, null, true)
                    "request_again" -> if (cur == null || cur.bought) lines[pid] = EffLine(pid, op.name ?: cur?.name ?: "Article", cur?.brand, op.category ?: cur?.category ?: "", op.photoUrl ?: cur?.photoUrl, op.unit ?: cur?.unit ?: "piece", op.quantity ?: 1.0, false, null, 0, null, null, null, null, true)
                    "set_qty" -> if (cur != null && !cur.bought) lines[pid] = cur.copy(quantity = op.quantity ?: cur.quantity, pending = true)
                    "remove" -> if (cur != null && !cur.bought) lines.remove(pid)
                }
            }
        }
        return lines.values.toList()
    }

    val pendingOps: Int get() = outbox.sumOf { it.ops.size }

    /* ───── Écriture ───── */

    private fun stamp() = now().toString()

    fun op(type: String, productId: String? = null, itemId: String? = null, purchaseId: String? = null, quantity: Double? = null, baseRev: Int? = null,
           name: String? = null, unit: String? = null, category: String? = null, photoUrl: String? = null) =
        Op(newId(), type, productId, itemId, purchaseId, quantity, baseRev, name, unit, category, photoUrl)

    /** Range un lot dans la file (écrit sur le disque avant tout envoi) : rien n'est perdu si l'application est fermée. */
    fun enqueue(ops: List<Op>): Batch {
        val b = Batch(newId(), stamp(), list?.id, ops)
        outbox = outbox + b
        saveOutbox()
        return b
    }

    suspend fun flush(): FlushReport = flushLock.withLock {
        var sent = 0; var orphaned = 0
        val msgs = LinkedHashSet<String>()
        while (outbox.isNotEmpty()) {
            val b = outbox.first()
            val path = if (b.listId != null) "/api/lists/${b.listId}/ops" else "/api/lists/active/ops"
            val call = api.call("POST", path, b.wire())
            trace?.invoke("envoi ${b.ops.size} opération(s) vers ${if (b.listId != null) "liste connue" else "liste du jour"} → " + when (call) {
                is Outcome.Ok -> "reçu " + parseResults(call.value).joinToString { it.status + (it.reason?.let { x -> ":$x" } ?: "") }
                is Outcome.Fail -> "échec ${call.failure} http=${call.status} code=${call.code}"
            })
            when (val r = call) {
                is Outcome.Ok -> {
                    online = true
                    val results = parseResults(r.value)
                    for (res in results) if (res.status == "rejected") {
                        val op = b.ops.firstOrNull { it.opId == res.opId }
                        val name = op?.name ?: list?.items?.firstOrNull { it.productId == op?.productId }?.name ?: "Cet article"
                        when (res.reason) {
                            "list_closed" -> {
                                // Demandes gardées « à reprendre » : ajouts, nouvelles demandes et quantités demandées (personnel hors connexion).
                                val adds = b.ops.filter { keeps(it) }
                                if (op != null && keeps(op)) { stash(op); orphaned++ }
                                msgs += if (adds.isNotEmpty()) "La liste a été terminée : vos articles sont gardés, appuyez sur « Reprendre »." else "La liste a été terminée : modification ignorée."
                            }
                            "stale" -> msgs += "« $name » a été modifié par quelqu'un d'autre : la liste affiche la quantité à jour."
                            "locked_purchased", "already_purchased" -> msgs += "« $name » est déjà acheté."
                            "product_inactive", "product_unknown" -> msgs += "« $name » n'est plus au catalogue."
                            "item_unknown", "item_removed" -> msgs += "« $name » n'est plus sur la liste."
                            "purchase_unknown" -> msgs += "Cet achat n'existe plus."
                            else -> msgs += "« $name » n'a pas pu être enregistré."
                        }
                    }
                    (r.value["list"] as? kotlinx.serialization.json.JsonObject)?.let { if (it["status"]?.toString()?.contains("active") == true) setList(it) }
                    outbox = outbox.drop(1); saveOutbox(); sent += b.ops.size
                }
                is Outcome.Fail -> {
                    when (r.failure) {
                        Failure.NOT_FOUND -> {
                            // Liste supprimée entre-temps : jamais recréée ; les demandes d'articles sont gardées.
                            b.ops.filter { keeps(it) }.forEach { stash(it); orphaned++ }
                            msgs += "La liste n'existe plus : vos articles sont gardés, appuyez sur « Reprendre »."
                            outbox = outbox.drop(1); saveOutbox()
                        }
                        Failure.FORBIDDEN, Failure.BAD_REQUEST, Failure.CONFLICT, Failure.UNKNOWN -> {
                            msgs += "Une demande a été refusée par le serveur et n'a pas été envoyée."
                            outbox = outbox.drop(1); saveOutbox()
                        }
                        else -> { noteFailure(r); return@withLock FlushReport(sent, msgs.toList(), orphaned, networkDown = true) }
                    }
                }
            }
        }
        FlushReport(sent, msgs.toList(), orphaned, false)
    }

    private fun stash(op: Op) {
        val pid = op.productId ?: return
        orphans = orphans.filter { it.productId != pid } + Orphan(pid, op.name ?: "Article", op.quantity ?: 1.0, op.unit)
        saveOrphans()
    }

    /** Actions qui exigent le réseau (achat, correction, clôture). Renvoie un message clair si elles échouent. */
    suspend fun strict(type: String, itemId: String? = null, purchaseId: String? = null): Outcome<List<OpResult>> {
        val l = list ?: return Outcome.Fail(Failure.NOT_FOUND)
        val o = op(type, itemId = itemId, purchaseId = purchaseId)
        val b = Batch(newId(), stamp(), l.id, listOf(o))
        return when (val r = api.call("POST", "/api/lists/${l.id}/ops", b.wire())) {
            is Outcome.Ok -> {
                online = true
                (r.value["list"] as? kotlinx.serialization.json.JsonObject)?.let { if (it["status"]?.toString()?.contains("active") == true) setList(it) }
                Outcome.Ok(parseResults(r.value))
            }
            is Outcome.Fail -> { noteFailure(r); r }
        }
    }

    suspend fun createList(): Outcome<ListData?> {
        val r = api.call("POST", "/api/lists", kotlinx.serialization.json.JsonObject(emptyMap()))
        return when (r) {
            is Outcome.Ok -> { setList(r.value["list"] as? kotlinx.serialization.json.JsonObject); online = true; Outcome.Ok(list) }
            is Outcome.Fail -> { noteFailure(r); r }
        }
    }

    suspend fun closeList(): Outcome<Unit> {
        val l = list ?: return Outcome.Fail(Failure.NOT_FOUND)
        return when (val r = api.call("POST", "/api/lists/${l.id}/close", kotlinx.serialization.json.JsonObject(emptyMap()))) {
            is Outcome.Ok -> { online = true; setList(null); Outcome.Ok(Unit) }
            is Outcome.Fail -> { noteFailure(r); r }
        }
    }

    fun markOffline() { online = false }
}
