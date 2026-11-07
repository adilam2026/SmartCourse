package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Outcome
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/*
 * Espace plateforme (consultation seulement), COMMUN à Android et à l'iPhone : « Photos manquantes » et « Usage de l'application ».
 * L'entrée n'apparaît que si le serveur l'indique pour la session (me.platform) ; chaque appel est de toute façon contrôlé par le
 * serveur (403 sinon). Aucune donnée personnelle n'est reçue : ni nom ni code de famille, ni membre, ni contenu de liste.
 */

private fun JsonObject.s(k: String) = this[k]?.jsonPrimitive?.contentOrNull
private fun JsonObject.i(k: String) = this[k]?.jsonPrimitive?.intOrNull
private fun JsonObject.o(k: String) = this[k] as? JsonObject
private fun JsonObject.a(k: String) = (this[k] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
private fun JsonObject.strings(k: String) = (this[k] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()

/** Chargement d'une route de l'espace plateforme : données, ou message clair (droit retiré, réseau…). */
@Composable
private fun rememberPlatformLoad(path: String, key: Any?): Triple<JsonObject?, String?, () -> Unit> {
    val data = LocalDemo.current.data
    val scope = rememberCoroutineScope()
    var value by remember(path) { mutableStateOf<JsonObject?>(null) }
    var error by remember(path) { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(path, key, tick) {
        error = null
        val api = data?.session?.api ?: run { error = "Connexion requise."; return@LaunchedEffect }
        when (val r = api.call("GET", path)) {
            is Outcome.Ok -> value = r.value
            is Outcome.Fail -> error = when (r.status) {
                403 -> "Accès réservé à l'espace plateforme."
                401 -> "Session expirée : reconnectez-vous."
                else -> "Données indisponibles pour le moment (connexion ?). Touchez Actualiser."
            }
        }
    }
    return Triple(value, error) { scope.launch { tick++ } }
}

@Composable
fun PlatformHomeScreen(onBack: () -> Unit, nav: (String) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        TopBar("Espace plateforme", "Consultation seulement", onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf(
                Triple("Photos manquantes", "Articles des familles sans photo : à fournir, à réutiliser, à vérifier", Icons.Rounded.PhotoCamera) to "v31",
                Triple("Usage de l'application", "Familles inscrites, actives, listes créées", Icons.Rounded.BarChart) to "v32",
            ).forEach { (t, route) ->
                SCard(padding = PaddingValues(0.dp)) {
                    Row(Modifier.fillMaxWidth().clickable { nav(route) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(t.third, null, tint = C.TealDark)
                        Column(Modifier.weight(1f)) {
                            Text(t.first, style = MaterialTheme.typography.titleSmall)
                            Text(t.second, style = MaterialTheme.typography.bodySmall, color = C.Muted)
                        }
                        Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, tint = C.Muted)
                    }
                }
            }
            InfoRow("Aucun nom, code de famille, membre ou contenu de liste n'est affiché. Les familles de démonstration listées côté serveur sont exclues.")
        }
    }
}

@Composable
fun PlatformPhotosScreen(onBack: () -> Unit) {
    var sort by remember { mutableStateOf(0) } // 0 : plus de familles ; 1 : plus récents
    var bucket by remember { mutableStateOf(0) } // « Photo à fournir » par défaut
    val (data, error, refresh) = rememberPlatformLoad("/api/platform/photos?sort=${if (sort == 0) "families" else "recent"}", sort)
    val buckets = listOf("provide" to "Photo à fournir", "reuse" to "Photo existante à réutiliser", "verify" to "Rapprochement à vérifier")
    val rows = data?.a("rows") ?: emptyList()
    Column(Modifier.fillMaxSize()) {
        TopBar("Photos manquantes", data?.s("computedAt")?.let { "Calculé le " + formatInstant(it, "d MMMM à HH:mm") }, onBack = onBack, actions = {
            Icon(Icons.Rounded.Refresh, "Actualiser", tint = C.TealDark, modifier = Modifier.clickable { refresh() }.padding(12.dp))
        })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SegTabs(buckets.map { (k, label) -> "$label (${rows.count { it.s("bucket") == k }})" }, bucket, { bucket = it })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ToggleChip("Plus de familles concernées", sort == 0) { sort = 0 }
                ToggleChip("Plus récents", sort == 1) { sort = 1 }
            }
            when {
                error != null -> NoteCard(error)
                data == null -> Text("Calcul en cours…", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                else -> {
                    val shown = rows.filter { it.s("bucket") == buckets[bucket].first }
                    if (shown.isEmpty()) Text("Rien dans cette catégorie.", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
                    shown.forEach { r -> PhotoRowCard(r) }
                    InfoRow(
                        "« Familles sans photo » : familles distinctes dont l'article n'affiche aucune photo (une famille n'est jamais comptée deux fois ; un article avec sa propre photo n'est pas compté). " +
                            "Aucun rattachement ni remplacement d'image n'est fait ici." + (data.i("excludedFamilies")?.takeIf { it > 0 }?.let { " $it famille(s) de démonstration exclue(s)." } ?: ""),
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun PhotoRowCard(r: JsonObject) {
    val ref = r.o("reference")
    val matching = r.s("matching")
    SCard(padding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(r.s("name") ?: "", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Pill("${r.i("familiesWithoutPhoto") ?: 0} famille(s) sans photo", C.TealDark, C.TealSoft)
        }
        r.s("category")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = C.Muted) }
        val variants = r.strings("variants")
        if (variants.size > 1 || (variants.size == 1 && variants[0] != r.s("name"))) Text("Saisies : " + variants.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
        when (matching) {
            "ambigu" -> Text("Ambigu : " + r.strings("candidates").joinToString(" ou ") + " ? À vérifier avant toute photo.", style = MaterialTheme.typography.bodySmall, color = C.Amber)
            "proche" -> Text("Proche de « ${r.strings("candidates").firstOrNull() ?: ""} » (accents) : à vérifier.", style = MaterialTheme.typography.bodySmall, color = C.Amber)
            "variante" -> Text("Référence proposée : ${ref?.s("name") ?: ""} (variante d'écriture) : à vérifier.", style = MaterialTheme.typography.bodySmall, color = C.Amber)
            else -> ref?.let {
                Text(
                    "Référence : ${it.s("name")} · " + if (it["hasPhoto"]?.jsonPrimitive?.booleanOrNull == true) "photo déjà au catalogue" else "référence sans photo",
                    style = MaterialTheme.typography.bodySmall,
                )
            } ?: Text("Absent du catalogue", style = MaterialTheme.typography.bodySmall)
        }
        r.s("lastAddedAt")?.let { Text("Dernier ajout : " + formatInstant(it, "d MMMM yyyy"), style = MaterialTheme.typography.bodySmall, color = C.Muted) }
    }
}

@Composable
fun PlatformUsageScreen(onBack: () -> Unit) {
    val periods = listOf(7, 30, 90, 365)
    var p by remember { mutableStateOf(1) }
    val (data, error, refresh) = rememberPlatformLoad("/api/platform/usage?days=${periods[p]}", p)
    Column(Modifier.fillMaxSize()) {
        TopBar("Usage de l'application", data?.s("computedAt")?.let { "Calculé le " + formatInstant(it, "d MMMM à HH:mm") }, onBack = onBack, actions = {
            Icon(Icons.Rounded.Refresh, "Actualiser", tint = C.TealDark, modifier = Modifier.clickable { refresh() }.padding(12.dp))
        })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when {
                error != null -> NoteCard(error)
                data == null -> Text("Calcul en cours…", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                else -> {
                    val f = data.o("families")
                    val l = data.o("lists")
                    @Composable fun stat(label: String, v: Int?) = SCard(padding = PaddingValues(14.dp)) {
                        Text(v?.toString() ?: "Non disponible", style = MaterialTheme.typography.headlineSmall, color = C.Ink)
                        Text(label, style = MaterialTheme.typography.bodySmall, color = C.Muted)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.weight(1f)) { stat("Familles inscrites", f?.i("registered")) }
                        Box(Modifier.weight(1f)) { stat("Listes créées (total)", l?.i("total")) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.weight(1f)) { stat("Nouvelles familles · 7 j", f?.i("new7")) }
                        Box(Modifier.weight(1f)) { stat("Nouvelles familles · 30 j", f?.i("new30")) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.weight(1f)) { stat("Familles actives · 7 j", f?.i("active7")) }
                        Box(Modifier.weight(1f)) { stat("Familles actives · 30 j", f?.i("active30")) }
                    }
                    data.s("activeDefinition")?.let { InfoRow(it) }
                    l?.s("totalLabel")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = C.Muted) }
                    f?.i("unfinishedSetups")?.takeIf { it > 0 }?.let { Text("$it installation(s) commencée(s) mais non terminée(s), non comptée(s).", style = MaterialTheme.typography.bodySmall, color = C.Muted) }
                    Text("Classement des familles", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 6.dp))
                    SegTabs(periods.map { "$it j" }, p, { p = it })
                    Text("Listes créées sur ${periods[p]} jours : ${l?.i("period") ?: 0}", style = MaterialTheme.typography.bodyMedium)
                    l?.s("periodNote")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = C.Muted) }
                    val ranking = data.a("ranking")
                    if (ranking.isEmpty()) Text("Aucune liste.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                    else SCard(padding = PaddingValues(12.dp)) {
                        Row { Text("Famille", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = C.Muted); Text("${periods[p]} j", Modifier.width(56.dp), style = MaterialTheme.typography.labelMedium, color = C.Muted); Text("Total", Modifier.width(56.dp), style = MaterialTheme.typography.labelMedium, color = C.Muted) }
                        ranking.forEach { x ->
                            Row(Modifier.padding(vertical = 4.dp)) {
                                Text(x.s("anon") ?: "", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                                Text("${x.i("period") ?: 0}", Modifier.width(56.dp), style = MaterialTheme.typography.bodyMedium)
                                Text("${x.i("total") ?: 0}", Modifier.width(56.dp), style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                    data.i("excludedFamilies")?.takeIf { it > 0 }?.let { Text("$it famille(s) de démonstration exclue(s).", style = MaterialTheme.typography.bodySmall, color = C.Muted) }
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}
