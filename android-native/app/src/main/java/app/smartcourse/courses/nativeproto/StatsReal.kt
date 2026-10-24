@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.ViewList
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.Outcome
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * Statistiques d'achats. Un achat = un article coché « Acheté » (les achats corrigés ne comptent pas). Les quantités gardent l'unité
 * enregistrée au moment de l'achat : des unités différentes ne sont jamais additionnées (« 2 pièces et 1 kg »). Aucun prix indicatif
 * n'est présenté comme une dépense, et aucun paiement par magasin n'est réparti entre les produits.
 */

private data class UnitTotal(val unit: String?, val purchases: Int, val quantity: Double?, val unknown: Int)
private data class StatRow(val productId: String, val name: String, val category: String, val photoUrl: String?, val purchases: Int, val units: List<UnitTotal>)
private data class StatData(val purchases: Int, val products: Int, val compare: Int?, val partial: Boolean, val rows: List<StatRow>, val fromDay: String?, val toDay: String?)
private data class Occurrence(val at: String, val quantity: Double?, val unit: String?, val listName: String?, val listCreatedAt: String?, val buyer: String?)
private data class ProductHistory(val purchases: Int, val units: List<UnitTotal>, val items: List<Occurrence>, val truncated: Boolean, val fromDay: String?, val toDay: String?)

/** Écran affiché dans l'onglet Statistiques. */
private sealed interface StatsView {
    data object Overview : StatsView
    data object All : StatsView
    data class Detail(val productId: String, val name: String, val photoUrl: String?, val fromAll: Boolean) : StatsView
}

private val PERIODS = listOf("Ce mois", "Mois précédent", "3 mois")
private val PERIOD_NAMES = listOf("Ce mois", "Mois précédent", "3 derniers mois")
private fun periodQuery(period: Int) = when (period) { 0 -> "period=month"; 1 -> "period=month&month=${YearMonth.now().minusMonths(1)}"; else -> "period=last3" }

private fun unitsOf(arr: JsonArray?): List<UnitTotal> = arr?.map { it.jsonObject }?.map { u ->
    UnitTotal(u["unit"]?.jsonPrimitive?.contentOrNull, u["purchases"]?.jsonPrimitive?.intOrNull ?: 0, u["quantity"]?.jsonPrimitive?.doubleOrNull, u["unknownQuantity"]?.jsonPrimitive?.intOrNull ?: 0)
} ?: emptyList()

private fun str(o: JsonObject?, k: String) = o?.get(k)?.jsonPrimitive?.contentOrNull

/** « 3 achats » : un achat = un article coché « Acheté ». */
private fun purchasesText(n: Int) = if (n == 1) "1 achat" else "$n achats"

/** Quantité telle qu'enregistrée, lisible dans sa dimension : « 250 g », « 1,5 kg », « 250 mL », « 2 paquets », « 1 pièce ». */
private fun recordedQty(unit: String, q: Double): String = when (unit) {
    "kg" -> if (q < 1) "${fmtNum(q * 1000)} g" else "${fmtNum(q)} kg"
    "litre" -> if (q < 1) "${fmtNum(q * 1000)} mL" else "${fmtNum(q)} L"
    else -> { val l = countLabelOf(unit); "${fmtNum(q)} " + if (q > 1) "${l}s" else l }
}

/** Quantité cumulée par unité, jamais additionnée entre unités : « 2 pièces et 1 kg ». null si aucune quantité n'est connue. */
private fun cumulText(units: List<UnitTotal>): String? {
    val parts = units.filter { it.unit != null && it.quantity != null }.map { recordedQty(it.unit!!, it.quantity!!) }
    return if (parts.isEmpty()) null else parts.joinToString(" et ")
}

