@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.CatProduct
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.PriceRef
import app.smartcourse.courses.nativeproto.net.LineAmount
import app.smartcourse.courses.nativeproto.net.fmtPrice
import app.smartcourse.courses.nativeproto.net.lineAmount
import app.smartcourse.courses.nativeproto.net.parseCents
import app.smartcourse.courses.nativeproto.net.parseMilli
import app.smartcourse.courses.nativeproto.net.parsePrice
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Composable
fun PricesScreen(onBack: () -> Unit) {
    if (LocalDemo.current.data == null) PricesScreenSim(onBack) else PricesReal(onBack)
}

/** Le prix est-il exprimé dans un format utilisable pour l'unité ACTUELLE du produit ? (sinon : ancien prix, à ressaisir) */
internal fun priceFits(p: CatProduct): Boolean = p.price != null && lineAmount(p.price, "1", p.unit) is LineAmount.Ok

private fun sourceLabel(p: PriceRef) = when (p.source) { "family" -> "Votre prix"; "community" -> "Prix de la ville"; else -> "Prix de référence" }

@Composable
private fun PricesReal(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data!!
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var cat by remember { mutableStateOf<String?>(null) }
    var missingOnly by remember { mutableStateOf(false) }
    var editId by remember { mutableStateOf<String?>(null) }
    var sync by remember { mutableStateOf(false) }
    val mine = data.catalogProducts.filter { it.active }
    val missing = mine.count { !priceFits(it) }
    val cats = mine.map { it.categoryLabel }.distinct()
    val shown = mine.filter { (cat == null || it.categoryLabel == cat) && (!missingOnly || !priceFits(it)) && (query.isBlank() || it.name.contains(query.trim(), ignoreCase = true)) }

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
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).heightIn(min = 60.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            RemotePhoto(p.photoUrl, 44.dp, 10.dp)
                            Column(Modifier.weight(1f)) {
                                Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                val stale = p.price != null && !priceFits(p)
                                if (stale) Text("Unité changée : prix à ressaisir ${perUnit(p.unit)}", style = MaterialTheme.typography.bodySmall, color = C.Amber, maxLines = 2)
                                else Text(p.price?.let { sourceLabel(it) } ?: "Réf. ${unitLabel2(p.unit)}", style = MaterialTheme.typography.bodySmall, maxLines = 1)
                            }
                            // Un ancien prix dans une autre unité n'est jamais présenté comme le prix actuel.
                            PricePill(p.price?.takeIf { priceFits(p) }?.let { fmtPrice(it) }) { editId = p.id }
                        }
                    }
                }
            }
        }
    }
    editId?.let { id ->
        data.catalogProducts.firstOrNull { it.id == id }?.let { p ->
            PriceSheet(p, { editId = null }) { scope.launch { data.refreshCatalog() } }
        }
    }
    if (sync) CommunitySheet({ sync = false }) { scope.launch { data.refreshCatalog() } }
}

private fun perUnit(u: String) = when (u) { "kg" -> "au kg"; "litre" -> "au litre"; else -> "à l'unité (${countLabelOf(u)})" }

private fun unitLabel2(u: String) = when (u) { "kg" -> "kg"; "litre" -> "litre"; else -> countLabelOf(u) }

