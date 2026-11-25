package com.jeffraben.tacompanion

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.view.KeyEvent

/** What the brain can ask for (the same paths Tasker answered): front, launch, media keys, volume, sleep. */
object Actions {
    private val main = Handler(Looper.getMainLooper())

    /** Bring the cockpit to the front. Needs "Display over other apps" when called from the background. */
    fun front(ctx: Context): Result {
        val prefs = Prefs(ctx)
        val pkg = prefs.cockpitPkg
        val intent = if (pkg != null) ctx.packageManager.getLaunchIntentForPackage(pkg) else Intent(Intent.ACTION_VIEW, Uri.parse(prefs.cockpitUrl))
        if (intent == null) return Result(false, "the cockpit app ($pkg) isn't installed: pick it again in TA Companion")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        if (!Settings.canDrawOverlays(ctx)) return start(ctx, intent).let { if (it.ok) Result(true, "opened (allow Display over other apps so this works from the background)") else it }
        return start(ctx, intent)
    }

    /** Open an installed app by package name (Moonlight, RetroArch, the music apps). */
    fun launch(ctx: Context, pkg: String): Result {
        if (!Regex("^[a-zA-Z][\\w.]{2,100}$").matches(pkg)) return Result(false, "bad package")
        val intent = ctx.packageManager.getLaunchIntentForPackage(pkg) ?: return Result(false, "$pkg isn't installed")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return start(ctx, intent)
    }

    private fun start(ctx: Context, intent: Intent): Result = try {
        main.post { ctx.startActivity(intent) }
        Result(true, "ok")
    } catch (e: Exception) { Result(false, e.message ?: "could not open it") }

    /** toggle, play, pause, next, prev to the app playing music; volup, voldown on the music volume. */
    fun media(ctx: Context, cmd: String): Result {
        val audio = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        when (cmd) {
            "volup" -> { audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI); return Result(true, "volume ${audio.getStreamVolume(AudioManager.STREAM_MUSIC)}") }
            "voldown" -> { audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI); return Result(true, "volume ${audio.getStreamVolume(AudioManager.STREAM_MUSIC)}") }
        }
        val code = when (cmd) {
            "toggle" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "prev" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> return Result(false, "cmd is one of toggle, play, pause, next, prev, volup, voldown")
        }
        val t = SystemClock.uptimeMillis()
        audio.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0))
        audio.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_UP, code, 0))
        return Result(true, "ok")
    }

    /** Turn the screen off now (needs TA Companion as a device admin: the one reliable way). */
    fun sleep(ctx: Context): Result {
        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isAdminActive(ComponentName(ctx, AdminReceiver::class.java))) return Result(false, "TA Companion isn't a device admin yet: turn on Screen off in the app")
        dpm.lockNow()
        return Result(true, "ok")
    }

    /** Wake the screen (the truck turned on). */
    @Suppress("DEPRECATION")
    fun wake(ctx: Context) {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "tacompanion:wake")
        wl.acquire(3000)
    }

    data class Result(val ok: Boolean, val message: String)
}