private val DAY_FMT = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.FRENCH)
private val WHEN_FMT = DateTimeFormatter.ofPattern("EEE d MMM yyyy · HH:mm", Locale.FRENCH)
private fun dayText(day: String?) = try { LocalDate.parse(day).format(DAY_FMT) } catch (_: Exception) { "" }
private fun rangeText(from: String?, to: String?) = if (from == null || to == null) "" else if (from == to) "le ${dayText(from)}" else "du ${dayText(from)} au ${dayText(to)}"
private fun whenText(iso: String) = try { OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(WHEN_FMT).replaceFirstChar { it.uppercase() } } catch (_: Exception) { iso }

private fun failText(r: Outcome.Fail) = when (r.failure) {
    Failure.FORBIDDEN -> "Votre profil n'a pas accès aux statistiques."
    Failure.NETWORK, Failure.TIMEOUT, Failure.TLS -> "Chargement impossible : pas de connexion. Ce n'est pas une absence d'achats."
    else -> "Chargement impossible pour le moment. Ce n'est pas une absence d'achats."
}

private fun parseStats(v: JsonObject): StatData {
    val t = v["totals"]!!.jsonObject
    val cmp = v["comparison"]?.jsonObject?.get("available")?.jsonPrimitive?.contentOrNull == "true"
    val w = v["window"]?.jsonObject
    return StatData(
        t["purchases"]?.jsonPrimitive?.intOrNull ?: 0, t["products"]?.jsonPrimitive?.intOrNull ?: 0,
        if (cmp) t["comparePurchases"]?.jsonPrimitive?.intOrNull else null,
        str(w, "partial") == "true",
        v["rows"]!!.jsonArray.map { it.jsonObject }.map { x ->
            StatRow(x["productId"]!!.jsonPrimitive.content, x["name"]!!.jsonPrimitive.content, str(x, "categoryLabel") ?: "", str(x, "photoUrl"),
                x["purchases"]?.jsonPrimitive?.intOrNull ?: 0, unitsOf(x["units"]?.jsonArray))
        },
        str(w, "fromDay"), str(w, "toDay"),
    )
}

@Composable
fun StatsScreen() {
    if (LocalDemo.current.data == null) StatsScreenSim() else StatsReal()
}

@Composable
private fun StatsReal() {
    val demo = LocalDemo.current
    val data = demo.data!!
    var period by rememberSaveable { mutableIntStateOf(0) }
    var view by remember { mutableStateOf<StatsView>(StatsView.Overview) }
    // Liste complète : recherche, données et position de défilement conservées au retour de l'historique d'un produit.
    var query by rememberSaveable { mutableStateOf("") }
    val allState = rememberLazyListState()
    var all by remember { mutableStateOf<StatData?>(null) }
    var allPeriod by remember { mutableIntStateOf(-1) }

    var resetScroll by remember { mutableStateOf(false) }

    when (val v = view) {
        StatsView.Overview -> Overview(period, { period = it }, onAll = {
            // Autre période que la dernière liste complète consultée : liste rechargée, recherche et position remises à zéro.
            if (allPeriod != period) { all = null; query = ""; resetScroll = true }
            view = StatsView.All
        }, onOpen = { r -> view = StatsView.Detail(r.productId, r.name, r.photoUrl, fromAll = false) })
        StatsView.All -> {
            androidx.activity.compose.BackHandler { view = StatsView.Overview }
            LaunchedEffect(resetScroll) { if (resetScroll) { allState.scrollToItem(0); resetScroll = false } }
            AllProducts(
                period, all, query, { query = it }, allState,
                load = {
                    when (val r = data.session.api.call("GET", "/api/stats/purchases?${periodQuery(period)}")) {
                        is Outcome.Ok -> { all = parseStats(r.value); allPeriod = period; null }
                        is Outcome.Fail -> failText(r)
                    }
                },
                onBack = { view = StatsView.Overview },
                onOpen = { r -> view = StatsView.Detail(r.productId, r.name, r.photoUrl, fromAll = true) },
            )
        }
        is StatsView.Detail -> {
            val back = { view = if (v.fromAll) StatsView.All else StatsView.Overview }
            androidx.activity.compose.BackHandler { back() }
            ProductHistoryScreen(v, period, back)
        }
    }
}

