@file:OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
private fun MonthBar(month: String, onChange: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton({ onChange(shiftMonth(month, -1)) }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "Mois précédent", tint = C.Ink) }
        Text(monthLabel(month), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        IconButton({ onChange(shiftMonth(month, 1)) }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "Mois suivant", tint = C.Ink) }
    }
}

@Composable
private fun Kpi(label: String, value: String, sub: String? = null, modifier: Modifier = Modifier, big: Boolean = false) {
    SCard(modifier, padding = PaddingValues(14.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = C.Muted)
        Text(value, style = if (big) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        sub?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = C.Muted) }
    }
}

@Composable
private fun BudgetBar(l: BudgetLine, b: BudgetInfo, onClick: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(l.category, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Text(if (l.planned == null) "Sans budget" else "${money(l.spent, b.dec, b.currency)} / ${money(l.planned, b.dec, b.currency)}", style = MaterialTheme.typography.bodySmall, color = C.Muted)
        }
        if (l.planned != null) {
            Spacer(Modifier.height(4.dp))
            val over = (l.remaining ?: 0) < 0
            LinearProgressIndicator(
                progress = { if (l.planned == 0L) (if (l.spent > 0) 1f else 0f) else (l.spent.toFloat() / l.planned).coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)), color = if (over) C.Danger else C.Teal, trackColor = C.Track,
            )
            Text(
                if (over) "Dépassement de ${money(-(l.remaining ?: 0), b.dec, b.currency)}" else "Restant ${money(l.remaining ?: 0, b.dec, b.currency)}",
                style = MaterialTheme.typography.bodySmall, color = if (over) C.Danger else C.TealDark,
            )
        } else if (l.spent > 0) Text("${money(l.spent, b.dec, b.currency)} dépensés", style = MaterialTheme.typography.bodySmall, color = C.Muted)
    }
}

/* ───────────── Vue d'ensemble ───────────── */

@Composable
fun BudgetScreen(nav: (String) -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val b = demo.budget
    var month by remember { mutableStateOf(today().substring(0, 7)) }
    var o by remember { mutableStateOf<Overview?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var openList by remember { mutableStateOf<ListToComplete?>(null) }
    LaunchedEffect(month, demo.budgetRev) {
        when (val r = Fin.call(data, "GET", "/api/budget/overview?month=$month&today=${today()}", Overview.serializer())) { is FinR.Ok -> { o = r.v; error = null }; is FinR.Err -> error = r.message }
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("Budget", if (b?.currency != null) "Montants saisis à la main, en ${b.currency}" else null)
        if (b == null || !b.rights.view) { Text("Le suivi financier n'est pas accessible avec ce profil.", color = C.Muted, modifier = Modifier.padding(24.dp)); return@Column }
        Box(Modifier.weight(1f)) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                MonthBar(month) { month = it }
                error?.let { Text(it, color = C.Danger) }
                val v = o
                if (v != null) {
                    v.account?.let { a ->
                        Kpi("Solde de mon compte (aujourd'hui)", money(a.balance, v.decimals, v.currency), "Solde initial ${money(a.opening, v.decimals, v.currency)} au ${shortDay(a.referenceDate)}" +
                            if (month != today().substring(0, 7)) " · solde actuel, pas celui de fin de ${monthLabel(month).lowercase()}" else "", Modifier.fillMaxWidth(), big = true)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Kpi("Dépenses du mois", money(v.monthExpenses, v.decimals, v.currency), modifier = Modifier.weight(1f))
                        Kpi("Entrées du mois", money(v.monthIncomes, v.decimals, v.currency), modifier = Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Kpi("Courses", money(v.monthCourses, v.decimals, v.currency), modifier = Modifier.weight(1f))
                        Kpi("Hors courses", money(v.monthOutsideCourses, v.decimals, v.currency), modifier = Modifier.weight(1f))
                    }
                    Kpi("Dépenses de la semaine", money(v.week.expenses, v.decimals, v.currency), "Du ${shortDay(v.week.from)} au ${shortDay(v.week.to)}", Modifier.fillMaxWidth())
                    v.budgets?.let { bs ->
                        SectionTitle("Budgets du mois")
                        SCard(padding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)) {
                            val shown = bs.filter { it.planned != null || it.spent > 0 }
                            if (shown.isEmpty()) Text("Aucun budget pour ce mois.", color = C.Muted, modifier = Modifier.padding(vertical = 8.dp))
                            shown.forEach { BudgetBar(it, b) { nav("b4") } }
                        }
                    }
                    if (v.listsToComplete.isNotEmpty()) {
                        SectionTitle("Listes à compléter")
                        v.listsToComplete.forEach { l ->
                            SCard(Modifier.fillMaxWidth().clickable { openList = l }, padding = PaddingValues(14.dp)) {
                                Text(openListLabel(l.name, l.createdAt), style = MaterialTheme.typography.titleSmall)
                                Text(
                                    (if (l.state == "none") "Montants non renseignés" else "Paiements à compléter · ${money(l.recorded, v.decimals, v.currency)} enregistrés") +
                                        " · clôturée le ${frenchDate(l.closedAt)}",
                                    style = MaterialTheme.typography.bodySmall, color = C.Amber,
                                )
                            }
                        }
                        Text("Les totaux ne couvrent que les dépenses enregistrées.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                    }
                }
                SectionTitle("Suivi")
                SCard(padding = PaddingValues(vertical = 4.dp)) {
                    NavRow("Historique des opérations", Icons.Rounded.ReceiptLong) { nav("b2") }
                    if (b.budgetsEnabled) NavRow("Budgets mensuels", Icons.Rounded.PieChart) { nav("b4") }
                    if (b.accountEnabled || b.rights.manage) NavRow("Mon compte", Icons.Rounded.AccountBalanceWallet) { nav("b5") }
                    if (b.rights.manage) NavRow("Réglages du budget", Icons.Rounded.Tune) { nav("b6") }
                }
                Spacer(Modifier.height(80.dp))
            }
            if (b.rights.edit) FloatingActionButton({ nav("b3") }, Modifier.align(Alignment.BottomEnd).padding(16.dp), containerColor = C.Teal, contentColor = Color.White) {
                Icon(Icons.Rounded.Add, "Ajouter une opération")
            }
        }
    }
    openList?.let { l -> AppSheet({ openList = null }) { ListPaymentsSection(l.listId, openListLabel(l.name, l.createdAt)) } }
}

@Composable
private fun NavRow(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = C.TealDark)
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = C.Muted)
    }
}

