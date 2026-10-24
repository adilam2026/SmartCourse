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
    photoUrl = photoUrl, serverUnit = unit, price = price, own = own, keywords = keywords,
)

/** Référence du catalogue commun proposée pendant une recherche (absente de la famille, ou retirée par un administrateur). */
data class Suggestion(val origin: String, val key: String, val name: String, val categoryLabel: String, val photoUrl: String?, val status: String, val productId: String?)

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
    private val orgKey = "selorg|$scopeKey"

    /** Compte supprimé : plus rien de ce profil ne reste sur le téléphone (copie de la liste, envois en attente, catalogue, réglages). */
    fun wipeLocal() {
        engine.wipeLocal()
        for (k in listOf(catKey, modeKey, orgKey, Notifier.key(scopeKey), Notifier.seenKey(scopeKey))) kv.remove(k)
    }

    init {
        demo.data = this
        engine.trace = { android.util.Log.i("CoursesData", it) }
        kv.get(catKey)?.let { s -> try { parseCatalog(json.parseToJsonElement(s) as JsonObject) } catch (_: Exception) { null } }?.let { catalog = it.products; if (it.categories.isNotEmpty()) demo.categoryList = it.categories }
        // Préférences d'affichage DE CE PROFIL (téléphone) : celles d'un profil précédent ne sont jamais reprises ; valeurs par défaut sinon.
        demo.selMode = SelMode.parse(kv.get(modeKey))
        demo.selOrg = SelOrg.parse(kv.get(orgKey))
        demo.listLoaded = engine.list != null
        applyLocation(me.location)
        applyFeatures(me.features)
        scope.launch { loadServerLevel() }
        applyPrefs(me.prefs)
        render()
        syncDraft()
    }

    /* ───── Affichage ───── */

    fun applyPrefs(p: Prefs?) { if (p != null) { demo.showPrices = p.showPrices && demo.pricesAvailable; demo.showTotals = p.showTotals && demo.pricesAvailable } }
    /** Options avancées de la famille : à l'activation, les listes en cours sont chargées pour le sélecteur. */
    fun applyFeatures(f: app.smartcourse.courses.nativeproto.net.FamilyFeatures?) {
        demo.multiLists = f?.multiLists == true
        if (demo.multiLists) scope.launch { loadOpenLists() } else demo.openLists = emptyList()
        if (f?.budget == true) scope.launch { loadBudget() } else demo.budget = null
    }

    suspend fun loadServerLevel() {
        val r = session.api.call("GET", "/health")
        if (r is Outcome.Ok) (r.value["schema"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.let { demo.serverSchema = it }
    }

    /** État du module Budget pour ce profil (droits compris, décidés par le serveur). */
    suspend fun loadBudget() {
        when (val r = Fin.call(this, "GET", "/api/budget", BudgetInfo.serializer())) {
            is FinR.Ok -> { demo.budget = r.v; demo.budgetRev++ }
            is FinR.Err -> if (!r.network) demo.budget = null
        }
    }

    suspend fun loadOpenLists() {
        val r = session.api.call("GET", "/api/lists/open")
        if (r !is Outcome.Ok) return
        demo.openLists = try {
            (r.value["lists"] as kotlinx.serialization.json.JsonArray).map { e ->
                val o = e as JsonObject
                fun str(k: String) = (o[k] as? kotlinx.serialization.json.JsonPrimitive)?.let { if (it.isString) it.content else null }
                fun int(k: String) = (o[k] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() ?: 0
                OpenList(str("id") ?: "", str("name"), str("createdAt") ?: "", int("remaining"), int("purchased"), (o["current"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true")
            }
        } catch (_: Exception) { demo.openLists }
    }

    /** Consulter une autre liste en cours : rien n'est déplacé ; la sélection en cours (brouillon) suit sa propre liste. */
    fun switchList(listId: String, after: () -> Unit = {}) {
        scope.launch {
            if (engine.pendingOps > 0) engine.flush()
            when (val r = engine.switchTo(listId)) {
                is Outcome.Ok -> { render(); followList(); loadOpenLists(); after() }
                is Outcome.Fail -> demo.say(if (r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT) networkMessage() else explain(r))
            }
        }
    }

    /** Nouvelle liste nommée (option « plusieurs listes ») : elle devient la liste consultée ; les autres listes ne changent pas. */
    fun createNamedList(name: String, after: () -> Unit = {}) {
        scope.launch {
            if (engine.pendingOps > 0) engine.flush()
            when (val r = engine.createList(name)) {
                is Outcome.Ok -> { render(); followList(); loadOpenLists(); after() }
                is Outcome.Fail -> demo.say(if (r.code == "active_exists") "Une liste est déjà en cours." else if (r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT) networkMessage() else explain(r))
            }
        }
    }

    /** Paramètres avancés (administrateurs) : renvoie un message d'erreur, ou null si c'est enregistré. */
    suspend fun setMultiLists(on: Boolean): String? = when (val r = session.api.call("PUT", "/api/family/features", buildJsonObject { put("multiLists", on) })) {
        is Outcome.Ok -> { session.verify(); demo.multiLists = on; if (on) loadOpenLists(); null }
        is Outcome.Fail -> if (r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT) networkMessage() else settingFailure(r, ::explain)
    }

    /** Localisation de la famille : hors du Maroc, aucun prix indicatif n'est affiché (les préférences enregistrées sont conservées). */
    fun applyLocation(l: app.smartcourse.courses.nativeproto.net.FamilyLocation?) {
        demo.pricesAvailable = l?.pricesAvailable ?: true
        if (!demo.pricesAvailable) { demo.showPrices = false; demo.showTotals = false }
    }

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
            Line(l.productId, qtyEdits[l.productId] ?: toBase(l.unit, l.quantity), l.bought, l.itemId, l.rev, l.purchaseId, l.buyer, clockTime(l.boughtAt), l.pending, l.price, l.unit)
        }
        if (lines != demo.lines.toList()) { demo.lines.clear(); demo.lines.addAll(lines) }
        demo.pendingOps = engine.pendingOps
        demo.orphanCount = engine.orphans.size
        demo.hasList = engine.list != null
        demo.listDate = frenchDate(engine.list?.createdAt ?: java.time.OffsetDateTime.now().toString())
        demo.listName = engine.list?.name
        demo.currentListId = engine.list?.id
        online = engine.online
    }

    fun estimate(): Pair<Long, Int> {
        var cents = 0L; var missing = 0
        for (l in demo.lines) {
            val p = demo.lineProduct(l) ?: continue
            when (val a = lineAmount(l.price ?: p.price, serverQtyText(p.serverUnit, l.qty), p.serverUnit)) {
                is LineAmount.Ok -> cents += a.cents
                is LineAmount.No -> missing++
            }
        }
        return cents to missing
    }

    /* ───── Brouillon de sélection ───── */

    private fun loadSelection(listId: String?) {
        val units = engine.loadDraftUnits(listId)
        val changed = ArrayList<String>()
        engine.loadDraft(listId).forEach { (pid, q) ->
            demo.byId[pid]?.let { p ->
                // Quantité saisie dans une unité qui n'est plus celle du produit : jamais convertie, à choisir de nouveau.
                if (units[pid] != null && units[pid] != p.serverUnit) changed += p.name
                else if (p.inCatalog) demo.selection[pid] = toBase(p.serverUnit, q)
            }
        }
        if (changed.isNotEmpty()) demo.say("Unité modifiée depuis votre sélection, quantité à choisir de nouveau : ${changed.joinToString(", ")}.")
    }

    private fun syncDraft() {
        val id = engine.list?.id
        if (draftListId == "\u0000") { draftListId = id; loadSelection(id); return }
        if (id == draftListId) return
        // Plusieurs listes : l'ancienne liste encore ouverte garde sa sélection (rien n'est mis « à reprendre »).
        if (demo.multiLists && demo.openLists.any { it.id == draftListId }) { followList(); return }
        if (draftListId == null) {
            // Le brouillon écrit alors qu'aucune liste n'existait suit la nouvelle liste.
            draftListId = id; persistDraft(); return
        }
        engine.stashDraftIfListChanged(draftListId, id) { pid -> demo.byId[pid]?.let { it.name to it.serverUnit } ?: ("Article" to null) }
        demo.selection.clear(); draftListId = id; loadSelection(id)
        demo.orphanCount = engine.orphans.size
    }

    /** Changement VOLONTAIRE de liste (l'ancienne reste ouverte) : sa sélection reste attachée à elle, celle de la nouvelle est rechargée. */
    private fun followList() {
        val id = engine.list?.id
        if (id == draftListId) return
        if (draftListId != "\u0000") persistDraft()
        demo.selection.clear(); draftListId = id; loadSelection(id)
    }

    private fun persistDraft() {
        val sel = demo.selection.toMap().filterKeys { demo.byId[it] != null }
        val m = sel.mapValues { (pid, q) -> toServer(demo.byId[pid]!!.serverUnit, q) }
        engine.saveDraft(draftListId.takeIf { it != "\u0000" }, m, sel.keys.associateWith { demo.byId[it]!!.serverUnit })
    }

    fun resumeOrphans() {
        val orphans = engine.takeOrphans()
        var n = 0
        val changed = ArrayList<String>()
        orphans.forEach { o ->
            val p = demo.byId[o.productId]
            if (p != null && p.inCatalog && o.unit != null && o.unit != p.serverUnit) changed += p.name // jamais converti d'une unité à l'autre
            else if (p != null && p.inCatalog) { demo.selection[o.productId] = toBase(p.serverUnit, o.quantity); n++ }
        }
        demo.orphanCount = 0
        val note = if (changed.isEmpty()) "" else " Unité modifiée, quantité à choisir de nouveau : ${changed.joinToString(", ")}."
        demo.say((if (n > 0) "$n article${if (n > 1) "s" else ""} repris dans votre sélection." else if (changed.isEmpty()) "Ces articles ne sont plus au catalogue." else "") + note)
    }

    fun dismissOrphans() { engine.takeOrphans(); demo.orphanCount = 0 }

    fun setSelMode(m: SelMode) { demo.selMode = m; kv.put(modeKey, m.name) }
    fun setSelOrg(o: SelOrg) { demo.selOrg = o; kv.put(orgKey, o.name) }

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
        android.util.Log.i("CoursesNotif", "application en arrière-plan : flux en direct fermé")
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
            "list.updated", "list.closed", "list.created", "list.deleted" -> { if (demo.multiLists) loadOpenLists(); flushAndRefresh() }
            "catalog.updated" -> refreshCatalog()
            "prefs.updated" -> session.verify()
            "budget.updated" -> if (demo.budget != null) loadBudget()
        }
    }

    /* ───── Synchronisation ───── */

    suspend fun refreshAll() { refreshCatalog(); if (demo.multiLists) loadOpenLists(); flushAndRefresh() }

    suspend fun refreshCatalog() {
        when (val r = session.api.call("GET", "/api/catalog")) {
            is Outcome.Ok -> {
                val c = parseCatalog(r.value) ?: return
                catalog = c.products; catalogRevLoaded = c.rev
                if (c.categories.isNotEmpty()) demo.categoryList = c.categories
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
        // Les demandes déjà vues À L'ÉCRAN (application au premier plan) ne donnent pas de notification plus tard.
        if (started) engine.list?.let { l ->
            kv.put(Notifier.seenKey(scopeKey), l.validations.joinToString(",") { it.id })
            android.util.Log.i("CoursesNotif", "repère mis à jour au premier plan : ${l.validations.size} demande(s) vue(s)")
        }
    }

    /* ───── Produits créés par la famille ───── */

    /** Références proches (catalogue commun) pour une recherche : jamais bloquant, vide hors connexion. */
    suspend fun suggest(q: String): List<Suggestion> {
        val r = session.api.call("GET", "/api/catalog/suggest?q=" + java.net.URLEncoder.encode(q.trim(), "UTF-8"))
        if (r !is Outcome.Ok) return emptyList()
        val labels = demo.categoryList.toMap()
        return try {
            r.value["results"]!!.let { it as kotlinx.serialization.json.JsonArray }.map { e ->
                val o = e as JsonObject
                fun str(k: String) = (o[k] as? kotlinx.serialization.json.JsonPrimitive)?.let { if (it.isString) it.content else null }
                Suggestion(str("origin") ?: "", str("key") ?: "", str("name") ?: "", str("category")?.let { labels[it] } ?: "", str("photoUrl"), str("status") ?: "absent", str("productId"))
            }
        } catch (_: Exception) { emptyList() }
    }

    /**
     * Crée un produit pour la famille (ou prend la référence commune choisie / de même nom), puis recharge le catalogue.
     * Renvoie l'identifiant du produit, ou un message d'erreur (la saisie reste dans le formulaire).
     */
    suspend fun createProduct(name: String?, category: String?, unit: String?, ref: Suggestion?): Pair<String?, String?> {
        val body = buildJsonObject {
            if (ref != null) put("ref", buildJsonObject { put("origin", ref.origin); put("key", ref.key) })
            else { put("name", name!!.trim()); if (category != null) put("category", category); if (unit != null) put("unit", unit) }
        }
        return when (val r = session.api.call("POST", "/api/products/family", body)) {
            is Outcome.Ok -> {
                val id = ((r.value["product"] as? JsonObject)?.get("id") as? kotlinx.serialization.json.JsonPrimitive)?.content
                refreshCatalog()
                id to null
            }
            is Outcome.Fail -> null to when {
                r.code == "product_hidden" -> "Ce produit a été retiré du catalogue par un administrateur de la famille."
                r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT -> "Pas de réseau : le produit n'est pas créé. Réessayez quand la connexion est revenue."
                else -> explain(r)
            }
        }
    }

    /** Proposition volontaire au catalogue commun : seuls le nom, la catégorie, l'unité et la description partent. */
    suspend fun propose(productId: String, description: String): String? =
        when (val r = session.api.call("POST", "/api/products/$productId/propose", buildJsonObject { if (description.isNotBlank()) put("description", description.trim()) })) {
            is Outcome.Ok -> null
            is Outcome.Fail -> when {
                r.code == "already_common" -> "Ce produit fait déjà partie du catalogue commun."
                r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT -> "Pas de réseau : la proposition n'est pas envoyée."
                else -> explain(r)
            }
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
        val sq = toServer(line.unit, q) // la quantité d'une ligne se modifie toujours dans l'unité de la ligne
        if (sq != line.quantity) {
            engine.enqueue(listOf(engine.op("set_qty", productId = pid, quantity = sq, baseRev = if (line.itemId != null) line.rev else 1, name = p.name, unit = line.unit)))
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

    /**
     * Personnel : enregistre les modifications de « Choisir mes articles » SANS quitter l'écran. La quantité choisie remplace la quantité
     * enregistrée (pas de cumul, pas de doublon) ; 0 = retirer. Hors connexion : file « Envoi en attente ». Refus : la sélection est rendue.
     */
    fun submitStaffSelection(after: (() -> Unit)? = null) {
        val entries = demo.selection.toMap()
        val lines = engine.effective()
        val ops = entries.flatMap { (pid, q) ->
            val p = demo.byId[pid] ?: return@flatMap emptyList()
            val cur = lines.firstOrNull { it.productId == pid }
            val sq = toServer(p.serverUnit, q.coerceAtLeast(0)).coerceIn(0.0, 999.0)
            when {
                q <= 0 -> listOfNotNull(if (cur != null && !cur.bought) engine.op("remove", productId = pid, baseRev = if (cur.itemId != null) cur.rev else 1, name = p.name) else null)
                !p.inCatalog -> emptyList()
                cur == null -> listOf(engine.op("add", productId = pid, quantity = sq, name = p.name, unit = p.serverUnit, category = p.category, photoUrl = p.photoUrl))
                cur.bought -> listOf(engine.op("request_again", productId = pid, quantity = sq, name = p.name, unit = p.serverUnit, category = p.category, photoUrl = p.photoUrl))
                // Ligne enregistrée dans une autre unité (unité du produit changée depuis) : la quantité choisie, dans la nouvelle unité,
                // remplace la ligne explicitement (retrait puis ajout) ; elle n'est jamais additionnée ni réinterprétée.
                cur.unit != p.serverUnit -> listOf(
                    engine.op("remove", productId = pid, baseRev = if (cur.itemId != null) cur.rev else 1, name = p.name),
                    engine.op("add", productId = pid, quantity = sq, name = p.name, unit = p.serverUnit, category = p.category, photoUrl = p.photoUrl),
                )
                cur.quantity == sq -> emptyList()
                else -> listOf(engine.op("set_qty", productId = pid, quantity = sq, baseRev = if (cur.itemId != null) cur.rev else 1, name = p.name, unit = p.serverUnit))
            }
        }
        if (ops.isEmpty()) { demo.selection.clear(); render(); after?.invoke(); return }
        engine.enqueue(ops)
        demo.selection.clear()
        render()
        after?.invoke()
        scope.launch {
            val rep = engine.flush()
            if (!rep.networkDown) engine.refresh()
            render()
            when {
                rep.networkDown -> demo.say("Envoi en attente : la sélection partira au retour du réseau.")
                rep.messages.isNotEmpty() -> {
                    // Ce qui n'a pas été appliqué revient dans la sélection : rien n'est perdu, « Terminer » permet de réessayer.
                    entries.forEach { (pid, q) -> val now = demo.savedQty(pid); if (if (q <= 0) now != null else now != q) demo.selection[pid] = q }
                    demo.say("Sélection non enregistrée : ${rep.messages.joinToString(" ")} Réessayez.")
                }
                else -> demo.say(if (me.role == "staff") "Sélection enregistrée" else "Liste mise à jour.")
            }
            syncDraft()
        }
    }

    /** Ajoute des produits à la liste (sélection, favori ou « Recommander ») : [entries] = produit → quantité (unités de l'application). */
    fun submit(entries: Map<String, Int>, clearSelection: Boolean, after: () -> Unit = {}, note: String = "") {
        val lines = engine.effective()
        val otherUnit = ArrayList<String>()
        val ops = entries.mapNotNull { (pid, q) ->
            val p = demo.byId[pid] ?: return@mapNotNull null
            if (!p.inCatalog) return@mapNotNull null
            val sq = toServer(p.serverUnit, q).coerceIn(0.001, 999.0)
            val cur = lines.firstOrNull { it.productId == pid }
            when {
                cur == null -> engine.op("add", productId = pid, quantity = sq, name = p.name, unit = p.serverUnit, category = p.category, photoUrl = p.photoUrl)
                cur.bought -> engine.op("request_again", productId = pid, quantity = sq, name = p.name, unit = p.serverUnit, category = p.category, photoUrl = p.photoUrl)
                cur.unit != p.serverUnit -> { otherUnit += p.name; null } // jamais d'addition entre deux unités
                else -> engine.op("set_qty", productId = pid, quantity = (cur.quantity + sq).coerceAtMost(999.0), baseRev = if (cur.itemId != null) cur.rev else 1, name = p.name, unit = p.serverUnit)
            }
        }
        val otherNote = (if (otherUnit.isEmpty()) "" else " Déjà dans la liste dans une autre unité, non modifié : ${otherUnit.joinToString(", ")} (modifiez la ligne existante).") + note
        if (ops.isEmpty()) { demo.say(if (otherUnit.isEmpty()) "Aucun article à ajouter." else otherNote.trim()); return }
        engine.enqueue(ops)
        if (clearSelection) demo.selection.clear()
        render(); after()
        scope.launch {
            val before = engine.pendingOps
            val rep = engine.flush()
            if (rep.networkDown) demo.say("Envoi en attente : $before modification${if (before > 1) "s" else ""} partiront au retour du réseau.")
            else if (rep.messages.isNotEmpty()) demo.say(rep.messages.joinToString(" "))
            else demo.say((if (me.role == "staff") "Demande envoyée." else "Articles ajoutés à la liste.") + otherNote)
            if (!rep.networkDown) engine.refresh()
            render(); syncDraft()
        }
    }

    /**
     * « Recommander » vers une liste en cours qui contient déjà des articles (règle prévue : Ajouter à la liste actuelle / Remplacer son
     * contenu). Ajouter : pas de doublon, quantités additionnées seulement pour une même unité. Remplacer : les articles non achetés prennent
     * les quantités de la commande, ceux qui n'y sont pas sont retirés. Les articles déjà achetés et la commande d'origine ne changent jamais.
     */
    fun reorderInto(entries: Map<String, Int>, replace: Boolean, after: () -> Unit = {}) {
        val lines = engine.effective()
        var otherUnit = 0
        val ops = ArrayList<app.smartcourse.courses.nativeproto.net.Op>()
        entries.forEach { (pid, q) ->
            val p = demo.byId[pid] ?: return@forEach
            if (!p.inCatalog) return@forEach
            val sq = toServer(p.serverUnit, q).coerceIn(0.001, 999.0)
            val cur = lines.firstOrNull { it.productId == pid }
            when {
                cur == null -> ops += engine.op("add", productId = pid, quantity = sq, name = p.name, unit = p.serverUnit, category = p.category, photoUrl = p.photoUrl)
                cur.bought -> ops += engine.op("request_again", productId = pid, quantity = sq, name = p.name, unit = p.serverUnit, category = p.category, photoUrl = p.photoUrl)
                cur.unit != p.serverUnit -> otherUnit++
                replace -> if (cur.quantity != sq) ops += engine.op("set_qty", productId = pid, quantity = sq, baseRev = if (cur.itemId != null) cur.rev else 1, name = p.name, unit = p.serverUnit)
                else -> ops += engine.op("set_qty", productId = pid, quantity = (cur.quantity + sq).coerceAtMost(999.0), baseRev = if (cur.itemId != null) cur.rev else 1, name = p.name, unit = p.serverUnit)
            }
        }
        if (replace) lines.filter { !it.bought && it.productId !in entries }.forEach { l ->
            ops += engine.op("remove", productId = l.productId, baseRev = if (l.itemId != null) l.rev else 1, name = l.name)
        }
        if (ops.isEmpty()) { demo.say("La liste en cours contient déjà ces articles."); after(); return }
        engine.enqueue(ops)
        render(); after()
        scope.launch {
            val rep = engine.flush()
            if (rep.networkDown) demo.say("Envoi en attente : la commande sera reprise au retour du réseau.")
            else if (rep.messages.isNotEmpty()) demo.say(rep.messages.joinToString(" "))
            else demo.say((if (replace) "Liste remplacée par la commande." else "Commande ajoutée à la liste en cours.") +
                if (otherUnit > 0) " $otherUnit article(s) déjà présent(s) dans une autre unité n'ont pas été modifiés." else "")
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
