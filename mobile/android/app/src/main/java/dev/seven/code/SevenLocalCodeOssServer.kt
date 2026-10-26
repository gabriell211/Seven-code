package dev.seven.code

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.zip.ZipInputStream
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Opt-in Android self-hosted Code OSS runtime. This path is enabled ONLY if the
 * APK actually contains an Android-compatible server ZIP, SHA-256 manifest and
 * a Bionic ARM64 Node executable packaged as libnode.so.
 *
 * Never download an unknown binary or silently substitute a remote server.
 * The production Code OSS extension host must be built for Android/Bionic.
 */
internal class SevenLocalCodeOssServer(private val context: Context) {
    companion object {
        private const val ARCHIVE = "seven-local/server.zip"
        private const val DIGEST = "seven-local/server.sha256"
        private const val MAX_UNPACKED_BYTES = 2_000_000_000L
        private const val MAX_ARCHIVE_BYTES = 500_000_000L
        private const val MAX_FILE_COUNT = 90_000
    }

    private val root = File(context.filesDir, "seven-code-oss-local")
    private val node = File(context.applicationInfo.nativeLibraryDir, "libnode.so")
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var process: Process? = null
    @Volatile private var stopped = false
    @Volatile var localOrigin: String? = null
        private set

    /**
     * Persistent, token-free startup breadcrumbs for ACTUAL on-device debug.
     * The external emulator CI reads this file after an E2E failure. A green
     * APK build does not constitute successful server startup.
     */
    @Volatile private var lastBootPhase: String = "not-started"

    private fun bootPhase(value: String) {
        lastBootPhase = value
        if (!root.isDirectory) root.mkdirs()
        File(root, "startup-phase.txt").writeText(value)
    }

    /**
     * Do not overwrite the last useful bootstrap stage with a bare exception
     * type. CI needs the actual phase AND a sanitized failure reason to debug
     * signed original Code OSS startup without exposing loopback auth tokens.
     */
    private fun bootError(failure: Throwable) {
        val reason = (failure.message ?: "<no-message>")
            .replace(Regex("[a-fA-F0-9]{64}"), "[redacted-local-token]")
            .replace(Regex("(?i)(?:tkn|token|password)=[^&\\s]+"), "secret=[redacted]")
            .replace(Regex("[\\r\\n\\t]+"), " ")
            .take(260)
        bootPhase("failed-at:$lastBootPhase;type:${failure.javaClass.simpleName};reason:$reason")
    }

    /**
     * Privacy-preserving device diagnostics for the failure screen.
     * Copy only allowlisted phase/ABI/version/IPC and exit status; do not
     * expose full process logs, private workspace paths, GitHub credentials,
     * session cookies, Copilot prompts or the loopback connection token.
     * This is NOT an E2E success claim.
     */
    fun safeRuntimeDiagnostic(): String {
        fun boundedLog(name: String): String =
            runCatching {
                val file = File(root, name)
                if (!file.isFile || file.length() > 32_768L) "" else file.readText().take(2_048)
            }.getOrDefault("")

        val phase = boundedLog("startup-phase.txt")
        val stage = Regex("(?:failed-at:)?([A-Za-z][A-Za-z0-9._-]{0,100})")
            .find(phase)?.groupValues?.getOrNull(1) ?: "indisponível"
        val errorType = Regex("type:([A-Za-z]{1,50})")
            .find(phase)?.groupValues?.getOrNull(1) ?: "nenhum"
        val code = Regex("exit=(\\d{1,4})")
            .find(phase)?.groupValues?.getOrNull(1) ?: "não registrado"
        val platform = boundedLog("gnu-platform-probe.txt")
        val declaredAbi = Regex("primaryAbi=([A-Za-z0-9_-]{1,40})")
            .find(platform)?.groupValues?.getOrNull(1)
            ?: android.os.Build.SUPPORTED_ABIS.firstOrNull().orEmpty()
        val version = Regex("(?m)^v(\\d{1,3}\\.\\d{1,3}\\.\\d{1,4})(?:\\r?\\n|$)")
            .find(boundedLog("gnu-node-version-probe.log"))?.groupValues?.getOrNull(1)
        val ipcProof = boundedLog("gnu-node-fork-probe.log")
            .lineSequence().any { it.trim() == "SEVEN_GNU_FORK_IPC_OK" }
        val nativeAddonProof = runCatching {
            val evidence = File(context.filesDir, "seven-code-node-runtime-proof.json")
            val json = JSONObject(evidence.readText().take(4096))
            json.optBoolean("nodeForkOk", false) &&
                json.optBoolean("copilotNativeAddonLoaded", false)
        }.getOrDefault(false)
        return buildString {
            appendLine("Seven Code — diagnóstico GNU Node local (não é homologação)")
            appendLine("ABI principal: $declaredAbi")
            appendLine("Android API: ${android.os.Build.VERSION.SDK_INT}")
            appendLine("Processo 64-bit: ${android.os.Process.is64Bit()}")
            appendLine("Fase: $stage")
            appendLine("Tipo de falha: $errorType")
            appendLine("Código de saída: $code")
            appendLine("Node.js: ${if (version == null) "não detectado" else "v$version"}")
            appendLine("Fork/IPC real: ${if (ipcProof) "aprovado" else "não comprovado"}")
            appendLine("Addon Copilot nativo: ${if (nativeAddonProof) "carregado" else "não comprovado"}")
            append("Chat/Agent autenticados: não testados neste diagnóstico")
        }
    }

