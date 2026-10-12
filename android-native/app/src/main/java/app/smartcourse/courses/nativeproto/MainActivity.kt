package app.smartcourse.courses.nativeproto

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BarChart
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
import app.smartcourse.courses.nativeproto.net.Me
import app.smartcourse.courses.nativeproto.net.Session

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var session: Session? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // Paramètres de lancement : réservés au build de recette (captures automatiques d'écrans simulés).
        Launch.extras = if (BuildConfig.RECETTE_HOOKS) intent?.extras else null
        val splash = installSplashScreen()
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(C.Navy.toArgb()),
            navigationBarStyle = SystemBarStyle.light(Color.White.toArgb(), Color.White.toArgb()),
        )
        super.onCreate(savedInstanceState)
        val storage = EncryptedStorage(applicationContext)
        val s = Session(storage, ApiClient(storage), scope)
        session = s
        val demoMode = Launch.str("screen") != null || Launch.str("path") != null || Launch.flag("hub")
        if (!demoMode) s.start()
        splash.setKeepOnScreenCondition { !demoMode && s.state == AuthState.Booting }
        setContent { CoursesTheme { Root(s, demoMode) } }
    }

    override fun onStart() { super.onStart(); session?.verify() }
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
                Column(Modifier.fillMaxSize().background(C.Bg)) {
                    TopStrip("RECETTE · ${session.serverAddress?.substringAfter("://") ?: "serveur à définir"}", null)
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
private val STAFF_TABS = listOf(
    NavItem("v03", "Liste du jour", Icons.Rounded.Checklist),
    NavItem("v04", "Choisir", Icons.Rounded.GridView),
)

/** Onglet mis en avant selon l'écran affiché. */
private fun tabFor(route: String?): String? = when {
    route == null -> null
    route.startsWith("v06") -> "v06"
    route in listOf("v08", "v09", "v10", "v11") || route.startsWith("stub") -> "v07"
    else -> route
}

private fun startRoute(): String = when (Launch.str("screen")?.lowercase()) {
    "v02" -> "v02"; "v03" -> "v03"; "v04", "v05" -> "v04"; "v06" -> "v06"; "v06d" -> "v06d/o3"
    "v07" -> "v07"; "v08" -> "v08"; "v09" -> "v09"; "v10" -> "v10"; "v11" -> "v11"; "v12" -> "v12"
    else -> "v01"
}

@Composable
fun App(session: Session, me: Me?) {
    val uiRole = if (me?.role == "staff") Role.STAFF else Role.ADMIN
    val demo = remember { Demo(if (me != null) uiRole else null) }
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    var hub by remember { mutableStateOf(Launch.once("hub")) }
    var account by remember { mutableStateOf(false) }
    var confirmLogout by remember { mutableStateOf(false) }
    val path = remember { Launch.str("path")?.split(",")?.filter { it.isNotBlank() } }
    val start = remember { if (me != null) (if (uiRole == Role.STAFF) "v03" else "v02") else path?.firstOrNull() ?: startRoute() }

    LaunchedEffect(Unit) { path?.drop(1)?.forEach { nav.navigate(it) } }

    val go: (String) -> Unit = { r ->
        val tab = ADMIN_TABS.any { it.route == r }
        nav.navigate(r) { if (tab) { popUpTo(if (demo.role == Role.ADMIN) "v02" else "v03") { inclusive = false }; launchSingleTop = true } }
    }
    val back: () -> Unit = { nav.popBackStack() }
    val tabs = if (demo.role == Role.ADMIN) (if (me?.role == "parent") ADMIN_TABS.filter { it.route != "v07" } else ADMIN_TABS) else STAFF_TABS
    val showBar = route != null && route != "v01" && route != "v04" &&
        (demo.role == Role.ADMIN || route == "v03")

    CompositionLocalProvider(LocalDemo provides demo, LocalCompact provides (demo.role == Role.ADMIN && route != "v01")) {
        Box(Modifier.fillMaxSize().background(C.Bg)) {
            Column(Modifier.fillMaxSize()) {
                if (me != null) TopStrip("RECETTE · connexion réelle · listes simulées", "Compte") { account = true }
                else TopStrip("PROTOTYPE · données fictives", "Écrans de démo") { hub = true }
                if (me != null && !session.online) Box(Modifier.fillMaxWidth().background(C.AmberSoft).padding(horizontal = 14.dp, vertical = 6.dp)) {
                    Text("Hors connexion : session conservée sur ce téléphone.", color = C.Ink, style = MaterialTheme.typography.labelMedium)
                }
                Column(Modifier.weight(1f).fillMaxWidth().imePadding()) {
                    NavHost(nav, startDestination = start, modifier = Modifier.weight(1f)) {
                        composable("v01") {
                            LoginScreen(null) { role ->
                                demo.role = role
                                nav.navigate(if (role == Role.ADMIN) "v02" else "v03") { popUpTo("v01") { inclusive = true } }
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
        if (account && me != null) AccountSheet(me, session, { account = false }, { account = false; hub = true }, { account = false; confirmLogout = true })
        if (confirmLogout) ConfirmDialog(
            "Se déconnecter ?", "Vous devrez saisir à nouveau votre code d'accès pour rouvrir l'application.",
            "Se déconnecter", { confirmLogout = false; session.signOut() }, { confirmLogout = false }, danger = true,
        )
    }
}

@Composable
private fun AccountSheet(me: Me, session: Session, onDismiss: () -> Unit, onDemo: () -> Unit, onLogout: () -> Unit) {
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
        me.city?.let { Text("Ville : $it", style = MaterialTheme.typography.bodyMedium) }
        Text("Serveur : ${session.serverAddress?.substringAfter("://") ?: "—"}", style = MaterialTheme.typography.bodyMedium)
        Text(if (session.online) "État : connecté" else "État : hors connexion, session conservée", style = MaterialTheme.typography.bodyMedium, color = if (session.online) C.TealDark else C.Amber)
        Spacer(Modifier.height(16.dp))
        SecondaryButton("Écrans de démo (données simulées)", onDemo, Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        SecondaryButton("Se déconnecter", onLogout, Modifier.fillMaxWidth(), danger = true)
    }
}

@Composable
private fun TopStrip(left: String, action: String?, onAction: () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().background(C.Navy).statusBarsPadding().height(26.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(left, color = Color(0xFF7FE3DE), fontSize = 11.sp, letterSpacing = 0.4.sp, modifier = Modifier.weight(1f), maxLines = 1)
        if (action != null) Row(Modifier.clip(RoundedCornerShape(50)).clickable(onClick = onAction).padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(action, color = Color.White, fontSize = 11.sp)
            Icon(Icons.Rounded.KeyboardArrowDown, null, tint = Color.White, modifier = Modifier.width(16.dp))
        }
    }
}

@Composable
private fun ToastHost(demo: Demo) {
    val t = demo.toast
    LaunchedEffect(t) { if (t != null) { delay(3200); if (demo.toast === t) demo.toast = null } }
    if (t != null) Box(Modifier.fillMaxSize().padding(bottom = 96.dp, start = 16.dp, end = 16.dp), contentAlignment = Alignment.BottomCenter) {
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
