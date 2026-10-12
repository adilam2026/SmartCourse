@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.BorderStroke

/** Sélecteur de catégorie (menu natif). */
@Composable
fun CategoryPicker(selected: String?, categories: List<String>, onSelect: (String?) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(14.dp)
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().height(46.dp).soft(shape, 2.dp).clip(shape).background(Color.White).clickable { open = true }.padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(selected ?: "Toutes les catégories", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.Rounded.KeyboardArrowDown, "Choisir une catégorie", tint = C.Muted)
        }
        DropdownMenu(open, { open = false }, containerColor = Color.White, shape = RoundedCornerShape(16.dp)) {
            DropdownMenuItem(text = { Text("Toutes les catégories") }, onClick = { open = false; onSelect(null) })
            categories.forEach { c -> DropdownMenuItem(text = { Text(c) }, onClick = { open = false; onSelect(c) }) }
        }
    }
}

/* ───────────── V09 — Catalogue ───────────── */

@Composable
fun CatalogScreen(onBack: () -> Unit) {
    val session = LocalSession.current
    if (session != null) CatalogScreenReal(session, onBack) else CatalogScreenSim(onBack)
}

@Composable
fun CatalogScreenSim(onBack: () -> Unit) {
    val demo = LocalDemo.current
    var tab by remember { mutableIntStateOf(when (Launch.str("tab")) { "in" -> 1; "out" -> 2; else -> 0 }) }
    var query by remember { mutableStateOf("") }
    var cat by remember { mutableStateOf<String?>(null) }
    val all = demo.products
    val inCount = all.count { demo.inCatalog[it.id] == true }
    val outCount = all.size - inCount
    val cats = all.map { it.category }.distinct()
    val base = all.filter { (cat == null || it.category == cat) && (query.isBlank() || it.name.contains(query.trim(), ignoreCase = true)) }
    val shown = when (tab) {
        1 -> base.filter { demo.inCatalog[it.id] == true }
        2 -> base.filter { demo.inCatalog[it.id] != true }
        else -> base.filter { demo.inCatalog[it.id] == true } + base.filter { demo.inCatalog[it.id] != true } // présents d'abord
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("Catalogue", onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SearchBox(query, { query = it }, "Rechercher un produit…")
            SegTabs(listOf("Tous (${all.size})", "Dans mon catalogue ($inCount)", "À ajouter ($outCount)"), tab, { tab = it })
            CategoryPicker(cat, cats, { cat = it })
        }
        Spacer(Modifier.height(8.dp))
        if (shown.isEmpty()) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Aucun produit.", color = C.Muted) }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp, 0.dp, 16.dp, 16.dp)) {
            item {
                SCard {
                    shown.forEachIndexed { i, p ->
                        val inside = demo.inCatalog[p.id] == true
                        if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(start = 66.dp))
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Photo(p.photo, 46.dp, radius = 10.dp)
                            Column(Modifier.weight(1f)) {
                                Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                    Box(Modifier.size(7.dp).clip(CircleShape).background(if (inside) C.Teal else Color(0xFFB9C7D4)))
                                    Text(if (inside) "Dans mon catalogue" else "Disponible", style = MaterialTheme.typography.bodySmall, maxLines = 1)
                                }
                            }
                            if (inside) RowAction("Retirer", {
                                demo.inCatalog[p.id] = false
                                demo.say("« ${p.name} » retiré de votre catalogue (simulation)", "Annuler") { demo.inCatalog[p.id] = true }
                            }, false)
                            else RowAction("Ajouter", { demo.inCatalog[p.id] = true; demo.say("« ${p.name} » ajouté à votre catalogue (simulation)", "Annuler") { demo.inCatalog[p.id] = false } }, true)
                        }
                    }
                }
            }
        }
    }
}

/* ───────────── V10 — Gestion des prix ───────────── */