/* ───────────── Historique et filtres ───────────── */

@Composable
fun OperationsScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val b = demo.budget ?: return
    var month by remember { mutableStateOf(today().substring(0, 7)) }
    var type by remember { mutableIntStateOf(0) } // toutes / dépenses / entrées
    var scope by remember { mutableIntStateOf(0) } // tout / courses / hors courses
    var category by remember { mutableStateOf<FinCategory?>(null) }
    var merchant by remember { mutableStateOf<String?>(null) }
    var res by remember { mutableStateOf<OpsResult?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var edit by remember { mutableStateOf<FinOp?>(null) }
    var catSheet by remember { mutableStateOf(false) }
    var merchSheet by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(month, type, scope, category, merchant, demo.budgetRev, reload) {
        val q = buildString {
            append("month=$month&type=${listOf("all", "expense", "income")[type]}&scope=${listOf("all", "courses", "hors_courses")[scope]}")
            category?.let { append("&categoryId=${it.id}") }
            merchant?.let { append("&merchant=${java.net.URLEncoder.encode(it, "UTF-8")}") }
        }
        when (val r = Fin.call(data, "GET", "/api/budget/operations?$q", OpsResult.serializer())) { is FinR.Ok -> { res = r.v; error = null }; is FinR.Err -> error = r.message }
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("Historique des opérations", onBack = onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp, 0.dp, 16.dp, 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { MonthBar(month) { month = it } }
            if (b.rights.view) item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("Toutes", "Dépenses", "Entrées").forEachIndexed { i, t -> ToggleChip(t, type == i) { type = i; if (i == 2) { scope = 0; category = null; merchant = null } } }
                }
                Spacer(Modifier.height(8.dp))
                if (type != 2) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ToggleChip("Courses", scope == 1) { scope = if (scope == 1) 0 else 1; category = null }
                    ToggleChip("Hors courses", scope == 2) { scope = if (scope == 2) 0 else 2; category = null }
                    ToggleChip(category?.name?.let { "Catégorie : $it" } ?: "Catégorie ▾", category != null) { if (category != null) category = null else catSheet = true }
                    ToggleChip(merchant?.let { "Commerce : $it" } ?: "Commerce ▾", merchant != null) { if (merchant != null) merchant = null else merchSheet = true }
                }
            }
            res?.let { r ->
                item {
                    val filt = buildList {
                        if (r.ownOnly) add("vos paiements de courses")
                        when (scope) { 1 -> add("courses"); 2 -> add("hors courses") }
                        category?.let { add(it.name) }; merchant?.let { add(it) }
                    }.joinToString(" · ")
                    SCard(padding = PaddingValues(14.dp)) {
                        if (type != 2) Row { Text("Dépenses${if (filt.isNotEmpty()) " ($filt)" else ""} · ${monthLabel(month).lowercase()}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f)); Text(money(r.totals.expenses, b.dec, b.currency), fontWeight = FontWeight.Bold) }
                        if (type != 1 && !r.ownOnly) Row { Text("Entrées · ${monthLabel(month).lowercase()}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f)); Text(money(r.totals.incomes, b.dec, b.currency), fontWeight = FontWeight.Bold) }
                        Text("${r.totals.count} opération${if (r.totals.count > 1) "s" else ""} · date réelle du paiement", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                    }
                }
                if (r.operations.isEmpty()) item { Text("Aucune opération pour ces filtres.", color = C.Muted, modifier = Modifier.padding(vertical = 16.dp)) }
                items(r.operations, key = { it.id }) { op -> OpRow(op, b) { if (op.canEdit) edit = op } }
            }
            error?.let { item { Text(it, color = C.Danger) } }
        }
    }
    if (catSheet) AppSheet({ catSheet = false }) {
        Text("Catégorie", style = MaterialTheme.typography.titleLarge)
        b.categories.forEach { c -> Text(c.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { category = c; scope = 0; catSheet = false }.padding(vertical = 14.dp, horizontal = 6.dp)) }
    }
    if (merchSheet) AppSheet({ merchSheet = false }) {
        Text("Commerce", style = MaterialTheme.typography.titleLarge)
        b.merchants.forEach { m -> Text(m, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { merchant = m; merchSheet = false }.padding(vertical = 14.dp, horizontal = 6.dp)) }
    }
    edit?.let { op ->
        if (op.source == "list_payment" && !b.rights.edit) PaymentSheet(op.listId ?: "", op.listName ?: "liste", { edit = null; reload++ }, { edit = null }, edit = op)
        else OperationEditor(op, { edit = null; reload++ }, { edit = null })
    }
}

@Composable
private fun OpRow(op: FinOp, b: BudgetInfo, onClick: () -> Unit) {
    SCard(Modifier.fillMaxWidth().clickable(onClick = onClick), padding = PaddingValues(horizontal = 14.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(op.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, textDecoration = if (op.voided) TextDecoration.LineThrough else null)
                val parts = listOfNotNull(if (op.kind == "income") "Entrée" else op.category, shortDay(op.date), op.listName?.let { "liste « $it »" } ?: op.listCreatedAt?.let { "liste du ${frenchDate(it)}" }, "par ${op.createdBy}")
                Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = C.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (op.voided) Text("Annulée" + (op.voidReason?.let { " : $it" } ?: ""), style = MaterialTheme.typography.labelSmall, color = C.Danger)
                else if (op.updatedAt != op.createdAt && op.rev > 1) Text("Corrigée par ${op.updatedBy}", style = MaterialTheme.typography.labelSmall, color = C.Muted)
            }
            Text(money(if (op.kind == "income") op.amount else -op.amount, b.dec, op.currency, signed = true), style = MaterialTheme.typography.titleSmall, color = if (op.kind == "income") C.TealDark else C.Ink)
        }
    }
}

/* ───────────── Ajouter / corriger une opération ───────────── */

@Composable
fun AddOperationScreen(onBack: () -> Unit) {
    OperationForm(null, onBack, onBack)
}

@Composable
private fun OperationEditor(op: FinOp, onDone: () -> Unit, onDismiss: () -> Unit) {
    AppSheet(onDismiss) { OperationForm(op, onDone, onDismiss, inSheet = true) }
}

@Composable
private fun OperationForm(edit: FinOp?, onDone: () -> Unit, onBack: () -> Unit, inSheet: Boolean = false) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val b = demo.budget ?: return
    val scope = rememberCoroutineScope()
    val requestId = remember { Fin.newRequest() }
    var income by remember { mutableStateOf(edit?.kind == "income") }
    var amount by remember { mutableStateOf(edit?.let { minorToInput(it.amount, b.dec) } ?: "") }
    var label by remember { mutableStateOf(edit?.title ?: "") }
    var categoryId by remember { mutableStateOf(edit?.categoryId) }
    var date by remember { mutableStateOf(edit?.date ?: today()) }
    var note by remember { mutableStateOf(edit?.note ?: "") }
    var listId by remember { mutableStateOf(edit?.listId) }
    var pickDate by remember { mutableStateOf(false) }
    var pickList by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmVoid by remember { mutableStateOf(false) }
    var newCat by remember { mutableStateOf(false) }
    val amountErr = if (amount.isEmpty()) null else amountError(amount, b.dec)
    val ok = !busy && amount.isNotBlank() && amountErr == null && label.isNotBlank() && (income || categoryId != null)
    val merchantLike = !income && b.merchants.any { it.equals(label.trim(), true) }
    fun save() {
        busy = true; error = null
        scope.launch {
            val body = buildJsonObject {
                if (edit == null) { put("requestId", requestId); put("kind", if (income) "income" else "expense") } else put("rev", edit.rev)
                put("amount", amount.trim()); put("date", date); put("note", note.trim())
                if (income) put("label", label.trim())
                else {
                    if (edit?.source != "list_payment") put("categoryId", categoryId)
                    if (merchantLike) { put("merchant", label.trim()); if (edit != null) put("label", JsonNull) } else { put("label", label.trim()); if (edit != null) put("merchant", JsonNull) }
                    if (edit?.source != "list_payment") { if (listId != null) put("listId", listId) else if (edit != null) put("listId", JsonNull) }
                }
            }
            val r = if (edit == null) Fin.call(data, "POST", "/api/budget/operations", OpResult.serializer(), body) else Fin.call(data, "PATCH", "/api/budget/operations/${edit.id}", OpResult.serializer(), body)
            busy = false
            when (r) {
                is FinR.Ok -> { demo.say(if (edit != null) "Opération corrigée." else if (r.v.replay) "Opération déjà enregistrée." else "Opération enregistrée."); r.v.warning?.let { demo.say(it) }; onDone() }
                is FinR.Err -> error = r.message
            }
        }
    }
    val body: @Composable ColumnScope.() -> Unit = {
        if (edit == null) SegTabs(listOf("Dépense", "Entrée d'argent"), if (income) 1 else 0, { income = it == 1 })
        else Text(if (income) "Corriger l'entrée d'argent" else "Corriger la dépense", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(10.dp))
        FormField(amount, { amount = it.take(16) }, "Montant", label = "Montant (${b.currency})", keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        amountErr?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodySmall) }
        Spacer(Modifier.height(8.dp))
        FormField(label, { label = it.take(80) }, if (income) "Libellé (ex. : Salaire)" else "Libellé ou commerce (ex. : Carburant)", label = if (income) "Libellé" else "Libellé ou commerce")
        if (!income && edit?.source != "list_payment") {
            Spacer(Modifier.height(10.dp))
            Text("Catégorie", style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(6.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                b.categories.filter { !it.archived }.forEach { c -> ToggleChip(c.name, categoryId == c.id) { categoryId = c.id } }
                if (b.rights.manage) ToggleChip("+ Nouvelle", false) { newCat = true }
            }
        }
        Spacer(Modifier.height(10.dp))
        DateRow("Date", date) { pickDate = true }
        if (!income && edit?.source != "list_payment") {
            Spacer(Modifier.height(8.dp))
            val name = demo.openLists.firstOrNull { it.id == listId }?.let { openListLabel(it.name, it.createdAt) } ?: if (listId == demo.currentListId && listId != null) demo.listName ?: "Liste en cours" else if (listId != null) "Liste associée" else "Aucune (facultatif)"
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color.White).clickable { pickList = true }.heightIn(min = 56.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Checklist, null, tint = C.Muted); Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) { Text("Liste associée", style = MaterialTheme.typography.labelMedium, color = C.Muted); Text(name, style = MaterialTheme.typography.bodyLarge) }
            }
        }
        Spacer(Modifier.height(8.dp))
        FormField(note, { note = it.take(300) }, "Note (facultative)")
        if (income) Text("Une entrée augmente le solde de Mon compte. Elle ne modifie ni les budgets ni les dépenses affichées.", style = MaterialTheme.typography.bodySmall, color = C.Muted, modifier = Modifier.padding(top = 6.dp))
        error?.let { Text(it, color = C.Danger, modifier = Modifier.padding(top = 8.dp)) }
        Spacer(Modifier.height(12.dp))
        PrimaryButton(if (busy) "Enregistrement…" else if (error != null && edit == null) "Réessayer" else "Enregistrer", { save() }, Modifier.fillMaxWidth(), enabled = ok)
        if (edit != null) { Spacer(Modifier.height(8.dp)); SecondaryButton("Annuler cette opération…", { confirmVoid = true }, Modifier.fillMaxWidth(), danger = true) }
    }
    if (inSheet) Column(content = body)
    else Column(Modifier.fillMaxSize()) {
        TopBar("Ajouter une opération", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), content = body)
    }
    if (pickDate) DatePick(date, { date = it; pickDate = false }, { pickDate = false })
    if (pickList) AppSheet({ pickList = false }) {
        Text("Liste associée", style = MaterialTheme.typography.titleLarge)
        Text("Rattacher une dépense à une liste ne crée pas de nouvelle dépense.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
        Spacer(Modifier.height(8.dp))
        Text("Aucune", modifier = Modifier.fillMaxWidth().clickable { listId = null; pickList = false }.padding(vertical = 14.dp))
        val lists = demo.openLists.ifEmpty { demo.currentListId?.let { listOf(OpenList(it, demo.listName, "", 0, 0, true)) } ?: emptyList() }
        lists.forEach { l -> Text(if (l.createdAt.isEmpty()) l.name ?: "Liste en cours" else openListLabel(l.name, l.createdAt), modifier = Modifier.fillMaxWidth().clickable { listId = l.id; pickList = false }.padding(vertical = 14.dp)) }
    }
    if (newCat) NewCategoryDialog({ newCat = false }) { categoryId = it }
    if (confirmVoid && edit != null) VoidDialog(edit, { confirmVoid = false }) { onDone() }
}

