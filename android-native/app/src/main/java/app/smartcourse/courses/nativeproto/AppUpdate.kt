package app.smartcourse.courses.nativeproto

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.ApiClient
import app.smartcourse.courses.nativeproto.net.Outcome
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/*
 * Mise à jour de l'application, décidée par le serveur (page /gestion/mise-a-jour) sans nouvelle application :
 *   - conseillée : « Une nouvelle version de Mes Courses est disponible. » — Mettre à jour / Plus tard (une fois, pas à chaque écran) ;
 *   - obligatoire : écran bloquant tant que la version installée (versionCode) est inférieure à la version minimale.
 * Vérifiée à l'ouverture et à chaque retour dans l'application (par exemple au retour de Google Play), avant comme après la connexion.
 * Serveur injoignable : rien n'est bloqué (aucun nouveau blocage). Rien n'est effacé : la saisie en cours et les opérations en attente
 * restent sous l'écran et continuent d'être envoyées.
 */

enum class UpdateLevel { NONE, RECOMMENDED, REQUIRED }

object AppUpdate {
    const val PACKAGE = "app.smartcourse.courses.natif"
    private const val PLAY_URL = "https://play.google.com/store/apps/details?id=$PACKAGE"
    private const val LATER_MS = 24 * 3600_000L

    var level by mutableStateOf(UpdateLevel.NONE)
        private set
    var storeUrl: String = PLAY_URL
        private set
    private var latest: Int? = null
    /** « Plus tard » ou déjà montré pendant cette ouverture de l'application : la recommandation ne revient pas à chaque écran. */
    private var shownThisRun = false
    var askRecommended by mutableStateOf(false)
        private set

    /** Dernière vérification réussie : au plus une toutes les 30 minutes, sauf obligation en cours ou retour de Google Play. */
    private var checkedAt = 0L
    private var storeOpened = false
    private const val MIN_INTERVAL_MS = 30 * 60_000L

    suspend fun check(api: ApiClient, installed: Int) {
        val due = level == UpdateLevel.REQUIRED || storeOpened || System.currentTimeMillis() - checkedAt >= MIN_INTERVAL_MS
        if (!due) return
        storeOpened = false
        when (val r = api.getPublic("/api/app/update?platform=android&versionCode=$installed")) {
            is Outcome.Ok -> {
                val v = r.value
                storeUrl = v["storeUrl"]?.jsonPrimitive?.contentOrNull?.takeIf { it.startsWith("https://") } ?: PLAY_URL
                latest = v["latestVersionCode"]?.jsonPrimitive?.intOrNull
                level = when (v["update"]?.jsonPrimitive?.contentOrNull) { "required" -> UpdateLevel.REQUIRED; "recommended" -> UpdateLevel.RECOMMENDED; else -> UpdateLevel.NONE }
                askRecommended = level == UpdateLevel.RECOMMENDED && !shownThisRun && !postponed()
                checkedAt = System.currentTimeMillis()
            }
            // Vérification impossible (réseau, serveur ancien sans cette route…) : l'état connu est gardé, jamais un nouveau blocage.
            is Outcome.Fail -> Unit
        }
    }

    private fun laterKey() = "update|later|${latest ?: 0}"
    private fun postponed(): Boolean = Env.kv?.get(laterKey())?.toLongOrNull()?.let { System.currentTimeMillis() - it < LATER_MS } == true

    fun later() {
        shownThisRun = true; askRecommended = false
        Env.kv?.put(laterKey(), System.currentTimeMillis().toString())
    }

    /** Ouvre la fiche Mes Courses dans Google Play, sinon dans le navigateur. */
    fun openStore(context: Context) {
        shownThisRun = true; askRecommended = false; storeOpened = true // au retour : nouvelle vérification immédiate
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$PACKAGE")).setPackage("com.android.vending").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(market)
            android.util.Log.i("CoursesUpdate", "Google Play ouverte : market://details?id=$PACKAGE")
        } catch (_: ActivityNotFoundException) {
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(storeUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                android.util.Log.i("CoursesUpdate", "navigateur, fiche ouverte : $storeUrl")
            } catch (_: ActivityNotFoundException) {
                android.util.Log.w("CoursesUpdate", "ni Google Play ni navigateur disponibles")
            }
        }
    }
}

/** Au-dessus de toute l'application : message de mise à jour conseillée, ou écran bloquant de mise à jour obligatoire. */
@Composable
fun UpdateGate() {
    val context = LocalContext.current
    if (AppUpdate.level == UpdateLevel.REQUIRED) {
        androidx.activity.compose.BackHandler { (context as? android.app.Activity)?.moveTaskToBack(true) }
        Box(
            // Bloque toute interaction avec l'application en dessous (rien n'y est effacé).
            Modifier.fillMaxSize().background(C.Bg).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { }
                .systemBarsPadding().padding(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Icon(Icons.Rounded.SystemUpdate, null, tint = C.TealDark, modifier = Modifier.size(64.dp))
                Text("Mise à jour nécessaire", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                Text(
                    "Pour continuer à utiliser Mes Courses, veuillez mettre à jour l'application. Vos données seront conservées.",
                    style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(4.dp))
                PrimaryButton("Mettre à jour", { AppUpdate.openStore(context) }, Modifier.fillMaxWidth())
            }
        }
    } else if (AppUpdate.askRecommended) AlertDialog(
        onDismissRequest = { AppUpdate.later() }, containerColor = Color.White, shape = RoundedCornerShape(24.dp),
        icon = { Icon(Icons.Rounded.SystemUpdate, null, tint = C.TealDark) },
        title = { Text("Mise à jour disponible", style = MaterialTheme.typography.titleLarge) },
        text = { Text("Une nouvelle version de Mes Courses est disponible.", style = MaterialTheme.typography.bodyMedium) },
        confirmButton = { TextButton({ AppUpdate.openStore(context) }) { Text("Mettre à jour", color = C.TealDark) } },
        dismissButton = { TextButton({ AppUpdate.later() }) { Text("Plus tard", color = C.Muted) } },
    )
}