    /** Presence is not proof of a runnable server. Integrity/startup checks follow. */
    fun hasBundle(): Boolean = try {
        context.assets.open(ARCHIVE).use { }
        true
    } catch (_: java.io.IOException) {
        false
    }

    fun start(onComplete: (Result<String>) -> Unit) {
        stopped = false
        thread(name = "seven-code-oss-bootstrap", isDaemon = true) {
            val result = runCatching { startVerifiedLocalServer() }
            result.exceptionOrNull()?.let { bootError(it) }
            handler.post {
                if (!stopped) onComplete(result)
            }
        }
    }

    /**
     * A real Android process probe, not an ELF header or a Linux-runner smoke
     * test. Check the original GNU Node --version before launching Code OSS.
     * Failure means the app/runtime is still NOT release-eligible.
     */
    private fun probeGnuNode(launch: SevenLocalGnuRuntime.Launch) {
        bootPhase("probe-original-gnu-node-on-android")
        // Persist non-identifying ABI information for fail-closed physical
        // Android acceptance. An x86_64 bridge must never count as native.
        val primaryAbi = android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"
        File(root, "gnu-platform-probe.txt").writeText(
            "primaryAbi=$primaryAbi;is64Bit=${android.os.Process.is64Bit()};" +
                "sdk=${android.os.Build.VERSION.SDK_INT};loader=isolated-gnu"
        )
        val log = File(root, "gnu-node-version-probe.log")
        // stdout redirected to a file BEFORE waitFor(): a native linker or
        // Node crash can produce enough output to fill the OS pipe and hang.
        val probe = ProcessBuilder(launch.prefix + "--version")
            .directory(root)
            .redirectErrorStream(true)
            .redirectOutput(log)
        probe.environment().apply {
            put("LD_LIBRARY_PATH", launch.libraryPath)
            put("HOME", context.filesDir.absolutePath)
            put("SEVEN_ANDROID_NODE_PROOF_DIR", context.filesDir.absolutePath)
            put("TMPDIR", context.cacheDir.absolutePath)
            put("NODE_OPTIONS", "--require=${launch.bootstrap.absolutePath}")
        }
        val child = probe.start()
        val finished = child.waitFor(15, TimeUnit.SECONDS)
        if (!finished) {
            child.destroyForcibly()
            child.waitFor(3, TimeUnit.SECONDS)
            error("Original GNU Node --version excedeu 15 segundos no Android.")
        }
        val output = runCatching { log.readText().take(800) }.getOrDefault("")
            .replace(Regex("[a-fA-F0-9]{64}"), "[redacted-local-token]")
            .replace(Regex("[\\r\\n\\t]+"), " ").take(220)
        val exitCode = child.exitValue()
        check(exitCode == 0 && output.contains(Regex("v[0-9]+\\.[0-9]+"))) {
            val hint = if (exitCode == 159 || exitCode == 128 + 31) {
                "SIGSYS possível: consulte o buffer de crash Android para confirmar seccomp/syscall."
            } else if (exitCode == 137) {
                "Processo encerrado por SIGKILL; consulte o buffer de crash Android."
            } else "Verifique o linker GNU e as dependências ARM64."
            "Node GNU ARM64 não executou no Android: exit=$exitCode; $hint; output=$output"
        }
        bootPhase("original-gnu-node-runs-on-android")
        probeGnuNodeForkIpc(launch)
    }

