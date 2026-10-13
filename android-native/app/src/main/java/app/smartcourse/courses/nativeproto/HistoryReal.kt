@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Outcome
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private data class Past(val id: String, val closedAt: String, val by: String, val purchased: Int, val remaining: Int, val thumbs: List<String?>)
private data class PastLine(val productId: String, val name: String, val photoUrl: String?, val qty: Double, val unit: String)

@Composable
fun HistoryScreen(nav: (String) -> Unit) {
    if (LocalDemo.current.data == null) HistoryScreenSim(nav) else HistoryReal(nav)
}

@Composable
fun HistoryDetailScreen(id: String, nav: (String) -> Unit, onBack: () -> Unit) {
    if (LocalDemo.current.data == null) HistoryDetailScreenSim(id, nav, onBack) else HistoryDetailReal(id, nav, onBack)
}

private fun parsePast(o: JsonObject) = Past(
    o["id"]!!.jsonPrimitive.content, o["closedAt"]!!.jsonPrimitive.content,
    (o["closedBy"] as? JsonObject)?.get("displayName")?.jsonPrimitive?.contentOrNull ?: "",
    o["purchased"]?.jsonPrimitive?.intOrNull ?: 0, o["remaining"]?.jsonPrimitive?.intOrNull ?: 0,
    o["thumbs"]?.jsonArray?.map { it.jsonObject["photoUrl"]?.jsonPrimitive?.contentOrNull } ?: emptyList(),
)

/** Recommander : remet dans la liste en cours les articles achetés, sans rien supprimer ni modifier d'ancien. */
private fun reorder(demo: Demo, lines: List<PastLine>, nav: (String) -> Unit) {
    val data = demo.data ?: return
    val usable = lines.filter { demo.byId[it.productId]?.inCatalog == true }
    if (usable.isEmpty()) { demo.say("Aucun de ces articles n'est dans votre catalogue actuel."); return }
    data.submit(usable.associate { it.productId to toBase(it.unit, it.qty) }, clearSelection = false)
    if (usable.size < lines.size) demo.say("${lines.size - usable.size} article(s) retiré(s) du catalogue n'ont pas été recommandés.")
    nav("v02")
}

private suspend fun loadLines(demo: Demo, id: String): Outcome<List<PastLine>> {
    val data = demo.data ?: return Outcome.Fail(app.smartcourse.courses.nativeproto.net.Failure.UNKNOWN)
    return when (val r = data.session.api.call("GET", "/api/lists/$id")) {
        is Outcome.Ok -> Outcome.Ok(r.value["list"]!!.jsonObject["items"]!!.jsonArray.map { it.jsonObject }.filter { it["status"]?.jsonPrimitive?.contentOrNull == "purchased" }.map { x ->
            PastLine(x["productId"]!!.jsonPrimitive.content, x["name"]!!.jsonPrimitive.content, x["photoUrl"]?.jsonPrimitive?.contentOrNull,
                x["quantity"]?.jsonPrimitive?.doubleOrNull ?: 1.0, x["unit"]?.jsonPrimitive?.contentOrNull ?: "piece")
        })
        is Outcome.Fail -> r
    }
}

