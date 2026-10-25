package dev.seven.code

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Offline transport fixture; does not authenticate a real GitHub account. */
@RunWith(AndroidJUnit4::class)
class SevenGitHubDeviceFlowTest {
    private val clientId = "01ab8ac9400c4e429b23"
    private val deviceCode = "1234567890abcdef1234567890abcdef12345678"

    private fun request(op: String, code: String = "") = JSONObject()
        .put("type", "github-device-request")
        .put("requestId", "fixture01")
        .put("clientId", clientId)
        .put("op", op)
        .put("scope", "read:user user:email")
        .put("deviceCode", code)

    @Test fun nativeDeviceFlowStartsPollsAndReturnsOnlyOfficialReplies() {
        val calls = mutableListOf<String>()
        val flow = SevenGitHubDeviceFlow { path, form ->
            calls.add(path + ":" + form)
            if (path == "/login/device/code") JSONObject()
                .put("device_code", deviceCode)
                .put("user_code", "ABCD-EFGH")
                .put("verification_uri", "https://github.com/login/device")
                .put("interval", 1).put("expires_in", 900).toString()
            else JSONObject().put("access_token", "FAKE_TEST_ONLY")
                .put("token_type", "bearer").toString()
        }
        val start = flow.process(request("begin"))
        assertEquals("github-device-result", start.getString("type"))
        assertEquals(200, start.getInt("status"))
        assertEquals(deviceCode, start.getJSONObject("body").getString("device_code"))
        assertEquals(1, calls.size)
        val unauthorized = flow.process(request("poll", "unknown-device-code-do-not-use"))
        assertEquals("invalid_device_code", unauthorized.getJSONObject("body").getString("error"))
        assertEquals(1, calls.size)
        // Native rate limit rejects early polls without contacting GitHub.
        val early = flow.process(request("poll", deviceCode))
        assertEquals("authorization_pending", early.getJSONObject("body").getString("error"))
        assertEquals(1, calls.size)
        Thread.sleep(1150)
        val completed = flow.process(request("poll", deviceCode))
        assertEquals("FAKE_TEST_ONLY", completed.getJSONObject("body").getString("access_token"))
        assertEquals(2, calls.size)
        assertTrue(calls[1].startsWith("/login/oauth/access_token:"))
        // A successful device grant cannot be replayed.
        assertEquals("invalid_device_code",
            flow.process(request("poll", deviceCode)).getJSONObject("body").getString("error"))
        assertEquals(2, calls.size)
    }

    @Test fun rejectsUnexpectedOperationsAndNeverLeaksTransportExceptions() {
        val flow = SevenGitHubDeviceFlow { _, _ -> throw Exception("SECRET_INTERNAL_TRANSPORT") }
        val unsupported = flow.process(request("delete"))
        assertEquals("unsupported_operation", unsupported.getJSONObject("body").getString("error"))
        val invalidClient = request("begin").put("clientId", "https://attacker.invalid/")
        assertEquals("android_github_device_flow_failed",
            flow.process(invalidClient).getJSONObject("body").getString("error"))
        val result = flow.process(request("begin"))
        assertFalse(result.toString().contains("SECRET_INTERNAL_TRANSPORT"))
        assertEquals("android_github_device_flow_failed",
            result.getJSONObject("body").getString("error"))
    }
}
