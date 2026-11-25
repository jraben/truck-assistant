package com.jeffraben.tacompanion

import android.content.Context
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder

/**
 * A tiny HTTP server on :1821 answering the brain exactly as Tasker did:
 *   GET /slate/front, /slate/launch?pkg=…, /slate/media?cmd=…  (plus /slate/sleep and /slate/status).
 * Only private-network callers (the truck's Wi-Fi, home, Tailscale) are answered.
 */
class Http(private val ctx: Context, private val port: Int = Prefs.PORT) {
    @Volatile private var server: ServerSocket? = null

    fun start() {
        if (server != null) return
        Thread({
            try {
                val s = ServerSocket(port)
                server = s
                while (!s.isClosed) {
                    val c = try { s.accept() } catch (e: Exception) { break }
                    Thread({ handle(c) }, "ta-http-client").start()
                }
            } catch (e: Exception) { Log.e("TACompanion", "HTTP server on :$port failed: ${e.message}") }
            server = null
        }, "ta-http").start()
    }

    fun stop() { try { server?.close() } catch (_: Exception) {}; server = null }

    private fun handle(c: Socket) = c.use { sock ->
        sock.soTimeout = 5000
        val reader = BufferedReader(InputStreamReader(sock.getInputStream()))
        val line = reader.readLine() ?: return@use
        val parts = line.split(" ")
        val target = parts.getOrNull(1) ?: "/"
        val (path, query) = target.split("?", limit = 2).let { it[0] to (it.getOrNull(1) ?: "") }
        val q = query.split("&").filter { it.contains("=") }.associate { kv -> kv.substringBefore("=") to URLDecoder.decode(kv.substringAfter("="), "UTF-8") }
        val r = if (!private(sock.inetAddress)) Actions.Result(false, "only the truck's own network may ask") else when (path.trimEnd('/')) {
            "/slate/front" -> Actions.front(ctx)
            "/slate/launch" -> Actions.launch(ctx, q["pkg"] ?: "")
            "/slate/media" -> Actions.media(ctx, q["cmd"] ?: "")
            "/slate/sleep" -> Actions.sleep(ctx)
            "/slate/status" -> Actions.Result(true, "TA Companion ${BuildConfigHolder.version(ctx)}")
            else -> Actions.Result(false, "unknown path $path")
        }
        val body = "{\"ok\":${r.ok},\"message\":\"${r.message.replace("\\", "\\\\").replace("\"", "\\\"")}\"}"
        val status = if (r.ok) "200 OK" else if (path.startsWith("/slate/")) "400 Bad Request" else "404 Not Found"
        val bytes = body.toByteArray()
        sock.getOutputStream().write("HTTP/1.1 $status\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray() + bytes)
    }

    private fun private(a: InetAddress): Boolean {
        if (a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress) return true
        val b = a.address
        // Tailscale's 100.64.0.0/10.
        return b.size == 4 && (b[0].toInt() and 0xff) == 100 && (b[1].toInt() and 0xc0) == 64
    }
}

object BuildConfigHolder {
    fun version(ctx: Context): String = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "?" } catch (_: Exception) { "?" }
}
