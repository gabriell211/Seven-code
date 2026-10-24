package dev.seven.code

import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A remote-only APK must never promote an arbitrary HTTP URL into a native
 * terminal-capable origin. The self-hosting path is opt-in only for a verified
 * local Code OSS bundle with a running Node process.
 */
@RunWith(AndroidJUnit4::class)
class SevenLocalRuntimeDeviceTest {
    @Test
    fun developerApkDoesNotPretendToContainCodeOssRuntime() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertFalse(SevenLocalCodeOssServer(activity).hasBundle())
                val parse = MainActivity::class.java.getDeclaredMethod("parseWorkbenchUrl", String::class.java)
                parse.isAccessible = true
                assertNull(parse.invoke(activity, "http://127.0.0.1:8080/?tkn=unauthorized"))
                assertNull(parse.invoke(activity, "http://localhost:8080"))
                assertNull(parse.invoke(activity, "http://example.com"))
                assertTrue(safeExternalHttpsTarget(Uri.parse("https://github.com/login")))
            }
        }
    }
}
