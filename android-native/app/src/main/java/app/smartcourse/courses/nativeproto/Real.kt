@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.Session
import app.smartcourse.courses.nativeproto.net.serverMessage
import coil.ImageLoader
import coil.compose.AsyncImage

/** Session réelle quand l'utilisateur est connecté ; null dans les écrans de démonstration (données fictives). */
val LocalSession = compositionLocalOf<Session?> { null }
val LocalImageLoader = compositionLocalOf<ImageLoader?> { null }

/** Photo du serveur (avec le cookie de session), mise en cache sur le téléphone. */
@Composable
fun RemotePhoto(path: String?, size: Dp, radius: Dp = 10.dp, modifier: Modifier = Modifier) {
    val base = LocalSession.current?.serverAddress
    val loader = LocalImageLoader.current
    Box(modifier.size(size).clip(RoundedCornerShape(radius)).background(Color(0xFFEFF4F8))) {
        if (path != null && base != null && loader != null) {
            AsyncImage(model = base + path, imageLoader = loader, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/** Message d'erreur du serveur, en français. */
fun explain(f: Outcome.Fail): String = serverMessage(f) { failureMessage(it) }

/** Choix de la ville dans la liste fournie (même liste que le serveur : 146 villes). */
@Composable
fun CityPickerSheet(current: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var q by remember { mutableStateOf("") }
    val shown = remember(q) { if (q.isBlank()) CITIES else CITIES.filter { flatCity(it).contains(flatCity(q)) } }
    AppSheet(onDismiss) {
        Text("Ville", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text("Elle sert à proposer les prix de votre ville.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(10.dp))
        SearchBox(q, { q = it }, "Rechercher une ville…")
        Spacer(Modifier.height(8.dp))
        if (shown.isEmpty()) Text("Aucune ville ne correspond.", color = C.Muted, modifier = Modifier.padding(vertical = 16.dp))
        LazyColumn(Modifier.heightIn(max = 380.dp)) {
            items(shown, key = { it }) { city ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).clickable { onPick(city) }.padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(city, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f), color = if (city == current) C.TealDark else C.Ink)
                    if (city == current) Icon(Icons.Rounded.Check, "Ville actuelle", tint = C.TealDark)
                }
                HorizontalDivider(color = C.Line.copy(alpha = 0.5f))
            }
        }
    }
}
