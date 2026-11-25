package com.jeffraben.tacompanion

import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService

/**
 * With Notification access on, Android lets TA Companion see the music apps' media sessions:
 * the song playing goes to the brain (the cockpit's Now Playing), like Tasker's Music Track Changed.
 */
class MediaListener : NotificationListenerService() {
    private val main = Handler(Looper.getMainLooper())
    private var controller: MediaController? = null
    private var lastKey = ""

    private val cb = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) = report()
        override fun onPlaybackStateChanged(state: PlaybackState?) = report()
        override fun onSessionDestroyed() { pick() }
    }

    private val sessions = MediaSessionManager.OnActiveSessionsChangedListener { pick() }

    override fun onListenerConnected() {
        val msm = getSystemService(MediaSessionManager::class.java)
        msm.addOnActiveSessionsChangedListener(sessions, ComponentName(this, MediaListener::class.java), main)
        pick()
    }

    override fun onListenerDisconnected() {
        try { getSystemService(MediaSessionManager::class.java).removeOnActiveSessionsChangedListener(sessions) } catch (_: Exception) {}
        controller?.unregisterCallback(cb); controller = null
    }

    /** Follow the session that is playing (or the most recent one). */
    private fun pick() {
        val list = try { getSystemService(MediaSessionManager::class.java).getActiveSessions(ComponentName(this, MediaListener::class.java)) } catch (_: SecurityException) { emptyList() }
        val next = list.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: list.firstOrNull()
        if (next?.sessionToken == controller?.sessionToken) return
        controller?.unregisterCallback(cb)
        controller = next
        next?.registerCallback(cb, main)
        report()
    }

    private fun report() {
        val c = controller ?: return
        val m = c.metadata ?: return
        val title = m.getString(MediaMetadata.METADATA_KEY_TITLE) ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
        val artist = m.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: m.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
        val album = m.getString(MediaMetadata.METADATA_KEY_ALBUM)
        val playing = c.playbackState?.state == PlaybackState.STATE_PLAYING
        val app = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(c.packageName, 0)).toString() } catch (_: Exception) { null }
        val key = "$title|$artist|$playing|${c.packageName}"
        if (key == lastKey || (title.isNullOrBlank() && artist.isNullOrBlank())) return
        lastKey = key
        Brain.nowPlaying(this, title, artist, album, app, c.packageName, playing)
    }
}
