@file:OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.json
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

/* ───────────── Modèle (réponses du serveur, montants en unités mineures entières) ───────────── */

@Serializable data class FinRights(val manage: Boolean = false, val view: Boolean = false, val record: Boolean = false, val edit: Boolean = false)
@Serializable data class FinCategory(val id: String, val name: String, val key: String? = null, val archived: Boolean = false)
@Serializable data class BudgetInfo(
    val enabled: Boolean = false, val rights: FinRights = FinRights(), val currency: String? = null, val decimals: Int? = null,
    val proposedCurrency: String? = null, val currencies: Map<String, Int> = emptyMap(), val currencyFrozen: Boolean = false,
    val budgetsEnabled: Boolean = false, val accountEnabled: Boolean = false,
    val categories: List<FinCategory> = emptyList(), val merchants: List<String> = emptyList(),
) {
    val anyAccess get() = enabled && (rights.view || rights.record || rights.edit || rights.manage)
    val dec get() = decimals ?: 2
}
@Serializable data class FinOp(
    val id: String, val kind: String, val amount: Long, val currency: String, val date: String,
    val categoryId: String? = null, val category: String? = null, val courses: Boolean = false,
    val merchant: String? = null, val label: String? = null, val note: String? = null,
    val listId: String? = null, val listName: String? = null, val listCreatedAt: String? = null,
    val source: String = "manual", val rev: Int = 1, val createdAt: String = "", val createdBy: String = "",
    val updatedAt: String = "", val updatedBy: String = "", val voided: Boolean = false, val voidReason: String? = null,
    val mine: Boolean = false, val canEdit: Boolean = false,
) { val title get() = merchant ?: label ?: "Opération" }
@Serializable data class Totals(val expenses: Long = 0, val incomes: Long = 0, val count: Int = 0)
@Serializable data class OpsResult(val operations: List<FinOp> = emptyList(), val totals: Totals = Totals(), val ownOnly: Boolean = false)
@Serializable data class OpResult(val operation: FinOp, val replay: Boolean = false, val warning: String? = null)
@Serializable data class MerchantTotal(val merchant: String, val total: Long, val count: Int, val dates: List<String> = emptyList())
@Serializable data class ListPayments(
    val listId: String, val listStatus: String = "active", val listName: String? = null, val payments: List<FinOp> = emptyList(),
    val byMerchant: List<MerchantTotal> = emptyList(), val total: Long = 0, val dates: List<String> = emptyList(),
    val state: String = "none", val completeAt: String? = null, val completeBy: String? = null,
)
@Serializable data class AccountState(
    val balance: Long, val opening: Long, val referenceDate: String, val asOf: String,
    val incomesSinceReference: Long = 0, val expensesSinceReference: Long = 0, val operationsBeforeReference: Int = 0, val futureOperations: Int = 0,
)
@Serializable data class BudgetLine(val categoryId: String, val category: String, val courses: Boolean = false, val planned: Long? = null, val proposed: Long? = null, val spent: Long = 0, val remaining: Long? = null)
@Serializable data class ListToComplete(val listId: String, val name: String? = null, val createdAt: String, val closedAt: String, val state: String, val recorded: Long = 0)
@Serializable data class WeekTotal(val from: String, val to: String, val expenses: Long)
@Serializable data class Overview(
    val month: String, val today: String, val currency: String, val decimals: Int, val account: AccountState? = null,
    val monthExpenses: Long = 0, val monthIncomes: Long = 0, val monthCourses: Long = 0, val monthOutsideCourses: Long = 0,
    val week: WeekTotal, val budgets: List<BudgetLine>? = null, val listsToComplete: List<ListToComplete> = emptyList(),
)
@Serializable data class AccountHist(val opening: Long, val referenceDate: String, val reason: String? = null, val at: String, val by: String)
@Serializable data class AccountInfo(val account: AccountState? = null, val history: List<AccountHist> = emptyList())
@Serializable data class AccountSet(val account: AccountState? = null, val warnings: List<String> = emptyList())
@Serializable data class BudgetsResult(val month: String, val budgets: List<BudgetLine> = emptyList())
@Serializable data class RightsProfile(val profileId: String, val displayName: String, val role: String, val active: Boolean = true, val fixed: Boolean = false, val rights: FinRights = FinRights())
@Serializable data class RightsResult(val profiles: List<RightsProfile> = emptyList())

