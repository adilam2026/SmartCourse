package app.smartcourse.courses.nativeproto

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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.smartcourse.courses.nativeproto.net.ApiClient
import app.smartcourse.courses.nativeproto.net.Outcome
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/*
 * Mise à jour de l'application (COMMUN Android / iPhone), décidée par le serveur (page /gestion/mise-a-jour) sans nouvelle publication :
 *   - proposition facultative : « Une nouvelle version de Mes Courses est disponible. » — Mettre à jour / Plus tard (une fois, pas à
 *     chaque écran) ;
 *   - blocage : écran « Mise à jour nécessaire » tant que le numéro technique installé (versionCode Android, numéro de build iPhone)
 *     est inférieur à la version minimale ET que le blocage est activé côté serveur.
 * Vérifiée à l'ouverture et à chaque retour dans l'application (par exemple au retour du store), avant comme après la connexion.
 * Serveur injoignable ou réponse illisible : rien n'est bloqué (aucun nouveau blocage). Rien n'est effacé : la saisie en cours et les
 * opérations en attente restent sous l'écran et continuent d'être envoyées.
 * Partie propre à chaque plateforme (ouvrir la fiche du store, niveau du système, retour arrière) : AppUpdateAndroid.kt / AppUpdateIos.kt.
 */

enum class UpdateLevel { NONE, RECOMMENDED, REQUIRED }

object AppUpdate {
    private const val LATER_MS = 24 * 3600_000L

    var level by mutableStateOf(UpdateLevel.NONE)
        private set
    var storeUrl: String? = null
        private set
    private var latest: Int? = null
    /** « Plus tard » ou déjà montré pendant cette ouverture de l'application : la recommandation ne revient pas à chaque écran. */
    private var shownThisRun = false
    var askRecommended by mutableStateOf(false)
        private set

    /** Dernière vérification réussie : au plus une toutes les 30 minutes, sauf blocage en cours ou retour du store. */
    private var checkedAt = 0L
    private var storeOpened = false
    private const val MIN_INTERVAL_MS = 30 * 60_000L

    suspend fun check(api: ApiClient, installed: Int) {
        val due = level == UpdateLevel.REQUIRED || storeOpened || nowMillis() - checkedAt >= MIN_INTERVAL_MS
        if (!due) return
        storeOpened = false
        when (val r = api.getPublic("/api/app/update?platform=${UpdatePlatform.NAME}&versionCode=$installed&os=${UpdatePlatform.osLevel()}")) {
            is Outcome.Ok -> {
                val v = r.value
                val url = v["storeUrl"]?.jsonPrimitive?.contentOrNull?.takeIf { it.startsWith("https://") }
                // Sans fiche officielle connue, rien à proposer ni à imposer (rien à ouvrir).
                val lv = if (url == null) UpdateLevel.NONE else when (v["update"]?.jsonPrimitive?.contentOrNull) {
                    "required" -> UpdateLevel.REQUIRED; "recommended" -> UpdateLevel.RECOMMENDED; else -> UpdateLevel.NONE
                }
                storeUrl = url ?: UpdatePlatform.DEFAULT_STORE_URL
                latest = v["latestVersionCode"]?.jsonPrimitive?.intOrNull
                level = lv
                askRecommended = level == UpdateLevel.RECOMMENDED && !shownThisRun && !postponed()
                checkedAt = nowMillis()
            }
            // Vérification impossible (réseau, serveur ancien sans cette route…) : l'état connu est gardé, jamais un nouveau blocage.
            is Outcome.Fail -> Unit
        }
    }

    private fun laterKey() = "update|later|${latest ?: 0}"
    private fun postponed(): Boolean = Env.kv?.get(laterKey())?.toLongOrNull()?.let { nowMillis() - it < LATER_MS } == true

    fun later() {
        shownThisRun = true; askRecommended = false
        Env.kv?.put(laterKey(), nowMillis().toString())
    }

    /** Ouvre la fiche officielle de Mes Courses (Google Play, App Store). */
    fun openStore() {
        shownThisRun = true; askRecommended = false; storeOpened = true // au retour : nouvelle vérification immédiate
        UpdatePlatform.openStore(storeUrl ?: UpdatePlatform.DEFAULT_STORE_URL)
    }
}

/** Au-dessus de toute l'application : message de mise à jour conseillée, ou écran bloquant de mise à jour obligatoire. */
@Composable
fun UpdateGate() {
    if (AppUpdate.level == UpdateLevel.REQUIRED) {
        UpdateBackGuard()
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
                    "Pour continuer à utiliser Mes Courses, veuillez mettre à jour l'application. Vos données seront conservées, " +
                        "y compris les modifications pas encore envoyées.",
                    style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(4.dp))
                PrimaryButton("Mettre à jour", { AppUpdate.openStore() }, Modifier.fillMaxWidth())
            }
        }
    } else if (AppUpdate.askRecommended) AlertDialog(
        onDismissRequest = { AppUpdate.later() }, containerColor = Color.White, shape = RoundedCornerShape(24.dp),
        icon = { Icon(Icons.Rounded.SystemUpdate, null, tint = C.TealDark) },
        title = { Text("Mise à jour disponible", style = MaterialTheme.typography.titleLarge) },
        text = { Text("Une nouvelle version de Mes Courses est disponible.", style = MaterialTheme.typography.bodyMedium) },
        confirmButton = { TextButton({ AppUpdate.openStore() }) { Text("Mettre à jour", color = C.TealDark) } },
        dismissButton = { TextButton({ AppUpdate.later() }) { Text("Plus tard", color = C.Muted) } },
    )
}
