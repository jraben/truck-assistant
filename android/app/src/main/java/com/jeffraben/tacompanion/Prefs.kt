package com.jeffraben.tacompanion

import android.content.Context

/** The app's few settings. The brain address and the cockpit app are all it needs. */
class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("ta", Context.MODE_PRIVATE)

    /** Where the brain answers: the Pi on the truck's Wi-Fi by default (the NAS copy for desk testing). */
    var brainUrl: String
        get() = p.getString("brainUrl", DEFAULT_BRAIN) ?: DEFAULT_BRAIN
        set(v) = p.edit().putString("brainUrl", v.trim().trimEnd('/')).apply()

    /** The installed Slate Cockpit app (Chrome's installed web app), or null to open [cockpitUrl] in the browser. */
    var cockpitPkg: String?
        get() = p.getString("cockpitPkg", null)
        set(v) = p.edit().putString("cockpitPkg", v).apply()

    var cockpitUrl: String
        get() = p.getString("cockpitUrl", DEFAULT_COCKPIT) ?: DEFAULT_COCKPIT
        set(v) = p.edit().putString("cockpitUrl", v.trim()).apply()

    /** Bring the cockpit to the front when power comes on (the truck turns on). */
    var frontOnPower: Boolean
        get() = p.getBoolean("frontOnPower", true)
        set(v) = p.edit().putBoolean("frontOnPower", v).apply()

    companion object {
        const val DEFAULT_BRAIN = "http://10.42.0.1:8080"
        const val DEFAULT_COCKPIT = "https://truck.jeffraben.com"
        /** The port Tasker used, so the brain needs no change. */
        const val PORT = 1821
    }
}
