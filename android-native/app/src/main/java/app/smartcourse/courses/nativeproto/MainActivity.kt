package app.smartcourse.courses.nativeproto

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccountBalanceWallet
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Checklist
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import app.smartcourse.courses.nativeproto.net.ApiClient
import app.smartcourse.courses.nativeproto.net.AuthState
import app.smartcourse.courses.nativeproto.net.EncryptedStorage
import app.smartcourse.courses.nativeproto.net.FileKv
import app.smartcourse.courses.nativeproto.net.Me
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.ProfilesRepo
import coil.ImageLoader
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.wrapContentHeight
import kotlinx.coroutines.launch
import app.smartcourse.courses.nativeproto.net.Session

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var session: Session? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // Paramètres de lancement : réservés au build de recette (captures automatiques d'écrans simulés).
        Launch.extras = if (BuildConfig.RECETTE_HOOKS) intent?.extras else null
        // Recette seulement : confie une vérification à WorkManager (même chemin que la tâche périodique, exécutée en arrière-plan).
        // Une tâche périodique ne peut pas être avancée par Android : on passe donc par une tâche unique, avec la même classe PollWorker.
        if (BuildConfig.RECETTE_HOOKS && intent?.getBooleanExtra("pollwork", false) == true) {
            super.onCreate(savedInstanceState)
            androidx.work.WorkManager.getInstance(applicationContext).enqueue(androidx.work.OneTimeWorkRequestBuilder<PollWorker>().build())
            android.util.Log.i("CoursesNotif", "tâche unique confiée à WorkManager (recette)")
            finish()
            return
        }
        // Recette seulement : exécute la vérification des notifications tout de suite (sans attendre Android), sans ouvrir l'application.
        if (BuildConfig.RECETTE_HOOKS && intent?.getBooleanExtra("poll", false) == true) {
            super.onCreate(savedInstanceState)
            android.util.Log.i("CoursesNotif", "déclenchement de la vérification (recette), nouvelle instance")
            CoroutineScope(Dispatchers.IO).launch { val ok = pollOnce(applicationContext); android.util.Log.i("CoursesNotif", "vérification terminée, réussie=$ok"); runOnUiThread { finish() } }
            return
        }
        val splash = installSplashScreen()
        enableEdgeToEdge(
            // Barre d'état claire (icônes sombres) sur le fond de l'application : aucun bandeau ajouté.
            statusBarStyle = SystemBarStyle.light(C.Bg.toArgb(), C.Bg.toArgb()),
            navigationBarStyle = SystemBarStyle.light(Color.White.toArgb(), Color.White.toArgb()),
        )
        super.onCreate(savedInstanceState)
        Env.context = applicationContext
        Env.kv = FileKv(java.io.File(filesDir, "store"))
        val storage = EncryptedStorage(applicationContext)
        val s = Session(storage, ApiClient(storage), scope)
        session = s
        // Version finale : serveur permanent fixé à la compilation, jamais demandé à l'utilisateur.
        if (BuildConfig.FINAL) s.setServer(BuildConfig.SERVER_URL)
        val demoMode = Launch.str("screen") != null || Launch.str("path") != null || Launch.flag("hub")
        if (!demoMode) s.start()
        splash.setKeepOnScreenCondition { !demoMode && s.state == AuthState.Booting }
        val loader = ImageLoader.Builder(applicationContext).okHttpClient(s.api.imageClient()).crossfade(true).build()
        setContent { CoursesTheme { CompositionLocalProvider(LocalImageLoader provides loader) { Root(s, demoMode) } } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (BuildConfig.RECETTE_HOOKS && intent.getBooleanExtra("poll", false)) {
            android.util.Log.i("CoursesNotif", "déclenchement de la vérification (recette), instance existante")
            CoroutineScope(Dispatchers.IO).launch { val ok = pollOnce(applicationContext); android.util.Log.i("CoursesNotif", "vérification terminée, réussie=$ok") }
            return
        }
    }

    override fun onStart() { super.onStart(); session?.verify(); LiveHolder.current?.onForeground() }
    override fun onStop() { super.onStop(); LiveHolder.current?.onBackground() }
    override fun onDestroy() { super.onDestroy(); scope.cancel() }
}

