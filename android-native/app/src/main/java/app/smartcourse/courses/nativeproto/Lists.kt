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
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var editId by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(Launch.once("menu")) }
    var confirmClose by remember { mutableStateOf(Launch.once("confirm")) }
    var confirmFinish by remember { mutableStateOf(false) }
    var favs by remember { mutableStateOf(Launch.once("favs")) }
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }
    val total = demo.lines.size
    val bought = demo.boughtCount
    val all = total > 0 && bought == total
    // Aucune liste en cours (≠ liste en cours vide) : rien n'est créé en consultant l'écran.
    val noList = demo.live && demo.listLoaded && !demo.hasList && total == 0
    val canClose = !demo.live || demo.hasList
    val canShare = total > bought
    // À acheter, groupés par catégorie ; les articles achetés passent dans « Déjà achetés », après toutes les catégories.
    val groups = demo.lines.filter { !it.bought }.groupBy { demo.byId[it.productId]?.category ?: "" }
    val boughtLines = demo.lines.filter { it.bought }

    Column(Modifier.fillMaxSize()) {
        TopBar("Ma liste", if (noList) "" else demo.listDate, actions = {
            if (canClose || canShare) Box {
                IconButton({ menu = true }) { Icon(Icons.Rounded.MoreVert, "Plus d'actions", tint = C.Ink) }
                DropdownMenu(menu, { menu = false }, containerColor = Color.White, shape = RoundedCornerShape(16.dp)) {
                    if (canClose) DropdownMenuItem(
                        text = { Text("Clôturer la liste") },
                        leadingIcon = { Icon(Icons.Rounded.Check, null, tint = C.Ink) },
                        onClick = { menu = false; confirmClose = true },
                    )
                    if (canShare) DropdownMenuItem(
                        text = { Text("Partager la liste") },
                        leadingIcon = { Icon(Icons.Rounded.Share, null, tint = C.Ink) },
                        onClick = { menu = false; if (demo.live) shareList(ctx, demo) else demo.simulated("partage de la liste") },
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
                if (all && canClose) {
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
            if (!noList && demo.listLoaded) item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryButton("Ajouter des articles", { nav("v04") }, Modifier.weight(1.5f), leading = Icons.Rounded.Add)
                    SecondaryButton("Favoris", { favs = true }, Modifier.weight(1f), leading = Icons.Rounded.Star)
                }
            }
            if (total == 0) item {
                Column(Modifier.fillMaxWidth().padding(top = 36.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (demo.live && !demo.listLoaded) Text("Chargement de la liste…", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
                    else if (noList) {
                        Text("Aucune liste en cours", style = MaterialTheme.typography.titleSmall)
                        Text("Choisissez les articles de vos prochaines courses.", style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(14.dp))
                        // Ouvre le parcours de sélection : la liste n'est créée qu'à la validation des articles.
                        PrimaryButton("Créer une liste", { nav("v04") }, leading = Icons.Rounded.Add)
                    } else {
                        Text("La liste est vide.", style = MaterialTheme.typography.titleSmall)
                        Text("Ajoutez des articles pour commencer.", style = MaterialTheme.typography.bodySmall)
                    }
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
                if (!closed) item(key = "c-$cat") { AdminLines(lines, demo) { editId = it } }
            }
            if (boughtLines.isNotEmpty()) {
                val closed = collapsed[BOUGHT] == true
                item(key = "h-$BOUGHT") {
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { collapsed[BOUGHT] = !closed }.padding(horizontal = 4.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Déjà achetés (${boughtLines.size})", style = MaterialTheme.typography.titleMedium, color = C.Muted, modifier = Modifier.weight(1f))
                        Icon(if (closed) Icons.Rounded.KeyboardArrowDown else Icons.Rounded.KeyboardArrowUp, if (closed) "Déplier" else "Replier", tint = C.Muted)
                    }
                }
                if (!closed) item(key = "c-$BOUGHT") { AdminLines(boughtLines, demo) { editId = it } }
            }
        }
    }

    if (confirmClose) {
        val left = total - bought
        ConfirmDialog(
            "Clôturer la liste ?",
            if (left == 0) "La liste sera archivée dans l'historique." else "Il reste $left article${if (left > 1) "s" else ""} non acheté${if (left > 1) "s" else ""}. La liste sera archivée dans l'historique.",
            "Clôturer", { confirmClose = false; val d = demo.data; if (d != null) d.closeList { ok -> if (ok) nav("v06") } else { demo.simulated("clôture de la liste"); nav("v06") } }, { confirmClose = false },
        )
    }
    if (confirmFinish) {
        ConfirmDialog(
            "Terminer les courses ?", "Tout est acheté. La liste sera archivée dans l'historique.",
            "Terminer", { confirmFinish = false; val d = demo.data; if (d != null) d.closeList { ok -> if (ok) nav("v06") } else { demo.simulated("fin des courses"); nav("v06") } }, { confirmFinish = false },
        )
    }
    editId?.let { id ->
        val p = demo.byId[id]
        val line = demo.lines.firstOrNull { it.productId == id }
        if (p == null || line == null) {
            editId = null
        } else {
            QuantitySheet(
                p, line.qty, demo.showPrices, demo.priceLabel(p, line), focusInput = false,
                onDismiss = { editId = null }, onConfirm = { demo.setLineQty(id, it); editId = null },
                onRemove = { demo.removeLine(id); editId = null }, removeLabel = "Retirer de la liste", confirmLabel = "Mettre à jour",
            )
        }
    }
    if (favs && demo.live) FavoritesSheet({ favs = false })
    else if (favs) {
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

private const val BOUGHT = "\u0000achetes"

/** Lignes d'une carte (catégorie ou « Déjà achetés ») : photo, nom, quantité, case Acheté. */
@Composable
private fun AdminLines(lines: List<Line>, demo: Demo, onEdit: (String) -> Unit) {
    SCard {
        lines.forEachIndexed { i, l ->
            val p = demo.byId[l.productId] ?: return@forEachIndexed
            if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(start = 66.dp))
            Row(
                Modifier.fillMaxWidth().then(if (!l.bought) Modifier.clickable { onEdit(p.id) } else Modifier).padding(horizontal = 12.dp, vertical = 8.dp).heightIn(min = 48.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                ProductPhoto(p, 44.dp, radius = 10.dp)
                Column(Modifier.weight(1f).alpha(if (l.bought) 0.55f else 1f)) {
                    Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    val price = demo.priceLabel(p, l)
                    Text(
                        qtyText(p, l.qty) + if (demo.showPrices && price != null) "  ·  $price" else "",
                        style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    if (l.pending) Text("En attente d'envoi", style = MaterialTheme.typography.labelSmall, color = C.Amber)
                    else if (l.bought && l.buyer != null) Text("Acheté par ${l.buyer}" + (l.boughtAt?.let { " · $it" } ?: ""), style = MaterialTheme.typography.labelSmall, color = C.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                CheckBox(l.bought, { demo.setBought(p.id, it) }, label = "Acheté : ${p.name}")
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
    val noList = demo.live && demo.listLoaded && !demo.hasList && total == 0
    // À acheter groupés par catégorie, puis « Déjà achetés » en bas (ordre habituel conservé : décoché, l'article reprend sa place).
    val todo: Map<String, List<Line>> = if (filter == 2) emptyMap() else demo.lines.filter { !it.bought }.groupBy { demo.byId[it.productId]?.category ?: "" }
    val done: List<Line> = if (filter == 1) emptyList() else demo.lines.filter { it.bought }
    val shownEmpty = todo.isEmpty() && done.isEmpty()

    Column(Modifier.fillMaxSize()) {
        TopBar("Liste du jour", if (noList) "" else demo.listDate)
        if (total == 0) {
            Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Box(Modifier.size(88.dp).clip(CircleShape).background(C.TealSoft), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.ShoppingBasket, null, tint = C.TealDark, modifier = Modifier.size(44.dp))
                }
                Spacer(Modifier.height(18.dp))
                // Le personnel ne crée ni ne clôture de liste : ses demandes ouvrent la liste du jour (droit inchangé).
                Text(if (noList) "Aucune liste en cours" else "Aucun article pour le moment", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(6.dp))
                Text(if (noList) "Choisissez les articles nécessaires : ils seront envoyés à la famille." else "Choisissez les articles à ajouter à la liste.", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
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
                if (shownEmpty) item {
                    Text(if (filter == 1) "Tout est acheté." else "Rien n'est encore acheté.", style = MaterialTheme.typography.bodyMedium, color = C.Muted, modifier = Modifier.padding(top = 16.dp))
                }
                todo.forEach { (cat, lines) ->
                    item(key = "h-$cat") { Text(cat, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 4.dp)) }
                    items(lines, key = { it.productId }) { l -> StaffCard(l, demo) }
                }
                if (done.isNotEmpty()) {
                    item(key = "h-achetes") { Text("Déjà achetés (${done.size})", style = MaterialTheme.typography.titleMedium, color = C.Muted, modifier = Modifier.padding(start = 4.dp, top = 4.dp)) }
                    items(done, key = { it.productId }) { l -> StaffCard(l, demo) }
                }
            }
        }
    }
}

@Composable
private fun StaffCard(l: Line, demo: Demo) {
    val p = demo.byId[l.productId] ?: return
    SCard(padding = PaddingValues(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            ProductPhoto(p, 72.dp, radius = 16.dp, modifier = Modifier.alpha(if (l.bought) 0.6f else 1f))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(p.name, style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill(qtyText(p, l.qty), C.Ink, Color(0xFFE8F0F7))
                    if (l.bought) Pill("Acheté", C.TealDark, C.TealSoft) else if (l.pending) Pill("En attente d'envoi", C.Amber, C.AmberSoft) else Pill("À acheter", C.Amber, C.AmberSoft)
                }
                val price = demo.priceLabel(p, l)
                if (demo.showPrices && price != null) Text(price, style = MaterialTheme.typography.bodySmall)
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

/** Partage du texte de la liste (messagerie, notes…) : uniquement les articles et quantités. */
fun shareList(ctx: android.content.Context, demo: Demo) {
    val text = buildString {
        append("Liste de courses — ${demo.listDate}\n")
        demo.lines.filter { !it.bought }.forEach { l -> demo.byId[l.productId]?.let { p -> append("• ${p.name} : ${qtyText(p, l.qty)}\n") } }
    }
    val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(android.content.Intent.EXTRA_TEXT, text) }
    try { ctx.startActivity(android.content.Intent.createChooser(send, "Partager la liste").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { demo.say("Aucune application de partage disponible.") }
}
