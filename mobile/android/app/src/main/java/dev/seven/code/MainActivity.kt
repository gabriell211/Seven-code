package dev.seven.code

import android.app.Activity
import android.app.AlertDialog
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import dev.seven.code.terminal.SevenPty
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Host Android do terminal LOCAL. A página WebView é empacotada no APK:
 * páginas remotas, iframes externos e acesso a arquivos do dispositivo são bloqueados.
 */
class MainActivity : Activity() {
    private val origin = "https://appassets.androidplatform.net"
    private lateinit var webView: WebView
    private var session: SevenPty? = null
    private var aiRunner: SevenAiCommandRunner? = null
    private var aiRequestId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            setContentView(TextView(this).apply {
                text = "Seven Code precisa de Android System WebView atualizado."
            })
            return
        }

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            blockNetworkLoads = true
            domStorageEnabled = false
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return !isLocalAsset(request.url)
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                if (!isLocalAsset(request.url)) {
                    return WebResourceResponse(
                        "text/plain", "UTF-8", 403, "Forbidden",
                        emptyMap(), ByteArrayInputStream(ByteArray(0))
                    )
                }
                return loader.shouldInterceptRequest(request.url)
            }
        }
        WebViewCompat.addWebMessageListener(
            webView, "SevenTerminalNative", setOf(origin)
        ) { _, message, sourceOrigin, isMainFrame, _ ->
            if (!isMainFrame || sourceOrigin.toString() != origin) return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            if (raw.length > 100_000) return@addWebMessageListener
            runOnUiThread { handleMessage(raw) }
        }
        setContentView(webView)
        webView.loadUrl("$origin/assets/index.html")
    }

    private fun isLocalAsset(uri: Uri): Boolean =
        uri.scheme == "https" &&
            uri.host == "appassets.androidplatform.net" &&
            (uri.port == -1 || uri.port == 443) &&
            (uri.path?.startsWith("/assets/") == true) &&
            uri.userInfo == null

    private fun handleMessage(raw: String) {
        try {
            val message = JSONObject(raw)
            when (message.optString("type")) {
                "start" -> {
                    if (session != null) return
                    val cols = message.optInt("cols")
                    val rows = message.optInt("rows")
                    val next = SevenPty(
                        this,
                        onData = { sendEvent("data", Base64.encodeToString(it, Base64.NO_WRAP)) },
                        onError = { sendEvent("error", it.message ?: "Falha no shell") },
                        onExit = { sendEvent("exit", it?.toString() ?: "Sessão encerrada") }
                    )
                    next.start(cols, rows)
                    session = next
                }
                "input" -> {
                    val encoded = message.optString("data")
                    if (encoded.length > 90_000) return
                    val bytes = Base64.decode(encoded, Base64.NO_WRAP)
                    session?.write(bytes)
                }
                "resize" -> session?.resize(message.optInt("cols"), message.optInt("rows"))
                "ai-propose" -> proposeAiCommand(message)
                "close" -> {
                    session?.close()
                    session = null
                }
            }
        } catch (ex: Exception) {
            sendEvent("error", ex.message ?: "Mensagem inválida")
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

    override fun onDestroy() {
        aiRunner?.cancel()
        aiRunner = null
        session?.close()
        session = null
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
