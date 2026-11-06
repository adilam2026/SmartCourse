package app.smartcourse.courses.nativeproto

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * Listes gratuites de la famille et offres « Mes Courses Famille » (abonnement annuel ou achat à vie), COMMUN à Android et à l'iPhone.
 * Le serveur décide (compteur, droits) ; le store fournit les prix (jamais de montant écrit dans l'application) et encaisse.
 * La partie propre à chaque plateforme (Google Play Billing, StoreKit) est fournie par rememberStoreHost().
 */

/** État de la famille, tel que renvoyé par GET /api/family/plan. */
data class FamilyPlan(
    val quotaActive: Boolean = false,
    val freeLimit: Int = 10,
    val used: Int = 0,
    val freeRemaining: Int = 10,
    val blocked: Boolean = false,
    val entitlementKind: String? = null,      // "annual" | "lifetime"
    val entitlementStatus: String? = null,    // "active" | "grace" | "cancelled" …
    val entitlementPlatform: String? = null,  // "google" | "apple"
    val expiresAt: String? = null,
    val autoRenewing: Boolean = false,
    val canPurchase: Boolean = false,
) {
    val entitled get() = entitlementKind != null
    /** Afficher discrètement le nombre de listes gratuites restantes. */
    val showRemaining get() = quotaActive && !entitled

    companion object {
        fun parse(o: JsonObject?): FamilyPlan? {
            val p = (o?.get("plan") as? JsonObject) ?: return null
            fun b(k: String) = p[k]?.jsonPrimitive?.booleanOrNull ?: false
            fun i(k: String, d: Int) = p[k]?.jsonPrimitive?.intOrNull ?: d
            val e = p["entitlement"] as? JsonObject
            fun s(k: String) = e?.get(k)?.jsonPrimitive?.contentOrNull
            return FamilyPlan(
                quotaActive = b("quotaActive"), freeLimit = i("freeLimit", 10), used = i("used", 0), freeRemaining = i("freeRemaining", 10),
                blocked = b("blocked"), entitlementKind = s("kind"), entitlementStatus = s("status"), entitlementPlatform = s("platform"),
                expiresAt = s("expiresAt"), autoRenewing = e?.get("autoRenewing")?.jsonPrimitive?.booleanOrNull ?: false, canPurchase = b("canPurchase"),
            )
        }
    }
}

const val PRODUCT_ANNUAL = "courses_famille_annuel"
const val PRODUCT_LIFETIME = "courses_famille_a_vie"

/** Offre telle que décrite par le store (prix et devise du store, jamais calculés ici). */
data class StoreOffer(val productId: String, val title: String, val displayPrice: String, val periodText: String?)

sealed interface BuyResult {
    /** Achat confirmé par le store et transmis au serveur, qui l'a vérifié. */
    data object Done : BuyResult
    data object Cancelled : BuyResult
    /** En attente (paiement différé, accord parental…). */
    data object Pending : BuyResult
    data class Failed(val message: String) : BuyResult
}

/** Partie propre à la plateforme : Google Play Billing (Android), StoreKit (iPhone). */
interface StoreHost {
    val storeName: String
    /** Le store répond et les produits sont configurés. */
    suspend fun offers(): List<StoreOffer>
    suspend fun buy(productId: String): BuyResult
    /** Retransmet au serveur les achats connus du store ; renvoie le nombre d'achats retrouvés. */
    suspend fun restore(): Int
    /** Ouvre la gestion de l'abonnement dans le store (arrêter, changer). */
    fun manageSubscription()
    /** Où arrêter un abonnement de ce store (texte affiché). */
    val manageHint: String
}

/** Ligne discrète : « 3 listes gratuites restantes ». */
@Composable
fun FreeListsHint(plan: FamilyPlan?, modifier: Modifier = Modifier) {
    if (plan == null || !plan.showRemaining) return
    val t = when (plan.freeRemaining) {
        0 -> "Listes gratuites utilisées"
        1 -> "1 liste gratuite restante"
        else -> "${plan.freeRemaining} listes gratuites restantes"
    }
    Text(t, style = MaterialTheme.typography.bodySmall, color = C.Muted, modifier = modifier)
}

private fun dateFr(iso: String?): String? = iso?.let { runCatching { formatInstant(it, "d MMMM yyyy") }.getOrNull() }

/** « Mes Courses Famille » : état du droit, offres (administrateurs), restaurer, gérer ; message pour les autres membres. */
@Composable
fun PlanScreen(onBack: () -> Unit) {
    val demo = LocalDemo.current
    val data = demo.data
    val plan = demo.plan
    val store = rememberStoreHost()
    val scope = rememberCoroutineScope()
    var offers by remember { mutableStateOf<List<StoreOffer>?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        data?.loadPlan()
        offers = runCatching { store.offers() }.getOrDefault(emptyList())
    }
    fun act(block: suspend () -> Unit) { if (!busy) scope.launch { busy = true; try { block() } finally { busy = false; data?.loadPlan() } } }

    Column(Modifier.fillMaxSize()) {
        TopBar("Mes Courses Famille", "Pour toute la famille", onBack = onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            // État actuel
            SCard(padding = PaddingValues(16.dp)) {
                when {
                    plan == null -> Text("Chargement…", style = MaterialTheme.typography.bodyMedium, color = C.Muted)
                    plan.entitlementKind == "lifetime" -> {
                        Text("Mes Courses Famille à vie", style = MaterialTheme.typography.titleSmall)
                        Text("Débloqué pour toute la famille, sans abonnement.", style = MaterialTheme.typography.bodySmall)
                    }
                    plan.entitlementKind == "annual" -> {
                        Text("Abonnement annuel actif", style = MaterialTheme.typography.titleSmall)
                        val d = dateFr(plan.expiresAt)
                        Text(
                            when {
                                plan.autoRenewing && d != null -> "Renouvellement automatique le $d."
                                d != null -> "Renouvellement arrêté : accès jusqu'au $d."
                                else -> "Débloqué pour toute la famille."
                            },
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    plan.quotaActive -> {
                        Text(if (plan.blocked) "Listes gratuites utilisées" else "${plan.freeRemaining} sur ${plan.freeLimit} listes gratuites restantes", style = MaterialTheme.typography.titleSmall)
                        Text("La liste en cours, l'historique, les statistiques et toutes vos données restent accessibles. Seule la création de nouvelles listes demande Mes Courses Famille.", style = MaterialTheme.typography.bodySmall)
                    }
                    else -> Text("Création de listes illimitée.", style = MaterialTheme.typography.titleSmall)
                }
            }
            if (plan != null && !plan.canPurchase) {
                NoteCard("Seuls les administrateurs de la famille peuvent débloquer Mes Courses Famille. Demandez à un administrateur.")
            } else if (plan != null) {
                val lifetime = plan.entitlementKind == "lifetime"
                val annual = plan.entitlementKind == "annual"
                if (!lifetime) {
                    val list = offers
                    when {
                        list == null -> Text("Chargement des offres…", style = MaterialTheme.typography.bodySmall, color = C.Muted)
                        list.isEmpty() -> NoteCard("Les offres ne sont pas disponibles pour le moment (${store.storeName} ne répond pas ou les achats ne sont pas encore ouverts). Réessayez plus tard.")
                        else -> list.filter { !(annual && it.productId == PRODUCT_ANNUAL) }.forEach { o ->
                            SCard(padding = PaddingValues(16.dp)) {
                                Text(o.title, style = MaterialTheme.typography.titleSmall)
                                Text(o.displayPrice + (o.periodText?.let { " · $it" } ?: ""), style = MaterialTheme.typography.titleMedium, color = C.TealDark)
                                Text(
                                    if (o.productId == PRODUCT_ANNUAL) "Abonnement d'un an, renouvelé automatiquement chaque année au prix affiché tant qu'il n'est pas arrêté avant l'échéance dans ${store.manageHint}."
                                    else "Paiement unique, sans abonnement ni renouvellement. Pour toute la famille, sur Android et sur iPhone.",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                if (annual && o.productId == PRODUCT_LIFETIME) Text(
                                    "Votre abonnement annuel ne s'arrête pas tout seul : après cet achat, arrêtez-le dans ${store.manageHint} (ou dans le store où il a été souscrit) pour ne plus être facturé.",
                                    style = MaterialTheme.typography.bodySmall, color = C.Amber,
                                )
                                Spacer(Modifier.height(10.dp))
                                PrimaryButton(if (o.productId == PRODUCT_ANNUAL) "S'abonner" else "Acheter à vie", {
                                    act {
                                        when (val r = store.buy(o.productId)) {
                                            BuyResult.Done -> demo.say("Mes Courses Famille est débloqué pour toute la famille.")
                                            BuyResult.Pending -> demo.say("Paiement en attente : le déblocage se fera dès sa confirmation.")
                                            BuyResult.Cancelled -> {}
                                            is BuyResult.Failed -> demo.say(r.message)
                                        }
                                    }
                                }, Modifier.fillMaxWidth(), enabled = !busy)
                            }
                        }
                    }
                }
                SecondaryButton("Restaurer les achats", { act { val n = store.restore(); demo.say(if (n > 0) "Achats retrouvés et vérifiés." else "Aucun achat à restaurer sur ce compte ${store.storeName}.") } }, Modifier.fillMaxWidth(), leading = Icons.Rounded.Refresh)
                if (annual) SecondaryButton("Gérer l'abonnement", { store.manageSubscription() }, Modifier.fillMaxWidth())
            }
            InfoRow("Un achat débloque toute la famille, sur Android comme sur iPhone, sans second paiement. Les prix affichés sont ceux du store, dans votre devise.")
            Spacer(Modifier.height(12.dp))
        }
    }
}
