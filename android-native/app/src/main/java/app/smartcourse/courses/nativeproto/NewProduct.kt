@file:OptIn(ExperimentalLayoutApi::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Unités proposées pour un nouveau produit (mêmes clés que le serveur). */
private val UNIT_CHOICES = listOf("piece" to "Pièce", "paquet" to "Paquet", "bouteille" to "Bouteille", "brique" to "Brique", "pot" to "Pot", "boite" to "Boîte", "kg" to "kg", "litre" to "Litre")

/** Même règle que le serveur : l'unité proposée suit la catégorie ; « Autres » = à la pièce. */
fun defaultUnitFor(category: String): String = when (category) {
    "legumes", "fruits", "viandes" -> "kg"
    "boissons" -> "bouteille"
    "epicerie", "surgeles" -> "paquet"
    else -> "piece"
}

/** Recherche sans résultat (ou fin des résultats) : « Ajouter « … » ». */
@Composable
fun AddProductCard(query: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(Color.White).border(BorderStroke(1.5.dp, C.Teal), shape).clickable(onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = "Ajouter un produit : ${query.trim()}" }.padding(12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(C.Teal), contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Add, null, tint = Color.White) }
        Column(Modifier.weight(1f)) {
            Text("Ajouter « ${query.trim()} »", style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("Nouveau produit de votre famille, utilisable tout de suite.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** Référence du catalogue commun proposée pendant la recherche. */
@Composable
fun SuggestionRow(s: Suggestion, canUse: Boolean, onUse: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(Color.White).then(if (canUse) Modifier.clickable(onClick = onUse) else Modifier).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        RemotePhoto(s.photoUrl, 48.dp, radius = 10.dp)
        Column(Modifier.weight(1f)) {
            Text(s.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(if (canUse) s.categoryLabel else "Retiré du catalogue par un administrateur", style = MaterialTheme.typography.bodySmall)
        }
        if (canUse) Box(Modifier.size(40.dp).clip(CircleShape).background(C.Teal), contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Add, "Ajouter ${s.name}", tint = Color.White) }
    }
}

/**
 * Création d'un produit pour la famille : nom (obligatoire, prérempli avec la recherche), catégorie facultative (« Autres » par défaut),
 * unité proposée selon la catégorie, références proches rappelées avant création. Un seul envoi à la fois ; en cas d'erreur, la saisie reste.
 */
@Composable
fun NewProductSheet(initialName: String, onDismiss: () -> Unit, onCreated: (String) -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(initialName.trim().replace(Regex("\\s+"), " ")) }
    var category by remember { mutableStateOf("autres") }
    var unit by remember { mutableStateOf(defaultUnitFor("autres")) }
    var unitTouched by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var refs by remember { mutableStateOf<List<Suggestion>>(emptyList()) }
    val isAdmin = demo.role == Role.ADMIN
    val same = demo.products.firstOrNull { demo.inCatalog[it.id] == true && flatSearch(it.name) == flatSearch(name) }
    LaunchedEffect(name) {
        refs = emptyList()
        if (data == null || name.trim().length < 2) return@LaunchedEffect
        delay(350)
        refs = data.suggest(name).filter { it.status != "active" }.take(3)
    }
    fun finish(id: String?, err: String?) {
        busy = false
        if (id != null) { demo.byId[id]?.let { p -> if (demo.selQty(id) == null) demo.setSel(id, defaultQty(p)) }; onCreated(id) } else error = err
    }
    AppSheet(onDismiss) {
        Text("Nouveau produit", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(10.dp))
        Text("Nom", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(6.dp))
        FormField(
            name, { name = it.take(60); error = null }, "Nom du produit",
            keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
        Spacer(Modifier.height(12.dp))
        Text("Catégorie (facultative)", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(6.dp))
        val cats = remember(demo.categoryList) { demo.categoryList.sortedBy { if (it.first == "autres") 0 else 1 } }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            cats.forEach { (k, label) -> ToggleChip(label, category == k) { category = k; if (!unitTouched) unit = defaultUnitFor(k) } }
        }
        Spacer(Modifier.height(12.dp))
        Text("Unité", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(6.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            UNIT_CHOICES.forEach { (k, label) -> ToggleChip(label, unit == k) { unit = k; unitTouched = true } }
        }
        if (same != null || refs.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Bg).padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Rounded.Info, null, tint = C.TealDark, modifier = Modifier.size(18.dp))
                    Text("Déjà dans le catalogue ?", style = MaterialTheme.typography.titleSmall)
                }
                if (same != null) ChoosePlainRow(same.name, "Dans votre catalogue") {
                    if (demo.selQty(same.id) == null) demo.setSel(same.id, defaultQty(same)); onDismiss()
                }
                refs.forEach { s ->
                    val canUse = s.status == "absent" || isAdmin
                    if (canUse) ChoosePlainRow(s.name, s.categoryLabel) {
                        if (busy || data == null) return@ChoosePlainRow
                        busy = true; error = null
                        scope.launch { val (id, err) = data.createProduct(null, null, null, s); finish(id, err) }
                    }
                }
            }
        }
        error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.height(14.dp))
        PrimaryButton(if (busy) "Création…" else "Créer et ajouter à ma sélection", {
            if (busy) return@PrimaryButton
            if (data == null) { demo.say("Création de produit : disponible avec votre famille connectée."); return@PrimaryButton }
            busy = true; error = null
            scope.launch { val (id, err) = data.createProduct(name, category, unit, null); finish(id, err) }
        }, Modifier.fillMaxWidth(), enabled = name.isNotBlank() && !busy)
        Spacer(Modifier.height(8.dp))
        SecondaryButton("Annuler", onDismiss, Modifier.fillMaxWidth())
    }
}

