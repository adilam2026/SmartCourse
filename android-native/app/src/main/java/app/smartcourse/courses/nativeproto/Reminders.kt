package app.smartcourse.courses.nativeproto

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.smartcourse.courses.nativeproto.net.ApiClient
import app.smartcourse.courses.nativeproto.net.EncryptedStorage
import app.smartcourse.courses.nativeproto.net.FileKv
import app.smartcourse.courses.nativeproto.net.KeyValueStore
import app.smartcourse.courses.nativeproto.net.Me
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.json
import app.smartcourse.courses.nativeproto.net.parseList
import kotlinx.serialization.json.JsonObject
import java.io.File
import java.time.DayOfWeek
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Rappels d'achat personnels (propres à chaque profil, sur ce téléphone) : jours et horaires choisis.
 * Pas d'alarme exacte (permission restreinte par Google Play) : Android déclenche le rappel dans une fenêtre d'environ 10 minutes après
 * l'horaire, parfois plus tard en économie de batterie. Au déclenchement, la liste est vérifiée : aucun rappel s'il ne reste rien à acheter.
 */
data class ReminderPrefs(val enabled: Boolean = false, val days: Set<Int> = setOf(1, 2, 3, 4, 5, 6, 7), val times: List<String> = listOf("18:00")) {
    fun encode() = "${if (enabled) 1 else 0}|${days.sorted().joinToString(",")}|${times.joinToString(",")}"

    /** Prochain horaire strictement après [now], dans le fuseau du téléphone (changements d'heure compris). */
    fun next(now: ZonedDateTime): ZonedDateTime? {
        if (!enabled || days.isEmpty() || times.isEmpty()) return null
        val parsed = times.mapNotNull { parseTime(it) }.sorted()
        for (d in 0..7) {
            val date = now.toLocalDate().plusDays(d.toLong())
            if (date.dayOfWeek.value !in days) continue
            for (t in parsed) {
                val at = ZonedDateTime.of(date, t, now.zone)
                if (at.isAfter(now)) return at
            }
        }
        return null
    }

    companion object {
        fun decode(s: String?): ReminderPrefs {
            if (s.isNullOrBlank()) return ReminderPrefs()
            val p = s.split("|")
            return ReminderPrefs(
                enabled = p.getOrNull(0) == "1",
                days = p.getOrNull(1)?.split(",")?.mapNotNull { it.toIntOrNull() }?.filter { it in 1..7 }?.toSet() ?: emptySet(),
                times = p.getOrNull(2)?.split(",")?.filter { parseTime(it) != null }?.distinct() ?: emptyList(),
            )
        }
        fun parseTime(s: String): LocalTime? = try { LocalTime.parse(s.trim()) } catch (_: Exception) { null }
        val DAY_LABELS = listOf(1 to "Lun", 2 to "Mar", 3 to "Mer", 4 to "Jeu", 5 to "Ven", 6 to "Sam", 7 to "Dim")
    }
}

object Reminders {
    const val CHANNEL = "rappels"
    private const val ACTION_FIRE = "app.smartcourse.courses.REMINDER"
    fun key(scope: String) = "remind|$scope"
    private fun lastKey(scope: String) = "remindlast|$scope"

    fun load(kv: KeyValueStore, scope: String) = ReminderPrefs.decode(kv.get(key(scope)))
    fun save(ctx: Context, kv: KeyValueStore, scope: String, p: ReminderPrefs) { kv.put(key(scope), p.encode()); schedule(ctx) }

    private fun current(ctx: Context): Pair<Me, String>? {
        val storage = EncryptedStorage(ctx)
        val me = storage.meJson?.let { try { json.decodeFromString(Me.serializer(), it) } catch (_: Exception) { null } } ?: return null
        if (storage.cookie == null) return null
        return me to "${me.familyId.ifEmpty { "f" }}|${me.id}"
    }

