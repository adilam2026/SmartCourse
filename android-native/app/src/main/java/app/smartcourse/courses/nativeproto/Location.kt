package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Alignment
import app.smartcourse.courses.nativeproto.net.Outcome
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Choix du pays (recherche dans la liste). */
@Composable
fun CountryPickerSheet(current: String?, onPick: (Country) -> Unit, onDismiss: () -> Unit) {
    var q by remember { mutableStateOf("") }
    val shown = remember(q) { if (q.isBlank()) COUNTRIES else COUNTRIES.filter { flatSearch(it.name).contains(flatSearch(q)) } }
    AppSheet(onDismiss) {
        Text("Pays", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(10.dp))
        SearchBox(q, { q = it }, "Rechercher un pays…")
        Spacer(Modifier.height(8.dp))
        if (shown.isEmpty()) Text("Aucun pays ne correspond.", color = C.Muted, modifier = Modifier.padding(vertical = 16.dp))
        LazyColumn(Modifier.heightIn(max = 380.dp)) {
            items(shown, key = { it.code }) { c ->
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).clickable { onPick(c) }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(c.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f), color = if (c.code == current) C.TealDark else C.Ink)
                    if (c.code == current) Icon(Icons.Rounded.Check, "Pays actuel", tint = C.TealDark)
                }
                HorizontalDivider(color = C.Line.copy(alpha = 0.5f))
            }
        }
    }
}

/**
 * Pays et ville de la famille. Administrateur : choisir puis enregistrer (une famille existante sans pays n'est jamais supposée au Maroc ;
 * la ville déjà connue, si elle est reconnue, est seulement préremplie). Autres profils : lecture seule.
 */
@Composable
fun LocationScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val session = data?.session
    val me = session?.signedMe
    val loc = me?.location
    val admin = me?.role == "admin"
    val scope = rememberCoroutineScope()
    var country by remember { mutableStateOf(loc?.country ?: loc?.suggestion?.country) }
    var city by remember { mutableStateOf(loc?.city ?: loc?.suggestion?.city) }
    var countrySheet by remember { mutableStateOf(false) }
    var citySheet by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize()) {
        TopBar("Pays et ville", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (loc != null && !loc.confirmed) NoteCard(
                if (loc.suggestion != null) "Prérempli depuis la ville déjà connue (${loc.suggestion.city}). Vérifiez puis confirmez : rien n'est appliqué avant."
                else "Le pays de votre famille n'est pas encore renseigné. Choisissez-le : rien n'a été modifié ni effacé."
            )
            if (!admin) {
                Text(if (loc?.confirmed == true) "Pays : ${countryName(loc.country) ?: loc.country}" else "Pays : non renseigné", style = MaterialTheme.typography.bodyLarge)
                loc?.city?.let { Text("Ville : $it", style = MaterialTheme.typography.bodyLarge) }
                Text("Seul un administrateur de la famille peut modifier le pays et la ville.", style = MaterialTheme.typography.bodySmall)
            } else {
                SecondaryButton("Pays : ${countryName(country) ?: "à choisir"}", { countrySheet = true }, Modifier.fillMaxWidth(), height = 54.dp)
                if (country == "MA") SecondaryButton(if (city == null) "Ville : à choisir (obligatoire)" else "Ville : $city", { citySheet = true }, Modifier.fillMaxWidth(), height = 54.dp)
                else if (country != null) NoteCard("Hors du Maroc, l'application n'affiche pas de prix indicatifs. Vos prix familiaux et l'historique sont conservés.")
                Text("Changer de pays ou de ville ne modifie ni vos prix familiaux ni l'historique.", style = MaterialTheme.typography.bodySmall)
                error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
                PrimaryButton(if (busy) "Enregistrement…" else "Confirmer", {
                    val c = country
                    if (c == null) { error = "Choisissez le pays de la famille."; return@PrimaryButton }
                    if (c == "MA" && city == null) { error = "Choisissez la ville."; citySheet = true; return@PrimaryButton }
                    if (busy || session == null) return@PrimaryButton
                    busy = true; error = null
                    scope.launch {
                        when (val r = session.api.call("PUT", "/api/family/location", buildJsonObject { put("country", c); if (c == "MA") put("city", city!!) })) {
                            is Outcome.Ok -> { session.verify(); demo.say("Pays et ville enregistrés."); onBack() }
                            is Outcome.Fail -> error = explain(r)
                        }
                        busy = false
                    }
                }, Modifier.fillMaxWidth(), enabled = !busy)
            }
            Spacer(Modifier.height(16.dp))
        }
    }
    if (countrySheet) CountryPickerSheet(country, { country = it.code; if (it.code != "MA") city = null; countrySheet = false; error = null }, { countrySheet = false })
    if (citySheet) CityPickerSheet(city, { city = it; citySheet = false; error = null }, { citySheet = false })
}
