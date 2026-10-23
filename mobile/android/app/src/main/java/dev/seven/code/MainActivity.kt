package dev.seven.code

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import dev.seven.code.terminal.SevenPty
import org.json.JSONObject
import java.io.IOException
import java.io.ByteArrayInputStream

/**
 * Host for the original Code OSS web workbench, served by the upstream-compatible VS Code web server over authenticated HTTPS.
 * The mobile-only addition is the native terminal bridge. No fake editor UI is used.
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val sessions = mutableMapOf<String, SevenPty>()
    private val pendingSessions = mutableMapOf<String, AlertDialog>()
    private var terminalGeneration = 0
    private var trustedOrigin: String = ""
    private var aiRunner: SevenAiCommandRunner? = null
    private var aiRequestId: String? = null
    private val sessionPattern = Regex("[A-Za-z0-9_-]{1,64}")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val savedUrl = getPreferences(MODE_PRIVATE).getString("workbenchUrl", null)
        if (savedUrl == null || parseWorkbenchUrl(savedUrl) == null) {
            showServerSetup()
        } else {
            openWorkbench(savedUrl)
        }
    }

    private fun parseWorkbenchUrl(raw: String): Pair<String, String>? {
        val uri = Uri.parse(raw.trim())
        if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null ||
            uri.fragment != null || uri.port > 65535 || uri.port == 0) return null
        if (uri.host!!.contains("..")) return null
        val host = uri.host!!.lowercase()
        val port = if (uri.port == -1 || uri.port == 443) "" else ":" + uri.port
        return "https://" + host + port to uri.toString()
    }

    private fun showServerSetup(error: String? = null) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (24 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        layout.addView(TextView(this).apply {
            text = "Seven Code — Code OSS\n\nInforme o HTTPS do servidor web do Code OSS, compatível com esta versão. " +
                "Editor, extensões e Git usam o servidor do Code OSS; somente o terminal Android é nativo."
            textSize = 18f
        })
        if (error != null) layout.addView(TextView(this).apply { text = error })
        val field = EditText(this).apply {
            hint = "https://seu-servidor-code-oss.exemplo"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
        }
        layout.addView(field)
        layout.addView(Button(this).apply {
            text = "Abrir editor"
            setOnClickListener {
                val candidate = field.text.toString().trim()
                if (parseWorkbenchUrl(candidate) == null) {
                    field.error = "Informe uma URL HTTPS válida e sem credenciais na URL"
                    return@setOnClickListener
                }
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Confiar neste servidor?")
                    .setMessage("O servidor escolhido terá acesso à interface do editor. " +
                        "O terminal Android solicitará aprovação separada antes de abrir cada sessão.\n\n" + candidate)
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton("Confiar e abrir") { _, _ ->
                        getPreferences(MODE_PRIVATE).edit().putString("workbenchUrl", candidate).apply()
                        openWorkbench(candidate)
                    }.show()
            }
        })
        setContentView(layout)
    }

    private fun openWorkbench(url: String) {
        val parsed = parseWorkbenchUrl(url) ?: return showServerSetup("URL inválida")
        trustedOrigin = parsed.first
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            setContentView(TextView(this).apply {
                text = "Atualize o Android System WebView para usar o Seven Code."
            })
            return
        }
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                // A replaced document cannot own the previous workbench's sessions.
                closeWorkbenchTerminals()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val uri = request.url
                val port = if (uri.port == -1 || uri.port == 443) "" else ":" + uri.port
                val requestedOrigin = uri.scheme + "://" + (uri.host ?: "").lowercase() + port
                return requestedOrigin != trustedOrigin || uri.userInfo != null
            }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.scheme == "http") return WebResourceResponse(
                    "text/plain", "UTF-8", 403, "Blocked insecure request",
                    emptyMap(), ByteArrayInputStream(ByteArray(0))
                )
                return null
            }
        }
        WebViewCompat.addWebMessageListener(
            webView, "SevenTerminalNative", setOf(trustedOrigin)
        ) { _, message, sourceOrigin, isMainFrame, _ ->
            if (!isMainFrame || sourceOrigin.toString() != trustedOrigin) return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            if (raw.length > 100_000) return@addWebMessageListener
            runOnUiThread { handleMessage(raw) }
        }
        setContentView(webView)
        webView.loadUrl(parsed.second)
    }

    private fun sendEvent(type: String, sessionId: String, value: String? = null, exitCode: Int? = null) {
        val message = JSONObject().put("type", type).put("sessionId", sessionId)
        if (value != null) message.put("value", value)
        if (type == "exit") message.put("exitCode", exitCode ?: JSONObject.NULL)
        sendPayload(message)
    }

    private fun handleMessage(raw: String) {
        try {
            val data = JSONObject(raw)
            if (data.optString("type") == "ai-propose") {
                proposeAiCommand(data)
                return
            }
            val sessionId = data.optString("sessionId")
            if (!sessionPattern.matches(sessionId)) return
            when (data.optString("type")) {
                "start" -> {
                    if (sessions.containsKey(sessionId) || pendingSessions.containsKey(sessionId)) return
                    val cols = data.optInt("cols")
                    val rows = data.optInt("rows")
                    if (cols !in 1..1000 || rows !in 1..1000) return
                    fun rejectSession() {
                        if (pendingSessions.remove(sessionId) == null) return
                        sendEvent("error", sessionId, "Terminal negado pelo usuário")
                        sendEvent("exit", sessionId)
                    }
                    val dialog = AlertDialog.Builder(this)
                        .setTitle("Abrir terminal Android?")
                        .setMessage("Autorizar sessão do shell local /system/bin/sh? " +
                            "Os comandos executarão com as permissões do Seven Code no Android.")
                        .setNegativeButton("Negar") { _, _ -> rejectSession() }
                        .setOnCancelListener { rejectSession() }
                        .setPositiveButton("Abrir terminal") { _, _ ->
                            // The editor can close the terminal while approval is open.
                            if (pendingSessions.remove(sessionId) == null || isFinishing || isDestroyed) {
                                return@setPositiveButton
                            }
                            try {
                                val generation = terminalGeneration
                                val pty = SevenPty(this,
                                    onData = { bytes ->
                                        runOnUiThread {
                                            if (generation == terminalGeneration) {
                                                sendEvent("data", sessionId, Base64.encodeToString(bytes, Base64.NO_WRAP))
                                            }
                                        }
                                    },
                                    onError = { error ->
                                        runOnUiThread {
                                            if (generation == terminalGeneration) {
                                                sendEvent("error", sessionId, error.message ?: "Erro PTY")
                                            }
                                        }
                                    },
                                    onExit = { code ->
                                        runOnUiThread {
                                            if (generation == terminalGeneration) {
                                                sessions.remove(sessionId)
                                                sendEvent("exit", sessionId, exitCode = code)
                                            }
                                        }
                                    }
                                )
                                pty.start(cols, rows)
                                sessions[sessionId] = pty
                                sendEvent("ready", sessionId)
                            } catch (error: Exception) {
                                sendEvent("error", sessionId, error.message ?: "Falha ao abrir shell")
                                sendEvent("exit", sessionId)
                            }
                        }.create()
                    pendingSessions[sessionId] = dialog
                    dialog.show()
                }
                "input" -> {
                    val encoded = data.optString("data")
                    if (encoded.length > 90_000) return
                    val bytes = Base64.decode(encoded, Base64.NO_WRAP)
                    if (bytes.size <= 65_536) sessions[sessionId]?.write(bytes)
                }
                "resize" -> sessions[sessionId]?.resize(data.optInt("cols"), data.optInt("rows"))
                "close" -> {
                    pendingSessions.remove(sessionId)?.dismiss()
                    sessions.remove(sessionId)?.close()
                }
            }
        } catch (error: Exception) {
            // A malformed web message must not crash the Android workbench.
        }
    }

    /**
     * Only the native host can approve executing an AI-proposed command.
     * Never auto-run anything received from a language model.
     */
    private fun proposeAiCommand(message: JSONObject) {
        val id = message.optString("requestId")
        val command = message.optString("command")
        val timeout = message.optLong("timeoutMs", 60_000L)
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,64}")) ||
            command.isBlank() || command.length > 4096 || command.any { it.code == 0 } ||
            timeout !in 1000L..120_000L) {
            sendAiResult(id, false, null, "", false, "Solicitação inválida")
            return
        }
        if (aiRunner != null || aiRequestId != null) {
            sendAiResult(id, false, null, "", false, "Já existe comando em execução")
            return
        }
        aiRequestId = id
        AlertDialog.Builder(this)
            .setTitle("Permitir comando da IA?")
            .setMessage("Comando no terminal local do Android:\n\n$command\n\n" +
                "A execução terá as permissões do aplicativo Seven Code.")
            .setCancelable(false)
            .setNegativeButton("Negar") { _, _ ->
                aiRequestId = null
                sendAiResult(id, false, null, "", false, "Negado pelo usuário")
            }
            .setPositiveButton("Executar") { _, _ ->
                val runner = SevenAiCommandRunner(this, onComplete = { result ->
                    aiRunner = null
                    aiRequestId = null
                    sendAiResult(id, true, result.exitCode, result.output,
                        result.truncated, result.error)
                })
                aiRunner = runner
                try {
                    runner.execute(command, timeout)
                } catch (error: Exception) {
                    aiRunner = null
                    aiRequestId = null
                    sendAiResult(id, true, null, "", false,
                        error.message ?: "Falha no terminal")
                }
            }.show()
    }

    private fun sendAiResult(
        id: String,
        approved: Boolean,
        exitCode: Int?,
        output: String,
        truncated: Boolean,
        error: String?
    ) {
        val payload = JSONObject()
            .put("type", "ai-result")
            .put("requestId", id)
            .put("approved", approved)
            .put("exitCode", exitCode ?: JSONObject.NULL)
            .put("output", output)
            .put("truncated", truncated)
        if (error != null) payload.put("error", error)
        sendPayload(payload)
    }

    private fun sendPayload(payload: JSONObject) {
        if (!::webView.isInitialized) return
        val encoded = payload.toString()
        runOnUiThread {
            if (!isFinishing && !isDestroyed) {
                webView.evaluateJavascript("window.sevenNativeEvent?.($encoded)", null)
            }
        }
    }

    private fun sendEvent(type: String, value: String) {
        if (!::webView.isInitialized) return
        sendPayload(JSONObject().put("type", type).put("value", value))
    }

    private fun closeWorkbenchTerminals() {
        terminalGeneration++
        pendingSessions.values.toList().forEach { it.dismiss() }
        pendingSessions.clear()
        val previousSessions = sessions.values.toList()
        sessions.clear()
        previousSessions.forEach { it.close() }
    }

    override fun onDestroy() {
        closeWorkbenchTerminals()
        aiRunner?.cancel()
        aiRunner = null
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
