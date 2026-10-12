@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import kotlin.math.roundToInt

/* ───────────── V04 — Sélection (trois modes) ───────────── */

@Composable
fun SelectionScreen(nav: (String) -> Unit, onBack: () -> Unit) {
    val demo = LocalDemo.current
    var query by remember { mutableStateOf("") }
    val startSheet = remember { demo.pendingSheet.also { demo.pendingSheet = null } ?: Launch.strOnce("sheet") }
    var sheetFor by remember { mutableStateOf(startSheet) }
    val admin = demo.role == Role.ADMIN
    // Variantes de capture : une sélection de départ (jamais appliquée en usage normal)
    remember {
        if (Launch.once("preselect")) {
            demo.selection["tomates"] = 2000; demo.selection["pommes-de-terre"] = 1500; demo.selection["oignons"] = 1500
        }
        val sp = startSheet?.let { demo.byId[it] }
        if (sp != null && Launch.flag("selected") && demo.selection[sp.id] == null) demo.selection[sp.id] = Launch.str("qty")?.toIntOrNull() ?: defaultQty(sp)
        0
    }
    val items = demo.products.filter { demo.inCatalog[it.id] == true && (query.isBlank() || it.name.contains(query.trim(), ignoreCase = true)) }
    val entries: List<Any> = buildList { items.groupBy { it.category }.forEach { (c, ps) -> add(c); addAll(ps) } }
    val count = demo.selection.size

    Column(Modifier.fillMaxSize()) {
        TopBar(if (admin) "Ajouter des articles" else "Choisir mes articles", onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SearchBox(query, { query = it }, "Rechercher un produit…")
            SegTabs(SelMode.entries.map { it.label }, demo.selMode.ordinal, { demo.selMode = SelMode.entries[it] })
        }
        Spacer(Modifier.height(6.dp))
        Box(Modifier.weight(1f)) {
            when (demo.selMode) {
                SelMode.LIST -> LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(entries, key = { if (it is Product) it.id else "h-$it" }) { e ->
                        if (e is Product) SelListRow(e) { sheetFor = e.id } else Header(e as String)
                    }
                }
                SelMode.GRID -> LazyVerticalGrid(
                    GridCells.Fixed(2), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    entries.forEach { e ->
                        if (e is Product) item(key = e.id) { SelTile(e) { sheetFor = e.id } }
                        else item(key = "h-$e", span = { GridItemSpan(maxLineSpan) }) { Header(e as String) }
                    }
                }
                SelMode.CARDS -> LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(entries, key = { if (it is Product) it.id else "h-$it" }) { e ->
                        if (e is Product) SelBigCard(e) { sheetFor = e.id } else Header(e as String)
                    }
                }
            }
        }
        // Une seule action finale
        Column(
            Modifier.fillMaxWidth().shadow(10.dp, ambientColor = C.Navy.copy(alpha = 0.12f), spotColor = C.Navy.copy(alpha = 0.25f))
                .background(Color.White).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            PrimaryButton(
                if (count == 0) "Terminer ma sélection" else "Terminer ma sélection ($count)",
                {
                    demo.selection.forEach { (id, q) ->
                        val i = demo.lines.indexOfFirst { it.productId == id }
                        if (i >= 0 && !demo.lines[i].bought) demo.lines[i] = demo.lines[i].copy(qty = demo.lines[i].qty + q)
                        else if (i < 0) demo.lines.add(Line(id, q, false))
                    }
                    demo.selection.clear()
                    demo.simulated(if (admin) "articles ajoutés à la liste" else "demande envoyée (hors connexion : « Envoi en attente »)")
                    nav(if (admin) "v02" else "v03")
                },
                Modifier.fillMaxWidth(), enabled = count > 0, trailing = Icons.AutoMirrored.Rounded.ArrowForward,
            )
        }
    }

    sheetFor?.let { id ->
        val p = demo.byId[id]
        if (p != null) QuantitySheet(
            p, demo.selection[id], demo.showPrices, demo.prices[id], focusInput = remember { Launch.once("keyboard") },
            onDismiss = { sheetFor = null },
            onConfirm = { demo.selection[id] = it; sheetFor = null },
            onRemove = { demo.selection.remove(id); sheetFor = null },
        )
    }
}

@Composable private fun Header(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp))
}

private val SelBorder = BorderStroke(2.5.dp, C.Teal)

