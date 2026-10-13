package app.smartcourse.courses.nativeproto

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import app.smartcourse.courses.nativeproto.net.CatProduct
import app.smartcourse.courses.nativeproto.net.EffLine
import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.KeyValueStore
import app.smartcourse.courses.nativeproto.net.LineAmount
import app.smartcourse.courses.nativeproto.net.ListEngine
import app.smartcourse.courses.nativeproto.net.Me
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.Prefs
import app.smartcourse.courses.nativeproto.net.Session
import app.smartcourse.courses.nativeproto.net.json
import app.smartcourse.courses.nativeproto.net.lineAmount
import app.smartcourse.courses.nativeproto.net.parseCatalog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Contexte de l'application, renseigné au démarrage (stockage local, connectivité). */
object Env {
    var kv: KeyValueStore? = null
    var context: Context? = null
}

/** L'instance de données réelles actuellement affichée, pour les changements de premier plan / arrière-plan de l'activité. */
object LiveHolder { var current: AppData? = null }

private val DATE_FMT = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.FRENCH)
private val TIME_FMT = DateTimeFormatter.ofPattern("HH:mm", Locale.FRENCH)

fun frenchDate(iso: String?): String = try {
    if (iso == null) "" else OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(DATE_FMT).replaceFirstChar { it.uppercase() }
} catch (_: Exception) { "" }

fun clockTime(iso: String?): String? = try {
    if (iso == null) null else OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(TIME_FMT)
} catch (_: Exception) { null }

private fun CatProduct.toProduct() = Product(
    id = id, name = if (brand.isNullOrBlank()) name else "$name $brand", photo = 0, category = categoryLabel,
    unit = unitKindOf(unit), countLabel = countLabelOf(unit), basePrice = null, inCatalog = active,
    photoUrl = photoUrl, serverUnit = unit, price = price,
)

/**
 * Pont entre les données réelles (serveur, copie locale, file d'attente) et les écrans : il remplit l'état [Demo] que les écrans lisent déjà
 * (mêmes écrans validés, données réelles) et transforme chaque action en opérations numérotées.
 */
class AppData(val demo: Demo, val session: Session, val me: Me, private val kv: KeyValueStore, private val scope: CoroutineScope) {
    val scopeKey = "${me.familyId.ifEmpty { "f" }}|${me.id}"
    val engine = ListEngine(session.api, kv, scopeKey)
    var online by mutableStateOf(true); private set
    private var catalog: List<CatProduct> by mutableStateOf(emptyList())
    val catalogProducts: List<CatProduct> get() = catalog
    private var catalogRevLoaded = -1L
    private var started = false
    private var streamJob: Job? = null
    private var retryJob: Job? = null
    private var draftJob: Job? = null
    private var backoff = 1000L
    private var draftListId: String? = "\u0000"
    private val qtyEdits = HashMap<String, Int>()
    private val qtyJobs = HashMap<String, Job>()
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    private val catKey = "catalog|$scopeKey"
    private val modeKey = "selmode|$scopeKey"

    init {
        demo.data = this
        engine.trace = { android.util.Log.i("CoursesData", it) }
        kv.get(catKey)?.let { s -> try { parseCatalog(json.parseToJsonElement(s) as JsonObject) } catch (_: Exception) { null } }?.let { catalog = it.products }
        kv.get(modeKey)?.let { m -> SelMode.entries.firstOrNull { it.name == m }?.let { demo.selMode = it } }
        demo.listLoaded = engine.list != null
        applyPrefs(me.prefs)
        render()
        syncDraft()
    }

    /* ───── Affichage ───── */

    fun applyPrefs(p: Prefs?) { if (p != null) { demo.showPrices = p.showPrices; demo.showTotals = p.showTotals } }

    private fun display(l: EffLine) = if (l.brand.isNullOrBlank()) l.name else "${l.name} ${l.brand}"

