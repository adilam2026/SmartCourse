@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

private data class Period(val label: String, val lists: Int, val items: Int, val estimate: String, val bars: List<Pair<String, Float>>)

private val PERIODS = listOf(
    Period("7 j", 1, 9, "≈ 86 DH", listOf("L" to 0f, "M" to 0.2f, "M" to 0f, "J" to 0.5f, "V" to 0f, "S" to 1f, "D" to 0.3f)),
    Period("30 j", 4, 37, "≈ 342 DH", listOf("S1" to 0.6f, "S2" to 0.8f, "S3" to 0.5f, "S4" to 1f)),
    Period("3 mois", 13, 118, "≈ 1 060 DH", listOf("Juil." to 0.7f, "Août" to 1f, "Sept." to 0.8f)),
    Period("Année", 51, 455, "≈ 4 120 DH", listOf("T1" to 0.8f, "T2" to 1f, "T3" to 0.9f, "T4" to 0.4f)),
)
private val CATS = listOf("Fruits et légumes" to 0.38f, "Épicerie" to 0.27f, "Produits laitiers et œufs" to 0.19f, "Viandes et poissons" to 0.1f, "Autres" to 0.06f)

/* ───────────── V12 — Statistiques ───────────── */

@Composable
fun StatsScreenSim() {
    var period by remember { mutableIntStateOf(1) }
    var help by remember { mutableStateOf(Launch.once("help")) }
    val d = PERIODS[period]
    Column(Modifier.fillMaxSize()) {
        TopBar("Statistiques", actions = {
            IconButton({ help = true }) { Icon(Icons.Rounded.Info, "Aide sur les statistiques", tint = C.TealDark) }
        })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SegTabs(PERIODS.map { it.label }, period, { period = it })
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Kpi("Listes terminées", d.lists.toString(), Modifier.weight(1f))
                Kpi("Articles achetés", d.items.toString(), Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Kpi("Estimation", d.estimate, Modifier.weight(1f), tag = "estimée", tagFg = C.Amber, tagBg = C.AmberSoft)
                Kpi("Dépense payée", "—", Modifier.weight(1f), tag = "non saisie", tagFg = C.Muted, tagBg = Color(0xFFE4EDF5))
            }
            SCard(padding = PaddingValues(16.dp)) {
                Text("Achats sur la période", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth().height(120.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                    d.bars.forEach { (_, f) ->
                        Box(Modifier.weight(1f).fillMaxHeight(maxOf(f, 0.04f)).clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp))
                            .background(Brush.verticalGradient(listOf(Color(0xFF45D6CF), C.Teal))))
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    d.bars.forEach { (l, _) -> Text(l, Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelSmall, color = C.Muted, maxLines = 1) }
                }
            }
            SCard(padding = PaddingValues(16.dp)) {
                Text("Par catégorie", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(10.dp))
                CATS.forEach { (c, f) ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 5.dp)) {
                        Text(c, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1.1f), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        Box(Modifier.weight(1f).height(10.dp).clip(RoundedCornerShape(5.dp)).background(C.Track)) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(f / 0.4f).clip(RoundedCornerShape(5.dp)).background(Brush.horizontalGradient(listOf(C.Teal, Color(0xFF45D6CF)))))
                        }
                        Text("${(f * 100).toInt()} %", style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(44.dp), textAlign = TextAlign.End)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
    if (help) AlertDialog(
        onDismissRequest = { help = false }, containerColor = Color.White, shape = RoundedCornerShape(24.dp),
        title = { Text("À propos des montants", style = MaterialTheme.typography.titleLarge) },
        text = { Text("L'estimation multiplie les quantités achetées par les prix indicatifs. Ce n'est pas la dépense réellement payée.", style = MaterialTheme.typography.bodyMedium) },
        confirmButton = { TextButton({ help = false }) { Text("Compris", color = C.TealDark) } },
    )
}

@Composable
internal fun Kpi(label: String, value: String, modifier: Modifier, tag: String? = null, tagFg: Color = C.Muted, tagBg: Color = Color.Transparent) {
    SCard(modifier, padding = PaddingValues(14.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, maxLines = 1)
        Spacer(Modifier.height(4.dp))
        Text(value, style = MaterialTheme.typography.headlineMedium, maxLines = 1)
        Box(Modifier.height(24.dp).padding(top = 4.dp)) { if (tag != null) Pill(tag, tagFg, tagBg) }
    }
}
