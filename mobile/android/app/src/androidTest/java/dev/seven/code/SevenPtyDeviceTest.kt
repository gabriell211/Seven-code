package dev.seven.code

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.seven.code.terminal.SevenPty
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
            pty.write("printf 'SEVEN_DEVICE_PTY_OK\\n'\n".toByteArray(StandardCharsets.UTF_8))
            assertTrue("Shell did not return the marker within 20 seconds", signal.await(20, TimeUnit.SECONDS))
            assertTrue("PTY error: " + failure.get(), failure.get() == null)
            assertTrue("Missing real PTY output", synchronized(received) { received.contains(expected) })
        } finally {
            pty.close()
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
