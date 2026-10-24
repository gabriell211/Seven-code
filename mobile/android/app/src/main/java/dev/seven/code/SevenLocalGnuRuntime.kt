package dev.seven.code

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipInputStream
import java.util.zip.ZipFile

/**
 * Experimental Android ARM64 path for running the ORIGINAL GNU/Linux Code OSS
 * Node extension host in a separate process. This preserves the unmodified
 * Copilot native modules; it never dlopens glibc from the Android/Bionic process.
 *
 * A working Linux/AArch64 test is NOT Android certification. The GNU branch is
 * used only when its complete, digest-pinned assets are present in the APK.
 * Production/release E2E still blocks publication until this runs on-device.
 */
internal class SevenLocalGnuRuntime(
    private val context: Context,
    private val root: File
) {
    data class Launch(
        val prefix: List<String>,
        val libraryPath: String,
        val cliWrapper: File,
        val bootstrap: File
    )

    private val nativeDir = File(context.applicationInfo.nativeLibraryDir)
    private val maximumExecutableBytes = 125_000_000L

    /**
     * Android chooses the primary ABI when extracting lib/ to nativeLibraryDir.
     * On an x86_64 emulator with an ARM64 native bridge, the standalone APK
     * still contains our ARM64 GNU executables but PackageManager extracts
     * only the x86_64 JNI libraries. Source them from the *signed APK itself*,
     * never the network, and verify exactly the original binary digest.
     *
     * The experimental APK temporarily targets SDK 28. Executable files
     * inside app-private storage are not supported as a production solution
     * on modern Android targets and remain subject to real-device acceptance.
     */
    private fun verifiedExecutable(name: String, digest: String): File {
        check(name in setOf("libseven-gnu-loader.so", "libseven-gnu-node.so")) {
            "Nome de executável GNU inesperado."
        }
        check(digest.matches(Regex("[a-fA-F0-9]{64}"))) {
            "SHA-256 do executável GNU é inválido."
        }
        val native = File(nativeDir, name)
        if (native.isFile && native.canExecute() && hash(native).equals(digest, true)) {
            return native
        }
        val destinationDir = File(root, "gnu-executables")
        check(destinationDir.isDirectory || destinationDir.mkdirs()) {
            "Falha ao preparar a pasta privada GNU."
        }
        val target = File(destinationDir, name)
        if (target.isFile && target.canExecute() && hash(target).equals(digest, true)) {
            return target
        }
        val stage = File(destinationDir, "$name.partial")
        stage.delete()
        try {
            ZipFile(context.applicationInfo.sourceDir).use { apk ->
                val entry = apk.getEntry("lib/arm64-v8a/$name")
                    ?: error("O APK instalado não contém o executável GNU ARM64: $name")
                check(!entry.isDirectory && entry.size in 1..maximumExecutableBytes) {
                    "Tamanho inesperado do executável GNU ARM64: $name"
                }
                apk.getInputStream(entry).use { input ->
                    stage.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var bytes = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            bytes += read
                            check(bytes <= maximumExecutableBytes) {
                                "O executável GNU excede o limite de segurança."
                            }
                            output.write(buffer, 0, read)
                        }
                    }
                }
            }
            check(hash(stage).equals(digest, true)) {
                "O executável GNU extraído não corresponde ao SHA-256 do APK: $name"
            }
            check(stage.setExecutable(true, true)) {
                "O sistema Android recusou permissão de execução ao binário GNU."
            }
            target.delete()
            check(stage.renameTo(target) && target.canExecute()) {
                "Falha ao ativar o executável GNU verificado."
            }
            return target
        } finally {
            stage.delete()
        }
    }

    fun hasBundle(): Boolean = try {
        context.assets.open("seven-local/gnu-manifest.json").use { }
        context.assets.open("seven-local/gnu-libs.zip").use { }
        true
    } catch (_: java.io.IOException) {
        false
    }

    private fun hash(file: File): String {
        val sha = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buf)
                if (count < 0) break
                sha.update(buf, 0, count)
            }
        }
        return sha.digest().joinToString("") { "%02x".format(it) }
    }

    private fun quote(value: String): String {
        return "'" + value.replace("'", "'\\''") + "'"
    }

    fun prepare(serverDir: File): Launch {
        check(hasBundle()) { "O APK não contém o runtime GNU completo." }
        val manifest = JSONObject(context.assets.open("seven-local/gnu-manifest.json")
            .bufferedReader().use { it.readText() })
        check(manifest.getString("mode") == "research-only-gnu-aarch64-separate-process" &&
            !manifest.getBoolean("androidVerified") &&
            !manifest.getBoolean("releaseEligible")) {
            "O manifesto do runtime GNU não corresponde aos artefatos de pesquisa esperados."
        }
        check(android.os.Build.SUPPORTED_ABIS.contains("arm64-v8a")) {
            "O runtime GNU exige ARM64."
        }
        val loader = verifiedExecutable("libseven-gnu-loader.so", manifest.getString("loaderSha256"))
        val node = verifiedExecutable("libseven-gnu-node.so", manifest.getString("nodeSha256"))

        val original = manifest.getJSONObject("originalCopilotElf")
        check(original.length() == 4) { "Os quatro componentes Copilot originais são obrigatórios." }
        val paths = original.keys()
        while (paths.hasNext()) {
            val relative = paths.next()
            check(!relative.startsWith("/") && !relative.contains("..") &&
                !relative.contains('\\')) { "Caminho Copilot inválido." }
            val binary = File(serverDir, relative)
            check(binary.isFile && hash(binary).equals(original.getString(relative), true)) {
                "Um componente original do Copilot está ausente ou alterado: $relative"
            }
        }

        val libraries = manifest.getJSONObject("libraries")
        val destination = File(root, "gnu-libs")
        val staging = File(root, "gnu-libs-staging")
        staging.deleteRecursively()
        check(staging.mkdirs()) { "Falha ao preparar as bibliotecas GNU locais." }
        var bytes = 0L
        val found = HashSet<String>()
        try {
            context.assets.open("seven-local/gnu-libs.zip").use { input ->
                ZipInputStream(input).use { zip ->
                    while (true) {
                        val entry = zip.nextEntry ?: break
                        val name = entry.name
                        check(!entry.isDirectory && name.matches(Regex("[A-Za-z0-9._+\\-]{1,140}")) &&
                            name.contains(".so") && libraries.has(name) && found.add(name)) {
                            "Biblioteca GNU inesperada, duplicada ou com caminho inválido: $name"
                        }
                        val target = File(staging, name)
                        target.outputStream().use { output ->
                            val block = ByteArray(32 * 1024)
                            while (true) {
                                val count = zip.read(block)
                                if (count < 0) break
                                bytes += count
                                check(bytes <= 256_000_000L) {
                                    "As bibliotecas GNU excedem o limite do aplicativo."
                                }
                                output.write(block, 0, count)
                            }
                        }
                        val expected = libraries.getJSONObject(name).getString("sha256")
                        check(hash(target).equals(expected, true)) {
                            "Biblioteca GNU não corresponde ao manifesto SHA-256: $name"
                        }
                        zip.closeEntry()
                    }
                }
            }
            check(found.size == libraries.length()) {
                "A distribuição GNU não contém todas as bibliotecas verificadas."
            }
            destination.deleteRecursively()
            check(staging.renameTo(destination)) {
                "Falha ao instalar o conjunto GNU local."
            }
        } catch (error: Exception) {
            staging.deleteRecursively()
            throw error
        }

        // @github/copilot-sdk can launch the original CLI through this script,
        // preventing execve from looking for the absent /lib/ld-linux-aarch64.so.1.
        val runtime = File(serverDir,
            "node_modules/@github/copilot-sdk-linux-arm64/prebuilds/linux-arm64/copilot-runtime")
        check(runtime.isFile) { "Executável original do Copilot ausente." }
        val wrapper = File(root, "copilot-cli-gnu.sh")
        wrapper.writeText(
            "#!/system/bin/sh\n" +
            "exec ${quote(loader.absolutePath)} --library-path ${quote(destination.absolutePath)} " +
            "${quote(runtime.absolutePath)} \"${'$'}@\"\n"
        )
        check(wrapper.setExecutable(true, true)) {
            "O wrapper GNU do Copilot não pôde receber permissão de execução."
        }
        // Code OSS launches its extension host with child_process.fork().
        // process.execPath normally points at the original GNU Node ELF, whose
        // hard-coded /lib/ld-linux-aarch64.so.1 interpreter does not exist in
        // Android. A second, local wrapper ensures *every* Node child process
        // uses our verified, APK-bundled GNU dynamic loader.
        val nodeWrapper = File(root, "seven-node-gnu.sh")
        nodeWrapper.writeText(
            "#!/system/bin/sh\n" +
            "exec ${quote(loader.absolutePath)} --library-path ${quote(destination.absolutePath)} " +
            "${quote(node.absolutePath)} \"${'$'}@\"\n"
        )
        check(nodeWrapper.setExecutable(true, true)) {
            "O wrapper de processos Node GNU não pôde receber permissão de execução."
        }
        val bootstrap = File(root, "seven-gnu-fork-bootstrap.cjs")
        bootstrap.writeText(
            "Object.defineProperty(process, 'execPath', {configurable: true, " +
            "writable: true, value: " + JSONObject.quote(nodeWrapper.absolutePath) + "});\n" +
            "if (process.execPath !== " + JSONObject.quote(nodeWrapper.absolutePath) +
            ") throw new Error('Seven GNU Node fork wrapper unavailable');\n"
        )
        return Launch(
            prefix = listOf(nodeWrapper.absolutePath),
            libraryPath = destination.absolutePath,
            cliWrapper = wrapper,
            bootstrap = bootstrap
        )
    }
}
