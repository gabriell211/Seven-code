package dev.seven.code

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
 * Real Android WebView test of the bundled original Code OSS Web workbench.
 * Do not replace this with an HTML mock or treat a successful APK build as E2E.
 */
@RunWith(AndroidJUnit4::class)
class SevenOfflineWebWorkbenchDeviceTest {
    @Test
    fun originalEditorActuallyStartsWithoutNodeOrRemoteUrl() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var booted = false
            var lastPage = "No web page"
            for (attempt in 0 until 90) {
                val latch = CountDownLatch(1)
                val snapshot = AtomicReference<String>("")
                scenario.onActivity { activity ->
                    val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
                    val web = root.getChildAt(0) as? WebView
                    if (web == null) {
                        latch.countDown()
                        return@onActivity
                    }
                    web.evaluateJavascript(
                        """JSON.stringify({
                            origin: location.origin,
                            editor: !!document.querySelector('.monaco-workbench'),
                            loading: !!document.getElementById('vscode-startup-fallback'),
                            title: document.title,
                            text: document.body?.innerText?.slice(0, 180)
                        })"""
                    ) {
                        snapshot.set(it)
                        latch.countDown()
                    }
                }
                if (latch.await(5, TimeUnit.SECONDS)) {
                    lastPage = snapshot.get()
                    if (lastPage.contains("\\\"editor\\\":true") &&
                        lastPage.contains("appassets.androidplatform.net") &&
                        lastPage.contains("\\\"loading\\\":false")) {
                        booted = true
                        break
                    }
                }
                SystemClock.sleep(1000)
            }
            assertTrue(
                "Real bundled Code OSS editor did not boot in Android WebView: $lastPage",
                booted
            )
        }
    }
}