    private fun intent(ctx: Context, slot: Long) = PendingIntent.getBroadcast(
        ctx, 4201, Intent(ctx, ReminderReceiver::class.java).setAction(ACTION_FIRE).putExtra("slot", slot),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** (Re)programme le prochain rappel du profil connecté ; l'annule si les rappels sont désactivés ou si personne n'est connecté. */
    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val cur = current(ctx)
        val kv = FileKv(File(ctx.filesDir, "store"))
        val next = cur?.let { load(kv, it.second).next(ZonedDateTime.now(ZoneId.systemDefault())) }
        if (next == null) { am.cancel(intent(ctx, 0)); return }
        val at = next.toInstant().toEpochMilli()
        // Fenêtre de 10 minutes : pas de permission d'alarme exacte ; Android regroupe les réveils pour économiser la batterie.
        am.setWindow(AlarmManager.RTC_WAKEUP, at, 10 * 60_000L, intent(ctx, at))
        android.util.Log.i("CoursesRappel", "prochain rappel prévu à $next")
    }

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Rappels d'achat", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Articles restant à acheter, aux horaires choisis" },
        )
    }

    /** Déclenchement : vérifie la liste puis notifie une seule fois pour cet horaire (pas de doublon après une relance ou un redémarrage). */
    suspend fun fire(ctx: Context, slot: Long) {
        val (me, scope) = current(ctx) ?: return
        val kv = FileKv(File(ctx.filesDir, "store"))
        if (!load(kv, scope).enabled) return
        val slotKey = slot.toString()
        if (kv.get(lastKey(scope)) == slotKey) return
        // Toutes les listes en cours (une seule sans l'option « plusieurs listes ») : un seul rappel groupé.
        val api = ApiClient(EncryptedStorage(ctx))
        val open = ((api.call("GET", "/api/lists/open") as? Outcome.Ok)?.value?.get("lists") as? kotlinx.serialization.json.JsonArray)
            ?.mapNotNull { ((it as? JsonObject)?.get("remaining") as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() }
        // Sinon la liste à jour si le réseau répond, ou la dernière liste connue sur ce téléphone.
        val fresh = if (open != null) null else (api.call("GET", "/api/lists/active") as? Outcome.Ok)?.value?.get("list") as? JsonObject
        val list = fresh?.let { parseList(it) }
            ?: kv.get("list|$scope")?.let { s -> try { parseList(json.parseToJsonElement(s) as JsonObject) } catch (_: Exception) { null } }
        val remaining = open?.sum() ?: list?.takeIf { it.status == "active" }?.items?.count { it.status == "to_buy" } ?: 0
        val lists = open?.count { it > 0 } ?: 1
        kv.put(lastKey(scope), slotKey)
        if (remaining <= 0) { android.util.Log.i("CoursesRappel", "rien à acheter : pas de rappel"); return }
        if (!Notifier.canPost(ctx)) { android.util.Log.i("CoursesRappel", "notifications refusées par Android"); return }
        ensureChannel(ctx)
        val tap = PendingIntent.getActivity(ctx, 4202, Intent(ctx, MainActivity::class.java).putExtra("open", "list").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val text = if (lists > 1) "Réparti sur $lists listes en cours." else if (me.role == "staff") "Ouvrez la liste du jour." else "Ouvrez votre liste de courses."
        val n = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_notif)
            .setContentTitle(if (remaining == 1) "Il reste 1 article à acheter" else "Il reste $remaining articles à acheter")
            .setContentText(text).setContentIntent(tap).setAutoCancel(true).build()
        try { NotificationManagerCompat.from(ctx).notify(1002, n) } catch (_: SecurityException) { }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            "app.smartcourse.courses.REMINDER" -> {
                WorkManager.getInstance(ctx).enqueue(OneTimeWorkRequestBuilder<ReminderWorker>().setInputData(workDataOf("slot" to intent.getLongExtra("slot", 0L))).build())
            }
            // Redémarrage, mise à jour, changement d'heure ou de fuseau : les horaires sont reprogrammés.
            else -> Reminders.schedule(ctx)
        }
    }
}

class ReminderWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        Reminders.fire(applicationContext, inputData.getLong("slot", 0L))
        Reminders.schedule(applicationContext)
        return Result.success()
    }
}