@Composable
private fun ChoosePlainRow(title: String, sub: String, onChoose: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).clickable(onClick = onChoose).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sub, style = MaterialTheme.typography.bodySmall)
        }
        Text("Choisir plutôt", color = C.TealDark, style = MaterialTheme.typography.labelLarge)
    }
}

/** Bandeau après création : produit ajouté, et proposition facultative au catalogue commun. */
@Composable
fun CreatedBanner(name: String, onPropose: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Navy).padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("« $name » créé et ajouté à votre sélection.", color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).padding(vertical = 8.dp))
        TextButton(onPropose) { Text("Proposer", color = Color(0xFF7FE3DD), fontWeight = FontWeight.Bold) }
        Box(Modifier.size(44.dp).clickable(onClick = onClose), contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Close, "Fermer", tint = Color.White) }
    }
}

/** Proposition facultative au catalogue commun : rien n'est publié sans un gestionnaire ; le produit reste à la famille dans tous les cas. */
@Composable
fun ProposeSheet(p: Product, onDismiss: () -> Unit) {
    val demo = LocalDemo.current
    val scope = rememberCoroutineScope()
    var desc by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AppSheet(onDismiss) {
        Text("Proposer au catalogue commun", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ProductPhoto(p, 48.dp, radius = 12.dp)
            Column { Text(p.name, style = MaterialTheme.typography.titleSmall); Text(p.category, style = MaterialTheme.typography.bodySmall) }
        }
        Spacer(Modifier.height(12.dp))
        Text("Description (facultative)", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            desc, { desc = it.take(300); error = null }, minLines = 2, maxLines = 4,
            placeholder = { Text("Ex. : format, marque habituelle, où le trouver…", color = C.Muted) },
            shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = C.Teal, unfocusedBorderColor = C.Line, focusedContainerColor = Color.White, unfocusedContainerColor = Color.White, cursorColor = C.Teal),
        )
        Spacer(Modifier.height(8.dp))
        Text("Seuls le nom, la catégorie, l'unité et cette description sont envoyés aux gestionnaires de Mes Courses, jamais le nom de votre famille. Vous gardez votre produit dans tous les cas.", style = MaterialTheme.typography.bodySmall)
        error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.height(12.dp))
        PrimaryButton(if (busy) "Envoi…" else "Envoyer la proposition", {
            val d = demo.data ?: run { onDismiss(); return@PrimaryButton }
            if (busy) return@PrimaryButton
            busy = true; error = null
            scope.launch {
                val err = d.propose(p.id, desc)
                busy = false
                if (err == null) { demo.say("Proposition envoyée. Merci !"); onDismiss() } else error = err
            }
        }, Modifier.fillMaxWidth(), enabled = !busy, leading = Icons.Rounded.Send)
        Spacer(Modifier.height(8.dp))
        SecondaryButton("Plus tard", onDismiss, Modifier.fillMaxWidth())
    }
}