@Composable
private fun NewCategoryDialog(onDismiss: () -> Unit, onCreated: (String) -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = Color.White, title = { Text("Nouvelle catégorie") },
        text = { Column { Text("Catégorie financière (distincte des catégories du catalogue de courses).", style = MaterialTheme.typography.bodyMedium); Spacer(Modifier.height(8.dp)); FormField(name, { name = it.take(40) }, "Ex. : Scolarité", focus = true); error?.let { Text(it, color = C.Danger) } } },
        confirmButton = {
            TextButton({
                scope.launch {
                    when (val r = data.session.api.call("POST", "/api/budget/categories", buildJsonObject { put("name", name.trim()) })) {
                        is app.smartcourse.courses.nativeproto.net.Outcome.Ok -> { data.loadBudget(); onCreated((r.value["id"] as kotlinx.serialization.json.JsonPrimitive).content); onDismiss() }
                        is app.smartcourse.courses.nativeproto.net.Outcome.Fail -> error = if (r.code == "category_exists") "Cette catégorie existe déjà." else explain(r)
                    }
                }
            }, enabled = name.isNotBlank()) { Text("Créer") }
        },
        dismissButton = { TextButton(onDismiss) { Text("Annuler") } },
    )
}

/* ───────────── Budgets mensuels ───────────── */

