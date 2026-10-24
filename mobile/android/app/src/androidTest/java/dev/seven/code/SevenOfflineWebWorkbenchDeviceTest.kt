package dev.seven.code

import android.os.SystemClock
import android.graphics.Bitmap
import java.io.File
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import androidx.test.platform.app.InstrumentationRegistry
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
        // Thin host CI does not bundle the Web production assets. The offline
        // workflow separately verifies this archive is actually in its APK
        // before running this test, so a missing bundle cannot pass release.
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val bundled = try {
            context.assets.open("seven-web/bundle.json").use { true }
        } catch (_: java.io.IOException) {
            false
        }
        assumeTrue("Only bundled Web-APK runs this end-to-end test", bundled)
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
                            loading: !!document.getElementById('seven-code-loading'),
                            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
                            workbench: (() => { const r = document.querySelector('.monaco-workbench')?.getBoundingClientRect(); return r ? {x:r.x, y:r.y, width:r.width, height:r.height} : null; })(),
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
            // Visual proof: actual compositor pixels captured while the real
            // editor is on screen, not a mock HTML render or stock photo.
            // The CI retrieves this file from the app sandbox with adb run-as.
            SystemClock.sleep(1800)
            val pixels = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            assertTrue("Android emulator did not provide a screen capture", pixels != null)
            val screenshot = File(context.filesDir, "seven-code-portrait.png")
            screenshot.outputStream().use { output ->
                assertTrue("Could not encode emulator screen to PNG",
                    pixels!!.compress(Bitmap.CompressFormat.PNG, 100, output))
            }
            pixels!!.recycle()
            assertTrue("Captured screen is empty or truncated", screenshot.length() > 20_000L)

        }
    }
}
