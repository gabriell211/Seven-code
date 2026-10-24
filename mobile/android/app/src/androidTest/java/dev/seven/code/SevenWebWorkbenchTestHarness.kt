package dev.seven.code

/**
 * Instrumentation-only HTML harness for origin-scoped terminal tests.
 * No remote URL entry point is exposed by the production Activity.
 */
internal object SevenWebWorkbenchTestHarness {
    fun attach(activity: MainActivity, url: String) {
        val serverField = MainActivity::class.java.getDeclaredField("localServer")
        serverField.isAccessible = true
        (serverField.get(activity) as? SevenLocalCodeOssServer)?.stop()

        val open = MainActivity::class.java.getDeclaredMethod("openWorkbench", String::class.java)
        open.isAccessible = true
        open.invoke(activity, url)
    }
}