@Composable
private fun HistoryReal(nav: (String) -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data!!
    val admin = data.me.role == "admin"
    val scope = rememberCoroutineScope()
    var orders by remember { mutableStateOf<List<Past>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var more by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<String?>(null) }
    var deleteFor by remember { mutableStateOf<Past?>(null) }

    fun load(before: String? = null) {
        scope.launch {
            when (val r = data.session.api.call("GET", "/api/lists?limit=30" + (before?.let { "&before=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""))) {
                is Outcome.Ok -> {
                    val page = r.value["lists"]!!.jsonArray.map { parsePast(it.jsonObject) }
                    orders = (if (before == null) emptyList() else orders ?: emptyList()) + page
                    more = page.size == 30; error = null
                }
                is Outcome.Fail -> error = if (r.failure == app.smartcourse.courses.nativeproto.net.Failure.FORBIDDEN) "Votre profil n'a pas accès à l'historique." else "Historique indisponible hors connexion."
            }
        }
    }
    LaunchedEffect(Unit) { load() }

    Column(Modifier.fillMaxSize()) {
        TopBar("Historique", orders?.let { "${it.size} commande${if (it.size > 1) "s" else ""} terminée${if (it.size > 1) "s" else ""}" })
        error?.let {
            Column(Modifier.weight(1f).fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = C.Muted)
                Spacer(Modifier.height(12.dp))
                SecondaryButton("Réessayer", { load() })
            }
        }
        if (orders?.isEmpty() == true) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Text("Aucune commande terminée.", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
        }
        if (error == null) LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(orders ?: emptyList(), key = { it.id }) { o ->
                val date = frenchDate(o.closedAt)
                SCard(onClick = { nav("v06d/${o.id}") }, padding = PaddingValues(start = 14.dp, top = 10.dp, bottom = 12.dp, end = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(date, style = MaterialTheme.typography.titleMedium)
                            Text("${o.purchased} article${if (o.purchased > 1) "s" else ""} acheté${if (o.purchased > 1) "s" else ""}" + (if (o.remaining > 0) " · ${o.remaining} non acheté${if (o.remaining > 1) "s" else ""}" else "") + (if (o.by.isNotEmpty()) " · ${o.by}" else ""),
                                style = MaterialTheme.typography.bodySmall, maxLines = 2)
                        }
                        Box {
                            IconButton({ menuFor = o.id }) { Icon(Icons.Rounded.MoreVert, "Actions de la commande du $date", tint = C.Ink) }
                            OrderMenu(menuFor == o.id, { menuFor = null }, {
                                scope.launch { when (val r = loadLines(demo, o.id)) { is Outcome.Ok -> reorder(demo, r.value, nav); is Outcome.Fail -> demo.say("Impossible de lire cette commande sans réseau.") } }
                            }, { deleteFor = o }, canDelete = admin)
                        }
                    }
                    Row(Modifier.padding(top = 4.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Row(horizontalArrangement = Arrangement.spacedBy((-10).dp), modifier = Modifier.weight(1f)) {
                            o.thumbs.take(4).forEach { RemotePhoto(it, 36.dp, 18.dp, Modifier.border(2.dp, Color.White, CircleShape)) }
                            if (o.purchased > 4) Box(Modifier.size(36.dp).clip(CircleShape).background(Color(0xFFE4EDF5)).border(2.dp, Color.White, CircleShape), contentAlignment = Alignment.Center) {
                                Text("+${o.purchased - 4}", style = MaterialTheme.typography.labelSmall, color = C.Muted)
                            }
                        }
                        RowAction("Recommander", {
                            scope.launch { when (val r = loadLines(demo, o.id)) { is Outcome.Ok -> reorder(demo, r.value, nav); is Outcome.Fail -> demo.say("Impossible de lire cette commande sans réseau.") } }
                        }, false)
                    }
                }
            }
            if (more) item { SecondaryButton("Afficher les commandes plus anciennes", { load(orders?.lastOrNull()?.closedAt) }, Modifier.fillMaxWidth()) }
        }
    }
    deleteFor?.let { o ->
        ConfirmDialog(
            "Supprimer cette commande ?", "La commande du ${frenchDate(o.closedAt)} sera retirée de l'historique. Les statistiques seront recalculées.",
            "Supprimer", {
                deleteFor = null
                scope.launch {
                    when (val r = data.session.api.call("DELETE", "/api/lists/${o.id}")) {
                        is Outcome.Ok -> { orders = orders?.filter { it.id != o.id }; demo.say("Commande supprimée.") }
                        is Outcome.Fail -> demo.say(explain(r))
                    }
                }
            }, { deleteFor = null }, danger = true,
        )
    }
}

@Composable
private fun HistoryDetailReal(id: String, nav: (String) -> Unit, onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data!!
    val admin = data.me.role == "admin"
    val scope = rememberCoroutineScope()
    var lines by remember { mutableStateOf<List<PastLine>?>(null) }
    var title by remember { mutableStateOf("Commande") }
    var error by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    LaunchedEffect(id) {
        when (val r = data.session.api.call("GET", "/api/lists/$id")) {
            is Outcome.Ok -> {
                val l = r.value["list"]!!.jsonObject
                title = frenchDate(l["closedAt"]?.jsonPrimitive?.contentOrNull ?: l["createdAt"]?.jsonPrimitive?.contentOrNull)
                lines = l["items"]!!.jsonArray.map { it.jsonObject }.filter { it["status"]?.jsonPrimitive?.contentOrNull == "purchased" }.map { x ->
                    PastLine(x["productId"]!!.jsonPrimitive.content, x["name"]!!.jsonPrimitive.content, x["photoUrl"]?.jsonPrimitive?.contentOrNull, x["quantity"]?.jsonPrimitive?.doubleOrNull ?: 1.0, x["unit"]?.jsonPrimitive?.contentOrNull ?: "piece")
                }
            }
            is Outcome.Fail -> error = "Commande indisponible hors connexion."
        }
    }
    Column(Modifier.fillMaxSize()) {
        TopBar(title, lines?.let { "${it.size} article${if (it.size > 1) "s" else ""} acheté${if (it.size > 1) "s" else ""}" }, onBack = onBack, actions = {
            Box {
                IconButton({ menu = true }) { Icon(Icons.Rounded.MoreVert, "Actions de la commande", tint = C.Ink) }
                OrderMenu(menu, { menu = false }, { lines?.let { reorder(demo, it, nav) } }, { confirm = true }, canDelete = admin)
            }
        })
        error?.let { Text(it, color = C.Muted, modifier = Modifier.padding(24.dp)) }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 12.dp)) {
            item {
                SCard {
                    lines?.forEachIndexed { i, l ->
                        if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(start = 66.dp))
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            RemotePhoto(l.photoUrl, 44.dp, 10.dp)
                            Text(l.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            val kind = unitKindOf(l.unit)
                            Text(
                                qtyText(Product(l.productId, l.name, 0, "", kind, countLabelOf(l.unit), null, true), toBase(l.unit, l.qty)),
                                style = MaterialTheme.typography.bodyMedium, color = C.Muted, maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
        Column(Modifier.fillMaxWidth().background(Color.White).navigationBarsPadding().padding(16.dp, 10.dp)) {
            PrimaryButton("Recommander", { lines?.let { reorder(demo, it, nav) } }, Modifier.fillMaxWidth(), leading = Icons.Rounded.Replay, enabled = lines?.isNotEmpty() == true)
        }
    }
    if (confirm) ConfirmDialog(
        "Supprimer cette commande ?", "La commande du $title sera retirée de l'historique. Les statistiques seront recalculées.",
        "Supprimer", {
            confirm = false
            scope.launch {
                when (val r = data.session.api.call("DELETE", "/api/lists/$id")) {
                    is Outcome.Ok -> { demo.say("Commande supprimée."); onBack() }
                    is Outcome.Fail -> demo.say(explain(r))
                }
            }
        }, { confirm = false }, danger = true,
    )
}
