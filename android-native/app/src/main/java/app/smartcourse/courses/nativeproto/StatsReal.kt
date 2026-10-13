@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Outcome
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.YearMonth

private data class StatRow(val name: String, val category: String, val photoUrl: String?, val purchases: Int, val qty: String)
private data class StatData(val purchases: Int, val products: Int, val compare: Int?, val partial: Boolean, val rows: List<StatRow>)

private fun qtyOf(units: List<JsonObject>): String = units.joinToString(" + ") { u ->
    val unit = u["unit"]?.jsonPrimitive?.contentOrNull
    val q = u["quantity"]?.jsonPrimitive?.doubleOrNull
    val n = u["purchases"]?.jsonPrimitive?.intOrNull ?: 0
    if (unit == null || q == null) "$n achat${if (n > 1) "s" else ""}"
    else qtyText(Product("", "", 0, "", unitKindOf(unit), countLabelOf(unit), null, true), toBase(unit, q))
}

@Composable
fun StatsScreen() {
    if (LocalDemo.current.data == null) StatsScreenSim() else StatsReal()
}

@Composable
private fun StatsReal() {
    val demo = LocalDemo.current
    val data = demo.data!!
    var period by remember { mutableIntStateOf(0) }
    var help by remember { mutableStateOf(false) }
    var stats by remember { mutableStateOf<StatData?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }

    LaunchedEffect(period, reload) {
        stats = null; error = null
        val q = when (period) { 0 -> "period=month"; 1 -> "period=month&month=${YearMonth.now().minusMonths(1)}"; else -> "period=last3" }
        when (val r = data.session.api.call("GET", "/api/stats/purchases?$q")) {
            is Outcome.Ok -> {
                val v = r.value
                val t = v["totals"]!!.jsonObject
                val cmp = v["comparison"]?.jsonObject?.get("available")?.jsonPrimitive?.contentOrNull == "true"
                stats = StatData(
                    t["purchases"]?.jsonPrimitive?.intOrNull ?: 0, t["products"]?.jsonPrimitive?.intOrNull ?: 0,
                    if (cmp) t["comparePurchases"]?.jsonPrimitive?.intOrNull else null,
                    v["window"]?.jsonObject?.get("partial")?.jsonPrimitive?.contentOrNull == "true",
                    v["rows"]!!.jsonArray.map { it.jsonObject }.map { x ->
                        StatRow(x["name"]!!.jsonPrimitive.content, x["categoryLabel"]?.jsonPrimitive?.contentOrNull ?: "", x["photoUrl"]?.jsonPrimitive?.contentOrNull,
                            x["purchases"]?.jsonPrimitive?.intOrNull ?: 0, qtyOf(x["units"]?.jsonArray?.map { it.jsonObject } ?: emptyList()))
                    },
                )
            }
            is Outcome.Fail -> error = if (r.failure == app.smartcourse.courses.nativeproto.net.Failure.FORBIDDEN) "Votre profil n'a pas accès aux statistiques." else "Statistiques indisponibles hors connexion."
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Statistiques", actions = { IconButton({ help = true }) { Icon(Icons.Rounded.Info, "Aide sur les statistiques", tint = C.TealDark) } })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SegTabs(listOf("Ce mois", "Mois précédent", "3 mois"), period, { period = it })
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
                            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                RemotePhoto(r.photoUrl, 40.dp, 10.dp)
                                Column(Modifier.weight(1f)) {
                                    Text(r.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(r.qty, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Text("${r.purchases}×", style = MaterialTheme.typography.titleSmall, color = C.TealDark)
                            }
                        }
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