@Composable
private fun SelBadge(modifier: Modifier = Modifier) {
    Box(modifier.size(28.dp).clip(CircleShape).background(C.Teal), contentAlignment = Alignment.Center) {
        Icon(Icons.Rounded.Check, "Sélectionné", tint = Color.White, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun PriceLine(p: Product) {
    val demo = LocalDemo.current
    val price = demo.prices[p.id]
    if (demo.showPrices) Text(if (price != null) priceText(price, p) else "Prix non renseigné", style = MaterialTheme.typography.bodySmall, maxLines = 1)
    else Text(when (p.unit) { UnitKind.MASS -> "au kilo"; UnitKind.VOLUME -> "au litre"; UnitKind.COUNT -> "à l'unité" }, style = MaterialTheme.typography.bodySmall, maxLines = 1)
}

@Composable
private fun SelListRow(p: Product, openSheet: () -> Unit) {
    val demo = LocalDemo.current
    val q = demo.selection[p.id]
    val shape = RoundedCornerShape(18.dp)
    Row(
        Modifier.fillMaxWidth().shadow(3.dp, shape, ambientColor = C.Navy.copy(alpha = 0.10f), spotColor = C.Navy.copy(alpha = 0.2f)).clip(shape)
            .background(if (q != null) C.TealSoft else Color.White)
            .then(if (q != null) Modifier.border(SelBorder, shape) else Modifier)
            .clickable { if (q == null) demo.selection[p.id] = defaultQty(p) else demo.selection.remove(p.id) }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Photo(p.photo, 56.dp, radius = 12.dp)
        Column(Modifier.weight(1f)) {
            Text(p.name, style = MaterialTheme.typography.titleSmall.copy(fontSize = 16.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
            PriceLine(p)
        }
        if (q != null) {
            QtyChip(qtyText(p, q), openSheet)
            SelBadge()
        } else AddDot()
    }
}

@Composable
private fun AddDot() {
    Box(Modifier.size(40.dp).shadow(5.dp, CircleShape, ambientColor = C.Teal, spotColor = C.TealDark).clip(CircleShape).background(C.Teal), contentAlignment = Alignment.Center) {
        Icon(Icons.Rounded.Add, "Ajouter", tint = Color.White)
    }
}

@Composable
private fun QtyChip(text: String, onClick: () -> Unit) {
    Row(
        Modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(50)).background(Color.White).border(BorderStroke(1.dp, C.Teal), RoundedCornerShape(50))
            .clickable(onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = C.TealDark, maxLines = 1)
        Icon(Icons.Rounded.Edit, "Modifier la quantité", tint = C.TealDark, modifier = Modifier.size(14.dp))
    }
}

@Composable
private fun SelTile(p: Product, openSheet: () -> Unit) {
    val demo = LocalDemo.current
    val q = demo.selection[p.id]
    val shape = RoundedCornerShape(20.dp)
    Column(
        Modifier.fillMaxWidth().shadow(4.dp, shape, ambientColor = C.Navy.copy(alpha = 0.10f), spotColor = C.Navy.copy(alpha = 0.2f)).clip(shape)
            .background(if (q != null) C.TealSoft else Color.White)
            .then(if (q != null) Modifier.border(SelBorder, shape) else Modifier)
            .clickable { if (q == null) demo.selection[p.id] = defaultQty(p) else demo.selection.remove(p.id) },
    ) {
        Box {
            Image(painterResource(p.photo), null, Modifier.fillMaxWidth().aspectRatio(1.15f), contentScale = ContentScale.Crop)
            if (q != null) SelBadge(Modifier.align(Alignment.TopEnd).padding(8.dp))
        }
        Row(Modifier.padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                PriceLine(p)
            }
            if (q == null) AddDot()
        }
        if (q != null) Box(Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp)) { QtyChip(qtyText(p, q), openSheet) }
    }
}

@Composable
private fun SelBigCard(p: Product, openSheet: () -> Unit) {
    val demo = LocalDemo.current
    val q = demo.selection[p.id]
    val shape = RoundedCornerShape(24.dp)
    Column(
        Modifier.fillMaxWidth().shadow(5.dp, shape, ambientColor = C.Navy.copy(alpha = 0.12f), spotColor = C.Navy.copy(alpha = 0.22f)).clip(shape)
            .background(if (q != null) C.TealSoft else Color.White)
            .then(if (q != null) Modifier.border(SelBorder, shape) else Modifier),
    ) {
        Box(Modifier.clickable { if (q == null) demo.selection[p.id] = defaultQty(p) else demo.selection.remove(p.id) }) {
            Image(painterResource(p.photo), null, Modifier.fillMaxWidth().height(190.dp), contentScale = ContentScale.Crop)
            if (q != null) SelBadge(Modifier.align(Alignment.TopEnd).padding(12.dp))
        }
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(p.name, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    PriceLine(p)
                }
                if (q == null) AddDot()
            }
            if (q != null) Row(verticalAlignment = Alignment.CenterVertically) {
                val big = q >= 1000 && p.unit != UnitKind.COUNT
                Stepper(
                    qtyText(p, q),
                    { demo.selection[p.id] = (q - stepOf(p, big)).coerceAtLeast(stepOf(p, big)) },
                    { demo.selection[p.id] = q + stepOf(p, big) },
                    size = 44.dp, canMinus = q > stepOf(p, big),
                )
                Spacer(Modifier.weight(1f))
                QtyChip("Quantité", openSheet)
            }
        }
    }
}