@Composable
fun PricesScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    var query by remember { mutableStateOf("") }
    var cat by remember { mutableStateOf<String?>(null) }
    var missingOnly by remember { mutableStateOf(Launch.str("filter") == "missing") }
    var editId by remember { mutableStateOf(Launch.strOnce("edit")) }
    var sync by remember { mutableStateOf(Launch.once("sync")) }
    val mine = demo.products.filter { demo.inCatalog[it.id] == true }
    val missing = mine.count { demo.prices[it.id] == null }
    val cats = mine.map { it.category }.distinct()
    val shown = mine.filter { (cat == null || it.category == cat) && (!missingOnly || demo.prices[it.id] == null) && (query.isBlank() || it.name.contains(query.trim(), ignoreCase = true)) }

    Column(Modifier.fillMaxSize()) {
        TopBar("Gestion des prix", onBack = onBack, actions = {
            IconButton({ sync = true }) { Icon(Icons.Rounded.Sync, "Synchroniser les prix de la ville", tint = C.TealDark) }
        })
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SearchBox(query, { query = it }, "Rechercher un produit…")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                CategoryPicker(cat, cats, { cat = it }, Modifier.weight(1f))
                ToggleChip(if (missing > 0) "Sans prix ($missing)" else "Sans prix", missingOnly, { missingOnly = !missingOnly })
            }
        }
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp, 0.dp, 16.dp, 16.dp)) {
            item {
                SCard {
                    if (shown.isEmpty()) Text("Aucun produit.", color = C.Muted, modifier = Modifier.padding(16.dp))
                    shown.forEachIndexed { i, p ->
                        if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(start = 66.dp))
                        val price = demo.prices[p.id]
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).heightIn(min = 60.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Photo(p.photo, 44.dp, radius = 10.dp)
                            Column(Modifier.weight(1f)) {
                                Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text("Réf. ${refLabel(p)}", style = MaterialTheme.typography.bodySmall, maxLines = 1)
                            }
                            PricePill(price?.let { priceText(it, p) }) { editId = p.id }
                        }
                    }
                }
            }
        }
    }

    editId?.let { id -> demo.byId[id]?.let { p -> PriceEditSheet(p, demo.prices[id], { editId = null }, { c -> if (c == null) demo.prices.remove(id) else demo.prices[id] = c; editId = null; demo.simulated("prix enregistré") }) } }
    if (sync) SyncSheet({ sync = false })
}

@Composable
private fun PricePill(text: String?, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    if (text != null) Box(
        Modifier.heightIn(min = 40.dp).widthIn(min = 110.dp).soft(shape, 1.dp).clip(shape).background(Color.White).border(BorderStroke(1.dp, C.Line), shape)
            .clickable(onClick = onClick).padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = MaterialTheme.typography.titleSmall, maxLines = 1) }
    else Box(
        Modifier.heightIn(min = 40.dp).widthIn(min = 110.dp).clip(shape).background(C.TealSoft).border(BorderStroke(1.dp, C.Teal.copy(alpha = 0.6f)), shape)
            .clickable(onClick = onClick).padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text("+ Ajouter un prix", color = C.TealDark, style = MaterialTheme.typography.labelLarge, maxLines = 1) }
}

@Composable
private fun PriceEditSheet(p: Product, current: Int?, onDismiss: () -> Unit, onSave: (Int?) -> Unit) {
    var text by remember { mutableStateOf(current?.let { String.format(java.util.Locale.US, "%d,%02d", it / 100, it % 100) } ?: "") }
    var why by remember { mutableStateOf(false) }
    val cents = text.trim().replace(',', '.').toDoubleOrNull()?.takeIf { it > 0 }?.let { Math.round(it * 100).toInt() }
    AppSheet(onDismiss) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Photo(p.photo, 56.dp, radius = 14.dp)
            Column(Modifier.weight(1f)) {
                Text(p.name, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("Prix par ${refLabel(p)}", style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(14.dp))
        OutlinedTextField(
            value = text, onValueChange = { text = it }, singleLine = true,
            suffix = { Text("DH / ${refLabel(p)}", color = C.Muted) },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
            textStyle = MaterialTheme.typography.titleLarge, shape = RoundedCornerShape(16.dp),
            isError = text.isNotBlank() && cents == null,
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = C.Teal, unfocusedBorderColor = C.Line, focusedContainerColor = Color.White, unfocusedContainerColor = Color.White, cursorColor = C.Teal),
            modifier = Modifier.fillMaxWidth(),
        )
        if (current != null) {
            Spacer(Modifier.height(6.dp))
            Row(Modifier.clip(RoundedCornerShape(8.dp)).clickable { why = !why }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Info, null, tint = C.TealDark, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("D'où vient ce prix ?", color = C.TealDark, style = MaterialTheme.typography.labelLarge)
            }
            if (why) Text("Prix de référence de la ville, calculé à partir de relevés. Il devient « prix de votre famille » dès que vous l'enregistrez.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 4.dp))
        }
        Spacer(Modifier.height(10.dp))
        PrimaryButton("Enregistrer", { onSave(cents) }, Modifier.fillMaxWidth(), enabled = cents != null)
        if (current != null) TextButton({ onSave(null) }, Modifier.align(Alignment.CenterHorizontally)) { Text("Retirer le prix", color = C.Danger, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) }
    }
}

@Composable
private fun SyncSheet(onDismiss: () -> Unit) {
    val demo = LocalDemo.current
    var city by remember { mutableIntStateOf(0) }
    val cities = listOf("Casablanca", "Rabat", "Marrakech")
    AppSheet(onDismiss) {
        Text("Synchroniser les prix", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text("Récupère les prix de référence de la ville. Vos prix saisis ne sont jamais écrasés.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(14.dp))
        SegTabs(cities, city, { city = it })
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.LocationCity, null, tint = C.TealDark)
            Text("Données fictives : ${12 + city * 3} prix disponibles pour ${cities[city]}.", style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton("Synchroniser", { onDismiss(); demo.simulated("synchronisation des prix de ${cities[city]}") }, Modifier.fillMaxWidth(), leading = Icons.Rounded.Sync)
    }
}
