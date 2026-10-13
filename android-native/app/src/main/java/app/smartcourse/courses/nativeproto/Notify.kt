package app.smartcourse.courses.nativeproto

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.smartcourse.courses.nativeproto.net.ApiClient
import app.smartcourse.courses.nativeproto.net.EncryptedStorage
import app.smartcourse.courses.nativeproto.net.FileKv
import app.smartcourse.courses.nativeproto.net.Failure
import app.smartcourse.courses.nativeproto.net.KeyValueStore
import app.smartcourse.courses.nativeproto.net.Me
import app.smartcourse.courses.nativeproto.net.Outcome
import app.smartcourse.courses.nativeproto.net.json
import app.smartcourse.courses.nativeproto.net.parseList
import kotlinx.serialization.json.JsonObject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Notifications de demandes (parents et administrateurs). Le serveur est hébergé sur Railway seul, sans service de notification Google :
 * l'application vérifie le serveur à intervalles réguliers (Android décide du moment exact, environ toutes les 15 minutes) et à chaque ouverture.
 * Ce n'est donc pas instantané. Rien ne part vers un tiers.
 */
object Notifier {
    const val CHANNEL = "demandes"
    private const val WORK = "courses-demandes"

    fun key(scope: String) = "notif|$scope"
    fun seenKey(scope: String) = "seenval|$scope"
    fun enabled(kv: KeyValueStore, scope: String) = kv.get(key(scope)) == "on"

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Demandes de la famille", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Quand quelqu'un ajoute des articles à la liste"
            })
        }
    }

    /** Android autorise-t-il vraiment les notifications (permission + réglage du téléphone) ? */
    fun canPost(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    }

    fun schedule(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<PollWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req)
    }

    fun cancel(ctx: Context) { WorkManager.getInstance(ctx).cancelUniqueWork(WORK) }

    fun show(ctx: Context, title: String, text: String) {
        if (!canPost(ctx)) return
        ensureChannel(ctx)
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_notif).setContentTitle(title).setContentText(text)
            .setContentIntent(open).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_DEFAULT).build()
        try { NotificationManagerCompat.from(ctx).notify(1001, n) } catch (_: SecurityException) { }
    }
}

class PollWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val storage = EncryptedStorage(ctx)
        val me = storage.meJson?.let { try { json.decodeFromString(Me.serializer(), it) } catch (_: Exception) { null } } ?: return Result.success()
        if (storage.cookie == null || me.role == "staff") return Result.success()
        val scope = "${me.familyId.ifEmpty { "f" }}|${me.id}"
        val kv = FileKv(File(ctx.filesDir, "store"))
        if (!Notifier.enabled(kv, scope)) return Result.success()
        return when (val r = ApiClient(storage).call("GET", "/api/lists/active")) {
            is Outcome.Ok -> {
                val list = (r.value["list"] as? JsonObject)?.let { parseList(it) }
                val all = list?.validations ?: emptyList()
                val seen = kv.get(Notifier.seenKey(scope))?.split(",")?.filter { it.isNotEmpty() }?.toSet()
                val fresh = all.filter { v -> seen != null && v.id !in seen && v.by != me.displayName }
                if (fresh.isNotEmpty()) {
                    val who = fresh.map { it.by }.distinct()
                    Notifier.show(ctx, if (fresh.size == 1) "Nouvelle demande" else "${fresh.size} nouvelles demandes", "De la part de ${who.joinToString(", ")}")
                }
                kv.put(Notifier.seenKey(scope), all.joinToString(",") { it.id })
                Result.success()
            }
            is Outcome.Fail -> if (r.failure == Failure.NETWORK || r.failure == Failure.TIMEOUT || r.failure == Failure.SERVER_ERROR) Result.retry() else Result.success()
        }
    }
}