/* ───────────── Montants et dates ───────────── */

private fun currencySuffix(c: String?) = when (c) { "MAD" -> "DH"; "EUR" -> "€"; "USD" -> "$"; "GBP" -> "£"; "CHF" -> "CHF"; null -> ""; else -> c }

/** Montant exact (entier en unités mineures) au format français : « 103 150,00 DH ». */
fun money(minor: Long, decimals: Int, currency: String?, signed: Boolean = false): String {
    val neg = minor < 0
    val a = kotlin.math.abs(minor)
    var unit = 1L; repeat(decimals) { unit *= 10 }
    val int = (a / unit).toString().reversed().chunked(3).joinToString(" ").reversed()
    val frac = if (decimals > 0) "," + (a % unit).toString().padStart(decimals, '0') else ""
    val sign = if (neg) "−" else if (signed) "+" else ""
    return "$sign$int$frac ${currencySuffix(currency)}".trim()
}

/** Contrôle local de la saisie (le serveur refait le calcul exact) : chiffres, une virgule, décimales de la devise, > 0. */
fun amountError(s: String, decimals: Int): String? {
    val t = s.replace(" ", "").replace(" ", "").replace(",", ".")
    if (t.isEmpty()) return "Indiquez le montant."
    val m = Regex("""^(\d{1,12})(?:\.(\d*))?$""").find(t) ?: return "Montant invalide."
    val frac = m.groupValues[2].trimEnd('0')
    if (frac.length > decimals) return if (decimals == 0) "Montant sans décimales." else "$decimals décimale${if (decimals > 1) "s" else ""} au plus."
    if (m.groupValues[1].trimStart('0').isEmpty() && frac.isEmpty()) return "Le montant doit être supérieur à zéro."
    return null
}

fun minorToInput(minor: Long, decimals: Int): String = money(minor, decimals, null).replace(" ", "")

private val DAY_FMT = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.FRENCH)
private val MONTH_FMT = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.FRENCH)
fun today(): String = LocalDate.now(ZoneId.systemDefault()).toString()
fun dayLabel(d: String): String = try { val x = LocalDate.parse(d); if (x == LocalDate.now()) "Aujourd'hui, ${x.format(DateTimeFormatter.ofPattern("d MMMM", Locale.FRENCH))}" else x.format(DAY_FMT) } catch (_: Exception) { d }
fun shortDay(d: String): String = try { LocalDate.parse(d).format(DateTimeFormatter.ofPattern("d MMM", Locale.FRENCH)) } catch (_: Exception) { d }
fun monthLabel(m: String): String = try { LocalDate.parse("$m-01").format(MONTH_FMT).replaceFirstChar { it.uppercase() } } catch (_: Exception) { m }
fun shiftMonth(m: String, by: Long): String = LocalDate.parse("$m-01").plusMonths(by).toString().substring(0, 7)

/* ───────────── Appels au serveur ───────────── */

/** Résultat d'un appel financier : confirmé, refusé (message), ou réseau absent (rien d'enregistré, saisie conservée). */
sealed interface FinR<out T> {
    data class Ok<T>(val v: T) : FinR<T>
    data class Err(val message: String, val network: Boolean = false) : FinR<Nothing>
}

object Fin {
    private fun <T> decode(s: KSerializer<T>, o: JsonObject): T = json.decodeFromJsonElement(s, o)
    suspend fun <T> call(data: AppData, method: String, path: String, s: KSerializer<T>, body: JsonObject? = null): FinR<T> =
        when (val r = data.session.api.call(method, path, body)) {
            is Outcome.Ok -> try { FinR.Ok(decode(s, r.value)) } catch (e: Exception) { FinR.Err("Réponse inattendue du serveur.") }
            is Outcome.Fail -> if (r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT)
                FinR.Err("Pas de connexion : rien n'est enregistré. Vos saisies sont gardées, réessayez quand le réseau revient.", network = true)
            else FinR.Err(finMessage(r))
        }

