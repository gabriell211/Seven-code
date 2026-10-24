package dev.seven.code

import android.app.AlertDialog
import android.os.SystemClock
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Genuine Android WebView -> origin-scoped WebMessageListener -> user approval
 * -> JNI shell -> evaluateJavascript callback. The page is a local protocol
 * harness (NOT the full Code OSS editor or actual GitHub Copilot login).
 */
@RunWith(AndroidJUnit4::class)
class SevenWebViewNativeBridgeTest {
    private val origin = "https://appassets.androidplatform.net"

    private fun withBridgePage(
        session: String,
        onActivity: (ActivityScenario<MainActivity>) -> Unit
    ) {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                val page = """
                    <!doctype html><meta charset="utf-8">
                    <script>
                    window.sevenEvents = [];
                    window.sevenNativeEvent = event => {
                        window.sevenEvents.push(event);
                        if (event.type === "ready" && event.sessionId === "$session") {
                            const command = "printf 'SEVEN_%s_PTY_OK\\n' WEBVIEW\n";
                            const data = btoa(command);
                            SevenTerminalNative.postMessage(JSON.stringify({
                                type: "input", sessionId: "$session", data
                            }));
                        }
                    };
                    SevenTerminalNative.postMessage(JSON.stringify({
                        type: "start", sessionId: "$session", cols: 80, rows: 24
                    }));
                    </script>
                """.trimIndent()
                scenario.onActivity { activity ->
                    SevenWebWorkbenchTestHarness.attach(activity, origin + "/probe")
                    val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
                    val web = root.getChildAt(0) as WebView
                    web.stopLoading()
                    web.loadDataWithBaseURL(origin + "/probe", page, "text/html", "UTF-8", null)
                }
                onActivity(scenario)
            }
    }

    private fun waitForApproval(scenario: ActivityScenario<MainActivity>, approve: Boolean) {
        var clicked = false
        repeat(60) {
            scenario.onActivity { activity ->
                val field = MainActivity::class.java.getDeclaredField("pendingSessions")
                field.isAccessible = true
                @Suppress("UNCHECKED_CAST")
                val pending = field.get(activity) as Map<String, AlertDialog>
                val dialog = pending.values.firstOrNull()
                if (dialog?.isShowing == true) {
                    dialog.getButton(if (approve) AlertDialog.BUTTON_POSITIVE else AlertDialog.BUTTON_NEGATIVE)
                        .performClick()
                    clicked = true
                }
            }
            if (clicked) return
            SystemClock.sleep(150)
        }
        throw AssertionError("Native terminal approval dialog was never displayed")
    }

    private fun javascriptBoolean(scenario: ActivityScenario<MainActivity>, expression: String): Boolean {
        val latch = CountDownLatch(1)
        val response = AtomicReference<String>()
        scenario.onActivity { activity ->
            val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
            val web = root.getChildAt(0) as WebView
            web.evaluateJavascript(expression) { value ->
                response.set(value)
                latch.countDown()
            }
        }
        assertTrue("Browser JavaScript evaluation timed out", latch.await(4, TimeUnit.SECONDS))
        return response.get() == "true"
    }

    private fun browserEventSnapshot(scenario: ActivityScenario<MainActivity>): String {
        val latch = CountDownLatch(1)
        val response = AtomicReference("No JavaScript result")
        scenario.onActivity { activity ->
            val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
            val web = root.getChildAt(0) as WebView
            web.evaluateJavascript("JSON.stringify(window.sevenEvents || [])") { value ->
                response.set(value)
                latch.countDown()
            }
        }
        if (!latch.await(4, TimeUnit.SECONDS)) return "JavaScript callback timed out"
        return response.get()
    }

    @Test
    fun userApprovedCommandFlowsFromRealWebViewToNativePtyAndBack() {
        withBridgePage("bridgeApproved01") { scenario ->
            waitForApproval(scenario, approve = true)
            var received = false
            repeat(70) {
                received = javascriptBoolean(scenario, """
                    (window.sevenEvents || []).some(e =>
                        e.type === 'data' && e.sessionId === 'bridgeApproved01' &&
                        atob(e.value || '').includes('SEVEN_WEBVIEW_PTY_OK'))
                """.trimIndent())
                if (received) return@withBridgePage
                SystemClock.sleep(150)
            }
            assertTrue("No actual JNI PTY output returned via the WebView callback", received)
        }
    }

    @Test
    fun deniedWebViewTerminalCannotRunQueuedCommands() {
        withBridgePage("bridgeDenied01") { scenario ->
            waitForApproval(scenario, approve = false)
            var denied = false
            repeat(45) {
                denied = javascriptBoolean(scenario, """
                    (window.sevenEvents || []).some(e =>
                        e.type === 'exit' && e.sessionId === 'bridgeDenied01') &&
                    !(window.sevenEvents || []).some(e =>
                        e.type === 'ready' && e.sessionId === 'bridgeDenied01')
                """.trimIndent())
                if (denied) return@withBridgePage
                SystemClock.sleep(120)
            }
            assertTrue(
                "Denied native terminal must exit before reporting ready; events: " +
                    browserEventSnapshot(scenario),
                denied
            )
        }
    }
}
