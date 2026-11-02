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
import app.smartcourse.courses.nativeproto.net.imageClient
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
    private var demoMode = false

    override fun onCreate(savedInstanceState: Bundle?) {
        // Paramètres de lancement : réservés au build de recette (captures automatiques d'écrans simulés).
        Launch.extras = if (BuildConfig.RECETTE_HOOKS) intent?.extras?.let { b -> b.keySet().associateWith { @Suppress("DEPRECATION") b.get(it) } } else null
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
        AndroidEnv.context = applicationContext
        Env.kv = FileKv(java.io.File(filesDir, "store"))
        val storage = EncryptedStorage(applicationContext)
        val s = Session(storage, ApiClient(storage), scope)
        session = s
        // Version finale : serveur permanent fixé à la compilation, jamais demandé à l'utilisateur.
        if (BuildConfig.FINAL) s.setServer(BuildConfig.SERVER_URL)
        val demoMode = Launch.str("screen") != null || Launch.str("path") != null || Launch.flag("hub")
        this.demoMode = demoMode
        if (!demoMode) s.start()
        splash.setKeepOnScreenCondition { !demoMode && s.state == AuthState.Booting }
        val loader = ImageLoader.Builder(applicationContext).okHttpClient(s.api.imageClient()).crossfade(true).build()
        setContent {
            CoursesTheme {
                CompositionLocalProvider(LocalImageLoader provides loader) {
                    Box(Modifier.fillMaxSize()) {
                        Root(s, demoMode)
                        if (!demoMode) UpdateGate()
                    }
                }
            }
        }
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

    override fun onStart() {
        super.onStart(); session?.verify(); LiveHolder.current?.onForeground()
        // Mise à jour : vérifiée à chaque ouverture et à chaque retour (ex. au retour de Google Play), connecté ou non.
        val s = session
        if (s != null && !demoMode) scope.launch { AppUpdate.check(s.api, BuildConfig.VERSION_CODE) }
    }
    override fun onStop() { super.onStop(); LiveHolder.current?.onBackground() }
    override fun onDestroy() { super.onDestroy(); scope.cancel() }
}
