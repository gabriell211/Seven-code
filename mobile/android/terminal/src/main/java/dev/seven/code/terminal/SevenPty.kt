package dev.seven.code.terminal

import android.content.Context
import android.os.SystemClock
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * PTY local para o Seven Code Android. Emite bytes brutos (sequências ANSI),
 * que devem ser conectados ao terminal xterm.js do workbench.
 *
 * Só o app nativo deve criar sessões. Não exponha este objeto via
 * addJavascriptInterface para páginas remotas ou conteúdo não confiável.
 */
class SevenPty(
    private val context: Context,
    private val onData: (ByteArray) -> Unit,
    private val onError: (IOException) -> Unit,
    private val onExit: (Int?) -> Unit
) : Closeable {
    companion object {
        init { System.loadLibrary("sevenpty") }
    }

    private external fun nativeSpawn(cwd: String, cols: Int, rows: Int): IntArray
    private external fun nativeRead(fd: Int): ByteArray?
    private external fun nativeWrite(fd: Int, bytes: ByteArray)
    private external fun nativeResize(fd: Int, cols: Int, rows: Int)
    private external fun nativeTerminate(fd: Int, pid: Int)
    private external fun nativeReap(pid: Int): Int
    private external fun nativeKill(pid: Int)

    private val closed = AtomicBoolean(false)
    private val started = AtomicBoolean(false)
    private val writer = Executors.newSingleThreadExecutor { task ->
        Thread(task, "SevenCodePTYWriter").apply { isDaemon = true }
    }
    private var ptyDescriptor: Int = -1
    private var processId: Int = -1

    fun shellPid(): Int = processId

    @Synchronized
    @Throws(IOException::class)
    fun start(columns: Int = 80, rows: Int = 24, workspace: File = context.filesDir) {
        check(!closed.get()) { "Sessão encerrada" }
        check(!started.get()) { "Sessão já iniciada" }
        require(columns in 1..1000 && rows in 1..1000) { "Dimensões inválidas" }

        val root = context.filesDir.canonicalFile
        val safeWorkspace = workspace.canonicalFile
        require(safeWorkspace == root || safeWorkspace.toPath().startsWith(root.toPath())) {
            "Workspace deve estar no sandbox do aplicativo"
        }
        require(safeWorkspace.isDirectory) { "Workspace inexistente" }

        val session = nativeSpawn(safeWorkspace.absolutePath, columns, rows)
        require(session.size == 2 && session[0] >= 0 && session[1] > 1) { "PTY inválido" }
        ptyDescriptor = session[0]
        processId = session[1]
        started.set(true)

        Thread({
            try {
                while (!closed.get()) {
                    val data = nativeRead(ptyDescriptor) ?: break
                    if (data.isNotEmpty()) onData(data)
                }
            } catch (error: IOException) {
                if (!closed.get()) onError(error)
            } finally {
                close()
            }
        }, "SevenCodePTYReader").apply { isDaemon = true; start() }
    }

    /** Envie os bytes recebidos por xterm.js.onData, sem avaliação via shell no host JS. */
    fun write(input: ByteArray) {
        check(started.get() && !closed.get()) { "Terminal não iniciado" }
        require(input.size <= 65536) { "Limite de entrada: 64 KiB" }
        val bytes = input.copyOf()
        writer.execute {
            if (closed.get()) return@execute
            try {
                nativeWrite(ptyDescriptor, bytes)
            } catch (error: IOException) {
                if (!closed.get()) onError(error)
            }
        }
    }

    fun resize(columns: Int, rows: Int) {
        check(started.get() && !closed.get()) { "Terminal não iniciado" }
        require(columns in 1..1000 && rows in 1..1000) { "Dimensões inválidas" }
        writer.execute {
            if (closed.get()) return@execute
            try {
                nativeResize(ptyDescriptor, columns, rows)
            } catch (error: IOException) {
                if (!closed.get()) onError(error)
            }
        }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        writer.shutdown()
        if (!started.get()) {
            onExit(null)
            return
        }
        val pid = processId
        nativeTerminate(ptyDescriptor, pid)
        Thread({
            // Reap the child without blocking the UI thread. Escalate after grace period.
            val deadline = SystemClock.elapsedRealtime() + 2000L
            var result: Int
            do {
                result = nativeReap(pid)
                if (result != 0) break
                SystemClock.sleep(50)
            } while (SystemClock.elapsedRealtime() < deadline)

            if (result == 0) {
                nativeKill(pid)
                do {
                    result = nativeReap(pid)
                    if (result != 0) break
                    SystemClock.sleep(50)
                } while (SystemClock.elapsedRealtime() < deadline + 1000L)
            }
            onExit(if (result > 0) result - 1 else null)
        }, "SevenCodePTYReaper").apply { isDaemon = true; start() }
    }
}