@Composable
private fun Root(session: Session, demoMode: Boolean) {
    if (demoMode) { App(session, null); return }
    when (val st = session.state) {
        AuthState.Booting -> Box(Modifier.fillMaxSize().background(C.Bg))
        AuthState.SignedOut -> {
            val demo = remember { Demo() }
            CompositionLocalProvider(LocalDemo provides demo, LocalCompact provides false) {
                Column(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding()) {
                    Column(Modifier.weight(1f).fillMaxWidth().imePadding()) { LoginScreen(session) { } }
                }
            }
        }
        is AuthState.SignedIn -> key(st.me.id) { App(session, st.me) }
    }
}

private val ADMIN_TABS = listOf(
    NavItem("v02", "Liste", Icons.Rounded.Checklist),
    NavItem("v06", "Historique", Icons.Rounded.History),
    NavItem("v12", "Statistiques", Icons.Rounded.BarChart),
    NavItem("v07", "Réglages", Icons.Rounded.Settings),
)
private val BUDGET_TAB = NavItem("b1", "Budget", Icons.Rounded.AccountBalanceWallet)
private val STAFF_TABS = listOf(
    NavItem("v04", "Choisir", Icons.Rounded.GridView),
    NavItem("v03", "Liste du jour", Icons.Rounded.Checklist),
)

/** Onglet mis en avant selon l'écran affiché. */
private fun tabFor(route: String?): String? = when {
    route == null -> null
    route.startsWith("v06") -> "v06"
    route.startsWith("b") -> "b1"
    route in listOf("v08", "v09", "v10", "v11") || route.startsWith("stub") -> "v07"
    else -> route
}

private fun startRoute(): String = when (Launch.str("screen")?.lowercase()) {
    "v02" -> "v02"; "v03" -> "v03"; "v04", "v05" -> "v04"; "v06" -> "v06"; "v06d" -> "v06d/o3"
    "v07" -> "v07"; "v08" -> "v08"; "v09" -> "v09"; "v10" -> "v10"; "v11" -> "v11"; "v12" -> "v12"
    else -> "v01"
}

/** Ouvre le panneau Compte depuis l'en-tête des écrans principaux (null hors session réelle). */
val LocalAccount = androidx.compose.runtime.compositionLocalOf<(() -> Unit)?> { null }

/** Ouvre la confirmation de déconnexion (null hors session réelle). */
val LocalLogout = androidx.compose.runtime.compositionLocalOf<(() -> Unit)?> { null }

