package com.jeffraben.tacompanion

import android.app.admin.DeviceAdminReceiver
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Device admin, with only "lock the screen": how TA Companion turns the screen off when the truck does. */
class AdminReceiver : DeviceAdminReceiver()

/** Start with the tablet (and after an update). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) CompanionService.start(ctx)
    }
}