@Composable
fun BudgetsScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val b = demo.budget ?: return
    val scope = rememberCoroutineScope()
    var month by remember { mutableStateOf(today().substring(0, 7)) }
    var lines by remember { mutableStateOf<List<BudgetLine>?>(null) }
    var edit by remember { mutableStateOf<BudgetLine?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(month, demo.budgetRev) {
        when (val r = Fin.call(data, "GET", "/api/budget/budgets?month=$month", BudgetsResult.serializer())) { is FinR.Ok -> lines = r.v.budgets; is FinR.Err -> error = r.message }
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("Budgets mensuels", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            MonthBar(month) { month = it }
            error?.let { Text(it, color = C.Danger) }
            lines?.let { ls ->
                SCard(padding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)) {
                    ls.forEach { l ->
                        BudgetBar(l, b, if (b.rights.manage) ({ edit = l }) else null)
                        if (l.planned == null && l.proposed != null) Text("Proposé d'après le mois précédent : ${money(l.proposed, b.dec, b.currency)}", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                        HorizontalDivider(color = C.Line.copy(alpha = 0.5f))
                    }
                }
            }
            Text("Un budget n'est ni une dépense ni un retrait sur Mon compte. Une dépense compte dans un seul budget (sa catégorie). Un dépassement est signalé sans bloquer la saisie. Pas de report du restant d'un mois à l'autre.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
            Spacer(Modifier.height(16.dp))
        }
    }
    edit?.let { l ->
        var v by remember(l) { mutableStateOf((l.planned ?: l.proposed)?.let { minorToInput(it, b.dec) } ?: "") }
        val err = if (v.isEmpty()) null else amountError(v, b.dec).takeIf { v.trim().trimStart('0').replace(",", "").replace(".", "").isNotEmpty() }
        AlertDialog(
            onDismissRequest = { edit = null }, containerColor = Color.White,
            title = { Text("${l.category} · ${monthLabel(month)}") },
            text = { Column { Text("Montant prévu pour ce mois seulement (les autres mois ne changent pas).", style = MaterialTheme.typography.bodyMedium); Spacer(Modifier.height(8.dp)); FormField(v, { v = it.take(16) }, "Montant prévu", keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal)); err?.let { Text(it, color = C.Danger) } } },
            confirmButton = {
                TextButton({
                    scope.launch {
                        when (val r = Fin.call(data, "PUT", "/api/budget/budgets", BudgetsResult.serializer(), buildJsonObject { put("month", month); put("categoryId", l.categoryId); put("amount", v.trim().ifEmpty { "0" }) })) {
                            is FinR.Ok -> { lines = r.v.budgets; edit = null }
                            is FinR.Err -> demo.say(r.message)
                        }
                    }
                }, enabled = err == null && v.isNotBlank()) { Text("Enregistrer") }
            },
            dismissButton = {
                Row {
                    if (l.planned != null) TextButton({
                        scope.launch {
                            when (val r = Fin.call(data, "PUT", "/api/budget/budgets", BudgetsResult.serializer(), buildJsonObject { put("month", month); put("categoryId", l.categoryId); put("amount", JsonNull) })) {
                                is FinR.Ok -> { lines = r.v.budgets; edit = null }
                                is FinR.Err -> demo.say(r.message)
                            }
                        }
                    }) { Text("Retirer", color = C.Danger) }
                    TextButton({ edit = null }) { Text("Annuler") }
                }
            },
        )
    }
}

