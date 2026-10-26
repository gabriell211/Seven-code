package dev.seven.code

import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Installs and runs the *single 300+ MB GNU APK*, not the lightweight test APK
 * or an HTML stand-in. Cannot be run by the normal Bionic PTY test workflow.
 * 
 * This validates real Android startup, isolated process, actual Code OSS
 * WebView, and original local server; it does NOT qualify real Copilot OAuth.
 */
@RunWith(AndroidJUnit4::class)
class SevenStandaloneGnuDeviceTest {
    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                val result = findWebView(view.getChildAt(index))
                if (result != null) return result
            }
        }
        return null
    }

    private fun latestError(view: View): String? {
        if (view is TextView) {
            val value = view.text.toString()
            if (value.contains("O editor local não iniciou")) return value.take(350)
        }
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                val result = latestError(view.getChildAt(index))
                if (result != null) return result
            }
        }
        return null
    }

    @Test
    fun fullBundledOriginalCodeOssOpensInAndroidWebViewWithoutExternalServer() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue("This acceptance probe needs the bundled original GNU Code OSS runtime",
            SevenLocalGnuRuntime(context,
                java.io.File(context.filesDir, "seven-code-oss-local")).hasBundle())
        assertTrue("ARM64 native ABI or verified ARM64 translation is REQUIRED. " +
            "Do not mark an x86 emulator green without translation.",
            android.os.Build.SUPPORTED_ABIS.contains("arm64-v8a"))

        val testStartedAt = System.currentTimeMillis()
        val scene = ActivityScenario.launch(MainActivity::class.java)
        try {
            var localUrl: String? = null
            var lastError: String? = null
            val phaseFile = java.io.File(context.filesDir,
                "seven-code-oss-local/startup-phase.txt")
            val deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(5)
            while (System.nanoTime() < deadline && localUrl == null) {
                // A genuine failed boot MUST stop this E2E immediately. It
                // must never spin for 5 minutes or count a blank WebView URL
                // as a ready VS Code editor.
                if (phaseFile.isFile && phaseFile.readText().startsWith("failed-at:")) {
                    lastError = "Original local runtime failed: " +
                        phaseFile.readText().take(300)
                    break
                }
                scene.onActivity { activity ->
                    val root = activity.findViewById<ViewGroup>(android.R.id.content)
                    lastError = latestError(root) ?: lastError
                    val webView = findWebView(root)
                    val loaded = webView?.url
                    if (loaded != null && loaded.startsWith("http://127.0.0.1:")) {
                        localUrl = loaded
                    }
                }
                if (lastError != null) break
                Thread.sleep(500)
            }
            val phase = if (phaseFile.isFile) phaseFile.readText().take(160)
                else "startup-phase-file-missing"
            assertTrue("Real GNU Code OSS did not load on Android (phase: $phase). " +
                (lastError ?: "No local workbench WebView appeared within five minutes."),
                localUrl != null)
            val pageUri = Uri.parse(localUrl)
            assertEquals("http", pageUri.scheme)
            assertEquals("127.0.0.1", pageUri.host)
            assertTrue(pageUri.port in 1024..65535)
            val token = pageUri.getQueryParameter("tkn")
            assertTrue("Local Code OSS must use a strong per-boot secret", 
                token != null && token.matches(Regex("[a-f0-9]{64}")))
            val versionConnection = URL("http://127.0.0.1:${pageUri.port}/version")
                .openConnection() as HttpURLConnection
            val version = try {
                versionConnection.connectTimeout = 2500
                versionConnection.readTimeout = 4000
                assertEquals(200, versionConnection.responseCode)
                versionConnection.inputStream.bufferedReader().use { it.readText().trim() }
            } finally {
                versionConnection.disconnect()
            }
            assertTrue("Original Code OSS must expose a 40-digit Git revision",
                version.matches(Regex("[a-f0-9]{40}")))

            // WebView is not considered functional just because a blank URL
            // appeared. The genuine Monaco workbench DOM must initialize.
            val domResult = AtomicReference<String?>(null)
            val deadlineDom = System.nanoTime() + TimeUnit.MINUTES.toNanos(2)
            while (System.nanoTime() < deadlineDom && domResult.get() != "true") {
                val signal = CountDownLatch(1)
                scene.onActivity { activity ->
                    val view = findWebView(activity.findViewById(android.R.id.content))
                    if (view != null) {
                        view.evaluateJavascript(
                            "Boolean(document.querySelector('.monaco-workbench'))"
                        ) { value -> domResult.set(value); signal.countDown() }
                    } else {
                        signal.countDown()
                    }
                }
                assertTrue("Android WebView JS callback stalled", signal.await(8, TimeUnit.SECONDS))
                if (domResult.get() != "true") Thread.sleep(1000)
            }
            assertEquals("Original Monaco Code OSS editor DOM did not load",
                "true", domResult.get())
            // Proof is produced by the actual GNU ARM64 Node.js process,
            // after spawning a separate Node child and receiving genuine IPC.
            // A desktop Linux unit test or a stored marker cannot pass here.
            val forkEvidence = java.io.File(context.filesDir,
                "seven-code-oss-local/gnu-node-fork-probe.log")
            assertTrue("GNU Node did not pass the on-device child_process.fork IPC preflight",
                forkEvidence.isFile && forkEvidence.lastModified() >= testStartedAt &&
                forkEvidence.readText().lineSequence().any {
                    it.trim() == "SEVEN_GNU_FORK_IPC_OK"
                })

            // A real Node.js workspace extension must activate inside the
            // LOCAL Android Code OSS server, fork a genuine Node child and
            // prove IPC. A browser-only Web Worker cannot write this evidence.
            val evidence = java.io.File(context.filesDir, "seven-code-node-runtime-proof.json")
            val nodeDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
            while (System.nanoTime() < nodeDeadline &&
                (!evidence.isFile || evidence.lastModified() < testStartedAt)) {
                Thread.sleep(800)
            }
            assertTrue("Original Android Node workspace extension host did not activate or fork a Node child",
                evidence.isFile && evidence.lastModified() >= testStartedAt)
            val result = org.json.JSONObject(evidence.readText())
            assertEquals("seven-code-original-node-extension-host-live", result.getString("kind"))
            assertTrue("Original Node.js child-process.fork IPC failed on Android",
                result.getBoolean("nodeForkOk"))
            assertTrue("Real native Node child PID was never recorded", result.getInt("pid") > 0)
            assertTrue("Node runtime on Android must be ARM64", result.getString("arch") == "arm64")
            assertTrue("The genuine Copilot native module did not load on Android; NOT a complete runtime",
                result.getBoolean("copilotNativeAddonLoaded"))

        } finally {
            scene.close()
        }
    }
}