    fun render() {
        val eff = engine.effective()
        val labelOf = catalog.associate { it.category to it.categoryLabel }
        val map = LinkedHashMap<String, Product>()
        catalog.forEach { map[it.id] = it.toProduct() }
        eff.forEach { l ->
            if (l.productId !in map) map[l.productId] = Product(
                l.productId, display(l), 0, labelOf[l.category] ?: l.category, unitKindOf(l.unit), countLabelOf(l.unit), null, false,
                photoUrl = l.photoUrl, serverUnit = l.unit, price = l.price,
            )
        }
        demo.products = map.values.toList()
        demo.byId = map
        demo.inCatalog.clear()
        map.values.forEach { demo.inCatalog[it.id] = it.inCatalog }
        val lines = eff.map { l ->
            Line(l.productId, qtyEdits[l.productId] ?: toBase(l.unit, l.quantity), l.bought, l.itemId, l.rev, l.purchaseId, l.buyer, clockTime(l.boughtAt), l.pending, l.price)
        }
        if (lines != demo.lines.toList()) { demo.lines.clear(); demo.lines.addAll(lines) }
        demo.pendingOps = engine.pendingOps
        demo.orphanCount = engine.orphans.size
        demo.hasList = engine.list != null
        demo.listDate = frenchDate(engine.list?.createdAt ?: java.time.OffsetDateTime.now().toString())
        online = engine.online
    }

    fun estimate(): Pair<Long, Int> {
        var cents = 0L; var missing = 0
        for (l in demo.lines) {
            val p = demo.byId[l.productId] ?: continue
            when (val a = lineAmount(l.price ?: p.price, serverQtyText(p.serverUnit, l.qty), p.serverUnit)) {
                is LineAmount.Ok -> cents += a.cents
                is LineAmount.No -> missing++
            }
        }
        return cents to missing
    }

    /* ───── Brouillon de sélection ───── */

    private fun loadSelection(listId: String?) {
        engine.loadDraft(listId).forEach { (pid, q) -> demo.byId[pid]?.let { p -> if (p.inCatalog) demo.selection[pid] = toBase(p.serverUnit, q) } }
    }

    private fun syncDraft() {
        val id = engine.list?.id
        if (draftListId == "\u0000") { draftListId = id; loadSelection(id); return }
        if (id == draftListId) return
        if (draftListId == null) {
            // Le brouillon écrit alors qu'aucune liste n'existait suit la nouvelle liste.
            draftListId = id; persistDraft(); return
        }
        engine.stashDraftIfListChanged(draftListId, id) { pid -> demo.byId[pid]?.let { it.name to it.serverUnit } ?: ("Article" to null) }
        demo.selection.clear(); draftListId = id; loadSelection(id)
        demo.orphanCount = engine.orphans.size
    }

    private fun persistDraft() {
        val m = demo.selection.toMap().mapNotNull { (pid, q) -> demo.byId[pid]?.let { pid to toServer(it.serverUnit, q) } }.toMap()
        engine.saveDraft(draftListId.takeIf { it != "\u0000" }, m)
    }

    fun resumeOrphans() {
        val orphans = engine.takeOrphans()
        var n = 0
        orphans.forEach { o -> val p = demo.byId[o.productId]; if (p != null && p.inCatalog) { demo.selection[o.productId] = toBase(p.serverUnit, o.quantity); n++ } }
        demo.orphanCount = 0
        demo.say(if (n > 0) "$n article${if (n > 1) "s" else ""} repris dans votre sélection." else "Ces articles ne sont plus au catalogue.")
    }

    fun dismissOrphans() { engine.takeOrphans(); demo.orphanCount = 0 }

    fun setSelMode(m: SelMode) { demo.selMode = m; kv.put(modeKey, m.name) }

    /* ───── Cycle de vie ───── */

    fun onForeground() {
        if (started) return
        started = true
        draftJob = scope.launch { snapshotFlow { demo.selection.toMap() }.collect { persistDraft() } }
        registerNetwork()
        startStream()
        retryJob = scope.launch { while (isActive) { delay(20_000); if (engine.pendingOps > 0) flushAndRefresh() } }
        scope.launch { refreshAll() }
    }

    fun onBackground() {
        started = false
        streamJob?.cancel(); retryJob?.cancel(); draftJob?.cancel()
        netCallback?.let { cb -> try { (Env.context?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)?.unregisterNetworkCallback(cb) } catch (_: Exception) { } }
        netCallback = null
    }

