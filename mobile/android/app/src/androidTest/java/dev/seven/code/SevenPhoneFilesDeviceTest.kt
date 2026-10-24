package dev.seven.code

import android.app.Activity
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.regex.Pattern

/**
 * Instrumented Android 35 SAF acceptance: use the ACTUAL platform DocumentsUI
 * and the local external-storage DocumentsProvider, then verify bytes persisted
 * on shared phone storage. The emulator script pre-creates Documents/SevenCodeCi.
 * This is not an in-memory fake DocumentsProvider.
 */
@RunWith(AndroidJUnit4::class)
class SevenPhoneFilesDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext

    private fun operation(docs: SevenMobileDocuments, requestId: String, op: String,
                          path: String = "/", extra: (JSONObject) -> Unit = {}): JSONObject {
        val input = JSONObject().put("requestId", requestId).put("op", op).put("path", path)
        extra(input)
        val response = docs.process(input)
        assertTrue("Android SAF $op failed: $response", response.optBoolean("ok"))
        return response.getJSONObject("value")
    }

    @Test
    fun selectedPhoneFolderPersistsProjectFilesThroughAndroidDocumentsProvider() {
        val name = "seven-" + UUID.randomUUID().toString().substring(0, 12) + ".txt"
        val renamed = name.replace(".txt", "-moved.txt")
        val payload = ("Seven Code Android • projeto local: café 🎉\n").repeat(95)
        val initial = DocumentsContract.buildDocumentUri(
            "com.android.externalstorage.documents", "primary:Documents/SevenCodeCi"
        )
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val field = MainActivity::class.java.getDeclaredField("mobileDocuments")
                field.isAccessible = true
                val documents = field.get(activity) as SevenMobileDocuments
                documents.beginSelection("safPickerCi", initial)
            }
            val device = UiDevice.getInstance(instrumentation)
            val use = device.wait(
                Until.findObject(By.text(Pattern.compile("(?i).*use this folder.*"))), 25_000
            ) ?: device.wait(Until.findObject(
                By.res("com.google.android.documentsui:id/action_menu_select")), 5_000
            ) ?: device.wait(Until.findObject(
                By.res("com.android.documentsui:id/action_menu_select")), 5_000)
            assertNotNull("Android did not show the DocumentsUI folder confirmation", use)
            use!!.click()
            val allow = device.wait(
                Until.findObject(By.text(Pattern.compile("(?i)^allow$"))), 15_000
            )
            assertNotNull("Android did not offer persisted SAF read/write permission", allow)
            allow!!.click()

            var persisted: String? = null
            for (attempt in 0 until 60) {
                persisted = context.getSharedPreferences("seven-mobile-documents", 0)
                    .getString("tree-uri", null)
                if (persisted?.contains("SevenCodeCi") == true) break
                Thread.sleep(200)
            }
            assertTrue("Activity did not persist the selected local phone folder: $persisted",
                persisted?.contains("SevenCodeCi") == true)

            // A new provider instance must read the selection from persisted
            // preferences and the platform ContentResolver permission store.
            var docs: SevenMobileDocuments? = null
            scenario.onActivity { docs = SevenMobileDocuments(it) }
            val provider = docs!!
            val selected = operation(provider, "statusCi", "status")
            assertEquals("SevenCodeCi", selected.getString("folder"))
            operation(provider, "beginCi", "write-begin", "/$name")
            val bytes = payload.toByteArray(StandardCharsets.UTF_8)
            operation(provider, "beginCi", "write-chunk", "/$name") {
                it.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            }
            operation(provider, "beginCi", "write-commit", "/$name")
            val meta = operation(provider, "statCi", "stat", "/$name")
            assertEquals(bytes.size.toLong(), meta.getLong("size"))

            val stored = operation(provider, "readCi", "read", "/$name") {
                it.put("offset", 0).put("length", 32768)
            }
            assertEquals(payload, String(
                Base64.decode(stored.getString("data"), Base64.NO_WRAP),
                StandardCharsets.UTF_8
            ))
            assertTrue("File should be visible in Android DocumentsProvider",
                operation(provider, "listCi", "list").getJSONArray("entries").toString()
                    .contains(name))

            operation(provider, "renameCi", "rename", "/$name") {
                it.put("target", "/$renamed")
            }
            assertEquals(bytes.size.toLong(),
                operation(provider, "statMovedCi", "stat", "/$renamed").getLong("size"))
            operation(provider, "deleteCi", "delete", "/$renamed")

            // Selection remains valid after the main Android activity recreates.
            scenario.recreate()
            var restored: SevenMobileDocuments? = null
            scenario.onActivity { restored = SevenMobileDocuments(it) }
            assertEquals("SevenCodeCi",
                operation(restored!!, "statusRestoredCi", "status").getString("folder"))
        }
    }
}