    private fun finMessage(r: Outcome.Fail): String = when (r.code) {
        "budget_disabled" -> "La gestion du budget n'est pas activée pour la famille."
        "finance_forbidden" -> "Ce profil n'a pas ce droit financier."
        "stale" -> "Cette opération a été modifiée entre-temps : actualisez puis recommencez."
        "currency_frozen" -> "La devise est figée depuis la première opération."
        "currency_required" -> "Confirmez la devise du budget."
        "invalid_amount" -> "Montant invalide."
        "label_required" -> "Indiquez un libellé ou un commerce."
        "category_required" -> "Choisissez une catégorie."
        "category_exists" -> "Cette catégorie existe déjà."
        "category_protected" -> "La catégorie Courses est nécessaire aux paiements des listes."
        "reason_required" -> "Indiquez la raison de la correction du solde initial."
        "account_opening_required" -> "Saisissez d'abord le solde initial et sa date de référence."
        "staff_rights_limited" -> "Le personnel peut seulement saisir les paiements des courses."
        "admin_rights_fixed" -> "Un administrateur a tous les droits financiers."
        "operation_voided" -> "Cette opération est annulée."
        else -> explain(r)
    }

    fun newRequest(): String = UUID.randomUUID().toString()

    fun paymentBody(requestId: String, merchant: String, amount: String, date: String, note: String) = buildJsonObject {
        put("requestId", requestId); put("merchant", merchant.trim()); put("amount", amount.trim()); put("date", date)
        if (note.isNotBlank()) put("note", note.trim())
    }
}

/* ───────────── Saisir un paiement (pendant les courses, ou plus tard depuis l'historique) ───────────── */

/**
 * Panneau court : commerce (habituels + saisie libre), montant obligatoire, date (aujourd'hui par défaut), note facultative.
 * La liste est associée automatiquement. Un seul identifiant de saisie pour ce panneau : une relance ne crée jamais de doublon.
 */
@Composable
fun PaymentSheet(listId: String, listLabel: String, onDone: (FinOp) -> Unit, onDismiss: () -> Unit, edit: FinOp? = null) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val b = demo.budget ?: return
    val scope = rememberCoroutineScope()
    val requestId = remember { Fin.newRequest() }
    var merchant by remember { mutableStateOf(edit?.merchant ?: "") }
    var other by remember { mutableStateOf(edit?.merchant?.let { m -> b.merchants.none { it.equals(m, true) } } == true) }
    var amount by remember { mutableStateOf(edit?.let { minorToInput(it.amount, b.dec) } ?: "") }
    var date by remember { mutableStateOf(edit?.date ?: today()) }
    var note by remember { mutableStateOf(edit?.note ?: "") }
    var pickDate by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmVoid by remember { mutableStateOf(false) }
    val amountErr = if (amount.isEmpty()) null else amountError(amount, b.dec)
    val ok = merchant.isNotBlank() && amount.isNotBlank() && amountErr == null && !busy
    fun save() {
        busy = true; error = null
        scope.launch {
            val r = if (edit == null) Fin.call(data, "POST", "/api/lists/$listId/payments", OpResult.serializer(), Fin.paymentBody(requestId, merchant, amount, date, note))
            else Fin.call(data, "PATCH", "/api/budget/operations/${edit.id}", OpResult.serializer(), buildJsonObject {
                put("rev", edit.rev); put("amount", amount.trim()); put("merchant", merchant.trim()); put("date", date); put("note", note.trim())
            })
            busy = false
            when (r) {
                is FinR.Ok -> { demo.say(if (edit != null) "Paiement corrigé." else if (r.v.replay) "Paiement déjà enregistré." else "Paiement enregistré : dépense Courses comptée."); r.v.warning?.let { demo.say(it) }; onDone(r.v.operation) }
                is FinR.Err -> error = r.message
            }
        }
    }
    AppSheet(onDismiss) {
        Text(if (edit == null) "Saisir un paiement" else "Corriger le paiement", style = MaterialTheme.typography.titleLarge)
        Text("Liste : $listLabel", style = MaterialTheme.typography.bodySmall, color = C.Muted)
        Spacer(Modifier.height(12.dp))
        Text("Commerce", style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(6.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            b.merchants.take(10).forEach { m -> ToggleChip(m, !other && merchant.equals(m, true)) { other = false; merchant = m } }
            ToggleChip("Autre…", other) { other = true; merchant = "" }
        }
        if (other) { Spacer(Modifier.height(8.dp)); FormField(merchant, { merchant = it.take(40) }, "Nom du commerce", focus = edit == null) }
        Spacer(Modifier.height(10.dp))
        FormField(amount, { amount = it.take(16) }, "Montant payé", label = "Montant payé (${currencySuffix(b.currency)})", keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        amountErr?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodySmall) }
        Spacer(Modifier.height(8.dp))
        DateRow("Date du paiement", date) { pickDate = true }
        Spacer(Modifier.height(8.dp))
        FormField(note, { note = it.take(300) }, "Note (facultative)")
        error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.height(12.dp))
        PrimaryButton(if (busy) "Enregistrement…" else if (error != null && edit == null) "Réessayer" else if (edit == null) "Enregistrer la dépense" else "Enregistrer la correction", { save() }, Modifier.fillMaxWidth(), enabled = ok)
        if (edit == null) Text("Dépense réelle « Courses », comptée tout de suite, même avant la clôture de la liste.", style = MaterialTheme.typography.bodySmall, color = C.Muted, modifier = Modifier.padding(top = 6.dp))
        else { Spacer(Modifier.height(8.dp)); SecondaryButton("Annuler ce paiement…", { confirmVoid = true }, Modifier.fillMaxWidth()) }
    }
    if (pickDate) DatePick(date, { date = it; pickDate = false }, { pickDate = false })
    if (confirmVoid && edit != null) VoidDialog(edit, { confirmVoid = false }) { onDone(it) }
}