@Composable
private fun PriceSheet(p: CatProduct, onDismiss: () -> Unit, onChanged: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data!!
    val scope = rememberCoroutineScope()
    val kind = unitKindOf(p.unit)
    val units = when (kind) { UnitKind.MASS -> listOf("kg", "g"); UnitKind.VOLUME -> listOf("litre", "ml"); UnitKind.COUNT -> listOf(p.unit) }
    // Ancien prix dans une autre unité (unité du produit changée) : affiché à part, jamais repris dans le formulaire avec la nouvelle unité.
    val stale = p.price?.takeIf { !priceFits(p) }
    val cur = p.price?.takeIf { stale == null }
    var amount by remember { mutableStateOf(cur?.amount?.replace('.', ',') ?: "") }
    var qty by remember { mutableStateOf(cur?.refQty?.replace('.', ',') ?: "1") }
    var unit by remember { mutableStateOf(cur?.refUnit?.takeIf { it in units } ?: units.first()) }
    var packaging by remember { mutableStateOf(cur?.packaging ?: "") }
    var format by remember { mutableStateOf(p.format ?: "") }
    val formatChanged = format.trim() != (p.format ?: "")
    // Prix modifié ? (enregistrer le seul format ne transforme jamais le prix commun en prix personnel)
    val priceChanged = cur == null || amount != cur.amount.replace('.', ',') || qty != cur.refQty.replace('.', ',') || unit != cur.refUnit || packaging != (cur.packaging ?: "")
    var why by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val cents = parseCents(amount)?.takeIf { it > 0 }
    val milli = parseMilli(qty)?.takeIf { it > 0 && (unit != "g" && unit != "ml" || it % 1000 == 0L) }
    val valid = cents != null && milli != null
    val fr = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(500); runCatching { fr.requestFocus() } }

    AppSheet(onDismiss) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RemotePhoto(p.photoUrl, 56.dp, 14.dp)
            Column(Modifier.weight(1f)) {
                Text(p.name, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("Prix indicatif (en dirhams)", style = MaterialTheme.typography.bodySmall)
            }
        }
        stale?.let {
            Spacer(Modifier.height(10.dp))
            Text(
                "Ancien prix : ${fmtPrice(it)}. L'unité de ce produit est maintenant « ${unitLabel2(p.unit)} » : ce prix ne peut pas être converti sans information complémentaire. Saisissez le prix ${perUnit(p.unit)}.",
                style = MaterialTheme.typography.bodySmall, color = C.Amber,
            )
        }
        Spacer(Modifier.height(14.dp))
        OutlinedTextField(
            value = amount, onValueChange = { amount = it }, singleLine = true, suffix = { Text("DH", color = C.Muted) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), textStyle = MaterialTheme.typography.titleLarge, shape = RoundedCornerShape(16.dp),
            isError = amount.isNotBlank() && cents == null,
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = C.Teal, unfocusedBorderColor = C.Line, focusedContainerColor = androidx.compose.ui.graphics.Color.White, unfocusedContainerColor = androidx.compose.ui.graphics.Color.White, cursorColor = C.Teal),
            modifier = Modifier.fillMaxWidth().focusRequester(fr),
        )
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("pour", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(
                value = qty, onValueChange = { qty = it }, singleLine = true, modifier = Modifier.width(96.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), shape = RoundedCornerShape(14.dp), isError = milli == null,
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = C.Teal, unfocusedBorderColor = C.Line, cursorColor = C.Teal),
            )
            if (units.size > 1) units.forEach { u -> ToggleChip(when (u) { "ml" -> "mL"; "litre" -> "L"; else -> u }, unit == u, { unit = u }) } else Text(unitLabel2(p.unit), style = MaterialTheme.typography.titleSmall)
        }
        if (kind == UnitKind.COUNT) {
            Spacer(Modifier.height(8.dp))
            FormField(packaging, { packaging = it.take(60) }, "Contenu (facultatif, ex. 250 g)")
        }
        Spacer(Modifier.height(8.dp))
        // Format du produit (facultatif) : affiché au moment de choisir l'article ; aucune conversion n'en est tirée.
        FormField(format, { format = it.take(60) }, "Format du produit (facultatif, ex. pot de 350 g)")
        if (cur != null) {
            Row(Modifier.padding(top = 6.dp).heightIn(min = 48.dp).then(Modifier), verticalAlignment = Alignment.CenterVertically) {
                TextButton({ why = !why }) { Text("D'où vient ce prix ?", color = C.TealDark) }
            }
            if (why) Text(
                when (cur.source) {
                    "family" -> "Vous avez saisi ce prix : il est commun à votre famille."
                    "community" -> "Prix proposé par les familles de votre ville, appliqué par un administrateur."
                    else -> "Prix de référence de l'application. Il devient « votre prix » dès que vous l'enregistrez."
                }, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 4.dp),
            )
        }
        Spacer(Modifier.height(10.dp))
        PrimaryButton("Enregistrer", {
            busy = true
            scope.launch {
                val body = if (!valid || !priceChanged) null else buildJsonObject {
                    put("amount", (cents!! / 100).toString() + "." + (cents % 100).toString().padStart(2, '0'))
                    put("refQty", java.math.BigDecimal(milli!!).movePointLeft(3).stripTrailingZeros().toPlainString())
                    put("refUnit", unit)
                    if (kind == UnitKind.COUNT && packaging.isNotBlank()) put("packaging", packaging.trim())
                }
                val f = if (!formatChanged) null else data.session.api.call("PATCH", "/api/products/${p.id}", buildJsonObject { put("format", format.trim()) })
                val r = body?.let { data.session.api.call("PUT", "/api/products/${p.id}/price", it) }
                when {
                    f is Outcome.Fail -> demo.say(explain(f))
                    r is Outcome.Fail -> demo.say(explain(r))
                    else -> { demo.say(if (r != null) "Prix enregistré." else "Format enregistré."); onChanged(); onDismiss() }
                }
                busy = false
            }
        }, Modifier.fillMaxWidth(), enabled = ((valid && priceChanged) || (formatChanged && (valid || amount.isBlank()))) && !busy)
        if (cur != null && cur.source == "family") {
            Spacer(Modifier.height(6.dp))
            SecondaryButton("Partager ce prix avec ma ville", {
                scope.launch {
                    when (val r = data.session.api.call("POST", "/api/prices/share", buildJsonObject { put("productId", p.id) })) {
                        is Outcome.Ok -> demo.say("Merci : votre prix est partagé, sans nom ni famille.")
                        is Outcome.Fail -> demo.say(when (r.code) {
                            "city_required" -> "Choisissez d'abord votre ville (menu Compte)."
                            "not_shareable" -> "Ce produit n'existe que dans votre famille : il ne peut pas être partagé."
                            "already_shared" -> "Ce produit a déjà été partagé aujourd'hui."
                            "price_inconsistent" -> "Ce prix semble très différent des prix connus : vérifiez le montant et l'unité."
                            "too_many_contributions" -> "Vous avez déjà beaucoup partagé aujourd'hui. Réessayez plus tard."
                            else -> explain(r)
                        })
                    }
                }
            }, Modifier.fillMaxWidth())
        }
        if (cur != null && cur.source != "base") TextButton({
            scope.launch {
                when (val r = data.session.api.call("DELETE", "/api/products/${p.id}/price")) {
                    is Outcome.Ok -> { demo.say("Prix initial rétabli."); onChanged(); onDismiss() }
                    is Outcome.Fail -> demo.say(explain(r))
                }
            }
        }, Modifier.align(Alignment.CenterHorizontally)) { Text("Rétablir le prix initial", color = C.Danger, fontWeight = FontWeight.SemiBold) }
    }
}

