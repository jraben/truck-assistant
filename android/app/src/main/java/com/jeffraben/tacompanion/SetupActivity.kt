package com.jeffraben.tacompanion

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * One screen: what TA Companion needs (each with a button that opens the right Android page),
 * the brain's address, which app is the cockpit, and test buttons. Replaces the Tasker setup.
 */
class SetupActivity : Activity() {
    private lateinit var list: LinearLayout
    private val prefs by lazy { Prefs(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CompanionService.start(this)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(24), dp(24), dp(24)) }
        setContentView(ScrollView(this).apply { setBackgroundColor(Color.parseColor("#141416")); addView(list) })
    }

    override fun onResume() { super.onResume(); render() }

    private fun render() {
        list.removeAllViews()
        list.addView(text("TA Companion", 28f, bold = true))
        list.addView(text("Lets the truck's dash control this tablet: brings the cockpit back when the truck turns on, turns the screen off when it turns off, and runs the music keys and volume. It replaces the Tasker setup.", 15f, dim = true))
        list.addView(text(CompanionService.running?.status ?: "Starting…", 15f).apply { setPadding(0, dp(12), 0, dp(4)) })

        section("What it needs")
        val dpm = getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(this, AdminReceiver::class.java)
        need("Screen off", "Turns the screen off when the truck turns off (device admin: lock screen only).", dpm.isAdminActive(admin)) {
            startActivity(Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
                .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "TA Companion only locks the screen, a few minutes after the truck turns off."))
        }
        need("Bring the cockpit back", "Display over other apps: lets it open the cockpit when the truck turns on.", Settings.canDrawOverlays(this)) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        val listening = (Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: "").contains(packageName)
        need("Now playing", "Notification access: sends the song playing in Spotify, Pandora and the rest to the cockpit.", listening) {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        val pm = getSystemService(PowerManager::class.java)
        need("Keep running", "Battery: Unrestricted, so Android never stops it.", pm.isIgnoringBatteryOptimizations(packageName)) {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }

        section("The truck")
        val brain = EditText(this).apply {
            setText(prefs.brainUrl); inputType = InputType.TYPE_TEXT_VARIATION_URI; setTextColor(Color.WHITE); setHintTextColor(Color.GRAY)
            hint = Prefs.DEFAULT_BRAIN
        }
        list.addView(text("Brain address (the Pi: http://10.42.0.1:8080; for testing at home, https://ta.jeffraben.com)", 14f, dim = true))
        list.addView(brain)
        list.addView(button("Save address") { prefs.brainUrl = brain.text.toString().ifBlank { Prefs.DEFAULT_BRAIN }; toast("Saved") })

        val cockpitName = prefs.cockpitPkg?.let { label(it) } ?: "the browser (${prefs.cockpitUrl})"
        list.addView(text("Cockpit app: $cockpitName", 15f).apply { setPadding(0, dp(12), 0, 0) })
        list.addView(button("Pick the cockpit app") { pickCockpit() })
        list.addView(CheckBox(this).apply {
            text = "Bring the cockpit to the front when the truck turns on"; setTextColor(Color.WHITE); isChecked = prefs.frontOnPower
            setOnCheckedChangeListener { _, on -> prefs.frontOnPower = on }
        })

        section("Test")
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(button("Cockpit") { result(Actions.front(this)) })
        row.addView(button("Play/Pause") { result(Actions.media(this, "toggle")) })
        row.addView(button("Vol +") { result(Actions.media(this, "volup")) })
        row.addView(button("Screen off") { result(Actions.sleep(this)) })
        list.addView(row)
        list.addView(text("The brain reaches this tablet on port ${Prefs.PORT}, the same as Tasker, so turn off Tasker's HTTP Request profiles (Music buttons, Slate front, Launch) before using this.", 13f, dim = true).apply { setPadding(0, dp(16), 0, 0) })
        list.addView(text("Version ${BuildConfigHolder.version(this)}", 12f, dim = true))
    }

    private fun pickCockpit() {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = packageManager.queryIntentActivities(launcher, 0).map { it.activityInfo.packageName to it.loadLabel(packageManager).toString() }
            .distinctBy { it.first }.sortedWith(compareByDescending<Pair<String, String>> { it.second.contains("Slate", true) || it.second.contains("Cockpit", true) }.thenBy { it.second.lowercase() })
        val names = (listOf("Browser (${prefs.cockpitUrl})") + apps.map { it.second }).toTypedArray()
        AlertDialog.Builder(this).setTitle("Which app is the cockpit?").setItems(names) { _, i ->
            prefs.cockpitPkg = if (i == 0) null else apps[i - 1].first
            render()
        }.show()
    }

    private fun label(pkg: String) = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() } catch (_: Exception) { "$pkg (not installed)" }

    private fun need(title: String, what: String, ok: Boolean, fix: () -> Unit) {
        val box = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(8), 0, dp(8)) }
        val txt = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
        txt.addView(text((if (ok) "✓  " else "•  ") + title, 17f, bold = true, color = if (ok) "#30D158" else "#FFFFFF"))
        txt.addView(text(what, 13f, dim = true))
        box.addView(txt)
        if (!ok) box.addView(button("Turn on") { fix() })
        list.addView(box)
    }

    private fun section(t: String) = list.addView(text(t.uppercase(), 12f, bold = true, dim = true).apply { setPadding(0, dp(20), 0, dp(4)); letterSpacing = 0.12f })

    private fun text(s: String, size: Float, bold: Boolean = false, dim: Boolean = false, color: String? = null) = TextView(this).apply {
        text = s; textSize = size; setTextColor(Color.parseColor(color ?: if (dim) "#98989F" else "#F5F5F7"))
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), dp(8), 0) }
    }

    private fun result(r: Actions.Result) = toast(if (r.ok) "Done" else r.message)
    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    @Suppress("unused") private fun hide(v: View) { v.visibility = View.GONE }
}
