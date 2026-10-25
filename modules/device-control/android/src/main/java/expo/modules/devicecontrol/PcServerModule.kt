package expo.modules.devicecontrol

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Tiny dependency-free HTTP server so a PC browser on the same Wi-Fi can drive
 * the app with the same design and the same capabilities. Every request is
 * forwarded to the JS layer as a `pcRequest` event; JS replies through
 * `respond()`. All authorization (PIN) is enforced in the JS layer.
 */
class PcServerModule : Module() {
  companion object {
    private const val TAG = "PcServer"
    private const val REQUEST_TIMEOUT_MS = 15_000L
  }

  private val running = AtomicBoolean(false)
  private val serverSocket = AtomicReference<ServerSocket?>(null)
  private val port = AtomicReference(8089)
  private val pending = ConcurrentHashMap<String, LinkedBlockingQueue<ByteArray>>()
  private var acceptThread: Thread? = null
  private val pool = Executors.newCachedThreadPool()

  override fun definition() = ModuleDefinition {
    Name("PcControl")
    Events("pcRequest")

    AsyncFunction("start") { wantedPort: Int ->
      if (running.get()) return@AsyncFunction true
      port.set(if (wantedPort in 1024..65535) wantedPort else 8089)
      val socket = ServerSocket(port.get(), 16, InetAddress.getByName("0.0.0.0"))
      serverSocket.set(socket)
      running.set(true)
      acceptThread = Thread({
        try {
          while (running.get()) {
            val client = socket.accept() ?: break
            pool.execute { handle(client) }
          }
        } catch (e: Exception) {
          if (running.get()) Log.w(TAG, "accept loop: ${e.message}")
        }
      }, "pc-server-accept")
      acceptThread?.start()
      true
    }

    AsyncFunction("stop") {
      running.set(false)
      try {
        serverSocket.getAndSet(null)?.close()
      } catch (_: Exception) {
      }
      pending.clear()
      true
    }

    Function("isRunning") { running.get() }
    Function("getPort") { port.get() }

    Function("getLocalIp") {
      val candidates = mutableListOf<String>()
      val interfaces = NetworkInterface.getNetworkInterfaces() ?: return@Function ""
      for (nif in interfaces) {
        for (addr in nif.inetAddresses) {
          if (!addr.isLoopbackAddress && addr.hostAddress?.contains(':') == false) {
            candidates.add(addr.hostAddress ?: continue)
          }
        }
      }
      candidates.firstOrNull { it.startsWith("192.168.") }
        ?: candidates.firstOrNull { it.startsWith("10.") }
        ?: candidates.firstOrNull()
        ?: ""
    }

    Function("respond") { id: String, status: Int, contentType: String, body: String ->
      val queue = pending.remove(id) ?: return@Function false
      val reason = when (status) {
        200 -> "OK"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 404 -> "Not Found"
        405 -> "Method Not Allowed"; else -> "OK"
      }
      val payload = body.toByteArray(Charsets.UTF_8)
      val head = "HTTP/1.1 $status $reason\r\n" +
        "Content-Type: $contentType; charset=utf-8\r\n" +
        "Content-Length: ${payload.size}\r\n" +
        "Access-Control-Allow-Origin: *\r\n" +
        "Connection: close\r\n\r\n"
      queue.offer(head.toByteArray(Charsets.UTF_8) + payload)
      true
    }
  }

  private fun handle(client: Socket) {
    try {
      client.soTimeout = 8000
      val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.UTF_8))
      val requestLine = reader.readLine() ?: return
      val parts = requestLine.split(" ")
      if (parts.size < 2) return
      val method = parts[0]
      val pathWithQuery = parts[1]
      var contentLength = 0
      while (true) {
        val line = reader.readLine() ?: break
        if (line.isEmpty()) break
        if (line.startsWith("Content-Length:", ignoreCase = true)) {
          contentLength = line.substringAfter(':').trim().toIntOrNull() ?: 0
        }
      }
      val body = if (contentLength > 0 && contentLength < 262_144) {
        val buf = CharArray(contentLength)
        var read = 0
        while (read < contentLength) {
          val r = reader.read(buf, read, contentLength - read)
          if (r < 0) break
          read += r
        }
        String(buf, 0, read)
      } else ""

      val id = "req-${System.nanoTime()}"
      val queue = LinkedBlockingQueue<ByteArray>()
      pending[id] = queue

      val pathOnly = pathWithQuery.substringBefore('?')
      sendEvent(
        "pcRequest",
        mapOf(
          "id" to id,
          "method" to method,
          "path" to pathWithQuery,
          "route" to pathOnly,
          "body" to body,
        ),
      )

      val response = queue.poll(REQUEST_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      if (response != null) {
        client.getOutputStream().use { it.write(response) }
      } else {
        pending.remove(id)
        val timeout = "HTTP/1.1 504 Timeout\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        client.getOutputStream().use { it.write(timeout.toByteArray(Charsets.UTF_8)) }
      }
    } catch (e: SocketException) {
      // client vanished — ignore
    } catch (e: Exception) {
      Log.w(TAG, "handle: ${e.message}")
    } finally {
      try {
        client.close()
      } catch (_: Exception) {
      }
    }
  }
}
