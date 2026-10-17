@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.CatCategory
import app.smartcourse.courses.nativeproto.net.CatalogCounts
import app.smartcourse.courses.nativeproto.net.CatalogEntry
import app.smartcourse.courses.nativeproto.net.CatalogRepo
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.Session
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Catalogue réel : « Dans mon catalogue » (articles actifs), « À ajouter » (retirés ou absents), compteurs réels, recherche et catégories. */
@Composable
fun CatalogScreenReal(session: Session, onBack: () -> Unit) {
    val demo = LocalDemo.current
    val repo = remember { CatalogRepo(session.api) }
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) }
    // Recherche transmise depuis « Ajouter des articles » (et retour vers la sélection après choix).
    val fromSelection = remember { demo.catalogFromSelection.also { demo.catalogFromSelection = false } }
    var query by remember { mutableStateOf(demo.catalogQuery.also { demo.catalogQuery = null } ?: "") }
    var category by remember { mutableStateOf<String?>(null) }
    var cats by remember { mutableStateOf<List<CatCategory>>(emptyList()) }
    val items = remember { mutableStateListOf<CatalogEntry>() }
    var counts by remember { mutableStateOf<CatalogCounts?>(null) }
    var total by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyKey by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    // Vérification dans TOUT le catalogue (actifs, masqués, disponibles), indépendante de l'onglet et de la catégorie.
    // « Créer un nouveau produit » n'est proposé que si cette vérification a ABOUTI sans aucun résultat pour la recherche affichée.
    var globalFor by remember { mutableStateOf<String?>(null) }
    var globalItems by remember { mutableStateOf<List<CatalogEntry>>(emptyList()) }
    var globalState by remember { mutableStateOf("idle") } // idle | loading | ok | error
    var globalError by remember { mutableStateOf<String?>(null) }
    var globalRetry by remember { mutableIntStateOf(0) }
    var creating by remember { mutableStateOf<String?>(null) }
    var created by remember { mutableStateOf<String?>(null) }
    var proposeFor by remember { mutableStateOf<String?>(null) }

    suspend fun fetch(reset: Boolean) {
        val status = when (tab) { 1 -> "active"; 2 -> "todo"; else -> null }
        val offset = if (reset) 0 else items.size
        when (val r = repo.page(status, category, query, offset, 30, withCounts = reset, presentFirst = tab == 0)) {
            is Outcome.Ok -> {
                if (reset) items.clear()
                items.addAll(r.value.items)
                total = r.value.total
                r.value.counts?.let { counts = it }
                error = null
            }
            // Échec d'une NOUVELLE recherche : ne jamais laisser affichés les résultats d'une recherche précédente.
            is Outcome.Fail -> { if (reset) { items.clear(); total = 0 }; error = explain(r) }
        }
        loading = false
        loadingMore = false
    }

    LaunchedEffect(Unit) { (repo.categories() as? Outcome.Ok)?.let { cats = it.value } }
    LaunchedEffect(tab, category, query) {
        loading = true
        if (query.isNotEmpty()) delay(300)
        fetch(true)
    }
    LaunchedEffect(query, globalRetry) {
        val q = query.trim()
        if (q.isEmpty()) { globalState = "idle"; globalFor = null; globalItems = emptyList(); return@LaunchedEffect }
        globalState = "loading"; globalFor = null
        delay(300)
        when (val r = repo.page(null, null, q, 0, 20)) {
            is Outcome.Ok -> { globalItems = r.value.items; globalFor = q; globalState = "ok" }
            is Outcome.Fail -> { globalError = explain(r); globalState = "error" }
        }
    }
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last ->
            if (!loading && !loadingMore && items.isNotEmpty() && items.size < total && last >= items.size - 5) { loadingMore = true; fetch(false) }
        }
    }

    fun keyOf(e: CatalogEntry) = "${e.origin}:${e.key}"
    fun replace(e: CatalogEntry, status: String, productId: String?) {
        val i = items.indexOfFirst { keyOf(it) == keyOf(e) }
        if (i < 0) return
        val gone = (tab == 1 && status != "active") || (tab == 2 && status == "active")
        if (gone) { items.removeAt(i); total -= 1 } else items[i] = e.copy(status = status, productId = productId ?: e.productId)
    }
    fun adjust(from: String, to: String) {
        counts = counts?.let { c ->
            fun d(s: String) = if (s == "active") c.copy(active = c.active - 1) else if (s == "inactive") c.copy(inactive = c.inactive - 1) else c.copy(absent = c.absent - 1)
            val a = d(from)
            when (to) { "active" -> a.copy(active = a.active + 1); "inactive" -> a.copy(inactive = a.inactive + 1); else -> a.copy(absent = a.absent + 1) }
        }
    }

    fun toggle(e: CatalogEntry) {
        if (busyKey != null) return
        scope.launch {
            busyKey = keyOf(e)
            when (e.status) {
                "active" -> when (val r = repo.setActive(e.productId!!, false)) {
                    is Outcome.Ok -> {
                        val pid = e.productId
                        replace(e, "inactive", null); adjust("active", "inactive")
                        demo.say("« ${e.name} » retiré de votre catalogue.", "Annuler") { scope.launch { repo.setActive(pid, true); loading = true; fetch(true) } }
                    }
                    is Outcome.Fail -> demo.say(explain(r))
                }
                "inactive" -> when (val r = repo.setActive(e.productId!!, true)) {
                    is Outcome.Ok -> {
                        val pid = e.productId
                        replace(e, "active", null); adjust("inactive", "active")
                        demo.say("« ${e.name} » remis dans votre catalogue.", "Annuler") { scope.launch { repo.setActive(pid, false); loading = true; fetch(true) } }
                    }
                    is Outcome.Fail -> demo.say(explain(r))
                }
                else -> when (val r = repo.addFromCatalog(e.origin, e.key)) {
                    is Outcome.Ok -> {
                        replace(e, "active", r.value); adjust("absent", "active")
                        demo.say("« ${e.name} » ajouté à votre catalogue.", "Annuler") { scope.launch { repo.setActive(r.value, false); loading = true; fetch(true) } }
                    }
                    is Outcome.Fail -> demo.say(explain(r))
                }
            }
            busyKey = null
        }
    }

    /** Résultat trouvé dans tout le catalogue : l'utiliser (actif), le réactiver (masqué) ou l'ajouter (disponible). */
    fun useGlobal(e: CatalogEntry) {
        if (busyKey != null) return
        scope.launch {
            busyKey = keyOf(e)
            val pid: String? = when (e.status) {
                "active" -> e.productId
                "inactive" -> when (val r = repo.setActive(e.productId!!, true)) { is Outcome.Ok -> e.productId; is Outcome.Fail -> { demo.say(explain(r)); null } }
                else -> when (val r = repo.addFromCatalog(e.origin, e.key)) { is Outcome.Ok -> r.value; is Outcome.Fail -> { demo.say(explain(r)); null } }
            }
            busyKey = null
            if (pid == null) return@launch
            if (fromSelection) {
                demo.data?.refreshCatalog()
                demo.byId[pid]?.let { p -> if (demo.selQty(pid) == null) demo.setSel(pid, defaultQty(p)) }
                demo.say("« ${e.name} » ajouté à votre sélection.")
                onBack()
            } else {
                demo.say(if (e.status == "inactive") "« ${e.name} » remis dans votre catalogue." else if (e.status == "active") "« ${e.name} » est déjà dans votre catalogue." else "« ${e.name} » ajouté à votre catalogue.")
                globalRetry++; loading = true; fetch(true)
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Catalogue", onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SearchBox(query, { query = it }, "Rechercher un produit…")
            val c = counts
            SegTabs(listOf("Tous (${c?.all ?: "…"})", "Dans mon catalogue (${c?.active ?: "…"})", "À ajouter (${c?.todo ?: "…"})"), tab, { tab = it })
            KeyedCategoryPicker(category, cats, { category = it })
        }
        Spacer(Modifier.height(8.dp))
        created?.let { id -> demo.byId[id]?.let { p -> CreatedBanner(p.name, { proposeFor = id; created = null }, { created = null }, Modifier.padding(horizontal = 12.dp, vertical = 4.dp), inSelection = fromSelection) } }
        if (query.isNotBlank() && items.isEmpty() && (!loading || error != null)) {
            GlobalCheckPanel(query.trim(), globalState, globalFor, globalItems, globalError, fromSelection, busyKey, ::keyOf, { useGlobal(it) }, { globalRetry++ }, { creating = query.trim() }, Modifier.weight(1f))
        } else if (error != null && items.isEmpty()) {
            Column(Modifier.weight(1f).fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(error!!, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(16.dp))
                SecondaryButton("Réessayer", { scope.launch { loading = true; fetch(true) } })
            }
        } else if (!loading && items.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Aucun produit.", color = C.Muted) }
        } else LazyColumn(Modifier.weight(1f), state = listState, contentPadding = PaddingValues(16.dp, 0.dp, 16.dp, 16.dp)) {
            itemsIndexed(items, key = { _, e -> keyOf(e) }) { i, e ->
                val shape = RoundedCornerShape(topStart = if (i == 0) 18.dp else 0.dp, topEnd = if (i == 0) 18.dp else 0.dp,
                    bottomStart = if (i == items.size - 1 && items.size >= total) 18.dp else 0.dp, bottomEnd = if (i == items.size - 1 && items.size >= total) 18.dp else 0.dp)
                Column(Modifier.fillMaxWidth().clip(shape).background(C.Card)) {
                    if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(start = 70.dp))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        RemotePhoto(e.photoUrl, 46.dp)
                        Column(Modifier.weight(1f)) {
                            Text(e.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                Box(Modifier.size(7.dp).clip(CircleShape).background(if (e.status == "active") C.Teal else Color(0xFFB9C7D4)))
                                Text(when (e.status) { "active" -> "Dans mon catalogue"; "inactive" -> "Retiré"; else -> "Disponible" }, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                            }
                        }
                        RowAction(when (e.status) { "active" -> "Retirer"; "inactive" -> "Réactiver"; else -> "Ajouter" }, { toggle(e) }, e.status != "active")
                    }
                }
            }
            if (loadingMore) item { Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = C.Teal, modifier = Modifier.size(24.dp)) } }
        }
    }
    creating?.let { n ->
        NewProductSheet(n, onDismiss = { creating = null }, onCreated = { id -> creating = null; created = id; globalRetry++; scope.launch { loading = true; fetch(true) } }, addToSelection = fromSelection)
    }
    proposeFor?.let { id -> demo.byId[id]?.let { p -> ProposeSheet(p) { proposeFor = null } } ?: run { proposeFor = null } }
}

