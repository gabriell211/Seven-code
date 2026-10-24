package dev.seven.code

import android.app.AlertDialog
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Real Android WebView -> native LM tool permission -> independent JNI
 * Android shell -> WebView result transport. GitHub OAuth / Copilot login
 * are deliberately NOT simulated or claimed here.
 */
@RunWith(AndroidJUnit4::class)
class SevenAiWorkbenchDeviceTest {
    private val origin = "https://appassets.androidplatform.net"

    private fun withWebTool(requestId: String, command: String,
                            check: (ActivityScenario<MainActivity>) -> Unit) {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                val request = JSONObject()
                    .put("type", "ai-propose").put("requestId", requestId)
                    .put("command", command).put("timeoutMs", 20_000)
                val html = """
                    <!doctype html><meta charset="utf-8">
                    <script>
                    window.sevenEvents = [];
                    window.sevenNativeEvent = event => window.sevenEvents.push(event);
                    SevenTerminalNative.postMessage(JSON.stringify($request));
                    </script>
                """.trimIndent()
                scenario.onActivity { activity ->
                    SevenWebWorkbenchTestHarness.attach(activity, "$origin/probe")
                    val root = activity.findViewById<ViewGroup>(android.R.id.content)
                    val webView = root.getChildAt(0) as WebView
                    webView.stopLoading()
                    webView.loadDataWithBaseURL("$origin/probe", html, "text/html", "UTF-8", null)
                }
                check(scenario)
            }
    }

    private fun clickNativeConsent(scenario: ActivityScenario<MainActivity>, allow: Boolean) {
        repeat(80) {
            var clicked = false
            scenario.onActivity { activity ->
                val field = MainActivity::class.java.getDeclaredField("pendingAiConsent")
                field.isAccessible = true
                val dialog = field.get(activity) as AlertDialog?
                if (dialog?.isShowing == true) {
                    dialog.getButton(if (allow) AlertDialog.BUTTON_POSITIVE
                        else AlertDialog.BUTTON_NEGATIVE).performClick()
                    clicked = true
                }
            }
            if (clicked) return
            SystemClock.sleep(150)
        }
        throw AssertionError("Native Android command consent was never shown")
    }

    private fun webCondition(scenario: ActivityScenario<MainActivity>,
                             expression: String): Boolean {
        val wait = CountDownLatch(1)
        val value = AtomicReference<String>()
        scenario.onActivity { activity ->
            val root = activity.findViewById<ViewGroup>(android.R.id.content)
            val webView = root.getChildAt(0) as WebView
            webView.evaluateJavascript(expression) {
                value.set(it)
                wait.countDown()
            }
        }
        assertTrue("Android WebView JavaScript did not respond", wait.await(5, TimeUnit.SECONDS))
        return value.get() == "true"
    }

    @Test
    fun approvedModelCommandReturnsActualAndroidShellOutputAndExitStatus() {
        val id = "webAgentApprovedCi"
        withWebTool(id, "printf 'SEVEN_AGENT_ANDROID_NATIVE_OK\\n'") { scenario ->
            clickNativeConsent(scenario, allow = true)
            var delivered = false
            repeat(110) {
                delivered = webCondition(scenario, """
                    (window.sevenEvents || []).some(e =>
                        e.type === 'ai-result' && e.requestId === '$id' &&
                        e.approved === true && e.exitCode === 0 &&
                        e.output.includes('SEVEN_AGENT_ANDROID_NATIVE_OK'))
                """.trimIndent())
                if (delivered) return@withWebTool
                SystemClock.sleep(150)
            }
            assertTrue("Approved Android agent command produced no real exit/output", delivered)
        }
    }

    @Test
    fun rejectedModelCommandMustNotRunOnAndroidDevice() {
        val id = "webAgentDeniedCi"
        withWebTool(id, "printf 'SEVEN_AGENT_MUST_NOT_RUN\\n'") { scenario ->
            clickNativeConsent(scenario, allow = false)
            var denied = false
            repeat(70) {
                denied = webCondition(scenario, """
                    (window.sevenEvents || []).some(e =>
                        e.type === 'ai-result' && e.requestId === '$id' &&
                        e.approved === false && e.exitCode == null &&
                        !(e.output || '').includes('SEVEN_AGENT_MUST_NOT_RUN'))
                """.trimIndent())
                if (denied) return@withWebTool
                SystemClock.sleep(150)
            }
            assertTrue("Denied command was not reported as rejected", denied)
            scenario.onActivity { activity ->
                val field = MainActivity::class.java.getDeclaredField("aiRunner")
                field.isAccessible = true
                assertTrue("Denied command must never allocate a shell runner",
                    field.get(activity) == null)
            }
        }
    }
}