    /**
     * A real child_process.fork() round trip, using exactly the same loader,
     * NODE_OPTIONS bootstrap and Node executable as the Code OSS server.
     * This runs on Android, not on the Linux CI host. A Node --version check
     * cannot prove the extension host can spawn child Node processes.
     */
    private fun probeGnuNodeForkIpc(launch: SevenLocalGnuRuntime.Launch) {
        bootPhase("probe-original-gnu-node-fork-ipc-on-android")
        val outputFile = File(root, "gnu-node-fork-probe.log")
        val probe = ProcessBuilder(launch.prefix + launch.forkProbe.absolutePath)
            .directory(root)
            .redirectErrorStream(true)
            .redirectOutput(outputFile)
        probe.environment().apply {
            put("LD_LIBRARY_PATH", launch.libraryPath)
            put("HOME", context.filesDir.absolutePath)
            put("TMPDIR", context.cacheDir.absolutePath)
            put("NODE_OPTIONS", "--require=${launch.bootstrap.absolutePath}")
        }
        val child = probe.start()
        if (!child.waitFor(12, TimeUnit.SECONDS)) {
            child.destroyForcibly()
            child.waitFor(3, TimeUnit.SECONDS)
            error("Fork/IPC do GNU Node não respondeu dentro de 12 segundos.")
        }
        val result = runCatching { outputFile.readText().take(1_000) }.getOrDefault("")
            .replace(Regex("[a-fA-F0-9]{64}"), "[redacted]")
            .replace(Regex("[\\r\\n\\t]+"), " ")
        check(child.exitValue() == 0 &&
            result.contains("SEVEN_GNU_FORK_IPC_OK")) {
            "GNU Node não conseguiu criar um processo filho com IPC: " +
                "exit=${child.exitValue()}, output=${result.take(200)}"
        }
        bootPhase("original-gnu-node-fork-ipc-verified")
    }

