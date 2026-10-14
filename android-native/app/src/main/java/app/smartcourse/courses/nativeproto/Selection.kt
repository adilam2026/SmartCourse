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
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
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
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import kotlinx.coroutines.delay
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/* ───────────── V04 — Sélection (trois modes) ───────────── */

@Composable
fun SelectionScreen(nav: (String) -> Unit, onBack: () -> Unit) {
    val demo = LocalDemo.current
    var query by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("") }
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
    // Personnel : pas de recherche (et aucune recherche précédente ne masque d'article) ; tous les articles par catégorie.
    val q = if (admin) query else ""
    val items = demo.products.filter { demo.inCatalog[it.id] == true && (q.isBlank() || it.name.contains(q.trim(), ignoreCase = true)) }
    // Organisation : « Tous les articles » (blocs titrés par catégorie, tous dépliés) ou « Par catégories » (grille de catégories,
    // puis les articles d'une seule catégorie). La présentation (Liste / Cartes) s'applique aux articles. Changer d'affichage, ouvrir
    // une catégorie ou revenir à la grille ne touche jamais à la sélection en cours.
    val groups = items.groupBy { it.category }
    var openCat by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf<String?>(null) }
    val byCategory = demo.selOrg == SelOrg.CATEGORY
    // Une recherche affiche directement ses résultats en blocs ; sans recherche, la grille des catégories.
    val showGrid = byCategory && openCat == null && q.isBlank()
    val shown: Map<String, List<Product>> = if (byCategory && openCat != null && q.isBlank()) mapOf(openCat!! to groups[openCat].orEmpty()) else groups
    val entries: List<Any> = buildList { shown.forEach { (c, ps) -> if (!(byCategory && openCat != null && q.isBlank())) add(c); addAll(ps) } }
    if (openCat != null && (!byCategory || groups[openCat] == null) && q.isBlank()) openCat = null
    androidx.activity.compose.BackHandler(enabled = byCategory && openCat != null && q.isBlank()) { openCat = null }
    var display by remember { mutableStateOf(false) }
    val count = demo.selChanges

    Column(Modifier.fillMaxSize()) {
        // Personnel : écran principal, sans flèche de retour (Liste du jour reste accessible par l'onglet du bas). L'icône Affichage est
        // sur la ligne du titre, juste à gauche de l'icône profil.
        TopBar(
            if (admin) "Ajouter des articles" else "Choisir mes articles",
            onBack = if (admin) ({ if (byCategory && openCat != null && q.isBlank()) openCat = null else onBack() }) else null,
        ) { DisplayIcon { display = true } }
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (admin) SearchBox(query, { query = it }, "Rechercher un produit…", Modifier.fillMaxWidth())
            if (demo.orphanCount > 0) SCard(padding = PaddingValues(12.dp)) {
                Text("${demo.orphanCount} article${if (demo.orphanCount > 1) "s" else ""} d'une liste terminée", style = MaterialTheme.typography.titleSmall)
                Text("Ils n'ont pas été ajoutés. Voulez-vous les reprendre dans votre sélection ?", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("Reprendre", { demo.data?.resumeOrphans() }, Modifier.weight(1f))
                    SecondaryButton("Ignorer", { demo.data?.dismissOrphans() }, Modifier.weight(1f))
                }
            }
        }
        if (admin || demo.orphanCount > 0) Spacer(Modifier.height(6.dp))
        if (byCategory && openCat != null && q.isBlank()) CategoryBar(openCat!!, groups[openCat].orEmpty().size) { openCat = null }
        Box(Modifier.weight(1f)) {
            if (showGrid) LazyVerticalGrid(
                GridCells.Fixed(2), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                groups.forEach { (c, ps) -> item(key = "c-$c") { CategoryCard(c, ps) { openCat = c } } }
            }
            else when (demo.selMode) {
                SelMode.LIST -> LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(entries, key = { if (it is Product) it.id else "h-$it" }) { e ->
                        if (e is Product) SelListRow(e) { sheetFor = e.id } else Header(e as String, groups[e].orEmpty().size)
                    }
                }
                SelMode.GRID -> LazyVerticalGrid(
                    GridCells.Fixed(2), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    entries.forEach { e ->
                        if (e is Product) item(key = e.id) { SelTile(e) { sheetFor = e.id } }
                        else item(key = "h-$e", span = { GridItemSpan(maxLineSpan) }) { Header(e as String, groups[e].orEmpty().size) }
                    }
                }
            }
        }
        // Une seule action finale
        Column(
            Modifier.fillMaxWidth().shadow(10.dp, ambientColor = C.Navy.copy(alpha = 0.12f), spotColor = C.Navy.copy(alpha = 0.25f))
                .background(Color.White).navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 8.dp),
        ) {
            PrimaryButton(
                if (count == 0) "Terminer ma sélection" else "Terminer ma sélection ($count)",
                {
                    val d = demo.data
                    if (d != null) { if (admin) d.submitSelection { nav("v02") } else d.submitStaffSelection() }
                    else {
                        demo.selection.forEach { (id, q) ->
                            val i = demo.lines.indexOfFirst { it.productId == id }
                            if (!admin && i >= 0 && !demo.lines[i].bought) { if (q <= 0) demo.lines.removeAt(i) else demo.lines[i] = demo.lines[i].copy(qty = q) }
                            else if (i >= 0 && !demo.lines[i].bought) demo.lines[i] = demo.lines[i].copy(qty = demo.lines[i].qty + q)
                            else if (i < 0 && q > 0) demo.lines.add(Line(id, q, false))
                        }
                        demo.selection.clear()
                        if (admin) { demo.simulated("articles ajoutés à la liste"); nav("v02") } else demo.say("Sélection enregistrée")
                    }
                },
                Modifier.fillMaxWidth(), enabled = count > 0, trailing = Icons.AutoMirrored.Rounded.ArrowForward,
            )
        }
    }

    if (display) DisplaySheet { display = false }
    sheetFor?.let { id ->
        val p = demo.byId[id]
        if (p != null) QuantitySheet(
            p, demo.selQty(id), demo.showPrices, demo.priceLabel(p), focusInput = remember { Launch.once("keyboard") },
            onDismiss = { sheetFor = null },
            onConfirm = { demo.setSel(id, it); sheetFor = null },
            onRemove = { demo.selRemove(id); sheetFor = null },
            removeLabel = if (demo.savedQty(id) != null) "Retirer de la liste" else "Retirer de la sélection",
        )
    }
}

