@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private fun pct(done: Int, total: Int) = if (total == 0) 0 else (done * 100) / total

/* ───────────── V02 — Liste administrateur ───────────── */

@Composable
fun AdminListScreen(nav: (String) -> Unit) {
    val demo = LocalDemo.current
    var menu by remember { mutableStateOf(Launch.once("menu")) }
    var confirmClose by remember { mutableStateOf(Launch.once("confirm")) }
    var confirmFinish by remember { mutableStateOf(false) }
    var favs by remember { mutableStateOf(Launch.once("favs")) }
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }
    val total = demo.lines.size
    val bought = demo.boughtCount
    val all = total > 0 && bought == total
    val groups = demo.lines.groupBy { demo.byId[it.productId]!!.category }

    Column(Modifier.fillMaxSize()) {
        TopBar("Ma liste", "Lundi 12 mai", actions = {
            Box {
                IconButton({ menu = true }) { Icon(Icons.Rounded.MoreVert, "Plus d'actions", tint = C.Ink) }
                DropdownMenu(menu, { menu = false }, containerColor = Color.White, shape = RoundedCornerShape(16.dp)) {
                    DropdownMenuItem(
                        text = { Text("Clôturer la liste") },
                        leadingIcon = { Icon(Icons.Rounded.Check, null, tint = C.Ink) },
                        onClick = { menu = false; confirmClose = true },
                    )
                    DropdownMenuItem(
                        text = { Text("Partager la liste") },
                        leadingIcon = { Icon(Icons.Rounded.Share, null, tint = C.Ink) },
                        onClick = { menu = false; demo.simulated("partage de la liste") },
                    )
                }
            }
        })
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                if (total > 0) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("$bought sur $total achetés", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            Text("${pct(bought, total)} %", style = MaterialTheme.typography.titleSmall, color = C.TealDark)
                        }
                        Spacer(Modifier.height(6.dp))
                        ProgressBar(if (total == 0) 0f else bought / total.toFloat())
                    }
                }
            }
            item {
                if (demo.showTotals && total > 0) {
                    val (cents, miss) = demo.estimate()
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Pill("estimé", C.Amber, C.AmberSoft)
                        Text(
                            "≈ ${String.format(java.util.Locale.US, "%d,%02d", cents / 100, cents % 100)} DH" + if (miss > 0) " · $miss sans prix" else "",
                            style = MaterialTheme.typography.titleSmall,
                        )
                    }
                }
            }
            item {
                if (all) {
                    SCard(padding = PaddingValues(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Box(Modifier.size(36.dp).clip(CircleShape).background(C.TealSoft), contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Check, null, tint = C.TealDark) }
                            Text("Tout est acheté.", style = MaterialTheme.typography.titleSmall)
                        }
                        Spacer(Modifier.height(12.dp))
                        PrimaryButton("Terminer les courses", { confirmFinish = true }, Modifier.fillMaxWidth(), leading = Icons.Rounded.Check)
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryButton("Ajouter des articles", { nav("v04") }, Modifier.weight(1.5f), leading = Icons.Rounded.Add)
                    SecondaryButton("Favoris", { favs = true }, Modifier.weight(1f), leading = Icons.Rounded.Star)
                }
            }
            if (total == 0) item {
                Column(Modifier.fillMaxWidth().padding(top = 36.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("La liste est vide.", style = MaterialTheme.typography.titleSmall)
                    Text("Ajoutez des articles pour commencer.", style = MaterialTheme.typography.bodySmall)
                }
            }
            groups.forEach { (cat, lines) ->
                val closed = collapsed[cat] == true
                item(key = "h-$cat") {
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { collapsed[cat] = !closed }.padding(horizontal = 4.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(cat, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        Icon(if (closed) Icons.Rounded.KeyboardArrowDown else Icons.Rounded.KeyboardArrowUp, if (closed) "Déplier" else "Replier", tint = C.Muted)
                    }
                }
                if (!closed) item(key = "c-$cat") {
                    SCard {
                        lines.forEachIndexed { i, l ->
                            val p = demo.byId[l.productId]!!
                            if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(start = 66.dp))
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).heightIn(min = 48.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Photo(p.photo, 44.dp, radius = 10.dp)
                                Column(Modifier.weight(1f).alpha(if (l.bought) 0.55f else 1f)) {
                                    Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    val price = demo.prices[p.id]
                                    Text(
                                        qtyText(p, l.qty) + if (demo.showPrices && price != null) "  ·  ${priceText(price, p)}" else "",
                                        style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                CheckBox(l.bought, { demo.setBought(p.id, it) })
                            }
                        }
                    }
                }
            }
        }
    }

    if (confirmClose) {
        val left = total - bought
        ConfirmDialog(
            "Clôturer la liste ?",
            if (left == 0) "La liste sera archivée dans l'historique." else "Il reste $left article${if (left > 1) "s" else ""} non acheté${if (left > 1) "s" else ""}. La liste sera archivée dans l'historique.",
            "Clôturer", { confirmClose = false; demo.simulated("clôture de la liste"); nav("v06") }, { confirmClose = false },
        )
    }
    if (confirmFinish) {
        ConfirmDialog(
            "Terminer les courses ?", "Tout est acheté. La liste sera archivée dans l'historique.",
            "Terminer", { confirmFinish = false; demo.simulated("fin des courses"); nav("v06") }, { confirmFinish = false },
        )
    }
    if (favs) {
        AppSheet({ favs = false }) {
            Text("Favoris", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            listOf("Courses de la semaine" to "8 articles", "Petit-déjeuner" to "5 articles").forEach { (n, c) ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { favs = false; demo.simulated("ajout du favori « $n »") }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Star, null, tint = C.Amber)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) { Text(n, style = MaterialTheme.typography.titleSmall); Text(c, style = MaterialTheme.typography.bodySmall) }
                    RowAction("Utiliser", { favs = false; demo.simulated("ajout du favori « $n »") }, true)
                }
            }
        }
    }
}

