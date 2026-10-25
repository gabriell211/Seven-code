package dev.seven.code

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.content.res.ColorStateList
import android.view.Gravity
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
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
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewAssetLoader
import dev.seven.code.terminal.SevenPty
import org.json.JSONObject
import java.io.IOException
import java.io.ByteArrayInputStream
import kotlin.concurrent.thread

/** External browser receives only top-level HTTPS URLs, never scripts or file URLs. */
internal fun safeExternalHttpsTarget(uri: Uri): Boolean =
    uri.scheme == "https" && !uri.host.isNullOrBlank() &&
        uri.userInfo == null && uri.fragment == null && uri.host!!.contains("..").not()

/**
 * Native PTY and document access must never be granted to arbitrary HTTPS.
 * Only the exact APK-bundled editor document or the locally authenticated
 * Code OSS server may receive the WebMessageListener bridge.
 */
internal fun trustedWorkbenchTarget(raw: String, verifiedLocalOrigin: String?): Pair<String, String>? {
    val uri = Uri.parse(raw.trim())
    if (uri.host.isNullOrBlank() || uri.userInfo != null || uri.fragment != null ||
        uri.port > 65535 || uri.port == 0) return null
    return when (uri.scheme) {
        "http" -> {
            if (uri.host != "127.0.0.1" || uri.port !in 1..65535) return null
            val origin = "http://127.0.0.1:${uri.port}"
            if (origin != verifiedLocalOrigin) return null
            origin to uri.toString()
        }
        "https" -> {
            if (!uri.host.equals("appassets.androidplatform.net", ignoreCase = true) ||
                (uri.port != -1 && uri.port != 443) ||
                uri.encodedPath != "/assets/seven-web/index.html" ||
                uri.query != null) return null
            "https://appassets.androidplatform.net" to
                "https://appassets.androidplatform.net/assets/seven-web/index.html"
        }
        else -> null
    }
}

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
    private var pendingAiConsent: AlertDialog? = null
    private val sessionPattern = Regex("[A-Za-z0-9_-]{1,64}")
    private var showingConnectionError = false
    private var workbenchActive = false
    private var lastImeRequestTime = 0L
    private val popupWindows = mutableSetOf<WebView>()
    private var pendingExternalConsent = false
    private var localServer: SevenLocalCodeOssServer? = null
    private val githubDeviceFlow = SevenGitHubDeviceFlow()
    private lateinit var mobileDocuments: SevenMobileDocuments
    private val webAssetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }
    private val embeddedWebUrl =
        "https://appassets.androidplatform.net/assets/seven-web/index.html"

    private fun hasEmbeddedWebWorkbench(): Boolean = try {
        assets.open("seven-web/index.html").use { true }
    } catch (_: IOException) {
        false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        localServer = SevenLocalCodeOssServer(this)
        mobileDocuments = SevenMobileDocuments(this)
        // Prefer the real compiled Code OSS browser workbench embedded in APK.
        // Browser UI needs no Node runtime, URL setup or remote server.
        // Legacy self-hosted builds without Web assets keep the old runtime path.
        if (hasEmbeddedWebWorkbench()) {
            openWorkbench(embeddedWebUrl)
        } else {
            startLocalWorkbench()
        }
    }

    private fun startLocalWorkbench() {
        // Legacy self-hosted Code OSS builds also get a genuine native,
        // animated loading screen. No static image or simulated progress.
        val density = resources.displayMetrics.density
        val surface = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(11, 16, 26))
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(24, 24, 24, 24)
        }
        column.addView(TextView(this).apply {
            text = "7"
            gravity = Gravity.CENTER
            textSize = 65f
            setTextColor(Color.rgb(66, 239, 196))
            setTypeface(null, android.graphics.Typeface.BOLD)
            contentDescription = "Seven Code"
        }, LinearLayout.LayoutParams((96 * density).toInt(), (98 * density).toInt()))
        column.addView(TextView(this).apply {
            text = "SEVEN CODE"
            textSize = 25f
            letterSpacing = 0.13f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(239, 248, 255))
            setTypeface(null, android.graphics.Typeface.BOLD)
        })
        column.addView(ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(Color.rgb(66, 239, 196))
            contentDescription = "Carregando o editor Code OSS"
        }, LinearLayout.LayoutParams(
            (56 * density).toInt(), (56 * density).toInt()
        ).apply { topMargin = (32 * density).toInt() })
        column.addView(TextView(this).apply {
            text = "Preparando seu ambiente de desenvolvimento"
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(190, 205, 222))
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = (14 * density).toInt() })
        surface.addView(column, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        ))
        setContentView(surface)
        localServer?.start { result ->
            if (isFinishing || isDestroyed) return@start
            result.fold(
                onSuccess = { openWorkbench(it) },
                onFailure = { showLocalStartupFailure(it.message ?: "Falha ao iniciar o Code OSS local.") }
            )
        }
    }

    private fun showLocalStartupFailure(reason: String) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }
        layout.addView(TextView(this).apply {
            text = "O editor local não iniciou.\n\n" + reason +
                "\n\nEste aplicativo usa somente o Code OSS incluído no APK."
            textSize = 17f
        })
        layout.addView(Button(this).apply {
            text = "Tentar abrir o editor novamente"
            setOnClickListener { startLocalWorkbench() }
        })
        setContentView(layout)
    }

    // Keep the internal entrypoint used by existing Android instrumentation
    // while centralizing the security checks in the origin validator above.
    private fun parseWorkbenchUrl(raw: String): Pair<String, String>? =
        trustedWorkbenchTarget(raw, localServer?.localOrigin)

    private fun openWorkbench(url: String) {
        val parsed = parseWorkbenchUrl(url) ?: return showLocalStartupFailure("URL local inválida.")
        // Stop authorization for the old web document before replacing its WebView.
        workbenchActive = false
        closeWorkbenchTerminals()
        mobileDocuments.dispose()
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
        webView = WebView(this).apply {
            // The original Monaco editor uses an underlying HTML textarea.
            // Android IME must connect to the actual focused WebView, not to a
            // native dummy EditText that would swallow typed code.
            isFocusable = true
            isFocusableInTouchMode = true
            setOnTouchListener { view, event ->
                if (event.actionMasked == MotionEvent.ACTION_DOWN) {
                    view.requestFocusFromTouch()
                }
                false // Chromium still receives the original touch event.
            }
        }
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
                // appassets.androidplatform.net is an HTTPS virtual origin, not
                // an external service. Serve only APK resources via AssetLoader.
                if (request.url.scheme == "https" &&
                    request.url.host == "appassets.androidplatform.net") {
                    return webAssetLoader.shouldInterceptRequest(request.url)
                        ?: WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                            emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
                if (request.url.scheme == "http" &&
                    request.url.scheme + "://" + request.url.host + ":" + request.url.port !=
                        localServer?.localOrigin) return WebResourceResponse(
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
        webView.requestFocus()
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
.setMessage(reason + "\n\nO servidor Code OSS local precisa continuar em execução no aplicativo.")
            .setPositiveButton("Tentar novamente") { _, _ ->
                if (::webView.isInitialized) webView.reload()
            }
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
            if (data.optString("type") == "keyboard-request") {
                showAndroidSystemIme()
                return
            }
            if (data.optString("type") == "github-device-request") {
                handleGitHubDeviceRequest(data)
                return
            }
            if (data.optString("type") == "fs-request") {
                handleFileRequest(data)
                return
            }
            if (data.optString("type") == "ai-cancel") {
                cancelAiCommand(data.optString("requestId"))
                return
            }
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

    /** Show the user's normal configured Android keyboard (IME) for Monaco,
     * terminal, quick input, dialogs and text inputs inside the trusted WebView.
     * The WebMessageListener rejects untrusted origins and child frames first.
     */
    private fun showAndroidSystemIme() {
        if (!workbenchActive || !::webView.isInitialized ||
            isFinishing || isDestroyed || !webView.isAttachedToWindow) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastImeRequestTime < 90L) return
        lastImeRequestTime = now
        val editorView = webView
        editorView.isFocusableInTouchMode = true
        editorView.requestFocus()
        // The JS focus event precedes Chromium's input-connection update on
        // some Android devices. Give its genuine textarea time to focus.
        editorView.postDelayed({
            if (workbenchActive && editorView === webView &&
                editorView.hasFocus() && editorView.isAttachedToWindow &&
                !isFinishing && !isDestroyed) {
                val ime = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                ime.showSoftInput(editorView, InputMethodManager.SHOW_IMPLICIT)
            }
        }, 110L)
    }

    private fun handleGitHubDeviceRequest(data: JSONObject) {
        val requestId = data.optString("requestId")
        if (!sessionPattern.matches(requestId)) return
        // HTTPS must run outside the Android main thread. Native only calls
        // GitHub's two device-flow endpoints; no arbitrary URL can be supplied.
        val generation = terminalGeneration
        thread(name = "seven-github-device", isDaemon = true) {
            val response = githubDeviceFlow.process(data)
            runOnUiThread {
                if (workbenchActive && generation == terminalGeneration &&
                    !isFinishing && !isDestroyed) sendPayload(response)
            }
        }
    }

    private fun handleFileRequest(data: JSONObject) {
        val requestId = data.optString("requestId")
        if (!requestId.matches(Regex("[A-Za-z0-9_-]{1,64}"))) return
        if (data.optString("op") == "select") {
            try {
                mobileDocuments.beginSelection(requestId)
            } catch (e: Exception) {
                sendPayload(JSONObject().put("type", "fs-result")
                    .put("requestId", requestId).put("ok", false)
                    .put("error", e.message ?: "Não foi possível selecionar a pasta."))
            }
            return
        }
        // SAF providers may perform slow I/O. Keep them off Android's UI thread.
        val generation = terminalGeneration
        thread(name = "seven-mobile-documents", isDaemon = true) {
            val reply = mobileDocuments.process(data)
            runOnUiThread {
                if (workbenchActive && generation == terminalGeneration && !isFinishing && !isDestroyed) {
                    sendPayload(reply)
                }
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == SevenMobileDocuments.PICK_FOLDER) {
            val result = mobileDocuments.finishSelection(resultCode, data)
            if (result != null && workbenchActive) sendPayload(result)
        }
    }

    /**
     * Only the native host can approve executing an AI-proposed command.
     * Never auto-run anything received from a language model.
     */
    private fun cancelAiCommand(requestId: String) {
        if (requestId.isBlank() || requestId != aiRequestId) return
        if (pendingAiConsent != null) {
            pendingAiConsent?.dismiss()
            pendingAiConsent = null
            aiRequestId = null
            sendAiResult(requestId, false, null, "", false, "Solicitação cancelada")
        } else {
            // Cancel runs through SevenAiCommandRunner, whose completion
            // returns an inconclusive exit code rather than fabricated success.
            aiRunner?.cancel()
        }
    }

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
                pendingAiConsent = null
                aiRequestId = null
                sendAiResult(id, false, null, "", false, "Negado pelo usuário")
            }
            .setPositiveButton("Executar") { _, _ ->
                pendingAiConsent = null
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
            }.create().also { dialog ->
                pendingAiConsent = dialog
                dialog.show()
            }
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
        pendingAiConsent?.dismiss()
        pendingAiConsent = null
        aiRunner?.cancel()
        aiRunner = null
        localServer?.stop()
        mobileDocuments.dispose()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
