package com.jeffraben.tacompanion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

/**
 * Always running (a quiet notification keeps Android from stopping it). It answers the brain on :1821
 * and follows the truck's power: on → wake and bring the cockpit back; off → wait as long as the
 * brain says, then turn the screen off (device admin: the step Tasker could not do reliably).
 */
class CompanionService : Service() {
    private val http by lazy { Http(this) }
    private val main = Handler(Looper.getMainLooper())
    private var sleepTask: Runnable? = null
    @Volatile var status = "Waiting for the truck"
        private set

    private val power = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (i.action) {
                Intent.ACTION_POWER_CONNECTED -> onPowerOn()
                Intent.ACTION_POWER_DISCONNECTED -> onPowerOff()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "TA Companion", NotificationManager.IMPORTANCE_MIN))
        val open = PendingIntent.getActivity(this, 0, Intent(this, SetupActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_launcher).setContentTitle("TA Companion")
            .setContentText("Ready for the truck's dash").setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(1, n)
        val filter = IntentFilter().apply { addAction(Intent.ACTION_POWER_CONNECTED); addAction(Intent.ACTION_POWER_DISCONNECTED) }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(power, filter, Context.RECEIVER_EXPORTED) else registerReceiver(power, filter)
        http.start()
        running = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        running = null
        try { unregisterReceiver(power) } catch (_: Exception) {}
        http.stop()
        sleepTask?.let { main.removeCallbacks(it) }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun onPowerOn() {
        sleepTask?.let { main.removeCallbacks(it) }; sleepTask = null
        status = "Truck on"
        Actions.wake(this)
        if (Prefs(this).frontOnPower) main.postDelayed({ Actions.front(this) }, 800)
    }

    private fun onPowerOff() {
        Thread {
            val plan = Brain.sleepPlan(this)
            val battery = (getSystemService(BATTERY_SERVICE) as BatteryManager).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            // "Never" keeps the screen on, unless the battery is below the brain's minimum.
            if (plan.never && battery >= plan.minBattery) { status = "Truck off: screen stays on (Settings › Truck)"; return@Thread }
            val wait = plan.waitSec.coerceIn(5, 3600)
            status = "Truck off: screen off in ${wait / 60} min ${wait % 60} s"
            main.post {
                sleepTask?.let { main.removeCallbacks(it) }
                val t = Runnable { if (!plugged()) { Actions.sleep(this); status = "Screen off (truck off)" } }
                sleepTask = t
                main.postDelayed(t, wait * 1000L)
            }
        }.start()
    }

    private fun plugged(): Boolean {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        return (i?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
    }

    companion object {
        const val CHANNEL = "ta"
        @Volatile var running: CompanionService? = null
        fun start(ctx: Context) { ctx.startForegroundService(Intent(ctx, CompanionService::class.java)) }
    }
}
