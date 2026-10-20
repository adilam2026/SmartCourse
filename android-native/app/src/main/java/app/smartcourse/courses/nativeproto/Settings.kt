@file:OptIn(ExperimentalMaterial3Api::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/* ───────────── V07 — Administration ───────────── */

private data class Entry(val label: String, val icon: ImageVector, val route: String)

@Composable
fun AdminHubScreen(nav: (String) -> Unit) {
    val demo = LocalDemo.current
    var reset by remember { mutableStateOf(Launch.once("confirm")) }
    val groups = listOf(
        // Hors du Maroc : ni prix indicatifs ni gestion des prix.
        "Produits et prix" to (listOf(Entry("Catalogue", Icons.Rounded.Inventory2, "v09")) + if (demo.pricesAvailable) listOf(Entry("Gestion des prix", Icons.Rounded.LocalOffer, "v10")) else emptyList()),
        "Famille et accès" to listOf(Entry("Profils", Icons.Rounded.Groups, "v08"), Entry("Récupération", Icons.Rounded.Key, "stub/Récupération")),
        "Famille" to ((if (serverSupports(demo.serverSchema, 26)) listOf(Entry("Identifiant famille", Icons.Rounded.Badge, "v18")) else emptyList()) +
            listOf(Entry("Pays et ville", Icons.Rounded.Public, "v15"), Entry("Paramètres avancés", Icons.Rounded.Tune, "v17"))),
        "Préférences" to listOf(Entry("Affichage", Icons.Rounded.Palette, "v11"), Entry("Notifications et rappels", Icons.Rounded.Notifications, "stub/Notifications")),
        "Application" to listOf(Entry("Sauvegarde", Icons.Rounded.Cloud, "stub/Sauvegarde"), Entry("À propos", Icons.Rounded.Info, "stub/À propos")),
    )
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        TopBar("Réglages")
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            // Localisation à confirmer (familles créées avant le choix du pays) : rien n'est appliqué sans un administrateur.
            val loc = demo.data?.session?.signedMe?.location
            if (loc != null && !loc.confirmed && demo.data?.me?.role == "admin" && serverSupports(demo.serverSchema, 23)) SCard(padding = PaddingValues(12.dp)) {
                Text("Confirmez le pays de votre famille", style = MaterialTheme.typography.titleSmall)
                Text("Il sert aux prix de votre ville. Rien n'a été modifié ni effacé.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
                PrimaryButton("Confirmer", { nav("v15") }, Modifier.fillMaxWidth())
            }
            // Identifiant famille pas encore choisi (familles existantes) : invitation discrète, rien n'est imposé.
            val fam = demo.data?.me?.family
            if (fam != null && fam.loginId == null && demo.data?.me?.role == "admin" && schemaNumber(demo.serverSchema)?.let { it >= 26 } == true) SCard(padding = PaddingValues(14.dp)) {
                Text("Choisissez votre identifiant famille", style = MaterialTheme.typography.titleSmall)
                Text("Plus simple à dicter que le code ${fam.code}, par exemple ${FamilyIdRules.propose(fam.name)}. L'ancien code famille restera valable pour se connecter. Vous pourrez le modifier plus tard.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
                PrimaryButton("Choisir l'identifiant", { nav("v18") }, Modifier.fillMaxWidth())
            }
            groups.forEach { (title, entries) ->
                Text(title, style = MaterialTheme.typography.titleSmall, color = C.Muted, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
                SCard {
                    // Deux entrées par ligne au plus (« Famille » en compte trois).
                    entries.chunked(2).forEachIndexed { rowIndex, rowEntries ->
                    if (rowIndex > 0) Box(Modifier.fillMaxWidth().height(1.dp).padding(horizontal = 12.dp).background(C.Line))
                    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                        rowEntries.forEachIndexed { i, e ->
                            if (i > 0) Box(Modifier.width(1.dp).fillMaxHeight().padding(vertical = 10.dp).background(C.Line))
                            Row(
                                Modifier.weight(1f).heightIn(min = 60.dp).clickable { nav(e.route) }.padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Icon(e.icon, null, tint = C.TealDark, modifier = Modifier.size(24.dp))
                                Text(e.label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        if (rowEntries.size == 1 && entries.size > 1) Spacer(Modifier.weight(1f))
                    }
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            LocalLogout.current?.let { logout ->
                SecondaryButton("Se déconnecter", logout, Modifier.fillMaxWidth(), leading = Icons.AutoMirrored.Rounded.Logout)
                Spacer(Modifier.height(4.dp))
            }
            // Supprimer toute la famille : réservé à l'administrateur principal (le serveur le vérifie aussi).
            if (demo.data == null || demo.data?.me?.primary == true) Row(
                Modifier.align(Alignment.CenterHorizontally).clip(RoundedCornerShape(12.dp)).clickable { reset = true }.padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.PowerSettingsNew, null, tint = C.Danger, modifier = Modifier.size(20.dp))
                Text("Supprimer toute la famille", color = C.Danger, style = MaterialTheme.typography.labelLarge)
            }
            Spacer(Modifier.height(16.dp))
        }
    }
    if (reset) ResetFamilySheet { reset = false }
}

/* ───────────── V11 — Affichage ───────────── */

@Composable
fun DisplayScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        TopBar("Affichage", "Réglages propres à ce profil", onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SCard(padding = PaddingValues(vertical = 4.dp)) {
                SwitchRow("Prix indicatifs", "Affiche le prix unitaire dans les listes et le panneau de quantité.", demo.showPrices) {
                    val d = demo.data
                    if (d != null) d.setPrefs(it, demo.showTotals && it) else { demo.showPrices = it; if (!it) demo.showTotals = false }
                }
                HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(horizontal = 16.dp))
                SwitchRow(
                    "Total estimé", if (demo.showPrices) "Affiche une estimation du montant de la liste." else "Nécessite les prix indicatifs.",
                    demo.showTotals, enabled = demo.showPrices,
                ) { val d = demo.data; if (d != null) d.setPrefs(demo.showPrices || it, it) else demo.showTotals = it }
            }
            SCard(padding = PaddingValues(16.dp)) {
                // Mêmes réglages que le bouton « Affichage » de l'écran de sélection (mémorisés pour ce profil).
                Text("Présentation des articles", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(10.dp))
                SegTabs(SelMode.entries.map { it.label }, demo.selMode.ordinal, { val m = SelMode.entries[it]; demo.data?.setSelMode(m) ?: run { demo.selMode = m } })
                Spacer(Modifier.height(12.dp))
                Text("Organisation", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(10.dp))
                SegTabs(SelOrg.entries.map { it.label }, demo.selOrg.ordinal, { val o = SelOrg.entries[it]; demo.data?.setSelOrg(o) ?: run { demo.selOrg = o } })
            }
            Row(Modifier.padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.Info, null, tint = C.Muted, modifier = Modifier.size(18.dp))
                Text("Changer l'affichage ne modifie jamais les quantités.", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun SwitchRow(title: String, sub: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().androidx_toggle(checked, enabled, onChange).heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = if (enabled) C.Ink else C.Muted)
            Text(sub, style = MaterialTheme.typography.bodySmall)
        }
        TealSwitch(checked, onChange, enabled)
    }
}

/* ───────────── V08 — Profils ───────────── */

@Composable
fun ProfilesScreen(onBack: () -> Unit) {
    val session = LocalSession.current
    if (session != null) ProfilesScreenReal(session, onBack) else ProfilesScreenSim(onBack)
}

@Composable
fun ProfilesScreenSim(onBack: () -> Unit) {
    val demo = LocalDemo.current
    var menuFor by remember { mutableStateOf(Launch.strOnce("pmenu")?.toIntOrNull()) }
    var deleteFor by remember { mutableStateOf(Launch.strOnce("pdelete")?.toIntOrNull()) }
    val activeAdmins = demo.profiles.count { it.role == ProfRole.ADMIN && it.active }
    Column(Modifier.fillMaxSize()) {
        TopBar("Profils", "${demo.profiles.size} profils", onBack = onBack, actions = {
            IconButton({ demo.simulated("création d'un profil") }) { Icon(Icons.Rounded.PersonAdd, "Ajouter un profil", tint = C.TealDark) }
        })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
            SCard {
                demo.profiles.forEachIndexed { i, pr ->
                    if (i > 0) HorizontalDivider(color = C.Line.copy(alpha = 0.6f), modifier = Modifier.padding(start = 64.dp))
                    val protected = pr.primary || (pr.role == ProfRole.ADMIN && pr.active && activeAdmins <= 1)
                    Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Avatar(pr.name.take(1).uppercase(), pr.color, 40.dp, dim = !pr.active)
                        Column(Modifier.weight(1f)) {
                            Text(pr.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = if (pr.active) C.Ink else C.Muted)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 3.dp)) {
                                Pill(if (pr.primary) "Administrateur principal" else pr.role.label, C.TealDark, C.TealSoft)
                                if (!pr.active) Pill("Désactivé", C.Muted, Color(0xFFE4EDF5))
                            }
                        }
                        Box {
                            IconButton({ menuFor = i }) { Icon(Icons.Rounded.MoreVert, "Actions pour ${pr.name}", tint = C.Ink) }
                            DropdownMenu(menuFor == i, { menuFor = null }, containerColor = Color.White, shape = RoundedCornerShape(16.dp)) {
                                DropdownMenuItem(text = { Text("Modifier le code d'accès") }, leadingIcon = { Icon(Icons.Rounded.Key, null, tint = C.Ink) },
                                    onClick = { menuFor = null; demo.simulated("nouveau code pour ${pr.name}") })
                                DropdownMenuItem(
                                    text = { Text(if (pr.active) "Désactiver" else "Réactiver") },
                                    leadingIcon = { Icon(if (pr.active) Icons.Rounded.Block else Icons.Rounded.CheckCircle, null, tint = C.Ink) },
                                    enabled = !protected || !pr.active,
                                    onClick = { menuFor = null; demo.profiles[i] = pr.copy(active = !pr.active); demo.simulated(if (pr.active) "profil désactivé (historique conservé)" else "profil réactivé") },
                                )
                                DropdownMenuItem(
                                    text = { Text(if (protected) "Suppression impossible" else "Supprimer le profil", color = if (protected) C.Muted else C.Danger) },
                                    leadingIcon = { Icon(Icons.Rounded.Delete, null, tint = if (protected) C.Muted else C.Danger) },
                                    enabled = !protected, onClick = { menuFor = null; deleteFor = i },
                                )
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.Shield, null, tint = C.Muted, modifier = Modifier.size(18.dp))
                Text("L'administrateur principal et le dernier administrateur actif sont protégés. Désactiver un profil n'est pas le supprimer.", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    deleteFor?.let { i ->
        val pr = demo.profiles.getOrNull(i)
        if (pr != null) ConfirmDialog(
            "Supprimer ${pr.name} ?",
            "Ses achats restent dans les listes et l'historique partagés ; ils s'afficheront sous « ${pr.name} (ancien profil) ».",
            "Supprimer", { deleteFor = null; demo.profiles.removeAt(i); demo.simulated("profil supprimé") }, { deleteFor = null }, danger = true,
        )
    }
}

/** Toute la ligne est un interrupteur (zone tactile large, annoncée « interrupteur » par TalkBack). */
internal fun Modifier.androidx_toggle(checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit): Modifier =
    this.toggleable(value = checked, enabled = enabled, role = androidx.compose.ui.semantics.Role.Switch, onValueChange = onChange)