    private fun registerNetwork() {
        val cm = Env.context?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { scope.launch { if (started) flushAndRefresh() } }
        }
        try { cm.registerDefaultNetworkCallback(cb); netCallback = cb } catch (_: Exception) { }
    }

    private fun startStream() {
        streamJob?.cancel()
        streamJob = scope.launch {
            while (isActive) {
                val r = session.api.stream("/api/events", onOpen = { }, onEvent = { name -> scope.launch { onEvent(name) } })
                if (r is Outcome.Fail && r.failure == Failure.SESSION_EXPIRED) break
                if (r is Outcome.Fail) { engine.markOffline(); online = false }
                delay(backoff); backoff = (backoff * 2).coerceAtMost(30_000)
            }
        }
    }

    private suspend fun onEvent(name: String) {
        when (name) {
            "ready" -> { backoff = 1000; online = true; refreshAll() }
            "list.updated", "list.closed", "list.created", "list.deleted" -> flushAndRefresh()
            "catalog.updated" -> refreshCatalog()
            "prefs.updated" -> session.verify()
        }
    }

    /* ───── Synchronisation ───── */

    suspend fun refreshAll() { refreshCatalog(); flushAndRefresh() }

    suspend fun refreshCatalog() {
        when (val r = session.api.call("GET", "/api/catalog")) {
            is Outcome.Ok -> {
                val c = parseCatalog(r.value) ?: return
                catalog = c.products; catalogRevLoaded = c.rev
                kv.put(catKey, r.value.toString())
                render(); syncDraft()
            }
            is Outcome.Fail -> if (r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT || r.failure == Failure.SERVER_ERROR) { engine.markOffline(); online = false }
        }
    }

    suspend fun flushAndRefresh() {
        val rep = engine.flush()
        if (rep.messages.isNotEmpty()) demo.say(rep.messages.joinToString(" "))
        if (!rep.networkDown) engine.refresh()
        android.util.Log.i("CoursesData", "flush envoyées=${rep.sent} gardées=${rep.orphaned} réseau=${rep.networkDown} messages=${rep.messages} | à reprendre=${engine.orphans.size} en attente=${engine.pendingOps} liste=${engine.list?.id} en ligne=${engine.online}")
        demo.listLoaded = true
        if (engine.catalogRev != catalogRevLoaded && engine.online) refreshCatalog()
        render(); syncDraft()
        // Les demandes déjà vues à l'écran ne donnent pas de notification plus tard.
        engine.list?.let { l -> kv.put(Notifier.seenKey(scopeKey), l.validations.joinToString(",") { it.id }) }
    }

    /* ───── Actions ───── */

    private fun networkMessage() = "Pas de réseau : l'action n'est pas enregistrée. Réessayez quand la connexion est revenue."

    fun setBought(productId: String, value: Boolean) {
        val line = demo.lines.firstOrNull { it.productId == productId } ?: return
        scope.launch {
            if (line.itemId == null) { demo.say("Cet article n'est pas encore envoyé : attendez le retour du réseau."); return@launch }
            if (!value && line.purchaseId == null) { demo.say("Achat introuvable : actualisez la liste."); return@launch }
            val r = if (value) engine.strict("purchase", itemId = line.itemId) else engine.strict("correct", purchaseId = line.purchaseId)
            when (r) {
                is Outcome.Ok -> r.value.firstOrNull { it.status == "rejected" }?.let { demo.say(strictMessage(it.reason)) }
                is Outcome.Fail -> demo.say(if (r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT || r.failure == Failure.TLS || r.failure == Failure.SERVER_ERROR) networkMessage() else if (r.failure == Failure.FORBIDDEN) "Action non autorisée pour votre profil." else "Action impossible : actualisez la liste.")
            }
            render()
            if (r is Outcome.Ok && r.value.any { it.status == "rejected" }) flushAndRefresh()
        }
    }

    private fun strictMessage(reason: String?) = when (reason) {
        "list_closed" -> "La liste a été terminée par quelqu'un d'autre."
        "item_removed", "item_unknown" -> "Cet article n'est plus sur la liste."
        "purchase_unknown" -> "Cet achat n'existe plus."
        else -> "Action refusée : actualisez la liste."
    }

    fun setQty(productId: String, q: Int) {
        qtyEdits[productId] = q
        render()
        qtyJobs[productId]?.cancel()
        qtyJobs[productId] = scope.launch { delay(900); commitQty(productId) }
    }

    private suspend fun commitQty(pid: String) {
        val q = qtyEdits[pid] ?: return
        if (engine.pendingOps > 0) engine.flush()
        val line = engine.effective().firstOrNull { it.productId == pid }
        val p = demo.byId[pid]
        if (line == null || p == null || line.bought) { qtyEdits.remove(pid); render(); return }
        val sq = toServer(p.serverUnit, q)
        if (sq != line.quantity) {
            engine.enqueue(listOf(engine.op("set_qty", productId = pid, quantity = sq, baseRev = if (line.itemId != null) line.rev else 1, name = p.name, unit = p.serverUnit)))
        }
        qtyEdits.remove(pid); render()
        if (sq != line.quantity) flushAndRefresh()
    }

    fun remove(productId: String) {
        val line = demo.lines.firstOrNull { it.productId == productId } ?: return
        val p = demo.byId[productId]
        qtyEdits.remove(productId); qtyJobs.remove(productId)?.cancel()
        engine.enqueue(listOf(engine.op("remove", productId = productId, baseRev = if (line.itemId != null) line.rev else 1, name = p?.name)))
        render()
        scope.launch { flushAndRefresh() }
    }

    /** « Terminer ma sélection » : un seul lot d'opérations pour toute la sélection. */
    fun submitSelection(after: () -> Unit) = submit(demo.selection.toMap(), clearSelection = true, after = after)

    /** Ajoute des produits à la liste (sélection, favori ou « Recommander ») : [entries] = produit → quantité (unités de l'application). */
    fun submit(entries: Map<String, Int>, clearSelection: Boolean, after: () -> Unit = {}) {
        val lines = engine.effective()
        val ops = entries.mapNotNull { (pid, q) ->
            val p = demo.byId[pid] ?: return@mapNotNull null
            if (!p.inCatalog) return@mapNotNull null
            val sq = toServer(p.serverUnit, q).coerceIn(0.001, 999.0)
            val cur = lines.firstOrNull { it.productId == pid }
            when {
                cur == null -> engine.op("add", productId = pid, quantity = sq, name = p.name, unit = p.serverUnit, category = p.category, photoUrl = p.photoUrl)
                cur.bought -> engine.op("request_again", productId = pid, quantity = sq, name = p.name, unit = p.serverUnit, category = p.category, photoUrl = p.photoUrl)
                else -> engine.op("set_qty", productId = pid, quantity = (cur.quantity + sq).coerceAtMost(999.0), baseRev = if (cur.itemId != null) cur.rev else 1, name = p.name, unit = p.serverUnit)
            }
        }
        if (ops.isEmpty()) { demo.say("Aucun article à ajouter."); return }
        engine.enqueue(ops)
        if (clearSelection) demo.selection.clear()
        render(); after()
        scope.launch {
            val before = engine.pendingOps
            val rep = engine.flush()
            if (rep.networkDown) demo.say("Envoi en attente : $before modification${if (before > 1) "s" else ""} partiront au retour du réseau.")
            else if (rep.messages.isNotEmpty()) demo.say(rep.messages.joinToString(" "))
            else demo.say(if (me.role == "staff") "Demande envoyée." else "Articles ajoutés à la liste.")
            if (!rep.networkDown) engine.refresh()
            render(); syncDraft()
        }
    }

    fun closeList(after: (Boolean) -> Unit) {
        scope.launch {
            if (engine.pendingOps > 0) engine.flush()
            when (val r = engine.closeList()) {
                is Outcome.Ok -> { render(); demo.say("Liste terminée et archivée dans l'historique."); after(true) }
                is Outcome.Fail -> { demo.say(if (r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT) networkMessage() else "La liste n'a pas pu être terminée : actualisez."); after(false) }
            }
        }
    }

    fun createList() {
        scope.launch {
            when (val r = engine.createList()) {
                is Outcome.Ok -> { render(); syncDraft() }
                is Outcome.Fail -> demo.say(if (r.code == "active_exists") "Une liste est déjà en cours." else networkMessage())
            }
            flushAndRefresh()
        }
    }

    fun setPrefs(showPrices: Boolean, showTotals: Boolean) {
        val old = demo.showPrices to demo.showTotals
        demo.showPrices = showPrices || showTotals; demo.showTotals = showTotals
        scope.launch {
            val body = buildJsonObject { put("showPrices", demo.showPrices); put("showTotals", demo.showTotals) }
            when (session.api.call("PUT", "/api/me/prefs", body)) {
                is Outcome.Ok -> session.verify()
                is Outcome.Fail -> { demo.showPrices = old.first; demo.showTotals = old.second; demo.say(networkMessage()) }
            }
        }
    }
}
