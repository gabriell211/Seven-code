package dev.seven.code

import android.os.SystemClock
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import javax.net.ssl.HttpsURLConnection

/**
 * Native CORS-free transport for upstream GitHub authentication's device flow.
 * Never acts as a generic HTTPS proxy. No GitHub token is persisted or logged
 * by Android: the original Code OSS AuthenticationProvider owns the session.
 */
internal class SevenGitHubDeviceFlow(
    private val transport: (String, String) -> String = ::postDeviceFlow
) {
    private data class Pending(
        val clientId: String,
        val deviceCode: String,
        val expiresAt: Long,
        var nextPollAt: Long,
        var intervalSeconds: Int
    )
    private var pending: Pending? = null
    private val clientIdPattern = Regex("[A-Za-z0-9]{16,64}")
    private val codePattern = Regex("[A-Za-z0-9_-]{20,256}")
    private val scopePattern = Regex("[A-Za-z0-9 ,:_-]{0,300}")

    @Synchronized
    fun process(request: JSONObject): JSONObject {
        val requestId = request.optString("requestId")
        val response = JSONObject()
            .put("type", "github-device-result")
            .put("requestId", requestId)
        if (!requestId.matches(Regex("[A-Za-z0-9_-]{1,64}"))) {
            return response.put("status", 400).put("body",
                JSONObject().put("error", "invalid_request"))
        }
        val body = try {
            val clientId = request.optString("clientId")
            require(clientIdPattern.matches(clientId))
            when (request.optString("op")) {
                "begin" -> begin(clientId, request.optString("scope"))
                "poll" -> poll(clientId, request.optString("deviceCode"))
                else -> JSONObject().put("error", "unsupported_operation")
            }
        } catch (_: Exception) {
            // No raw exception, credential, device code or HTTP URL is returned.
            JSONObject().put("error", "android_github_device_flow_failed")
        }
        return response.put("status", 200).put("body", body)
    }

    private fun begin(clientId: String, scope: String): JSONObject {
        require(scopePattern.matches(scope))
        val form = "client_id=" + enc(clientId) + "&scope=" + enc(scope)
        val result = JSONObject(transport("/login/device/code", form))
        if (result.has("error")) return result
        val deviceCode = result.getString("device_code")
        val verify = result.getString("verification_uri")
        val interval = result.optInt("interval", 5)
        val expiresIn = result.optInt("expires_in", 900)
        require(codePattern.matches(deviceCode) && verify == "https://github.com/login/device" &&
            interval in 1..120 && expiresIn in 1..1800)
        val now = SystemClock.elapsedRealtime()
        pending = Pending(clientId, deviceCode, now + expiresIn * 1000L,
            now + interval * 1000L, interval)
        return result
    }

    private fun poll(clientId: String, deviceCode: String): JSONObject {
        val current = pending ?: return JSONObject().put("error", "invalid_device_code")
        val now = SystemClock.elapsedRealtime()
        if (now > current.expiresAt) {
            pending = null
            return JSONObject().put("error", "expired_token")
        }
        require(codePattern.matches(deviceCode))
        if (clientId != current.clientId || deviceCode != current.deviceCode) {
            return JSONObject().put("error", "invalid_device_code")
        }
        if (now < current.nextPollAt) {
            // The Web Worker will back off instead of flooding GitHub.
            return JSONObject().put("error", "authorization_pending")
        }
        current.nextPollAt = now + current.intervalSeconds * 1000L
        val form = "client_id=" + enc(clientId) +
            "&device_code=" + enc(deviceCode) +
            "&grant_type=" + enc("urn:ietf:params:oauth:grant-type:device_code")
        val result = JSONObject(transport("/login/oauth/access_token", form))
        when (result.optString("error")) {
            "slow_down" -> {
                current.intervalSeconds = (current.intervalSeconds + 5).coerceAtMost(120)
                current.nextPollAt = now + current.intervalSeconds * 1000L
                result.put("interval", current.intervalSeconds)
            }
            "expired_token", "access_denied", "incorrect_device_code" -> pending = null
            "" -> if (result.optString("access_token").isNotEmpty()) pending = null
        }
        return result
    }
}

private fun enc(text: String): String = URLEncoder.encode(text, "UTF-8")

private fun postDeviceFlow(path: String, form: String): String {
    require(path == "/login/device/code" || path == "/login/oauth/access_token")
    require(form.length <= 1024)
    val url = URL("https://github.com" + path)
    val connection = (url.openConnection() as HttpsURLConnection).apply {
        requestMethod = "POST"
        instanceFollowRedirects = false
        connectTimeout = 12000
        readTimeout = 12000
        doOutput = true
        setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        setRequestProperty("Accept", "application/json")
        setRequestProperty("User-Agent", "SevenCode-Android")
    }
    try {
        connection.outputStream.use { it.write(form.toByteArray(Charsets.UTF_8)) }
        val status = connection.responseCode
        if (status !in 200..299) throw IOException("GitHub authorization returned a non-success status")
        val bytes = connection.inputStream.use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(output.size() + count <= 16_384) { "Oversized GitHub response" }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
        return String(bytes, Charsets.UTF_8)
    } finally {
        connection.disconnect()
    }
}