/* ───────────── V05 — Panneau de quantité ───────────── */

private fun display(q: Int, p: Product, big: Boolean): String =
    if (p.unit == UnitKind.COUNT) q.toString() else if (big) fmtNum(q / 1000.0) else q.toString()

@Composable
fun QuantitySheet(
    p: Product, current: Int?, showPrice: Boolean, price: Int?, focusInput: Boolean,
    onDismiss: () -> Unit, onConfirm: (Int) -> Unit, onRemove: () -> Unit,
) {
    var qty by remember { mutableIntStateOf(current ?: defaultQty(p)) }
    var big by remember { mutableStateOf(p.unit != UnitKind.COUNT && qty >= 1000) }
    var text by remember { mutableStateOf(display(qty, p, big)) }
    val fr = remember { FocusRequester() }
    if (focusInput) LaunchedEffect(Unit) { runCatching { fr.requestFocus() } }
    val hasUnits = p.unit != UnitKind.COUNT
    val bigName = p.unit.big ?: ""
    val smallName = if (hasUnits) p.unit.small else p.countLabel
    val step = stepOf(p, big)
    val valid = qty > 0

    fun parse(s: String) {
        text = s
        val v = s.trim().replace(',', '.').toDoubleOrNull()
        qty = if (v == null || v <= 0.0) 0 else if (p.unit == UnitKind.COUNT) v.roundToInt().coerceAtMost(9999) else (v * (if (big) 1000 else 1)).roundToInt().coerceAtMost(9_999_999)
    }

    AppSheet(onDismiss) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Photo(p.photo, 76.dp, radius = 18.dp)
            Column(Modifier.weight(1f)) {
                Text(p.name, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (showPrice) Text(if (price != null) "Prix indicatif : ${priceText(price, p)}" else "Prix non renseigné", style = MaterialTheme.typography.bodySmall)
                else Text(if (hasUnits) "Se choisit en $bigName ou en ${p.unit.small}" else "Se compte en ${p.countLabel}s", style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(16.dp))
        if (hasUnits) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Unité", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(end = 4.dp))
                ToggleChip(bigName, big, { if (!big) { big = true; text = display(qty, p, true) } })
                ToggleChip(p.unit.small, !big, { if (big) { big = false; text = display(qty, p, false) } })
            }
            Spacer(Modifier.height(14.dp))
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            RoundBtn(Icons.Rounded.Remove, "Diminuer", {
                qty = (qty - step).coerceAtLeast(step); text = display(qty, p, big)
            }, size = 52.dp, enabled = qty > step)
            OutlinedTextField(
                value = text, onValueChange = { parse(it) }, singleLine = true,
                suffix = { Text(if (hasUnits) (if (big) bigName else p.unit.small) else smallName + if (qty > 1) "s" else "", color = C.Muted) },
                keyboardOptions = KeyboardOptions(keyboardType = if (p.unit == UnitKind.COUNT) KeyboardType.Number else KeyboardType.Decimal),
                textStyle = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center),
                isError = !valid, shape = RoundedCornerShape(16.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = C.Teal, unfocusedBorderColor = C.Line, focusedContainerColor = Color.White, unfocusedContainerColor = Color.White, cursorColor = C.Teal),
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp).focusRequester(fr),
            )
            RoundBtn(Icons.Rounded.Add, "Augmenter", { qty += step; text = display(qty, p, big) }, filled = true, size = 52.dp)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            if (!valid) "Saisissez une quantité supérieure à zéro."
            else if (hasUnits) "= ${if (big) "${qty} ${p.unit.small}" else "${fmtNum(qty / 1000.0)} $bigName"}" else " ",
            style = MaterialTheme.typography.bodySmall, color = if (valid) C.Muted else C.Danger,
            modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(14.dp))
        PrimaryButton(if (current == null) "Ajouter à ma sélection" else "Mettre à jour", { onConfirm(qty) }, Modifier.fillMaxWidth(), enabled = valid)
        if (current != null) {
            Spacer(Modifier.height(8.dp))
            TextButton(onRemove, Modifier.align(Alignment.CenterHorizontally)) { Text("Retirer de la sélection", color = C.Danger, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) }
        }
    }
}