@Composable
private fun Overview(period: Int, onPeriod: (Int) -> Unit, onAll: () -> Unit, onOpen: (StatRow) -> Unit) {
    val data = LocalDemo.current.data!!
    var help by remember { mutableStateOf(false) }
    var stats by remember { mutableStateOf<StatData?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }

    LaunchedEffect(period, reload) {
        stats = null; error = null
        when (val r = data.session.api.call("GET", "/api/stats/purchases?${periodQuery(period)}")) {
            is Outcome.Ok -> stats = parseStats(r.value)
            is Outcome.Fail -> error = failText(r)
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Statistiques", actions = { IconButton({ help = true }) { Icon(Icons.Rounded.Info, "Aide sur les statistiques", tint = C.TealDark) } })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SegTabs(PERIODS, period, onPeriod)
            error?.let {
                Text(it, color = C.Muted, modifier = Modifier.padding(vertical = 24.dp))
                SecondaryButton("Réessayer", { reload++ })
            }
            if (stats == null && error == null) Text("Chargement…", color = C.Muted, modifier = Modifier.padding(vertical = 24.dp))
            stats?.let { d ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Kpi("Achats", d.purchases.toString(), Modifier.weight(1f))
                    Kpi("Produits différents", d.products.toString(), Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val diff = d.compare?.let { d.purchases - it }
                    Kpi("Période précédente", diff?.let { (if (it > 0) "+" else "") + it } ?: "—", Modifier.weight(1f), tag = if (diff != null) "même durée" else "pas d'historique", tagFg = C.Muted, tagBg = Color(0xFFE4EDF5))
                    Kpi("Dépense payée", "—", Modifier.weight(1f), tag = "non saisie", tagFg = C.Muted, tagBg = Color(0xFFE4EDF5))
                }
                val byCat = d.rows.groupBy { it.category }.mapValues { e -> e.value.sumOf { it.purchases } }.toList().sortedByDescending { it.second }
                if (byCat.isEmpty()) SCard(padding = PaddingValues(16.dp)) { Text("Aucun achat sur cette période.", color = C.Muted) }
                else {
                    SCard(padding = PaddingValues(16.dp)) {
                        Text("Achats par catégorie", style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(10.dp))
                        val max = byCat.first().second.coerceAtLeast(1)
                        byCat.take(6).forEach { (c, n) ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 5.dp)) {
                                Text(c, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1.1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Box(Modifier.weight(1f).height(10.dp).clip(RoundedCornerShape(5.dp)).background(C.Track)) {
                                    Box(Modifier.fillMaxHeight().fillMaxWidth(n / max.toFloat()).clip(RoundedCornerShape(5.dp)).background(Brush.horizontalGradient(listOf(C.Teal, Color(0xFF45D6CF)))))
                                }
                                Text("$n", style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(36.dp), textAlign = TextAlign.End)
                            }
                        }
                    }
                    SCard(padding = PaddingValues(16.dp)) {
                        Text("Produits les plus achetés", style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(8.dp))
                        d.rows.take(8).forEachIndexed { i, r ->
                            if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f))
                            ProductRow(r) { onOpen(r) }
                        }
                        Spacer(Modifier.height(10.dp))
                        SecondaryButton("Voir tous les produits (${d.rows.size})", onAll, Modifier.fillMaxWidth(), leading = Icons.Rounded.ViewList)
                    }
                }
                if (d.partial) Text("Le mois est en cours : la comparaison porte sur le même nombre de jours de la période précédente.", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
    if (help) AlertDialog(
        onDismissRequest = { help = false }, containerColor = Color.White, shape = RoundedCornerShape(24.dp),
        title = { Text("À propos des statistiques", style = MaterialTheme.typography.titleLarge) },
        text = { Text("Un achat = un article coché « acheté ». Les achats corrigés ne comptent pas. Aucun montant n'est calculé : la dépense réellement payée n'est jamais saisie, et les prix indicatifs ne servent qu'à estimer la liste en cours.", style = MaterialTheme.typography.bodyMedium) },
        confirmButton = { TextButton({ help = false }) { Text("Compris", color = C.TealDark) } },
    )
}

/** Ligne produit : photo, nom, quantité cumulée (par unité) et nombre d'achats ; un appui ouvre son historique. */
@Composable
private fun ProductRow(r: StatRow, onClick: () -> Unit) {
    val qty = cumulText(r.units)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(onClick = onClick).padding(vertical = 6.dp)
            .semantics(mergeDescendants = true) { contentDescription = "${r.name}, ${purchasesText(r.purchases)}${qty?.let { ", $it" } ?: ""}. Voir l'historique des achats" },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        RemotePhoto(r.photoUrl, 40.dp, 10.dp)
        Column(Modifier.weight(1f)) {
            Text(r.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(qty ?: "Quantité non enregistrée", style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text(purchasesText(r.purchases), style = MaterialTheme.typography.titleSmall, color = C.TealDark)
    }
}

@Composable
private fun AllProducts(
    period: Int, d: StatData?, query: String, onQuery: (String) -> Unit, listState: LazyListState,
    load: suspend () -> String?, onBack: () -> Unit, onOpen: (StatRow) -> Unit,
) {
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(period, reload, d == null) { if (d == null) { error = null; error = load() } }
    // Recherche sur TOUS les produits achetés de la période (partie du nom, sans majuscules ni accents).
    val needle = flatSearch(query)
    val shown = d?.rows?.filter { needle.isEmpty() || flatSearch(it.name).contains(needle) } ?: emptyList()

    Column(Modifier.fillMaxSize()) {
        TopBar("Tous les produits achetés", subtitle = "${PERIOD_NAMES[period]} ${rangeText(d?.fromDay, d?.toDay)}".trim(), onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp)) { SearchBox(query, onQuery, "Rechercher un produit…") }
        Spacer(Modifier.height(8.dp))
        when {
            error != null -> Column(Modifier.padding(16.dp)) {
                Text(error!!, color = C.Muted, modifier = Modifier.padding(vertical = 16.dp))
                SecondaryButton("Réessayer", { reload++ })
            }
            d == null -> Text("Chargement…", color = C.Muted, modifier = Modifier.padding(16.dp))
            d.rows.isEmpty() -> Text("Aucun achat sur cette période.", color = C.Muted, modifier = Modifier.padding(16.dp))
            shown.isEmpty() -> Text("Aucun produit acheté ne correspond à votre recherche", color = C.Muted, modifier = Modifier.padding(16.dp))
            else -> LazyColumn(Modifier.weight(1f), state = listState, contentPadding = PaddingValues(16.dp, 0.dp, 16.dp, 16.dp)) {
                item {
                    Text(
                        if (needle.isEmpty()) "${d.rows.size} produit${if (d.rows.size > 1) "s" else ""} · classés par nombre d'achats"
                        else "${shown.size} sur ${d.rows.size} produit${if (d.rows.size > 1) "s" else ""}",
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 6.dp),
                    )
                }
                items(shown, key = { it.productId }) { r ->
                    Column {
                        ProductRow(r) { onOpen(r) }
                        HorizontalDivider(color = C.Line.copy(alpha = 0.6f))
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductHistoryScreen(v: StatsView.Detail, period: Int, onBack: () -> Unit) {
    val data = LocalDemo.current.data!!
    var everything by rememberSaveable(v.productId) { mutableStateOf(false) }
    var h by remember { mutableStateOf<ProductHistory?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(v.productId, everything, reload) {
        h = null; error = null
        val q = if (everything) "period=all" else periodQuery(period)
        when (val r = data.session.api.call("GET", "/api/stats/products/${v.productId}?$q")) {
            is Outcome.Ok -> {
                val o = r.value
                val s = o["summary"]?.jsonObject
                val w = o["window"]?.jsonObject
                h = ProductHistory(
                    s?.get("purchases")?.jsonPrimitive?.intOrNull ?: 0, unitsOf(s?.get("units")?.jsonArray),
                    o["purchases"]?.jsonArray?.map { it.jsonObject }?.map { p ->
                        val l = p["list"]?.jsonObject
                        Occurrence(p["at"]!!.jsonPrimitive.content, p["quantity"]?.jsonPrimitive?.doubleOrNull, str(p, "unit"), str(l, "name"), str(l, "createdAt"), str(p["by"]?.jsonObject, "displayName"))
                    } ?: emptyList(),
                    str(o, "truncated") == "true", str(w, "fromDay"), str(w, "toDay"),
                )
            }
            is Outcome.Fail -> error = if (r.failure == Failure.NOT_FOUND) "Ce produit n'est pas disponible." else failText(r)
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Historique des achats", onBack = onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp, 0.dp, 16.dp, 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    RemotePhoto(v.photoUrl, 56.dp, 14.dp)
                    Text(v.name, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                }
            }
            item { SegTabs(listOf(PERIOD_NAMES[period], "Tout l'historique"), if (everything) 1 else 0, { everything = it == 1 }) }
            item {
                Text(
                    (if (everything) "Tout l'historique" else PERIOD_NAMES[period]) + " · " + rangeText(h?.fromDay, h?.toDay),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            when {
                error != null -> item {
                    Text(error!!, color = C.Muted, modifier = Modifier.padding(vertical = 12.dp))
                    SecondaryButton("Réessayer", { reload++ }, Modifier.fillMaxWidth())
                }
                h == null -> item { Text("Chargement…", color = C.Muted, modifier = Modifier.padding(vertical = 12.dp)) }
                else -> {
                    val x = h!!
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Kpi("Nombre d'achats", purchasesText(x.purchases), Modifier.weight(1f))
                            Kpi("Quantité cumulée", cumulText(x.units) ?: "—", Modifier.weight(1f))
                        }
                    }
                    val unknown = x.units.sumOf { it.unknown }
                    if (unknown > 0) item { Text("$unknown achat${if (unknown > 1) "s" else ""} sans quantité enregistrée (avant le suivi des quantités).", style = MaterialTheme.typography.bodySmall) }
                    if (x.items.isEmpty()) item {
                        SCard(padding = PaddingValues(16.dp)) {
                            Text(if (everything) "Aucun achat enregistré pour ce produit." else "Aucun achat de ce produit sur cette période.", color = C.Muted)
                            if (!everything) TextButton({ everything = true }) { Text("Voir tout l'historique", color = C.TealDark) }
                        }
                    } else item {
                        SCard(padding = PaddingValues(horizontal = 16.dp, vertical = 6.dp)) {
                            x.items.forEachIndexed { i, o ->
                                if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f))
                                Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Column(Modifier.weight(1f)) {
                                        Text(whenText(o.at), style = MaterialTheme.typography.titleSmall)
                                        Text(
                                            listOfNotNull(o.listName?.let { "Liste « $it »" } ?: o.listCreatedAt?.let { "Liste du ${frenchDate(it).lowercase()}" }, o.buyer?.let { "coché par $it" }).joinToString(" · "),
                                            style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                    Text(if (o.unit != null && o.quantity != null) recordedQty(o.unit, o.quantity) else "Quantité inconnue", style = MaterialTheme.typography.titleSmall, color = C.TealDark)
                                }
                            }
                        }
                    }
                    if (x.truncated) item { Text("Seuls les ${x.items.size} achats les plus récents sont listés ; les totaux portent sur toute la période.", style = MaterialTheme.typography.bodySmall) }
                    item { Text("Date d'achat : moment où l'article a été coché « Acheté ». Les prix indicatifs ne sont pas des dépenses.", style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
    }
}