/** Personnel : repère d'un article déjà enregistré dans la liste du jour (ou de la modification en attente). */
@Composable private fun SavedTag(p: Product) {
    val demo = LocalDemo.current
    val saved = demo.savedQty(p.id) ?: return
    val s = demo.selection[p.id]
    val (t, c) = when {
        s == null -> "Enregistré · ${qtyText(p, saved)}" to C.TealDark
        s <= 0 -> "Sera retiré à l'enregistrement" to C.Amber
        else -> "Modifié (enregistré : ${qtyText(p, saved)})" to C.Amber
    }
    Text(t, style = MaterialTheme.typography.labelSmall, color = c, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable private fun Header(text: String, total: Int) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f, fill = false))
        Text(articles(total), style = MaterialTheme.typography.bodySmall, color = C.Muted, modifier = Modifier.padding(bottom = 2.dp))
    }
}

private fun articles(n: Int) = if (n > 1) "$n articles" else "$n article"

/** Nombre de produits DISTINCTS choisis dans une catégorie (pas leurs quantités) : ceux qui portent la coche. */
@Composable private fun selectedIn(ps: List<Product>): Int { val demo = LocalDemo.current; return ps.count { demo.selQty(it.id) != null } }

/** Carte d'entrée d'une catégorie : photos représentatives, nom, nombre d'articles ; petit badge du nombre de produits choisis. */
@Composable
private fun CategoryCard(name: String, ps: List<Product>, onOpen: () -> Unit) {
    val sel = selectedIn(ps)
    val shape = RoundedCornerShape(20.dp)
    Column(
        Modifier.fillMaxWidth().shadow(4.dp, shape, ambientColor = C.Navy.copy(alpha = 0.10f), spotColor = C.Navy.copy(alpha = 0.2f)).clip(shape)
            .background(Color.White).clickable(onClick = onOpen)
            .semantics(mergeDescendants = true) { contentDescription = "$name, ${articles(ps.size)}" + if (sel > 0) ", $sel choisi${if (sel > 1) "s" else ""}" else "" },
    ) {
        Box {
            val pics = ps.take(4)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (r in 0 until 2) Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    for (c in 0 until 2) {
                        val p = pics.getOrNull(r * 2 + c)
                        val m = Modifier.weight(1f).aspectRatio(1.25f)
                        if (p != null) ProductImage(p, m, contentScale = ContentScale.Crop) else Box(m.background(Color(0xFFEFF4F8)))
                    }
                }
            }
            if (sel > 0) Box(
                Modifier.align(Alignment.TopEnd).padding(8.dp).heightIn(min = 26.dp).widthIn(min = 26.dp).clip(RoundedCornerShape(50)).background(C.Teal)
                    .padding(horizontal = 7.dp),
                contentAlignment = Alignment.Center,
            ) { Text(sel.toString(), color = Color.White, style = MaterialTheme.typography.labelLarge, maxLines = 1) }
        }
        Column(Modifier.padding(start = 12.dp, end = 10.dp, top = 8.dp, bottom = 12.dp)) {
            Text(name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(articles(ps.size), style = MaterialTheme.typography.bodySmall, color = C.Muted)
        }
    }
}

