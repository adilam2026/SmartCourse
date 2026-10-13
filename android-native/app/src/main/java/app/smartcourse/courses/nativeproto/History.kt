@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Menu « … » d'une commande : Recommander et Supprimer, visibles et explicites. */
@Composable
private fun OrderMenu(expanded: Boolean, onDismiss: () -> Unit, onReorder: () -> Unit, onDelete: () -> Unit) {
    DropdownMenu(expanded, onDismiss, containerColor = Color.White, shape = RoundedCornerShape(16.dp)) {
        DropdownMenuItem(text = { Text("Recommander") }, leadingIcon = { Icon(Icons.Rounded.Replay, null, tint = C.Ink) }, onClick = { onDismiss(); onReorder() })
        DropdownMenuItem(
            text = { Text("Supprimer", color = C.Danger) }, leadingIcon = { Icon(Icons.Rounded.Delete, null, tint = C.Danger) },
            onClick = { onDismiss(); onDelete() },
        )
    }
}

@Composable
fun HistoryScreen(nav: (String) -> Unit) {
    val demo = LocalDemo.current
    var menuFor by remember { mutableStateOf(Launch.strOnce("omenu")) }
    var deleteFor by remember { mutableStateOf<String?>(null) }
    val orders = demo.history.filter { it.id !in demo.deletedOrders }
    Column(Modifier.fillMaxSize()) {
        TopBar("Historique", "${orders.size} commandes terminées")
        if (orders.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("Aucune commande terminée.", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
            }
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(orders, key = { it.id }) { o ->
                SCard(onClick = { nav("v06d/${o.id}") }, padding = PaddingValues(start = 14.dp, top = 10.dp, bottom = 12.dp, end = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(o.date, style = MaterialTheme.typography.titleMedium)
                            Text("${o.lines.size} articles", style = MaterialTheme.typography.bodySmall)
                        }
                        Box {
                            IconButton({ menuFor = o.id }) { Icon(Icons.Rounded.MoreVert, "Actions de la commande du ${o.date}", tint = C.Ink) }
                            OrderMenu(menuFor == o.id, { menuFor = null },
                                { demo.simulated("commande « ${o.date} » recommandée"); nav("v02") }, { deleteFor = o.id })
                        }
                    }
                    Row(Modifier.padding(top = 4.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Row(horizontalArrangement = Arrangement.spacedBy((-10).dp), modifier = Modifier.weight(1f)) {
                            o.lines.take(5).forEach { (id, _) -> Photo(demo.byId[id]!!.photo, 36.dp, Modifier.border(2.dp, Color.White, CircleShape), radius = 18.dp) }
                            if (o.lines.size > 5) Box(Modifier.size(36.dp).clip(CircleShape).background(Color(0xFFE4EDF5)).border(2.dp, Color.White, CircleShape), contentAlignment = Alignment.Center) {
                                Text("+${o.lines.size - 5}", style = MaterialTheme.typography.labelSmall, color = C.Muted)
                            }
                        }
                        RowAction("Recommander", { demo.simulated("commande « ${o.date} » recommandée"); nav("v02") }, false)
                    }
                }
            }
        }
    }
    deleteFor?.let { id ->
        val o = demo.history.first { it.id == id }
        ConfirmDialog(
            "Supprimer cette commande ?", "La commande du ${o.date} sera retirée de l'historique. Les statistiques seront recalculées.",
            "Supprimer", { deleteFor = null; demo.deletedOrders.add(id); demo.simulated("suppression de la commande") }, { deleteFor = null }, danger = true,
        )
    }
}

@Composable
fun HistoryDetailScreen(id: String, nav: (String) -> Unit, onBack: () -> Unit) {
    val demo = LocalDemo.current
    val o = demo.history.firstOrNull { it.id == id } ?: return
    var menu by remember { mutableStateOf(Launch.once("menu")) }
    var confirm by remember { mutableStateOf(Launch.once("confirm")) }
    Column(Modifier.fillMaxSize()) {
        TopBar(o.date, "${o.lines.size} articles achetés", onBack = onBack, actions = {
            Box {
                IconButton({ menu = true }) { Icon(Icons.Rounded.MoreVert, "Actions de la commande", tint = C.Ink) }
                OrderMenu(menu, { menu = false }, { demo.simulated("commande recommandée"); nav("v02") }, { confirm = true })
            }
        })
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 12.dp)) {
            item {
                SCard {
                    o.lines.forEachIndexed { i, (pid, q) ->
                        val p = demo.byId[pid]!!
                        if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(start = 66.dp))
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            ProductPhoto(p, 44.dp, radius = 10.dp)
                            Text(p.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(qtyText(p, q), style = MaterialTheme.typography.bodyMedium, color = C.Muted, maxLines = 1)
                        }
                    }
                }
            }
        }
        Column(Modifier.fillMaxWidth().background(Color.White).navigationBarsPadding().padding(16.dp, 10.dp)) {
            PrimaryButton("Recommander", { demo.simulated("commande recommandée"); nav("v02") }, Modifier.fillMaxWidth(), leading = Icons.Rounded.Replay)
        }
    }
    if (confirm) ConfirmDialog(
        "Supprimer cette commande ?", "La commande du ${o.date} sera retirée de l'historique. Les statistiques seront recalculées.",
        "Supprimer", { confirm = false; demo.deletedOrders.add(id); demo.simulated("suppression de la commande"); onBack() }, { confirm = false }, danger = true,
    )
}