/**
 * Recherche sans résultat dans l'onglet ou la catégorie affichés : vérification dans tout le catalogue.
 * Pendant la vérification, ou si elle échoue (hors connexion, erreur), aucune création n'est proposée.
 */
@Composable
private fun GlobalCheckPanel(
    q: String, state: String, checkedFor: String?, found: List<CatalogEntry>, error: String?, fromSelection: Boolean, busyKey: String?,
    keyOf: (CatalogEntry) -> String, onUse: (CatalogEntry) -> Unit, onRetry: () -> Unit, onCreate: () -> Unit, modifier: Modifier,
) {
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when {
            state == "error" -> item("err") {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    NoteCard("Impossible de vérifier le catalogue complet${error?.let { " ($it)" } ?: ""}. Le produit existe peut-être déjà : la création reste indisponible tant que la vérification n'a pas abouti. Réessayez une fois la connexion revenue.")
                    SecondaryButton("Réessayer", onRetry, Modifier.fillMaxWidth())
                }
            }
            state != "ok" || checkedFor != q -> item("wait") {
                Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(color = C.Teal, modifier = Modifier.size(22.dp)); Spacer(Modifier.width(10.dp))
                    Text("Vérification dans tout le catalogue…", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
                }
            }
            found.isNotEmpty() -> {
                item("h") { Text("Trouvé dans tout le catalogue", style = MaterialTheme.typography.titleMedium) }
                items(found.size, key = { "g-" + keyOf(found[it]) }) { i ->
                    val e = found[i]
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.Card).padding(horizontal = 12.dp, vertical = 8.dp).heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        RemotePhoto(e.photoUrl, 46.dp)
                        Column(Modifier.weight(1f)) {
                            Text(e.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(when (e.status) { "active" -> "Déjà dans mon catalogue"; "inactive" -> "Masqué (retiré du catalogue)"; else -> "Disponible, pas encore dans mon catalogue" }, style = MaterialTheme.typography.bodySmall)
                        }
                        val label = when (e.status) { "active" -> if (fromSelection) "Choisir" else null; "inactive" -> "Réactiver"; else -> "Ajouter" }
                        if (label != null) RowAction(if (busyKey == keyOf(e)) "…" else label, { onUse(e) }, true)
                    }
                }
            }
            else -> item("none") {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Aucune référence ne correspond à « $q » dans tout le catalogue (produits actifs, masqués et disponibles).", style = MaterialTheme.typography.bodyMedium)
                    PrimaryButton("Créer un nouveau produit", onCreate, Modifier.fillMaxWidth())
                }
            }
        }
    }
}

/** Sélecteur de catégorie (libellés affichés, clés envoyées au serveur). */
@Composable
private fun KeyedCategoryPicker(selectedKey: String?, categories: List<CatCategory>, onSelect: (String?) -> Unit) {
    CategoryPicker(categories.firstOrNull { it.key == selectedKey }?.label, categories.map { it.label }, { label -> onSelect(categories.firstOrNull { it.label == label }?.key) })
}
