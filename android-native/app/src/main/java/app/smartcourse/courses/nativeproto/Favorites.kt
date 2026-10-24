@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Outcome
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

private data class FavItem(val productId: String, val name: String, val quantity: Double, val unit: String, val active: Boolean)
private data class Fav(val id: String, val name: String, val items: List<FavItem>)

/** Favoris de la famille (modèles de liste). Lecture et utilisation : parents et administrateurs ; création et suppression : administrateurs. */
@Composable
fun FavoritesSheet(onDismiss: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val admin = data.me.role == "admin"
    var favs by remember { mutableStateOf<List<Fav>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var name by remember { mutableStateOf("") }
    var deleteFor by remember { mutableStateOf<Fav?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun load() {
        scope.launch {
            when (val r = data.session.api.call("GET", "/api/templates")) {
                is Outcome.Ok -> {
                    error = null
                    favs = r.value["templates"]?.jsonArray?.map { t ->
                        val o = t.jsonObject
                        Fav(o["id"]!!.jsonPrimitive.content, o["name"]!!.jsonPrimitive.content, o["items"]!!.jsonArray.map { i ->
                            val x = i.jsonObject
                            FavItem(x["productId"]!!.jsonPrimitive.content, x["name"]!!.jsonPrimitive.content, x["quantity"]!!.jsonPrimitive.doubleOrNull ?: 1.0,
                                x["unit"]?.jsonPrimitive?.contentOrNull ?: "piece", x["productActive"]?.jsonPrimitive?.booleanOrNull ?: true)
                        })
                    } ?: emptyList()
                }
                is Outcome.Fail -> error = explain(r)
            }
        }
    }
    LaunchedEffect(Unit) { load() }

    AppSheet(onDismiss) {
        Text("Favoris", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text("Des listes toutes prêtes. Les utiliser ajoute leurs articles à la liste en cours, sans rien supprimer.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 8.dp)) }
        if (favs == null && error == null) Text("Chargement…", color = C.Muted, modifier = Modifier.padding(vertical = 12.dp))
        if (favs?.isEmpty() == true) Text("Aucun favori pour le moment.", color = C.Muted, modifier = Modifier.padding(vertical = 12.dp))
        favs?.forEach { f ->
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Star, null, tint = C.Amber)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(f.name, style = MaterialTheme.typography.titleSmall, maxLines = 2)
                    Text("${f.items.size} article${if (f.items.size > 1) "s" else ""}", style = MaterialTheme.typography.bodySmall)
                }
                RowAction("Utiliser", {
                    val available = f.items.filter { it.active && demo.byId[it.productId]?.inCatalog == true }
                    // Quantité du favori enregistrée dans une unité qui n'est plus celle du produit : jamais convertie, jamais ajoutée.
                    val otherUnit = available.filter { it.unit != demo.byId[it.productId]?.serverUnit }
                    val usable = available - otherUnit.toSet()
                    val note = if (otherUnit.isEmpty()) "" else " Unité modifiée, à ajouter vous-même : ${otherUnit.joinToString(", ") { it.name }}."
                    if (usable.isEmpty()) demo.say(if (otherUnit.isEmpty()) "Aucun article de ce favori n'est disponible dans votre catalogue." else note.trim())
                    else {
                        val ignored = f.items.size - usable.size - otherUnit.size
                        data.submit(usable.associate { it.productId to toBase(it.unit, it.quantity) }, clearSelection = false,
                            note = (if (ignored > 0) " $ignored article(s) retiré(s) du catalogue ont été ignorés." else "") + note)
                        onDismiss()
                    }
                }, true)
                if (admin) IconButton({ deleteFor = f }) { Icon(Icons.Rounded.Delete, "Supprimer le favori ${f.name}", tint = C.Danger) }
            }
        }
        if (admin && data.engine.list?.items?.any { it.status == "to_buy" || it.status == "purchased" } == true) {
            Spacer(Modifier.height(12.dp))
            Text("Enregistrer la liste en cours comme favori", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(6.dp))
            FormField(name, { name = it.take(60) }, "Nom du favori (ex. Courses de la semaine)")
            Spacer(Modifier.height(8.dp))
            PrimaryButton("Enregistrer", {
                busy = true
                scope.launch {
                    val listId = data.engine.list?.id
                    when (val r = data.session.api.call("POST", "/api/templates", buildJsonObject { put("name", name.trim()); put("fromListId", listId ?: "") })) {
                        is Outcome.Ok -> { name = ""; demo.say("Favori enregistré."); load() }
                        is Outcome.Fail -> demo.say(if (r.code == "template_exists") "Un favori porte déjà ce nom." else if (r.code == "too_many_templates") "Nombre maximal de favoris atteint." else explain(r))
                    }
                    busy = false
                }
            }, Modifier.fillMaxWidth(), enabled = name.isNotBlank() && !busy)
        }
    }
    deleteFor?.let { f ->
        ConfirmDialog("Supprimer ce favori ?", "« ${f.name} » sera supprimé. Les listes déjà faites ne changent pas.", "Supprimer", {
            deleteFor = null
            scope.launch {
                when (val r = data.session.api.call("DELETE", "/api/templates/${f.id}")) {
                    is Outcome.Ok -> { demo.say("Favori supprimé."); load() }
                    is Outcome.Fail -> demo.say(explain(r))
                }
            }
        }, { deleteFor = null }, danger = true)
    }
}