@Composable
fun App(session: Session, me: Me?) {
    val uiRole = if (me?.role == "staff") Role.STAFF else Role.ADMIN
    val demo = remember { Demo(if (me != null) uiRole else null, live = me != null) }
    val scopeUi = rememberCoroutineScope()
    val data = remember(me?.id) { if (me != null && Env.kv != null) AppData(demo, session, me, Env.kv!!, scopeUi) else null }
    DisposableEffect(data) {
        LiveHolder.current = data
        data?.onForeground()
        onDispose { data?.onBackground(); if (LiveHolder.current === data) LiveHolder.current = null }
    }
    LaunchedEffect(me?.prefs, me?.location, me?.features) { data?.applyLocation(me?.location); data?.applyFeatures(me?.features); data?.applyPrefs(me?.prefs) }
    // Rappels d'achat du profil connecté : reprogrammés à chaque connexion (annulés à la déconnexion).
    val appCtx = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(me?.id) { Reminders.schedule(appCtx) }
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    var hub by remember { mutableStateOf(Launch.once("hub")) }
    var account by remember { mutableStateOf(false) }
    var confirmLogout by remember { mutableStateOf(false) }
    var cityPicker by remember { mutableStateOf(false) }
    var deleteAccount by remember { mutableStateOf(false) }
    var deleteFamily by remember { mutableStateOf(false) }
    val profilesRepo = remember { ProfilesRepo(session.api) }
    val path = remember { Launch.str("path")?.split(",")?.filter { it.isNotBlank() } }
    val start = remember { if (me != null) (if (uiRole == Role.STAFF) "v04" else "v02") else path?.firstOrNull() ?: startRoute() }

    LaunchedEffect(Unit) { path?.drop(1)?.forEach { nav.navigate(it) } }

    val go: (String) -> Unit = { r ->
        val staff = demo.role == Role.STAFF
        val tab = if (staff) STAFF_TABS.any { it.route == r } else ADMIN_TABS.any { it.route == r } || r == BUDGET_TAB.route
        // Personnel : l'écran Choisir (mode, recherche, défilement) est conservé quand on passe par Liste du jour.
        nav.navigate(r) { if (tab) { if (staff) popUpTo(nav.graph.startDestinationId) { inclusive = false } else popUpTo("v02") { inclusive = false }; launchSingleTop = true } }
    }
    val back: () -> Unit = { nav.popBackStack() }
    val baseTabs = if (demo.role == Role.ADMIN) (if (me?.role == "parent") ADMIN_TABS.filter { it.route != "v07" } else ADMIN_TABS) else STAFF_TABS
    // Onglet Budget : seulement si l'option est activée ET que ce profil peut consulter le suivi financier (droit vérifié par le serveur).
    val tabs = if (demo.role == Role.ADMIN && demo.budget?.let { it.enabled && it.rights.view } == true)
        baseTabs.flatMap { if (it.route == "v12") listOf(it, BUDGET_TAB) else listOf(it) } else baseTabs
    val showBar = route != null && route != "v01" &&
        // Personnel : aucune barre d'onglets (ni son conteneur ni son espace) ; « Choisir mes articles » est l'unique écran principal.
        demo.role == Role.ADMIN && route != "v04"

    CompositionLocalProvider(LocalDemo provides demo, LocalSession provides (if (me != null) session else null), LocalCompact provides (demo.role == Role.ADMIN && route != "v01"), LocalLogout provides (if (me != null) ({ confirmLogout = true }) else null), LocalAccount provides (if (me != null) ({ account = true }) else null)) {
        Box(Modifier.fillMaxSize().background(C.Bg)) {
            Column(Modifier.fillMaxSize()) {
                // Aucun bandeau (recette ou prototype) : seule la barre d'état ; « Compte » est dans l'en-tête de chaque écran principal.
                Spacer(Modifier.statusBarsPadding())
                if (me != null && (!session.online || data?.online == false)) Box(Modifier.fillMaxWidth().background(C.AmberSoft).padding(horizontal = 14.dp, vertical = 6.dp)) {
                    Text("Hors connexion : session et dernières données conservées sur ce téléphone.", color = C.Ink, style = MaterialTheme.typography.labelMedium)
                }
                if (me != null && demo.pendingOps > 0) Row(Modifier.fillMaxWidth().background(C.AmberSoft).padding(horizontal = 14.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Envoi en attente : ${demo.pendingOps} modification${if (demo.pendingOps > 1) "s" else ""}", color = C.Ink, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                    Text("Réessayer", color = C.TealDark, style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { scopeUi.launch { data?.flushAndRefresh() } }.heightIn(min = 48.dp).wrapContentHeight(Alignment.CenterVertically).padding(horizontal = 8.dp))
                }
                Column(Modifier.weight(1f).fillMaxWidth().imePadding()) {
                    NavHost(nav, startDestination = start, modifier = Modifier.weight(1f)) {
                        composable("v01") {
                            LoginScreen(null) { role ->
                                demo.role = role
                                nav.navigate(if (role == Role.ADMIN) "v02" else "v04") { popUpTo("v01") { inclusive = true } }
                            }
                        }
                        composable("v02") { AdminListScreen(go) }
                        composable("v03") { StaffListScreen(go) }
                        composable("v04") { SelectionScreen(go, back) }
                        composable("v06") { HistoryScreen(go) }
                        composable("v06d/{id}") { HistoryDetailScreen(it.arguments?.getString("id") ?: "o3", go, back) }
                        composable("v07") { AdminHubScreen(go) }
                        composable("v08") { ProfilesScreen(back) }
                        composable("v09") { CatalogScreen(back) }
                        composable("v10") { PricesScreen(back) }
                        composable("v11") { DisplayScreen(back) }
                        composable("v12") { StatsScreen() }
                        composable("v15") { LocationScreen(back) }
                        composable("v17") { AdvancedSettingsScreen(back, go) }
                        // Module Budget (option familiale) : vue d'ensemble, historique, opération, budgets, Mon compte, réglages, droits.
                        composable("b1") { BudgetScreen(go) }
                        composable("b2") { OperationsScreen(back) }
                        composable("b3") { AddOperationScreen(back) }
                        composable("b4") { BudgetsScreen(back) }
                        composable("b5") { AccountScreen(back) }
                        composable("b6") { BudgetSettingsScreen(go, back) }
                        composable("b7") { FinanceRightsScreen(back) }
                        composable("stub/{name}") { StubScreen(it.arguments?.getString("name") ?: "", back) }
                    }
                    if (showBar) BottomNav(tabs, tabFor(route) ?: "", go)
                }
            }
            ToastHost(demo)
        }
        if (hub) HubSheet({ hub = false }) { r, role ->
            hub = false
            demo.role = role
            demo.pendingSheet = if (r.startsWith("v04?sheet=")) r.substringAfter("=") else null
            nav.navigate(r.substringBefore("?")) { launchSingleTop = true }
        }
        if (account && me != null) AccountSheet(me, session, { account = false }, { account = false; confirmLogout = true }, { account = false; cityPicker = true }, { account = false; deleteAccount = true })
        if (deleteAccount && me != null) DeleteAccountSheet(me, session, { deleteAccount = false }, { deleteAccount = false; deleteFamily = true })
        if (deleteFamily) ResetFamilySheet { deleteFamily = false }
        if (cityPicker && me != null) CityPickerSheet(me.city, { city ->
            cityPicker = false
            scopeUi.launch {
                when (val r = profilesRepo.setMyCity(city)) {
                    is Outcome.Ok -> { session.verify(); demo.say("Ville : $city.") }
                    is Outcome.Fail -> demo.say(explain(r))
                }
            }
        }, { cityPicker = false })
        // Famille tout juste créée : son code (à transmettre aux autres membres) avec Copier / Partager, puis préparation des courses.
        val welcome = if (me != null) session.welcomeFamilyCode else null
        if (welcome != null) {
            val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
            val ctx = androidx.compose.ui.platform.LocalContext.current
            var copied by remember { mutableStateOf(false) }
            AppSheet({ session.welcomeFamilyCode = null }) {
                Text("Votre famille est créée", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(6.dp))
                Text("Voici le code famille. Les autres membres en auront besoin, avec l'identifiant et le code d'accès que vous leur créerez dans Réglages → Profils.", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(14.dp))
                Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.TealSoft).padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                    Text(welcome, style = MaterialTheme.typography.headlineMedium, color = C.TealDark, letterSpacing = 3.sp)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryButton(if (copied) "Copié" else "Copier", { clipboard.setText(androidx.compose.ui.text.AnnotatedString(welcome)); copied = true }, Modifier.weight(1f), leading = if (copied) Icons.Rounded.Check else Icons.Rounded.ContentCopy)
                    SecondaryButton("Partager", {
                        val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "Rejoignez notre famille sur Mes Courses. Code famille : $welcome. Je vous donnerai votre identifiant et votre code d'accès.") }
                        try { ctx.startActivity(Intent.createChooser(send, "Partager le code famille").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { demo.say("Aucune application de partage disponible.") }
                    }, Modifier.weight(1f), leading = Icons.Rounded.Share)
                }
                // Confirmation visible dans le panneau lui-même (un message en bas d'écran serait masqué par le panneau).
                if (copied) { Spacer(Modifier.height(8.dp)); Text("Code famille copié dans le presse-papiers.", style = MaterialTheme.typography.bodyMedium, color = C.TealDark) }
                Spacer(Modifier.height(12.dp))
                PrimaryButton("Préparer mes courses", { session.welcomeFamilyCode = null; go("v04") }, Modifier.fillMaxWidth(), trailing = Icons.AutoMirrored.Rounded.ArrowForward)
            }
        }
        if (confirmLogout) ConfirmDialog(
            "Se déconnecter ?",
            // Rien n'est supprimé en silence : les modifications non envoyées restent sur ce téléphone pour ce profil
            // et repartent à sa prochaine connexion ; on prévient avant de quitter.
            (demo.pendingOps + demo.orphanCount).let { n ->
                if (n > 0) "$n modification${if (n > 1) "s n'ont" else " n'a"} pas encore été envoyée${if (n > 1) "s" else ""}. Elle${if (n > 1) "s resteront" else " restera"} sur ce téléphone et ne partira qu'à la prochaine connexion de ce profil. Vous devrez saisir à nouveau votre code d'accès."
                else "Vous devrez saisir à nouveau votre code d'accès pour rouvrir l'application."
            },
            if (demo.pendingOps + demo.orphanCount > 0) "Se déconnecter quand même" else "Se déconnecter", { confirmLogout = false; session.signOut() }, { confirmLogout = false }, danger = true,
        )
    }
}