/** Annulation explicite et tracée d'une opération (elle reste visible dans l'historique, barrée). */
@Composable
fun VoidDialog(op: FinOp, onDismiss: () -> Unit, onDone: (FinOp) -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val scope = rememberCoroutineScope()
    var reason by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = Color.White,
        title = { Text("Annuler cette opération ?") },
        text = {
            Column {
                Text("${op.title} · ${money(op.amount, demo.budget?.dec ?: 2, op.currency)}. Elle ne comptera plus nulle part ; l'annulation est conservée avec votre nom.", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                FormField(reason, { reason = it.take(200) }, "Raison (facultative)")
                error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton({
                scope.launch {
                    when (val r = Fin.call(data, "POST", "/api/budget/operations/${op.id}/void", OpResult.serializer(), buildJsonObject { put("rev", op.rev); if (reason.isNotBlank()) put("reason", reason.trim()) })) {
                        is FinR.Ok -> { demo.say("Opération annulée."); onDismiss(); onDone(r.v.operation) }
                        is FinR.Err -> error = r.message
                    }
                }
            }) { Text("Annuler l'opération", color = C.Danger) }
        },
        dismissButton = { TextButton(onDismiss) { Text("Garder") } },
    )
}

@Composable
fun DateRow(label: String, date: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color.White).clickable(onClick = onClick)
            .heightIn(min = 56.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Event, null, tint = C.Muted)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = C.Muted)
            Text(dayLabel(date), style = MaterialTheme.typography.bodyLarge)
        }
        Icon(Icons.Rounded.ExpandMore, "Changer la date", tint = C.Muted)
    }
}

@Composable
fun DatePick(date: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val init = try { LocalDate.parse(date).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli() } catch (_: Exception) { null }
    val st = rememberDatePickerState(initialSelectedDateMillis = init)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton({ st.selectedDateMillis?.let { onPick(java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneOffset.UTC).toLocalDate().toString()) } ?: onDismiss() }) { Text("Choisir") } },
        dismissButton = { TextButton(onDismiss) { Text("Annuler") } },
    ) { DatePicker(st) }
}

