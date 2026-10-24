package dev.seven.code

import android.content.Context
import android.net.Uri
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.seven.code.terminal.SevenPty
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Runs against a real Android system image, not a mocked JNI implementation.
 * A green build alone is insufficient: this test must spawn /system/bin/sh,
 * exchange bytes with the native PTY, and resize the real terminal.
 */
@RunWith(AndroidJUnit4::class)
class SevenPtyDeviceTest {
    @Test
    fun oauthPopupLinksCannotEscapeToInsecureOrEmbeddedCredentialUrls() {
        assertTrue(safeExternalHttpsTarget(Uri.parse("https://github.com/login/device")))
        assertTrue(safeExternalHttpsTarget(Uri.parse("https://login.microsoftonline.com/common/oauth2/authorize")))
        assertFalse(safeExternalHttpsTarget(Uri.parse("http://github.com/login/device")))
        assertFalse(safeExternalHttpsTarget(Uri.parse("javascript:alert(1)")))
        assertFalse(safeExternalHttpsTarget(Uri.parse("file:///sdcard/Downloads/token")))
        assertFalse(safeExternalHttpsTarget(Uri.parse("https://user:pass@github.com/login/device")))
        assertFalse(safeExternalHttpsTarget(Uri.parse("https://bad..example.com/login")))
    }

    @Test
    fun appStartsAndRejectsNonHttpsWorkbench() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE)
            .edit().remove("workbenchUrl").commit()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val root = activity.findViewById<ViewGroup>(android.R.id.content)
                val layout = root.getChildAt(0) as LinearLayout
                val widgets = (0 until layout.childCount).map { layout.getChildAt(it) }
                val field = widgets.filterIsInstance<EditText>().single()
                val button = widgets.filterIsInstance<Button>().single()
                field.setText("http://unsafe.example")
                button.performClick()
                assertTrue("HTTP workbench must be rejected", field.error != null)
            }
        }
    }

    @Test
    fun nativePtyRunsShellCommandAndStreamsOutput() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val signal = CountDownLatch(1)
        val received = StringBuilder()
        val failure = AtomicReference<String?>(null)
        val expected = "SEVEN_DEVICE_PTY_OK"
        val pty = SevenPty(
            context,
            onData = { data ->
                synchronized(received) {
                    received.append(String(data, StandardCharsets.UTF_8))
                    if (received.contains(expected)) signal.countDown()
                }
            },
            onError = { failure.set(it.message); signal.countDown() },
            onExit = { if (signal.count > 0) signal.countDown() }
        )
        try {
            pty.start(80, 24)
            pty.resize(100, 32)
            pty.write("printf 'SEVEN_%s_PTY_OK\\n' DEVICE\n".toByteArray(StandardCharsets.UTF_8))
            assertTrue("Shell did not return the marker within 20 seconds", signal.await(20, TimeUnit.SECONDS))
            assertTrue("PTY error: " + failure.get(), failure.get() == null)
            assertTrue("Missing real PTY output", synchronized(received) { received.contains(expected) })
        } finally {
            pty.close()
        }
    }


    @Test
    fun nativeAiCommandRunnerReportsRealOutputAndExitStatus() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val completed = CountDownLatch(1)
        val result = AtomicReference<AiTerminalResult>()
        val runner = SevenAiCommandRunner(
            context,
            onComplete = { response -> result.set(response); completed.countDown() }
        )
        try {
            runner.execute("printf 'SEVEN_AI_NATIVE_OK\\n'", 20_000)
            assertTrue("AI PTY command timed out", completed.await(30, TimeUnit.SECONDS))
            val response = result.get() ?: throw AssertionError("Missing native command result")
            assertNull("Native command failed: " + response.error, response.error)
            assertEquals("Wrong shell exit code", 0, response.exitCode)
            assertTrue("Missing shell stdout", response.output.contains("SEVEN_AI_NATIVE_OK"))
        } finally {
            runner.cancel()
        }
    }

    @Test
    fun terminalRejectsWorkspaceOutsideAppSandbox() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val pty = SevenPty(context, {}, {}, {})
        try {
            var rejected = false
            try {
                pty.start(80, 24, java.io.File("/system"))
            } catch (error: IllegalArgumentException) {
                rejected = true
            }
            assertTrue("PTY must not escape Android sandbox", rejected)
        } finally {
            pty.close()
        }
    }
}