@Composable
private fun AccountSheet(me: Me, session: Session, onDismiss: () -> Unit, onLogout: () -> Unit, onCity: () -> Unit, onDeleteAccount: () -> Unit) {
    val roleLabel = when (me.role) { "admin" -> if (me.primary == true) "Administrateur principal" else "Administrateur"; "parent" -> "Parent"; else -> "Personnel" }
    AppSheet(onDismiss) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Avatar(me.displayName.take(1).uppercase(), C.Teal, 52.dp)
            Column(Modifier.weight(1f)) {
                Text(me.displayName, style = MaterialTheme.typography.titleLarge, maxLines = 2)
                Row(Modifier.padding(top = 4.dp)) { Pill(roleLabel, C.TealDark, C.TealSoft) }
            }
        }
        Spacer(Modifier.height(14.dp))
        me.family?.let { Text("Famille : ${it.name} (${it.code})", style = MaterialTheme.typography.bodyMedium) }
        // Pays et ville de la famille (confirmés par un administrateur) ; sinon, la ville personnelle reste modifiable comme avant.
        val loc = me.location
        if (loc?.confirmed == true) Text(
            "Famille : ${countryName(loc.country) ?: loc.country}${loc.city?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.heightIn(min = 48.dp).wrapContentHeight(Alignment.CenterVertically),
        ) else Text(
            "Ville : ${me.city ?: "à choisir"} · Modifier", style = MaterialTheme.typography.bodyMedium, color = C.TealDark,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onCity).heightIn(min = 48.dp).wrapContentHeight(Alignment.CenterVertically),
        )
        if (!BuildConfig.FINAL) Text("Serveur : ${session.serverAddress?.substringAfter("://") ?: "—"}", style = MaterialTheme.typography.bodyMedium)
        Text(if (session.online) "État : connecté" else "État : hors connexion, session conservée", style = MaterialTheme.typography.bodyMedium, color = if (session.online) C.TealDark else C.Amber)
        Spacer(Modifier.height(16.dp))
        SecondaryButton("Se déconnecter", onLogout, Modifier.fillMaxWidth(), danger = true)
        // Suppression du compte : pour chaque rôle, distincte de la déconnexion et de la désactivation d'un profil.
        Text(
            "Supprimer mon compte", style = MaterialTheme.typography.labelLarge, color = C.Danger,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 6.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onDeleteAccount)
                .heightIn(min = 48.dp).padding(horizontal = 16.dp).wrapContentHeight(Alignment.CenterVertically),
        )
    }
}

