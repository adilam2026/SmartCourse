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
    var query by remember { mutableStateOf("") }
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
            is Outcome.Fail -> error = explain(r)
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

    Column(Modifier.fillMaxSize()) {
        TopBar("Catalogue", onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SearchBox(query, { query = it }, "Rechercher un produit…")
            val c = counts
            SegTabs(listOf("Tous (${c?.all ?: "…"})", "Dans mon catalogue (${c?.active ?: "…"})", "À ajouter (${c?.todo ?: "…"})"), tab, { tab = it })
            KeyedCategoryPicker(category, cats, { category = it })
        }
        Spacer(Modifier.height(8.dp))
        if (error != null && items.isEmpty()) {
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
                        RowAction(if (e.status == "active") "Retirer" else "Ajouter", { toggle(e) }, e.status != "active")
                    }
                }
            }
            if (loadingMore) item { Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = C.Teal, modifier = Modifier.size(24.dp)) } }
        }
    }
}

/** Sélecteur de catégorie (libellés affichés, clés envoyées au serveur). */
@Composable
private fun KeyedCategoryPicker(selectedKey: String?, categories: List<CatCategory>, onSelect: (String?) -> Unit) {
    CategoryPicker(categories.firstOrNull { it.key == selectedKey }?.label, categories.map { it.label }, { label -> onSelect(categories.firstOrNull { it.label == label }?.key) })
}