    private fun startVerifiedLocalServer(): String {
        bootPhase("verify-bundle")
        check(hasBundle()) { "Pacote Code OSS não está incluído neste APK." }
        check(android.os.Build.SUPPORTED_ABIS.contains("arm64-v8a")) {
            "O runtime local requer Android ARM64; este dispositivo usa outra arquitetura."
        }
        val gnuRuntime = SevenLocalGnuRuntime(context, root)
        val useGnu = gnuRuntime.hasBundle()
        if (!useGnu) {
            check(node.isFile && node.canExecute()) {
                "Node.js Bionic ARM64 não está incluído no APK."
            }
        }

        val expected = context.assets.open(DIGEST).bufferedReader().use { it.readText().trim() }
        check(expected.matches(Regex("[a-fA-F0-9]{64}"))) {
            "SHA-256 do pacote Code OSS está ausente ou inválido."
        }
        val manifest = File(root, "verified.sha256")
        val serverDir = File(root, "server")
        if (!(manifest.isFile && manifest.readText().trim().equals(expected, true)
                    && File(serverDir, "out/server-main.js").isFile)) {
            val staging = File(root, "staging")
            staging.deleteRecursively()
            check(staging.mkdirs()) { "Não foi possível preparar arquivos locais." }
            try {
                val digest = MessageDigest.getInstance("SHA-256")
                var archiveSize = 0L
                // Materialize the archive and hash the actual installed bytes before extraction.
                val zipFile = File(root, "incoming.zip")
                bootPhase("copy-codeoss-archive")
                context.assets.open(ARCHIVE).use { input ->
                    zipFile.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            archiveSize += n
                            check(archiveSize <= MAX_ARCHIVE_BYTES) { "Arquivo Code OSS grande demais." }
                            digest.update(buffer, 0, n)
                            output.write(buffer, 0, n)
                        }
                    }
                }
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                check(actual.equals(expected, true)) { "Pacote Code OSS falhou no SHA-256." }
                check(StatFs(context.filesDir.absolutePath).availableBytes > 1_000_000_000L) {
                    "Espaço insuficiente para instalar o Code OSS local."
                }
                bootPhase("extract-original-codeoss")
                FileInputStream(zipFile).use { extractVerifiedZip(it, staging) }
                check(File(staging, "out/server-main.js").isFile) {
                    "Pacote não contém o servidor original do Code OSS."
                }
                serverDir.deleteRecursively()
                check(staging.renameTo(serverDir)) { "Falha ao ativar o servidor local." }
                manifest.writeText(expected)
                zipFile.delete()
            } catch (error: Exception) {
                staging.deleteRecursively()
                File(root, "incoming.zip").delete()
                throw error
            }
        }

        val randomToken = ByteArray(32)
        SecureRandom().nextBytes(randomToken)
        val token = randomToken.joinToString("") { "%02x".format(it) }
        val port = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
        val url = "http://127.0.0.1:$port/?tkn=$token"
        // The GNU experiment uses a separate original Linux/AArch64 Node
        // process. It must NEVER dlopen glibc inside the Android/Bionic JVM.
        // Without the explicit GNU assets, the normal Bionic path is unchanged.
        bootPhase(if (useGnu) "verify-and-extract-gnu-runtime" else "verify-bionic-runtime")
        val gnuLaunch = if (useGnu) gnuRuntime.prepare(serverDir) else null
        bootPhase("native-runtime-verified")
        if (gnuLaunch != null) probeGnuNode(gnuLaunch)
        val nativeLibraryDirectory = if (gnuLaunch == null) unpackTermuxNativeLibraries() else null
        val log = File(root, "server.log")
        val expectedCommit = JSONObject(File(serverDir, "product.json").readText()).getString("commit")
        check(expectedCommit.matches(Regex("[a-f0-9]{40}"))) {
            "O servidor Code OSS local está sem revisão verificável."
        }

        // The library is packaged as a directly executable ELF (not a dlopen-only
        // libnode). It must be built for Android's linker and ship its dependencies.
        val command = (gnuLaunch?.prefix ?: listOf(node.absolutePath)) + listOf(
            File(serverDir, "out/server-main.js").absolutePath,
            "--host", "127.0.0.1", "--port", port.toString(),
            "--connection-token", token,
            "--server-data-dir", File(root, "data").absolutePath,
            "--user-data-dir", File(root, "user").absolutePath,
            "--accept-server-license-terms", "--telemetry-level", "off"
        )
        val env = ProcessBuilder(command)
            .directory(serverDir)
            .redirectErrorStream(true)
            .redirectOutput(log)
        env.environment().apply {
            put("HOME", context.filesDir.absolutePath)
            put("SEVEN_ANDROID_NODE_PROOF_DIR", context.filesDir.absolutePath)
            put("TMPDIR", context.cacheDir.absolutePath)
            put("XDG_CONFIG_HOME", File(root, "config").absolutePath)
            put("XDG_CACHE_HOME", File(root, "cache").absolutePath)
            if (gnuLaunch != null) {
                put("LD_LIBRARY_PATH", gnuLaunch.libraryPath)
                put("COPILOT_CLI_PATH", gnuLaunch.cliWrapper.absolutePath)
                // Inherit the same loader wrapper in every Code OSS Node
                // extension-host child spawned by child_process.fork().
                put("NODE_OPTIONS", "--require=${gnuLaunch.bootstrap.absolutePath}")
            } else {
                put("LD_LIBRARY_PATH", nativeLibraryDirectory!!.absolutePath + ":" +
                    context.applicationInfo.nativeLibraryDir)
            }
        }
        bootPhase("start-original-codeoss-process")
        val started = env.start()
        process = started
        bootPhase("await-real-server-auth-and-web-workbench")
        val deadline = System.nanoTime() + 90_000_000_000L
        while (!stopped && System.nanoTime() < deadline && started.isAlive) {
            // TCP alone is NOT proof: another process may bind the ephemeral
            // port between reservation and the Code OSS Node spawn.
            if (hasServerReadinessBanner(log, port) &&
                verifyAuthenticatedWorkbench(port, token, expectedCommit)) {
                localOrigin = "http://127.0.0.1:$port"
                bootPhase("authenticated-workbench-ready")
                return url
            }
            Thread.sleep(200)
        }
        val exit = if (started.isAlive) "timeout-while-alive" else {
            "exit=${runCatching { started.exitValue() }.getOrNull()}"
        }
        val tail = runCatching {
            if (log.isFile) log.readText().takeLast(600) else "<no-server-log>"
        }.getOrDefault("<unreadable-server-log>")
            .replace(Regex("[a-fA-F0-9]{64}"), "[redacted-local-token]")
            .replace(Regex("[\\r\\n\\t]+"), " ")
        stop()
        error("O servidor original do Code OSS não iniciou no Android ($exit): " + tail.take(350))
    }

    private fun unpackTermuxNativeLibraries(): File {
        val dest = File(root, "native-libs")
        val asset = "seven-local/native-libs.zip"
        check(dest.isDirectory || dest.mkdirs()) {
            "Não foi possível preparar bibliotecas Android/Bionic."
        }
        val manifest = JSONObject(context.assets.open("seven-local/termux-provenance.json")
            .bufferedReader().use { it.readText() })
        val expectedLibraries = manifest.getJSONObject("libraries")
        val found = HashSet<String>()
        var bytes = 0L
        var files = 0
        context.assets.open(asset).use { input ->
            ZipInputStream(input).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val name = entry.name
                    check(!entry.isDirectory &&
                        name.matches(Regex("[A-Za-z0-9._+\\-]{1,255}")) &&
                        name.contains(".so") &&
                        expectedLibraries.has(name) && found.add(name)) {
                        "Biblioteca Bionic inesperada ou duplicada."
                    }
                    files++
                    check(files <= 128) { "Bibliotecas Android demais." }
                    val outputFile = File(dest, name)
                    val digest = MessageDigest.getInstance("SHA-256")
                    outputFile.outputStream().use { output ->
                        val buffer = ByteArray(32 * 1024)
                        while (true) {
                            val count = zip.read(buffer)
                            if (count < 0) break
                            bytes += count
                            check(bytes <= 256_000_000L) {
                                "Bibliotecas Android grandes demais."
                            }
                            digest.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                        }
                    }
                    val actual = digest.digest().joinToString("") { "%02x".format(it) }
                    check(actual.equals(expectedLibraries.getString(name), true)) {
                        "SHA-256 de biblioteca Android inválido: $name"
                    }
                    zip.closeEntry()
                }
            }
        }
        check(found.size == expectedLibraries.length()) {
            "O APK não contém todas as bibliotecas exigidas pelo Node Android."
        }
        return dest
    }

    private fun hasServerReadinessBanner(log: File, port: Int): Boolean {
        if (!log.isFile) return false
        return try {
            RandomAccessFile(log, "r").use { handle ->
                val length = minOf(handle.length(), 16_384L).toInt()
                if (length == 0) return false
                handle.seek(handle.length() - length)
                val bytes = ByteArray(length)
                handle.readFully(bytes)
                String(bytes, Charsets.UTF_8)
                    .contains("Web UI available at http://localhost:$port")
            }
        } catch (_: java.io.IOException) {
            false
        }
    }

    private fun readLimited(url: URL, cookie: String? = null): String? {
        val connection = url.openConnection() as HttpURLConnection
        return try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 700
            connection.readTimeout = 1500
            if (cookie != null) connection.setRequestProperty("Cookie", cookie)
            if (connection.responseCode != 200) return null
            connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                val text = StringBuilder()
                val buffer = CharArray(4096)
                while (text.length < 262_144) {
                    val n = reader.read(buffer, 0, minOf(buffer.size, 262_144 - text.length))
                    if (n < 0) break
                    text.append(buffer, 0, n)
                }
                text.toString()
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun verifyAuthenticatedWorkbench(port: Int, token: String, commit: String): Boolean {
        return try {
            val origin = "http://127.0.0.1:$port"
            val version = readLimited(URL("$origin/version"))
            if (version?.trim() != commit) return false
            val page = readLimited(URL("$origin/"), "vscode-tkn=$token")
            page?.contains("vscode-workbench-web-configuration") == true
        } catch (_: Exception) {
            false
        }
    }

    private fun extractVerifiedZip(source: FileInputStream, destination: File) {
        val base = destination.canonicalPath + File.separator
        var total = 0L
        var count = 0
        ZipInputStream(source).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                count++
                check(count <= MAX_FILE_COUNT) { "Pacote Code OSS tem arquivos demais." }
                check(!entry.name.contains('\\') && !entry.name.startsWith('/')) {
                    "Caminho inválido no pacote Code OSS."
                }
                val target = File(destination, entry.name)
                check(target.canonicalPath.startsWith(base)) { "Caminho de extração não permitido." }
                if (entry.isDirectory) {
                    check(target.isDirectory || target.mkdirs()) { "Falha ao criar diretório." }
                } else {
                    check(target.parentFile?.isDirectory == true || target.parentFile?.mkdirs() == true) {
                        "Falha ao criar diretórios do servidor."
                    }
                    target.outputStream().use { output ->
                        val buffer = ByteArray(32 * 1024)
                        while (true) {
                            val n = zip.read(buffer)
                            if (n < 0) break
                            total += n
                            check(total <= MAX_UNPACKED_BYTES) { "Pacote Code OSS excede tamanho seguro." }
                            output.write(buffer, 0, n)
                        }
                    }
                }
                zip.closeEntry()
            }
        }
    }

    fun stop() {
        stopped = true
        localOrigin = null
        process?.destroy()
        process = null
    }
}