/* ───────────── V03 — Liste personnel ───────────── */

@Composable
fun StaffListScreen(nav: (String) -> Unit) {
    val demo = LocalDemo.current
    var filter by remember { mutableIntStateOf(when (Launch.str("filter")) { "todo" -> 1; "done" -> 2; else -> 0 }) }
    val total = demo.lines.size
    val bought = demo.boughtCount
    val shown = demo.lines.filter { when (filter) { 1 -> !it.bought; 2 -> it.bought; else -> true } }

    Column(Modifier.fillMaxSize()) {
        TopBar("Liste du jour", "Lundi 12 mai")
        if (total == 0) {
            Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Box(Modifier.size(88.dp).clip(CircleShape).background(C.TealSoft), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.ShoppingBasket, null, tint = C.TealDark, modifier = Modifier.size(44.dp))
                }
                Spacer(Modifier.height(18.dp))
                Text("Aucun article pour le moment", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(6.dp))
                Text("Choisissez les articles à ajouter à la liste.", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
                Spacer(Modifier.height(20.dp))
                PrimaryButton("Choisir des articles", { nav("v04") }, Modifier.fillMaxWidth())
            }
        } else {
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    SCard(padding = PaddingValues(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("$bought sur $total achetés", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            Text("${pct(bought, total)} %", style = MaterialTheme.typography.titleMedium, color = C.TealDark)
                        }
                        Spacer(Modifier.height(10.dp))
                        ProgressBar(bought / total.toFloat())
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("Tous", "À acheter", "Achetés").forEachIndexed { i, t -> ToggleChip(t, filter == i, { filter = i }) }
                    }
                }
                if (shown.isEmpty()) item {
                    Text(if (filter == 1) "Tout est acheté." else "Rien n'est encore acheté.", style = MaterialTheme.typography.bodyMedium, color = C.Muted, modifier = Modifier.padding(top = 16.dp))
                }
                items(shown, key = { it.productId }) { l ->
                    val p = demo.byId[l.productId]!!
                    SCard(padding = PaddingValues(12.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Photo(p.photo, 72.dp, radius = 16.dp, modifier = Modifier.alpha(if (l.bought) 0.6f else 1f))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(p.name, style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Pill(qtyText(p, l.qty), C.Ink, Color(0xFFE8F0F7))
                                    if (l.bought) Pill("Acheté", C.TealDark, C.TealSoft) else Pill("À acheter", C.Amber, C.AmberSoft)
                                }
                                val price = demo.prices[p.id]
                                if (demo.showPrices && price != null) Text(priceText(price, p), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        if (!l.bought) {
                            Spacer(Modifier.height(10.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Stepper(
                                    qtyText(p, l.qty),
                                    { demo.setLineQty(p.id, (l.qty - stepOf(p, l.qty >= 1000)).coerceAtLeast(stepOf(p, l.qty >= 1000))) },
                                    { demo.setLineQty(p.id, l.qty + stepOf(p, l.qty >= 1000)) },
                                    size = 48.dp, canMinus = l.qty > stepOf(p, l.qty >= 1000),
                                )
                                Spacer(Modifier.weight(1f))
                                RoundBtn(Icons.Rounded.Delete, "Retirer ${p.name}", { demo.removeLine(p.id) }, size = 48.dp)
                            }
                        }
                    }
                }
            }
        }
    }
}