/* ───────────── Récapitulatif des paiements (clôture, ou détail d'une liste clôturée) ───────────── */

@Composable
fun PaymentsSummary(p: ListPayments, b: BudgetInfo, onEdit: (FinOp) -> Unit) {
    if (p.payments.isEmpty()) {
        Text("Aucun paiement saisi pour cette liste : montants non renseignés (ce n'est pas zéro).", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
        return
    }
    SCard(padding = PaddingValues(vertical = 4.dp)) {
        p.payments.forEach { o ->
            Row(
                Modifier.fillMaxWidth().then(if (o.canEdit) Modifier.clickable { onEdit(o) } else Modifier).heightIn(min = 52.dp).padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(o.title, style = MaterialTheme.typography.titleSmall)
                    Text("${shortDay(o.date)} · par ${o.createdBy}", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                }
                Text(money(o.amount, b.dec, o.currency), style = MaterialTheme.typography.titleSmall)
                if (o.canEdit) Icon(Icons.Rounded.Edit, "Corriger", tint = C.Muted, modifier = Modifier.padding(start = 8.dp).size(18.dp))
            }
            HorizontalDivider(color = C.Line.copy(alpha = 0.5f))
        }
        if (p.byMerchant.size < p.payments.size) p.byMerchant.forEach { m ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp)) {
                Text("${m.merchant} (${m.count} paiements)", style = MaterialTheme.typography.bodySmall, color = C.Muted, modifier = Modifier.weight(1f))
                Text(money(m.total, b.dec, b.currency), style = MaterialTheme.typography.bodySmall, color = C.Muted)
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Total de la liste", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Text(money(p.total, b.dec, b.currency), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
    }
    if (p.dates.size > 1) Text("Paiements du ${p.dates.joinToString(", ") { shortDay(it) }}.", style = MaterialTheme.typography.bodySmall, color = C.Muted, modifier = Modifier.padding(top = 4.dp))
}

fun paymentStateLabel(s: String) = when (s) { "complete" -> "Montants confirmés comme complets"; "to_complete" -> "Paiements saisis, à compléter"; else -> "Montants non renseignés" }

/**
 * Clôture avec le budget activé : paiements déjà saisis (par commerce, total), ajout d'un paiement oublié, corrections selon les droits,
 * puis « Confirmer et clôturer ». Rien n'est redemandé ni déduit une seconde fois. Sans paiement : renseigner, ou clôturer et compléter plus tard.
 */
@Composable
fun CloseWithPaymentsSheet(listId: String, listLabel: String, remaining: Int, onClose: () -> Unit, onDismiss: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val b = demo.budget ?: return
    val scope = rememberCoroutineScope()
    var p by remember { mutableStateOf<ListPayments?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var add by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf<FinOp?>(null) }
    var complete by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    suspend fun load() { when (val r = Fin.call(data, "GET", "/api/lists/$listId/payments", ListPayments.serializer())) { is FinR.Ok -> p = r.v; is FinR.Err -> error = r.message } }
    LaunchedEffect(listId) { load() }
    AppSheet(onDismiss) {
        Text("Terminer les courses", style = MaterialTheme.typography.titleLarge)
        if (remaining > 0) Text("Il reste $remaining article${if (remaining > 1) "s" else ""} non acheté${if (remaining > 1) "s" else ""}. La liste sera archivée.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
        Spacer(Modifier.height(10.dp))
        Text("Paiements enregistrés", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(6.dp))
        val cur = p
        if (cur == null) Text(error ?: "Chargement…", color = if (error != null) C.Danger else C.Muted)
        else {
            Column(Modifier.heightIn(max = 340.dp).verticalScroll(rememberScrollState())) { PaymentsSummary(cur, b) { edit = it } }
            Spacer(Modifier.height(8.dp))
            SecondaryButton(if (cur.payments.isEmpty()) "Renseigner un paiement" else "Ajouter un paiement oublié", { add = true }, Modifier.fillMaxWidth(), leading = Icons.Rounded.Add)
            Spacer(Modifier.height(12.dp))
            if (cur.payments.isNotEmpty()) {
                Text("État des paiements", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ToggleChip("Complets", complete) { complete = true }
                    ToggleChip("À compléter plus tard", !complete) { complete = false }
                }
                Text("Ces dépenses sont déjà comptées : la clôture ne déduit rien de plus.", style = MaterialTheme.typography.bodySmall, color = C.Muted, modifier = Modifier.padding(top = 6.dp))
            } else Text("Vous pourrez saisir les montants plus tard depuis l'historique de la liste, sans la rouvrir.", style = MaterialTheme.typography.bodySmall, color = C.Muted)
            error?.let { Text(it, color = C.Danger, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp)) }
            Spacer(Modifier.height(12.dp))
            PrimaryButton(
                if (busy) "Clôture…" else if (cur.payments.isEmpty()) "Clôturer et compléter plus tard" else "Confirmer et clôturer",
                {
                    busy = true; error = null
                    scope.launch {
                        val st = if (cur.payments.isNotEmpty() && complete) Fin.call(data, "PUT", "/api/lists/$listId/payments/status", ListPayments.serializer(), buildJsonObject { put("complete", true) }) else null
                        busy = false
                        if (st is FinR.Err) error = st.message else onClose()
                    }
                },
                Modifier.fillMaxWidth(), enabled = !busy,
            )
        }
    }
    if (add) PaymentSheet(listId, listLabel, { add = false; scope.launch { load() } }, { add = false })
    edit?.let { o -> PaymentSheet(listId, listLabel, { edit = null; scope.launch { load() } }, { edit = null }, edit = o) }
}

/** Détail d'une liste clôturée : ses paiements (dates réelles), leur état, saisie ultérieure sans rouvrir la liste. */
@Composable
fun ListPaymentsSection(listId: String, listLabel: String) {
    val demo = LocalDemo.current
    val data = demo.data ?: return
    val b = demo.budget ?: return
    if (!b.enabled || !(b.rights.view || b.rights.record || b.rights.edit)) return
    val scope = rememberCoroutineScope()
    var p by remember { mutableStateOf<ListPayments?>(null) }
    var add by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf<FinOp?>(null) }
    suspend fun load() { (Fin.call(data, "GET", "/api/lists/$listId/payments", ListPayments.serializer()) as? FinR.Ok)?.let { p = it.v } }
    LaunchedEffect(listId, demo.budgetRev) { load() }
    val cur = p ?: return
    Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Paiements", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Pill(paymentStateLabel(cur.state), if (cur.state == "complete") C.TealDark else C.Amber, if (cur.state == "complete") C.TealSoft else C.AmberSoft)
        }
        Spacer(Modifier.height(6.dp))
        PaymentsSummary(cur, b) { edit = it }
        if (cur.state != "complete" && cur.payments.isNotEmpty()) Text("Les totaux ne couvrent que les paiements enregistrés.", style = MaterialTheme.typography.bodySmall, color = C.Amber, modifier = Modifier.padding(top = 4.dp))
        if (b.rights.record || b.rights.edit) {
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton("Ajouter un paiement", { add = true }, Modifier.weight(1f), leading = Icons.Rounded.Add)
                if (cur.payments.isNotEmpty()) SecondaryButton(if (cur.state == "complete") "Marquer à compléter" else "Marquer complets", {
                    scope.launch {
                        when (val r = Fin.call(data, "PUT", "/api/lists/$listId/payments/status", ListPayments.serializer(), buildJsonObject { put("complete", cur.state != "complete") })) {
                            is FinR.Ok -> p = r.v
                            is FinR.Err -> demo.say(r.message)
                        }
                    }
                }, Modifier.weight(1f))
            }
        }
    }
    if (add) PaymentSheet(listId, listLabel, { add = false; scope.launch { load() } }, { add = false })
    edit?.let { o -> PaymentSheet(listId, listLabel, { edit = null; scope.launch { load() } }, { edit = null }, edit = o) }
}

/** « Saisir un paiement » visible seulement si le module est activé et le profil autorisé. */
fun canRecordPayments(demo: Demo) = demo.budget?.let { it.enabled && (it.rights.record || it.rights.edit) } == true