/* ───────────── Mon compte ───────────── */

@Composable
fun AccountScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val b = demo.budget ?: return
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<AccountInfo?>(null) }
    var opening by remember { mutableStateOf("") }
    var ref by remember { mutableStateOf(today().substring(0, 8) + "01") }
    var reason by remember { mutableStateOf("") }
    var pick by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf(false) }
    suspend fun load() { (Fin.call(data, "GET", "/api/budget/account?today=${today()}", AccountInfo.serializer()) as? FinR.Ok)?.let { info = it.v; it.v.account?.let { a -> opening = minorToInput(a.opening, b.dec); ref = a.referenceDate } } }
    LaunchedEffect(demo.budgetRev) { load() }
    val acc = info?.account
    val first = acc == null
    Column(Modifier.fillMaxSize()) {
        TopBar("Mon compte", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (acc != null) {
                Kpi("Solde de mon compte (aujourd'hui)", money(acc.balance, b.dec, b.currency), "Solde initial ${money(acc.opening, b.dec, b.currency)} au début du ${shortDay(acc.referenceDate)} + entrées ${money(acc.incomesSinceReference, b.dec, b.currency)} − dépenses ${money(acc.expensesSinceReference, b.dec, b.currency)}", Modifier.fillMaxWidth(), big = true)
                if (acc.operationsBeforeReference > 0) Text("${acc.operationsBeforeReference} opération(s) antérieure(s) au solde initial restent dans l'historique sans être retirées du solde.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                if (acc.futureOperations > 0) Text("${acc.futureOperations} opération(s) datée(s) après aujourd'hui seront comptées à leur date.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                if (!b.accountEnabled) Text("Le suivi du solde est désactivé : il n'apparaît pas dans la vue d'ensemble.", color = C.Amber, style = MaterialTheme.typography.bodySmall)
            }
            if (b.rights.manage && (first || editing)) {
                Text(
                    "Indiquez l'argent disponible au DÉBUT de la date de référence. Les opérations de ce jour et des jours suivants seront comptées ; les plus anciennes restent dans l'historique sans modifier le solde.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                FormField(opening, { opening = it.take(16) }, "Solde initial", label = "Solde initial (${b.currency})", keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                DateRow("Date de référence", ref) { pick = true }
                if (!first) FormField(reason, { reason = it.take(200) }, "Raison de la correction (conservée)")
                msg?.let { Text(it, color = C.Amber) }
                val okAmount = opening.isNotBlank() && amountError(opening.removePrefix("-"), b.dec).let { it == null || it.startsWith("Le montant") }
                PrimaryButton(if (busy) "Enregistrement…" else if (first) "Activer le suivi du solde" else "Enregistrer la correction", {
                    busy = true; msg = null
                    scope.launch {
                        val r = Fin.call(data, "PUT", "/api/budget/account", AccountSet.serializer(), buildJsonObject {
                            put("opening", opening.trim()); put("referenceDate", ref); put("today", today()); if (reason.isNotBlank()) put("reason", reason.trim())
                        })
                        busy = false
                        when (r) {
                            is FinR.Ok -> { msg = r.v.warnings.joinToString(" ").ifEmpty { null }; editing = false; reason = ""; data.loadBudget(); load(); demo.say("Mon compte enregistré.") }
                            is FinR.Err -> msg = r.message
                        }
                    }
                }, Modifier.fillMaxWidth(), enabled = !busy && okAmount && (first || reason.isNotBlank()))
                Text("Une correction ultérieure crée une ligne datée et signée, sans effacer l'ancienne valeur.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
            } else if (b.rights.manage) SecondaryButton("Corriger le solde initial…", { editing = true }, Modifier.fillMaxWidth())
            info?.history?.takeIf { it.size > 0 }?.let { h ->
                SectionTitle("Historique du solde initial")
                SCard(padding = PaddingValues(14.dp)) {
                    h.forEach { x ->
                        Text("${money(x.opening, b.dec, b.currency)} au ${shortDay(x.referenceDate)}", style = MaterialTheme.typography.titleSmall)
                        Text("${frenchDate(x.at)} · ${x.by}" + (x.reason?.let { " · « $it »" } ?: ""), style = MaterialTheme.typography.bodySmall, color = C.Muted)
                        Spacer(Modifier.height(6.dp))
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
    if (pick) DatePick(ref, { ref = it; pick = false }, { pick = false })
}

/* ───────────── Réglages du budget et droits ───────────── */

@Composable
fun BudgetSettingsScreen(nav: (String) -> Unit, onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val b = demo.budget ?: return
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var currencySheet by remember { mutableStateOf(false) }
    var newCat by remember { mutableStateOf(false) }
    fun set(body: JsonObject) {
        scope.launch {
            when (val r = data.session.api.call("PUT", "/api/budget/settings", body)) {
                is app.smartcourse.courses.nativeproto.net.Outcome.Ok -> { error = null; data.loadBudget() }
                is app.smartcourse.courses.nativeproto.net.Outcome.Fail -> error = if (r.code == "account_opening_required") "Saisissez d'abord le solde initial (Mon compte)." else if (r.code == "currency_frozen") "La devise est figée depuis la première opération." else explain(r)
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        TopBar("Réglages du budget", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SCard(padding = PaddingValues(16.dp)) {
                Row(Modifier.clickable(enabled = !b.currencyFrozen) { currencySheet = true }, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Devise", style = MaterialTheme.typography.titleSmall)
                        Text(if (b.currencyFrozen) "${b.currency} · figée depuis la première opération" else "${b.currency} · modifiable tant qu'aucune opération n'est enregistrée", style = MaterialTheme.typography.bodySmall)
                    }
                    if (!b.currencyFrozen) Icon(Icons.Rounded.ExpandMore, null, tint = C.Muted)
                }
            }
            SCard(padding = PaddingValues(16.dp)) {
                Row(Modifier.clickable { set(buildJsonObject { put("budgetsEnabled", !b.budgetsEnabled) }) }, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(end = 12.dp)) { Text("Budgets mensuels", style = MaterialTheme.typography.titleSmall); Text("Facultatif : un montant prévu par catégorie et par mois.", style = MaterialTheme.typography.bodySmall) }
                    TealSwitch(b.budgetsEnabled, { set(buildJsonObject { put("budgetsEnabled", it) }) })
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.clickable { if (b.accountEnabled) set(buildJsonObject { put("accountEnabled", false) }) else nav("b5") }, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(end = 12.dp)) { Text("Mon compte (solde)", style = MaterialTheme.typography.titleSmall); Text("Facultatif : solde initial puis entrées et dépenses. Sans connexion bancaire.", style = MaterialTheme.typography.bodySmall) }
                    TealSwitch(b.accountEnabled, { if (it) nav("b5") else set(buildJsonObject { put("accountEnabled", false) }) })
                }
            }
            error?.let { Text(it, color = C.Danger) }
            SectionTitle("Catégories financières")
            SCard(padding = PaddingValues(vertical = 4.dp)) {
                b.categories.forEach { c ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(c.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f), color = if (c.archived) C.Muted else C.Ink)
                        if (c.key != "courses") TextButton({
                            scope.launch { data.session.api.call("PATCH", "/api/budget/categories/${c.id}", buildJsonObject { put("archived", !c.archived) }); data.loadBudget() }
                        }) { Text(if (c.archived) "Rétablir" else "Archiver") }
                    }
                }
                Row(Modifier.fillMaxWidth().clickable { newCat = true }.heightIn(min = 48.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Add, null, tint = C.TealDark); Spacer(Modifier.width(8.dp)); Text("Nouvelle catégorie", color = C.TealDark)
                }
            }
            SectionTitle("Accès")
            SCard(padding = PaddingValues(vertical = 4.dp)) { NavRow("Droits financiers des membres", Icons.Rounded.Lock) { nav("b7") } }
            Text("Désactiver la gestion du budget (Paramètres avancés) masque le module sans effacer ses données.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
            Spacer(Modifier.height(16.dp))
        }
    }
    if (currencySheet) CurrencySheet(b.currency, b.currencies, { c -> currencySheet = false; set(buildJsonObject { put("currency", c) }) }, { currencySheet = false })
    if (newCat) NewCategoryDialog({ newCat = false }) { }
}

@Composable
fun CurrencySheet(current: String?, currencies: Map<String, Int>, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    AppSheet(onDismiss) {
        Text("Devise de la famille", style = MaterialTheme.typography.titleLarge)
        Text("Une seule devise par famille, sans conversion.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.heightIn(max = 380.dp)) {
            items(currencies.keys.sorted()) { c ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { onPick(c) }.heightIn(min = 48.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(c, modifier = Modifier.weight(1f), color = if (c == current) C.TealDark else C.Ink)
                    if (c == current) Icon(Icons.Rounded.Check, null, tint = C.TealDark)
                }
            }
        }
    }
}

@Composable
fun FinanceRightsScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val scope = rememberCoroutineScope()
    var profiles by remember { mutableStateOf<List<RightsProfile>?>(null) }
    var edit by remember { mutableStateOf<RightsProfile?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    suspend fun load() { when (val r = Fin.call(data, "GET", "/api/budget/rights", RightsResult.serializer())) { is FinR.Ok -> profiles = r.v.profiles; is FinR.Err -> error = r.message } }
    LaunchedEffect(Unit) { load() }
    Column(Modifier.fillMaxSize()) {
        TopBar("Droits financiers", onBack = onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Text("Par défaut, seuls les administrateurs accèdent au budget. Ces droits sont vérifiés par le serveur, pas seulement à l'écran.", style = MaterialTheme.typography.bodyMedium, color = C.Muted) }
            error?.let { item { Text(it, color = C.Danger) } }
            items(profiles ?: emptyList(), key = { it.profileId }) { p ->
                SCard(Modifier.fillMaxWidth().clickable(enabled = !p.fixed) { edit = p }, padding = PaddingValues(14.dp)) {
                    Text(p.displayName, style = MaterialTheme.typography.titleSmall)
                    val r = p.rights
                    val txt = if (p.fixed) "Administrateur : tous les droits" else listOfNotNull(
                        "gérer".takeIf { r.manage }, "consulter".takeIf { r.view }, "saisir les paiements".takeIf { r.record }, "modifier".takeIf { r.edit },
                    ).joinToString(", ").ifEmpty { "Aucun accès financier" }
                    Text((when (p.role) { "staff" -> "Personnel · "; "parent" -> "Parent · "; else -> "" }) + txt, style = MaterialTheme.typography.bodySmall, color = C.Muted)
                }
            }
        }
    }
    edit?.let { p ->
        var r by remember(p) { mutableStateOf(p.rights) }
        val staff = p.role == "staff"
        AppSheet({ edit = null }) {
            Text("Droits de ${p.displayName}", style = MaterialTheme.typography.titleLarge)
            Text(if (staff) "Personnel : seule la saisie des paiements des courses peut être accordée." else "Aucun accès financier par défaut.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
            Spacer(Modifier.height(10.dp))
            @Composable fun line(t: String, s: String, v: Boolean, enabled: Boolean, set: (Boolean) -> Unit) {
                Row(Modifier.fillMaxWidth().clickable(enabled = enabled) { set(!v) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(end = 12.dp)) { Text(t, style = MaterialTheme.typography.titleSmall, color = if (enabled) C.Ink else C.Muted); if (s.isNotEmpty()) Text(s, style = MaterialTheme.typography.bodySmall) }
                    TealSwitch(v, set, enabled = enabled)
                }
            }
            line("Saisir les paiements des courses", "Sans voir le solde, les entrées ni les autres dépenses ; corrige seulement ses propres paiements", r.record, true) { r = r.copy(record = it) }
            line("Consulter le suivi financier", "Solde, entrées, toutes les dépenses", r.view, !staff) { r = r.copy(view = it) }
            line("Modifier les opérations", "Ajouter, corriger ou annuler toute opération", r.edit, !staff) { r = r.copy(edit = it) }
            line("Gérer les paramètres et budgets", "Devise, catégories, budgets, Mon compte, droits", r.manage, !staff) { r = r.copy(manage = it, view = it || r.view) }
            Spacer(Modifier.height(12.dp))
            PrimaryButton("Enregistrer", {
                scope.launch {
                    when (val x = data.session.api.call("PUT", "/api/budget/rights/${p.profileId}", buildJsonObject { put("manage", r.manage); put("view", r.view); put("record", r.record); put("edit", r.edit) })) {
                        is app.smartcourse.courses.nativeproto.net.Outcome.Ok -> { edit = null; load(); demo.say("Droits enregistrés.") }
                        is app.smartcourse.courses.nativeproto.net.Outcome.Fail -> demo.say(if (x.code == "staff_rights_limited") "Le personnel peut seulement saisir les paiements des courses." else explain(x))
                    }
                }
            }, Modifier.fillMaxWidth())
        }
    }
}