private data class Proposal(val productId: String, val name: String, val format: String, val price: PriceRef, val contributors: Int, val min: String, val max: String, val current: PriceRef?)

@Composable
private fun CommunitySheet(onDismiss: () -> Unit, onChanged: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data!!
    val scope = rememberCoroutineScope()
    var props by remember { mutableStateOf<List<Proposal>?>(null) }
    var city by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val picked = remember { mutableStateListOf<String>() }
    fun key(p: Proposal) = p.productId + "|" + p.format

    fun load() {
        scope.launch {
            when (val r = data.session.api.call("GET", "/api/prices/community")) {
                is Outcome.Ok -> {
                    city = r.value["city"]?.jsonPrimitive?.contentOrNull
                    props = r.value["proposals"]!!.jsonArray.map { it.jsonObject }.mapNotNull { x ->
                        val price = parsePrice(x["price"]) ?: return@mapNotNull null
                        Proposal(x["productId"]!!.jsonPrimitive.content, x["name"]!!.jsonPrimitive.content, x["format"]!!.jsonPrimitive.content, price,
                            x["contributors"]?.jsonPrimitive?.intOrNull ?: 0, x["min"]?.jsonPrimitive?.contentOrNull ?: "", x["max"]?.jsonPrimitive?.contentOrNull ?: "", parsePrice(x["current"]))
                    }
                    error = null
                }
                is Outcome.Fail -> error = if (r.code == "city_required") "Choisissez d'abord votre ville (menu Compte) pour recevoir les prix de votre ville." else explain(r)
            }
        }
    }
    LaunchedEffect(Unit) { load() }

    AppSheet(onDismiss) {
        Text("Synchroniser les prix", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text("Prix proposés par plusieurs familles de ${city ?: "votre ville"}. Rien ne s'applique tout seul : vous choisissez.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(10.dp))
        error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
        if (props == null && error == null) Text("Chargement…", color = C.Muted)
        if (props?.isEmpty() == true) Text("Aucune nouvelle proposition pour le moment.", color = C.Muted, modifier = Modifier.padding(vertical = 8.dp))
        LazyColumn(Modifier.heightIn(max = 360.dp)) {
            items(props ?: emptyList(), key = { key(it) }) { p ->
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CheckBox(key(p) in picked, { if (it) picked.add(key(p)) else picked.remove(key(p)) })
                    Column(Modifier.weight(1f)) {
                        Text(p.name, style = MaterialTheme.typography.titleSmall, maxLines = 2)
                        Text("${fmtPrice(p.price)} · ${p.contributors} familles (${p.min}–${p.max} DH)", style = MaterialTheme.typography.bodySmall)
                        p.current?.let { Text("Actuel : ${fmtPrice(it)}", style = MaterialTheme.typography.labelSmall, color = C.Muted) }
                    }
                    TextButton({
                        scope.launch {
                            when (val r = data.session.api.call("POST", "/api/prices/community/report", buildJsonObject { put("productId", p.productId); put("format", p.format) })) {
                                is Outcome.Ok -> { demo.say("Proposition signalée : elle ne vous sera plus montrée."); load() }
                                is Outcome.Fail -> demo.say(explain(r))
                            }
                        }
                    }) { Text("Signaler", color = C.Muted) }
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        PrimaryButton(if (picked.isEmpty()) "Choisissez des prix" else "Appliquer ${picked.size} prix", {
            val chosen = props?.filter { key(it) in picked } ?: emptyList()
            scope.launch {
                val body = buildJsonObject { put("items", buildJsonArray { chosen.forEach { add(buildJsonObject { put("productId", it.productId); put("format", it.format) }) } }) }
                when (val r = data.session.api.call("POST", "/api/prices/community/apply", body)) {
                    is Outcome.Ok -> { demo.say("${r.value["applied"]?.jsonPrimitive?.intOrNull ?: 0} prix appliqué(s)."); onChanged(); onDismiss() }
                    is Outcome.Fail -> demo.say(explain(r))
                }
            }
        }, Modifier.fillMaxWidth(), enabled = picked.isNotEmpty(), leading = Icons.Rounded.Sync)
    }
}