/** Catégorie ouverte : retour clair vers la grille des catégories, puis son nom. */
@Composable
private fun CategoryBar(name: String, total: Int, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val shape = RoundedCornerShape(50)
        Row(
            Modifier.heightIn(min = 48.dp).clip(shape).background(Color.White).border(BorderStroke(1.dp, C.Line), shape).clickable(onClick = onBack)
                .semantics(mergeDescendants = true) { contentDescription = "Retour aux catégories" }.padding(start = 10.dp, end = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, null, tint = C.Ink, modifier = Modifier.size(20.dp))
            Text("Catégories", style = MaterialTheme.typography.labelLarge, color = C.Ink)
        }
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(articles(total), style = MaterialTheme.typography.bodySmall, color = C.Muted)
        }
    }
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
    if (demo.showPrices) Text(demo.priceLabel(p) ?: "Prix non renseigné", style = MaterialTheme.typography.bodySmall, maxLines = 1)
    else Text(when (p.unit) { UnitKind.MASS -> "au kilo"; UnitKind.VOLUME -> "au litre"; UnitKind.COUNT -> "à l'unité" }, style = MaterialTheme.typography.bodySmall, maxLines = 1)
}

@Composable
private fun SelListRow(p: Product, openSheet: () -> Unit) {
    val demo = LocalDemo.current
    val q = demo.selQty(p.id)
    val shape = RoundedCornerShape(18.dp)
    Row(
        Modifier.fillMaxWidth().shadow(3.dp, shape, ambientColor = C.Navy.copy(alpha = 0.10f), spotColor = C.Navy.copy(alpha = 0.2f)).clip(shape)
            .background(if (q != null) C.TealSoft else Color.White)
            .then(if (q != null) Modifier.border(SelBorder, shape) else Modifier)
            .clickable { demo.selToggle(p, openSheet) }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ProductPhoto(p, 56.dp, radius = 12.dp)
        Column(Modifier.weight(1f)) {
            Text(p.name, style = MaterialTheme.typography.titleSmall.copy(fontSize = 16.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
            PriceLine(p)
            SavedTag(p)
        }
        if (q != null) {
            QtyChip(qtyText(p, q), p.name, openSheet)
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
private fun QtyChip(text: String, name: String, onClick: () -> Unit) {
    val cmp = LocalCompact.current
    Box(Modifier.heightIn(min = if (cmp) 36.dp else 48.dp).clickable(onClick = onClick), contentAlignment = Alignment.CenterStart) {
        Row(
            Modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(50)).background(Color.White).border(BorderStroke(1.dp, C.Teal), RoundedCornerShape(50))
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(text, style = MaterialTheme.typography.labelMedium, color = C.TealDark, maxLines = 1)
            Icon(Icons.Rounded.Edit, "Modifier la quantité : $name", tint = C.TealDark, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun SelTile(p: Product, openSheet: () -> Unit) {
    val demo = LocalDemo.current
    val q = demo.selQty(p.id)
    val shape = RoundedCornerShape(20.dp)
    Column(
        Modifier.fillMaxWidth().shadow(4.dp, shape, ambientColor = C.Navy.copy(alpha = 0.10f), spotColor = C.Navy.copy(alpha = 0.2f)).clip(shape)
            .background(if (q != null) C.TealSoft else Color.White)
            .then(if (q != null) Modifier.border(SelBorder, shape) else Modifier)
            .clickable { demo.selToggle(p, openSheet) },
    ) {
        Box {
            ProductImage(p, Modifier.fillMaxWidth().aspectRatio(1.15f), contentScale = ContentScale.Crop)
            if (q != null) SelBadge(Modifier.align(Alignment.TopEnd).padding(8.dp))
        }
        Row(Modifier.padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                PriceLine(p)
                SavedTag(p)
            }
            if (q == null) AddDot()
        }
        if (q != null) Box(Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp)) { QtyChip(qtyText(p, q), p.name, openSheet) }
    }
}

/* ───────────── V05 — Panneau de quantité ───────────── */

private fun display(q: Int, p: Product, big: Boolean): String =
    if (p.unit == UnitKind.COUNT) q.toString() else if (big) fmtNum(q / 1000.0) else q.toString()

@Composable
fun QuantitySheet(
    p: Product, current: Int?, showPrice: Boolean, priceLabel: String?, focusInput: Boolean,
    onDismiss: () -> Unit, onConfirm: (Int) -> Unit, onRemove: () -> Unit,
    removeLabel: String = "Retirer de la sélection", confirmLabel: String? = null,
) {
    var qty by remember { mutableIntStateOf(current ?: defaultQty(p)) }
    var big by remember { mutableStateOf(p.unit != UnitKind.COUNT && qty >= 1000) }
    var text by remember { mutableStateOf(display(qty, p, big)) }
    val fr = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    if (focusInput) LaunchedEffect(Unit) { delay(700); runCatching { fr.requestFocus() }; keyboard?.show() }
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
            ProductPhoto(p, 76.dp, radius = 18.dp)
            Column(Modifier.weight(1f)) {
                Text(p.name, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (showPrice) Text(if (priceLabel != null) "Prix indicatif : $priceLabel" else "Prix non renseigné", style = MaterialTheme.typography.bodySmall)
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
        PrimaryButton(confirmLabel ?: if (current == null) "Ajouter à ma sélection" else "Mettre à jour", { onConfirm(qty) }, Modifier.fillMaxWidth(), enabled = valid)
        if (current != null) {
            Spacer(Modifier.height(8.dp))
            TextButton(onRemove, Modifier.align(Alignment.CenterHorizontally)) { Text(removeLabel, color = C.Danger, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) }
        }
    }
}


/** Icône « Affichage » de l'en-tête (zone tactile 48 dp) ; son nom accessible indique aussi les deux réglages actifs. */
@Composable
private fun DisplayIcon(onClick: () -> Unit) {
    val demo = LocalDemo.current
    IconButton(onClick, Modifier.semantics { contentDescription = "Affichage : ${demo.selMode.label}, ${demo.selOrg.label.lowercase()}" }) {
        Icon(Icons.Rounded.Tune, null, tint = C.Ink, modifier = Modifier.size(26.dp))
    }
}

/** Panneau « Affichage » : présentation et organisation, appliquées tout de suite (sans « Enregistrer ») et mémorisées pour le profil. */
@Composable
private fun DisplaySheet(onDismiss: () -> Unit) {
    val demo = LocalDemo.current
    AppSheet(onDismiss) {
        Text("Affichage", style = MaterialTheme.typography.titleLarge)
        Text("Appliqué tout de suite et mémorisé pour votre profil. Votre sélection ne change pas.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(14.dp))
        Text("Présentation", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SelMode.entries.forEach { m -> ChoiceRow(m.label, if (m == SelMode.LIST) Icons.Rounded.ViewList else Icons.Rounded.GridView, demo.selMode == m, Modifier.weight(1f)) { demo.data?.setSelMode(m) ?: run { demo.selMode = m } } }
        }
        Spacer(Modifier.height(14.dp))
        Text("Organisation", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SelOrg.entries.forEach { o -> ChoiceRow(o.label, if (o == SelOrg.GLOBAL) Icons.Rounded.ViewAgenda else Icons.Rounded.Category, demo.selOrg == o, Modifier.weight(1f)) { demo.data?.setSelOrg(o) ?: run { demo.selOrg = o } } }
        }
        Spacer(Modifier.height(16.dp))
        SecondaryButton("Fermer", onDismiss, Modifier.fillMaxWidth())
    }
}

@Composable
private fun ChoiceRow(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier.heightIn(min = 52.dp).clip(shape).background(if (selected) C.Teal else Color.White)
            .border(BorderStroke(if (selected) 0.dp else 1.dp, if (selected) C.Teal else C.Line), shape).clickable(onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = if (selected) "$label, choisi" else label }
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    ) {
        Icon(icon, null, tint = if (selected) Color.White else C.Ink, modifier = Modifier.size(18.dp))
        Text(label, style = MaterialTheme.typography.labelLarge, color = if (selected) Color.White else C.Ink, textAlign = TextAlign.Center, maxLines = 2)
        if (selected) Icon(Icons.Rounded.Check, null, tint = Color.White, modifier = Modifier.size(18.dp))
    }
}
