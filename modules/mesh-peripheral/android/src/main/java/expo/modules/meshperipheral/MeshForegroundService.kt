package expo.modules.meshperipheral

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps the app process (and therefore the JS mesh engine, BLE connections and GATT server)
 * alive while the app is in the background. Declared with foregroundServiceType
 * "connectedDevice", which requires FOREGROUND_SERVICE_CONNECTED_DEVICE on Android 14+.
 */
class MeshForegroundService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.meshperipheral.START"
    const val ACTION_UPDATE = "expo.modules.meshperipheral.UPDATE"
    const val ACTION_STOP = "expo.modules.meshperipheral.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "mesh_service"
    private const val NOTIFICATION_ID = 4711

    @Volatile var isRunning = false
      private set

    fun intent(ctx: Context, action: String, title: String? = null, text: String? = null): Intent =
      Intent(ctx, MeshForegroundService::class.java).apply {
        this.action = action
        title?.let { putExtra(EXTRA_TITLE, it) }
        text?.let { putExtra(EXTRA_TEXT, it) }
      }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        isRunning = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
          @Suppress("DEPRECATION") stopForeground(true)
        }
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Mesh Chat"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Sieć mesh aktywna"
        val notification = buildNotification(title, text)
        if (!isRunning || intent?.action == ACTION_START) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
          } else {
            startForeground(NOTIFICATION_ID, notification)
          }
          isRunning = true
        } else {
          (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, notification)
        }
      }
    }
    // Not sticky: without the JS engine a restarted service would have nothing to do.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  private fun buildNotification(title: String, text: String): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Sieć mesh", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Utrzymuje połączenia Bluetooth mesh w tle"
          setShowBadge(false)
        }
      )
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = launch?.let {
      PendingIntent.getActivity(
        this, 0, it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }
    return builder
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .apply { if (pending != null) setContentIntent(pending) }
      .build()
  }
}
