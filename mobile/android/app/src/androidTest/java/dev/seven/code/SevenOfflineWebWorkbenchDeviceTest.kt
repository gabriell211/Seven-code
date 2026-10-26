package dev.seven.code

import android.os.SystemClock
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import java.io.File
import android.webkit.WebView
import android.os.Build
import android.view.WindowInsets
import android.content.Context
import android.view.inputmethod.InputMethodManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.text.InputType
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
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
            val screenshot = File(context.filesDir, "seven-code-portrait.png")
            var visualProof = false
            var lastDiagnostic = "No screenshot"
            for (captureAttempt in 0 until 5) {
                val pixels = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                if (pixels != null) {
                    try {
                        // A lossless PNG can legitimately be below 20 KiB on
                        // headless emulators. Reject empty/solid frames by
                        // inspecting actual compositor colors and dimensions.
                        val colors = HashSet<Int>()
                        val xStep = (pixels.width / 32).coerceAtLeast(1)
                        val yStep = (pixels.height / 32).coerceAtLeast(1)
                        for (y in pixels.height / 10 until pixels.height * 9 / 10 step yStep) {
                            for (x in pixels.width / 10 until pixels.width * 9 / 10 step xStep) {
                                colors.add(pixels.getPixel(x, y))
                            }
                        }
                        screenshot.outputStream().use { output ->
                            assertTrue("Could not encode emulator screen to PNG",
                                pixels.compress(Bitmap.CompressFormat.PNG, 100, output))
                        }
                        visualProof = pixels.width >= 320 && pixels.height >= 480 &&
                            colors.size >= 8 && screenshot.length() > 4_096L
                        lastDiagnostic = "dimensions=${pixels.width}x${pixels.height}; " +
                            "interiorColors=${colors.size}; pngBytes=${screenshot.length()}"
                    } finally {
                        pixels.recycle()
                    }
                }
                if (visualProof) break
                SystemClock.sleep(800)
            }
            assertTrue("Real Code OSS editor was not visibly painted on screen: $lastDiagnostic", visualProof)

        }
    }
    @Test
    fun rotatingAndroidDoesNotRestartCodeOssOrDestroyUnsavedEditorState() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val bundled = try {
            context.assets.open("seven-web/bundle.json").use { true }
        } catch (_: java.io.IOException) { false }
        assumeTrue("Rotation E2E requires the original bundled Code OSS", bundled)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val beforeActivity = AtomicReference<MainActivity>()
            val beforeWebView = AtomicReference<WebView>()
            var markerStored = false
            for (attempt in 0 until 80) {
                val done = CountDownLatch(1)
                val result = AtomicReference<String>("false")
                scenario.onActivity { activity ->
                    val web = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
                        .getChildAt(0) as? WebView
                    if (web == null) {
                        done.countDown()
                        return@onActivity
                    }
                    web.evaluateJavascript(
                        """(function() {
                            if (!document.querySelector('.monaco-workbench')) return false;
                            document.documentElement.dataset.sevenRotationProof = 'unsaved-editor-state-kept';
                            return true;
                        })()"""
                    ) {
                        if (it == "true") {
                            beforeActivity.set(activity)
                            beforeWebView.set(web)
                        }
                        result.set(it)
                        done.countDown()
                    }
                }
                if (done.await(4, TimeUnit.SECONDS) && result.get() == "true") {
                    markerStored = true
                    break
                }
                SystemClock.sleep(500)
            }
            assertTrue("Code OSS did not boot before screen rotation", markerStored)

            for (orientation in listOf(
                ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE,
                ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            )) {
                scenario.onActivity { activity ->
                    activity.requestedOrientation = orientation
                }
                val expected = if (orientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)
                    Configuration.ORIENTATION_LANDSCAPE else Configuration.ORIENTATION_PORTRAIT
                var preserved = false
                var diagnostic = "No configuration result"
                for (attempt in 0 until 50) {
                    val done = CountDownLatch(1)
                    val same = AtomicReference(false)
                    scenario.onActivity { activity ->
                        val web = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
                            .getChildAt(0) as? WebView
                        val orientationNow = activity.resources.configuration.orientation
                        if (web == null || activity !== beforeActivity.get() || web !== beforeWebView.get()) {
                            diagnostic = "Activity or Chromium WebView recreated"
                            done.countDown()
                            return@onActivity
                        }
                        if (orientationNow != expected) {
                            diagnostic = "Awaiting orientation " + expected + ", observed " + orientationNow
                            done.countDown()
                            return@onActivity
                        }
                        web.evaluateJavascript(
                            "document.documentElement.dataset.sevenRotationProof === 'unsaved-editor-state-kept' && !!document.querySelector('.monaco-workbench')"
                        ) {
                            same.set(it == "true")
                            diagnostic = "DOM marker preserved: " + it
                            done.countDown()
                        }
                    }
                    if (done.await(4, TimeUnit.SECONDS) && same.get()) {
                        preserved = true
                        break
                    }
                    SystemClock.sleep(350)
                }
                assertTrue("Code OSS restarted or lost live state when rotated: $diagnostic", preserved)
            }
        }
    }

    @Test
    fun androidSystemKeyboardOpensForRealFocusedWebViewTextarea() {
        // This is an on-emulator test of Chromium -> trusted WebMessageListener
        // -> Android InputMethodManager. It NEVER installs a custom keyboard.
        assumeTrue("IME window insets require Android R+", Build.VERSION.SDK_INT >= 30)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val bundled = try {
            context.assets.open("seven-web/bundle.json").use { true }
        } catch (_: java.io.IOException) { false }
        assumeTrue("Only the complete offline Web APK can prove IME end-to-end", bundled)
        val enabledImes = (context.getSystemService(Context.INPUT_METHOD_SERVICE)
            as InputMethodManager).enabledInputMethodList
        assumeTrue("Android emulator has no configured system keyboard", enabledImes.isNotEmpty())
        // Emulators have a virtual hardware keyboard by default, which can
        // prevent the Android IME from appearing even though the app is correct.
        // Enable the genuine Android IME for this device instrumentation.
        instrumentation.uiAutomation.executeShellCommand(
            "settings put secure show_ime_with_hard_keyboard 1"
        ).close()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var focused = false
            for (attempt in 0 until 70) {
                val done = CountDownLatch(1)
                val result = AtomicReference<String>("false")
                scenario.onActivity { activity ->
                    val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
                    val web = root.getChildAt(0) as? WebView
                    if (web == null) {
                        done.countDown()
                        return@onActivity
                    }
                    web.evaluateJavascript(
                        """(function(){
                            if (!document.querySelector('.monaco-workbench')) return false;
                            let input = document.getElementById('seven-ime-e2e');
                            if (!input) {
                                input = document.createElement('textarea');
                                input.id = 'seven-ime-e2e';
                                input.style.cssText =
                                  'position:fixed;top:calc(50% - 21px);left:calc(50% - 80px);' +
                                  'width:160px;height:42px;z-index:2147483647;opacity:1;' +
                                  'pointer-events:auto;background:#fff;color:#000;border:3px solid #087aca';
                                // Do not append to .monaco-workbench: it can have
                                // clipping/stacking contexts above the editor,
                                // especially after a landscape reflow. A true
                                // user touch must actually hit this textarea.
                                document.body.append(input);
                            }
                            return !!input && input.getBoundingClientRect().width > 0;
                        })()"""
                    ) {
                        result.set(it)
                        done.countDown()
                    }
                }
                if (done.await(5, TimeUnit.SECONDS) && result.get() == "true") {
                    focused = true
                    break
                }
                SystemClock.sleep(500)
            }
            assertTrue("The genuine Code OSS WebView did not render the IME test input", focused)
            // Android WebView may legally refuse to display a keyboard for
            // programmatic JS input.focus() without a real user gesture.
            // Simulate an actual finger tap on the visible textarea instead.
            // This proves the same path the user's Android keyboard uses.
            val tap = AtomicReference<Pair<Int, Int>?>(null)
            scenario.onActivity { activity ->
                val web = activity.findViewById<android.view.ViewGroup>(
                    android.R.id.content).getChildAt(0) as? WebView
                if (web != null) {
                    val position = IntArray(2)
                    web.getLocationOnScreen(position)
                    tap.set(Pair(position[0] + web.width / 2, position[1] + web.height / 2))
                }
            }
            val target = tap.get() ?: throw AssertionError(
                "No WebView center available for real user IME tap")
            assertTrue("Android could not tap the real editor field",
                UiDevice.getInstance(instrumentation).click(target.first, target.second))
            var keyboardVisible = false
            for (attempt in 0 until 35) {
                scenario.onActivity { activity ->
                    val insets = activity.window.decorView.rootWindowInsets
                    if (insets?.isVisible(WindowInsets.Type.ime()) == true) {
                        keyboardVisible = true
                    }
                }
                if (keyboardVisible) break
                SystemClock.sleep(500)
            }
            val focusDiagnostic = AtomicReference("unknown")
            val focusedInDom = AtomicReference(false)
            val diagnosticLatch = CountDownLatch(1)
            scenario.onActivity { activity ->
                val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
                val web = root.getChildAt(0) as? WebView
                val native = "nativeFocus=${web?.hasFocus()}, windowFocus=${web?.hasWindowFocus()}"
                if (web == null) {
                    focusDiagnostic.set(native + ", WebView missing")
                    diagnosticLatch.countDown()
                } else {
                    web.evaluateJavascript(
                        "document.activeElement?.id === 'seven-ime-e2e'"
                    ) { js ->
                        focusedInDom.set(js == "true")
                        focusDiagnostic.set(native + ", domTextareaFocus=" + js)
                        diagnosticLatch.countDown()
                    }
                }
            }
            diagnosticLatch.await(5, TimeUnit.SECONDS)
            assertTrue(
                "Real finger tap never focused the actual Code OSS HTML textarea: " +
                    focusDiagnostic.get(),
                focusedInDom.get()
            )
            assertTrue(
                "HTML textarea has real focus but the Android IME is not visible: " +
                    focusDiagnostic.get(),
                keyboardVisible
            )
            // Keyboard visibility does not imply its input reaches Chromium.
            // Commit through the actual WebView InputConnection, then read DOM.
            val connection = AtomicReference<InputConnection?>(null)
            val inputType = AtomicReference<Int>(InputType.TYPE_NULL)
            scenario.onActivity { activity ->
                val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
                val web = root.getChildAt(0) as? WebView
                val editorInfo = EditorInfo()
                connection.set(web?.onCreateInputConnection(editorInfo))
                inputType.set(editorInfo.inputType)
            }
            assertTrue("WebView has no editable Android InputConnection", connection.get() != null)
            assertTrue("WebView InputConnection is TYPE_NULL despite visible IME",
                inputType.get() != InputType.TYPE_NULL)
            assertTrue("IME failed to commit text to Chromium",
                connection.get()!!.commitText("SevenIME42", 1))
            var textArrived = false
            var lastValue = ""
            for (attempt in 0 until 30) {
                val done = CountDownLatch(1)
                val result = AtomicReference<String>("")
                scenario.onActivity { activity ->
                    val root = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
                    val web = root.getChildAt(0) as? WebView
                    if (web == null) {
                        done.countDown()
                        return@onActivity
                    }
                    web.evaluateJavascript("document.getElementById('seven-ime-e2e')?.value ?? ''") {
                        result.set(it)
                        done.countDown()
                    }
                }
                if (done.await(5, TimeUnit.SECONDS)) {
                    lastValue = result.get()
                    if (lastValue.contains("SevenIME42")) {
                        textArrived = true
                        break
                    }
                }
                SystemClock.sleep(200)
            }
            assertTrue("IME opened but text was not delivered to HTML input: $lastValue",
                textArrived)
        }
    }

}