@Composable
private fun ToastHost(demo: Demo) {
    val t = demo.toast
    LaunchedEffect(t) { if (t != null) { delay(if (t.undoLabel != null) 8000 else 3200); if (demo.toast === t) demo.toast = null } }
    // imePadding : le message (et son bouton « Annuler ») reste visible et touchable au-dessus du clavier
    if (t != null) Box(Modifier.fillMaxSize().imePadding().navigationBarsPadding().padding(bottom = 96.dp, start = 16.dp, end = 16.dp), contentAlignment = Alignment.BottomCenter) {
        Row(
            Modifier.clip(RoundedCornerShape(16.dp)).background(C.Navy).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(t.message, color = Color.White, style = MaterialTheme.typography.bodyMedium.copy(color = Color.White), modifier = Modifier.weight(1f, fill = false))
            if (t.undoLabel != null) Text(
                t.undoLabel, color = Color(0xFF7FE3DE), style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { t.undo?.invoke(); demo.toast = null }.padding(4.dp),
            )
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun HubSheet(onDismiss: () -> Unit, onPick: (String, Role) -> Unit) {
    val items = listOf(
        Triple("V01 · Connexion", "v01", Role.ADMIN), Triple("V02 · Liste administrateur", "v02", Role.ADMIN),
        Triple("V03 · Liste personnel", "v03", Role.STAFF), Triple("V04 · Sélection", "v04", Role.ADMIN),
        Triple("V05 · Quantité", "v04?sheet=tomates", Role.ADMIN), Triple("V06 · Historique", "v06", Role.ADMIN),
        Triple("V07 · Administration", "v07", Role.ADMIN), Triple("V08 · Profils", "v08", Role.ADMIN),
        Triple("V09 · Catalogue", "v09", Role.ADMIN), Triple("V10 · Gestion des prix", "v10", Role.ADMIN),
        Triple("V11 · Affichage", "v11", Role.ADMIN), Triple("V12 · Statistiques", "v12", Role.ADMIN),
    )
    AppSheet(onDismiss) {
        Text("Écrans de démonstration", style = MaterialTheme.typography.titleLarge)
        Text("Navigation de démonstration : données fictives, aucune écriture réelle.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items.forEach { (label, r, role) -> ToggleChip(label, false, { onPick(r, role) }) }
        }
    }
}
