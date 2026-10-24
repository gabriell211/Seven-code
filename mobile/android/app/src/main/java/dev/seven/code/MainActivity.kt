package dev.seven.code

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.util.Base64
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
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

/** External browser receives only top-level HTTPS URLs, never scripts or file URLs. */
internal fun safeExternalHttpsTarget(uri: Uri): Boolean =
    uri.scheme == "https" && !uri.host.isNullOrBlank() &&
        uri.userInfo == null && uri.fragment == null && uri.host!!.contains("..").not()

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
    private var showingConnectionError = false
    private var workbenchActive = false
    private val popupWindows = mutableSetOf<WebView>()
    private var pendingExternalConsent = false

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
        // Revoke bridge access before leaving the trusted workbench screen.
        workbenchActive = false
        trustedOrigin = ""
        closeWorkbenchTerminals()
        closePopupWindows()
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.loadUrl("about:blank")
        }
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
            setText(getPreferences(MODE_PRIVATE).getString("workbenchUrl", "") ?: "")
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
        // Stop authorization for the old web document before replacing its WebView.
        workbenchActive = false
        closeWorkbenchTerminals()
        closePopupWindows()
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            setContentView(TextView(this).apply {
                text = "Atualize o Android System WebView para usar o Seven Code."
            })
            return
        }
        // Do not retain a disconnected WebView when changing the trusted server.
        val previousWebView = if (::webView.isInitialized) webView else null
        trustedOrigin = parsed.first
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            // env.openExternal can call window.open after an async OAuth step,
            // when Chromium no longer reports a gesture. The host handles
            // every popup separately, with HTTPS validation and native consent.
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                // An event from an abandoned WebView cannot terminate the new PTY.
                if (workbenchActive && view === webView) closeWorkbenchTerminals()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!workbenchActive || view !== webView) return true
                if (!request.isForMainFrame) return false
                val uri = request.url
                val port = if (uri.port == -1 || uri.port == 443) "" else ":" + uri.port
                val requestedOrigin = uri.scheme + "://" + (uri.host ?: "").lowercase() + port
                if (requestedOrigin == trustedOrigin && uri.userInfo == null) return false
                // OAuth providers prohibit login in embedded webviews. Only
                // deliberate HTTPS navigations can leave this trusted origin.
                if (request.hasGesture() && safeExternalHttpsTarget(uri)) {
                    openInSystemBrowser(uri)
                }
                return true
            }

            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: WebResourceError
            ) {
                if (workbenchActive && view === webView && request.isForMainFrame) {
                    promptServerFailure("Falha ao conectar: " + error.description.toString().take(200))
                }
            }

            override fun onReceivedHttpError(
                view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse
            ) {
                if (workbenchActive && view === webView &&
                    request.isForMainFrame && errorResponse.statusCode in listOf(401, 403)) {
                    promptServerFailure("Acesso negado (HTTP " + errorResponse.statusCode +
                        "). Verifique a autenticação e as permissões no servidor Code OSS.")
                }
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.scheme == "http") return WebResourceResponse(
                    "text/plain", "UTF-8", 403, "Blocked insecure request",
                    emptyMap(), ByteArrayInputStream(ByteArray(0))
                )
                return null
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView, isDialog: Boolean,
                isUserGesture: Boolean, resultMsg: Message
            ): Boolean {
                // Code OSS env.openExternal frequently uses window.open, not
                // a main-frame navigation. Never load an OAuth popup inside
                // the privileged workbench WebView.
                if (!workbenchActive || view !== webView || popupWindows.isNotEmpty() ||
                    isFinishing || isDestroyed) return false
                val popup = WebView(this@MainActivity)
                popup.settings.apply {
                    javaScriptEnabled = false
                    allowFileAccess = false
                    allowContentAccess = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                }
                var handled = false
                fun forwardPopupUrl(uri: Uri) {
                    if (handled) return
                    handled = true
                    if (safeExternalHttpsTarget(uri)) {
                        openInSystemBrowser(uri, requireConsent = !isUserGesture)
                    }
                    destroyPopup(popup)
                }
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        child: WebView, request: WebResourceRequest
                    ): Boolean {
                        if (!request.isForMainFrame || request.url.toString() == "about:blank") {
                            return false
                        }
                        forwardPopupUrl(request.url)
                        return true
                    }
                    override fun onPageStarted(child: WebView, url: String, favicon: Bitmap?) {
                        val uri = Uri.parse(url)
                        if (safeExternalHttpsTarget(uri)) forwardPopupUrl(uri)
                    }
                }
                popupWindows.add(popup)
                // Android WebView requires a transported child window for
                // target=_blank. Popup never receives the native terminal API.
                (view.parent as? ViewGroup)?.addView(
                    popup, ViewGroup.LayoutParams(1, 1)
                )
                popup.visibility = android.view.View.INVISIBLE
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
                return true
            }

            override fun onCloseWindow(window: WebView) {
                destroyPopup(window)
            }
        }
        WebViewCompat.addWebMessageListener(
            webView, "SevenTerminalNative", setOf(trustedOrigin)
        ) { senderView, message, sourceOrigin, isMainFrame, _ ->
            if (!workbenchActive || senderView !== webView || !isMainFrame ||
                sourceOrigin.toString() != trustedOrigin) return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            if (raw.length > 100_000) return@addWebMessageListener
            runOnUiThread {
                if (workbenchActive && senderView === webView) handleMessage(raw)
            }
        }
        setContentView(webView)
        previousWebView?.stopLoading()
        previousWebView?.destroy()
        showingConnectionError = false
        workbenchActive = true
        webView.loadUrl(parsed.second)
    }

    private fun openInSystemBrowser(uri: Uri, requireConsent: Boolean = false) {
        if (!safeExternalHttpsTarget(uri)) return
        if (requireConsent) {
            // Third-party iframes can attempt to open a popup. Without a
            // genuine gesture, never launch another app silently.
            if (pendingExternalConsent || !workbenchActive || isFinishing || isDestroyed) return
            pendingExternalConsent = true
            AlertDialog.Builder(this)
                .setTitle("Abrir autenticação no navegador?")
                .setMessage("O editor quer abrir " + uri.host +
                    " no navegador do sistema. Autorize somente se iniciou essa ação.")
                .setPositiveButton("Abrir") { _, _ -> launchExternalBrowser(uri) }
                .setNegativeButton("Cancelar", null)
                .setOnDismissListener { pendingExternalConsent = false }
                .show()
            return
        }
        launchExternalBrowser(uri)
    }

    private fun launchExternalBrowser(uri: Uri) {
        if (!safeExternalHttpsTarget(uri)) return
        try {
            startActivity(
                Intent(Intent.ACTION_VIEW, uri)
                    .addCategory(Intent.CATEGORY_BROWSABLE)
            )
        } catch (_: ActivityNotFoundException) {
            promptServerFailure("Nenhum navegador disponível para concluir a autenticação.")
        }
    }

    private fun destroyPopup(popup: WebView) {
        if (!popupWindows.remove(popup)) return
        popup.stopLoading()
        (popup.parent as? ViewGroup)?.removeView(popup)
        popup.destroy()
    }

    private fun closePopupWindows() {
        popupWindows.toList().forEach { destroyPopup(it) }
    }

    private fun promptServerFailure(reason: String) {
        if (showingConnectionError || isFinishing || isDestroyed) return
        showingConnectionError = true
        AlertDialog.Builder(this)
            .setTitle("Não foi possível abrir o Seven Code")
            .setMessage(reason + "\n\nO aplicativo precisa do servidor Code OSS original " +
                "em uma conexão HTTPS autenticada.")
            .setPositiveButton("Tentar novamente") { _, _ ->
                if (::webView.isInitialized) webView.reload()
            }
            .setNeutralButton("Alterar servidor") { _, _ -> showServerSetup(reason) }
            .setNegativeButton("Cancelar", null)
            .setOnDismissListener { showingConnectionError = false }
            .show()
    }

    private fun sendEvent(type: String, sessionId: String, value: String? = null, exitCode: Int? = null) {
        val message = JSONObject().put("type", type).put("sessionId", sessionId)
        if (value != null) message.put("value", value)
        if (type == "exit") message.put("exitCode", exitCode ?: JSONObject.NULL)
        sendPayload(message)
    }

    private fun handleMessage(raw: String) {
        if (!workbenchActive) return
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
                                sendPayload(JSONObject().put("type", "ready")
                                    .put("sessionId", sessionId)
                                    .put("pid", pty.shellPid())
                                    .put("cwd", filesDir.canonicalPath))
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
        if (!workbenchActive || !::webView.isInitialized) return
        val encoded = payload.toString()
        runOnUiThread {
            if (!isFinishing && !isDestroyed && workbenchActive) {
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
        workbenchActive = false
        closePopupWindows()
        closeWorkbenchTerminals()
        aiRunner?.cancel()
        aiRunner = null
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
