@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Nom affiché d'une liste en cours : son nom, sinon sa date de création. */
fun openListLabel(name: String?, createdAt: String): String = name?.takeIf { it.isNotBlank() } ?: "Liste du ${frenchDate(createdAt).ifEmpty { "jour" }}"

/**
 * Option « Plusieurs listes actives » : bandeau sous l'en-tête indiquant la liste consultée, avec le choix d'une autre liste en cours.
 * Rien n'est affiché sans l'option (la présentation habituelle à une seule liste reste inchangée).
 */
@Composable
fun ListSwitcher(canCreate: Boolean) {
    val demo = LocalDemo.current
    if (!demo.multiLists || demo.data == null) return
    var sheet by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf(false) }
    val count = demo.openLists.size
    val cur = demo.openLists.firstOrNull { it.current }
    val label = cur?.let { openListLabel(it.name, it.createdAt) } ?: demo.listName ?: if (demo.hasList) demo.listDate else "Aucune liste consultée"
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 2.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.TealSoft)
            .clickable { sheet = true }.heightIn(min = 48.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.ShoppingBasket, null, tint = C.TealDark)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (count <= 1) "1 liste en cours" else "$count listes en cours · changer", style = MaterialTheme.typography.bodySmall, color = C.TealDark)
        }
        Icon(Icons.Rounded.ExpandMore, "Choisir une liste", tint = C.TealDark)
    }
    if (sheet) OpenListsSheet(
        title = "Listes en cours",
        canCreate = canCreate,
        onPick = { l -> sheet = false; if (!l.current) demo.data?.switchList(l.id) },
        onNew = { sheet = false; naming = true },
        onDismiss = { sheet = false },
    )
    if (naming) NewListDialog(defaultName = "", onDone = { name -> naming = false; demo.data?.createNamedList(name) }, onDismiss = { naming = false })
}

@Composable
fun OpenListsSheet(title: String, canCreate: Boolean, onPick: (OpenList) -> Unit, onNew: () -> Unit, onDismiss: () -> Unit, newLabel: String = "Nouvelle liste", intro: String? = null) {
    val demo = LocalDemo.current
    LaunchedEffect(Unit) { demo.data?.loadOpenLists() }
    AppSheet(onDismiss) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        if (intro != null) { Spacer(Modifier.height(6.dp)); Text(intro, style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.height(10.dp))
        if (demo.openLists.isEmpty()) Text("Aucune liste en cours.", color = C.Muted, modifier = Modifier.padding(vertical = 12.dp))
        LazyColumn(Modifier.heightIn(max = 360.dp)) {
            items(demo.openLists, key = { it.id }) { l ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(12.dp)).clickable { onPick(l) }.padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(openListLabel(l.name, l.createdAt), style = MaterialTheme.typography.bodyLarge, color = if (l.current) C.TealDark else C.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            (if (l.remaining == 0) "Rien à acheter" else "${l.remaining} à acheter") + if (l.purchased > 0) " · ${l.purchased} acheté${if (l.purchased > 1) "s" else ""}" else "",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (l.current) Icon(Icons.Rounded.Check, "Liste consultée", tint = C.TealDark)
                }
                HorizontalDivider(color = C.Line.copy(alpha = 0.5f))
            }
        }
        if (canCreate) {
            Spacer(Modifier.height(12.dp))
            SecondaryButton(newLabel, onNew, Modifier.fillMaxWidth(), leading = Icons.Rounded.Add)
        }
    }
}

@Composable
fun NewListDialog(defaultName: String, onDone: (String) -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf(defaultName) }
    val ok = name.trim().length in 1..40
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = androidx.compose.ui.graphics.Color.White,
        title = { Text("Nouvelle liste") },
        text = {
            Column {
                Text("Donnez-lui un nom pour la retrouver facilement (40 caractères au plus).", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(10.dp))
                FormField(name, { name = it.take(40) }, "Ex. : Marché du samedi", focus = true)
            }
        },
        confirmButton = { TextButton({ onDone(name.trim()) }, enabled = ok) { Text("Créer") } },
        dismissButton = { TextButton(onDismiss) { Text("Annuler") } },
    )
}

/** « Recommander » avec l'option plusieurs listes : nouvelle liste (par défaut) ou une liste en cours, puis la règle Ajouter/Remplacer. */
@Composable
fun ReorderDestination(nav: (String) -> Unit) {
    val demo = LocalDemo.current
    val entries = demo.reorderDestination ?: return
    val data = demo.data ?: return
    var naming by remember { mutableStateOf(false) }
    val defaultName = "Commande du " + java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("d MMMM", java.util.Locale.FRENCH))
    if (!naming) OpenListsSheet(
        title = "Recommander dans…",
        intro = "Choisissez une liste en cours, ou créez-en une nouvelle. La commande d'origine ne sera pas modifiée.",
        canCreate = true, newLabel = "Nouvelle liste",
        onPick = { l ->
            demo.reorderDestination = null
            val go = { if (demo.lines.any { !it.bought }) demo.reorderAsk = entries else { data.submit(entries, clearSelection = false); nav("v02") } }
            if (l.current) go() else data.switchList(l.id) { go() }
        },
        onNew = { naming = true },
        onDismiss = { demo.reorderDestination = null },
    )
    else NewListDialog(defaultName, onDone = { name ->
        naming = false; demo.reorderDestination = null
        data.createNamedList(name) { data.submit(entries, clearSelection = false); nav("v02") }
    }, onDismiss = { naming = false })
}

/** Paramètres avancés de la famille : options désactivées par défaut, modifiables par un administrateur seulement. */
@Composable
fun AdvancedSettingsScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val me = data?.session?.signedMe
    val admin = me?.role == "admin"
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmOff by remember { mutableStateOf(false) }
    fun apply(on: Boolean) {
        val d = data ?: return
        busy = true; error = null
        scope.launch { error = d.setMultiLists(on); busy = false }
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("Paramètres avancés", "Options de la famille", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                if (admin) "Ces options sont désactivées par défaut. Elles s'appliquent à toute la famille."
                else "Seul un administrateur peut modifier ces options.",
                style = MaterialTheme.typography.bodyMedium, color = C.Muted,
            )
            SCard(padding = PaddingValues(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(end = 12.dp)) {
                        Text("Plusieurs listes actives", style = MaterialTheme.typography.titleSmall)
                        Text("Préparer plusieurs listes en même temps (marché, supermarché…). Chacun choisit la liste qu'il consulte.", style = MaterialTheme.typography.bodySmall)
                    }
                    TealSwitch(demo.multiLists, { on -> if (on) apply(true) else confirmOff = true }, enabled = admin && !busy)
                }
            }
            error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
        }
    }
    if (confirmOff) ConfirmDialog(
        "Revenir à une seule liste ?",
        "Possible seulement quand une seule liste est en cours : clôturez ou supprimez d'abord les autres listes.",
        "Désactiver", { confirmOff = false; apply(false) }, { confirmOff = false },
    )
}
