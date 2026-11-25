package com.jeffraben.tacompanion

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** The two calls TA Companion makes to the brain (the ones Tasker made). */
object Brain {
    data class SleepPlan(val waitSec: Int, val never: Boolean, val minBattery: Int)

    /** How long to wait after the truck turns off (Settings › Truck › When the truck turns off). 2 minutes if the brain doesn't answer. */
    fun sleepPlan(ctx: Context): SleepPlan = try {
        val c = URL("${Prefs(ctx).brainUrl}/api/tablet/sleep").openConnection() as HttpURLConnection
        c.connectTimeout = 3000; c.readTimeout = 3000
        val j = JSONObject(c.inputStream.bufferedReader().readText())
        SleepPlan(j.optInt("waitSec", 120), j.optBoolean("never", false), j.optInt("minBattery", 30))
    } catch (_: Exception) { SleepPlan(120, false, 30) }

    /** What the tablet's music app is playing, for the cockpit's Now Playing. */
    fun nowPlaying(ctx: Context, title: String?, artist: String?, album: String?, app: String?, pkg: String?, playing: Boolean) {
        Thread {
            try {
                val c = URL("${Prefs(ctx).brainUrl}/api/tablet/nowplaying").openConnection() as HttpURLConnection
                c.connectTimeout = 3000; c.readTimeout = 3000
                c.requestMethod = "POST"; c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                val j = JSONObject().put("title", title ?: "").put("artist", artist ?: "").put("album", album ?: "")
                    .put("app", app ?: "").put("pkg", pkg ?: "").put("playing", playing)
                c.outputStream.use { it.write(j.toString().toByteArray()) }
                c.responseCode
            } catch (_: Exception) { /* no brain on this network: the next song tries again */ }
        }.start()
    }
}
