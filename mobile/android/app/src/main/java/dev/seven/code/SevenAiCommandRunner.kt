package dev.seven.code

import android.content.Context
import android.os.Handler
import android.os.Looper
import dev.seven.code.terminal.SevenPty
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

data class AiTerminalResult(
    val exitCode: Int?,
    val output: String,
    val truncated: Boolean,
    val error: String? = null
)

/**
 * Executes a SINGLE, user-approved command in a separate PTY session.
 * The visible user terminal is never hijacked by tool executions.
 * This is intentionally NOT a privileged shell: /system/bin/sh runs in the app sandbox.
 */
class SevenAiCommandRunner(
    private val context: Context,
    private val onComplete: (AiTerminalResult) -> Unit,
    private val onOutput: (String) -> Unit = {}
) {
    private val main = Handler(Looper.getMainLooper())
    private val finished = AtomicBoolean(false)
    private val lock = Any()
    private val transcript = ByteArrayOutputStream()
    private val probe = ByteArrayOutputStream()
    private var truncated = false
    private var ready = false
    private var pty: SevenPty? = null
    private val token = UUID.randomUUID().toString().replace("-", "")
    private val readyMarker = "__SEVEN_READY_${token}__"
    private val doneMarker = "__SEVEN_DONE_${token}__:"
    private var requestedCommand = ""
    private val timeoutTask = Runnable { finish(null, "Tempo esgotado") }

    fun execute(command: String, timeoutMs: Long = 60_000) {
        require(!finished.get()) { "Sessão encerrada" }
        require(command.isNotBlank() && command.length <= 4096 && !command.contains('\u0000')) {
            "Comando inválido"
        }
        require(timeoutMs in 1000L..120_000L) { "Timeout inválido" }
        requestedCommand = command
        main.postDelayed(timeoutTask, timeoutMs)
        try {
            val terminal = SevenPty(
                context,
                onData = { consume(it) },
                onError = { finish(null, it.message ?: "Erro de leitura do PTY") },
                onExit = { code ->
                    // Normal exit without the marker can happen on 'exit', crashes, etc.
                    if (!finished.get()) finish(code, "Shell encerrado sem status do comando")
                }
            )
            pty = terminal
            terminal.start(80, 24)
            // Disable terminal echo before sending the approved command.
            terminal.write("stty -echo\nprintf '\\n$readyMarker\\n'\n".toByteArray(StandardCharsets.UTF_8))
        } catch (error: Exception) {
            finish(null, error.message ?: "Falha ao iniciar comando")
        }
    }

    private fun consume(chunk: ByteArray) {
        if (finished.get()) return
        synchronized(lock) {
            if (finished.get()) return
            if (!ready) {
                probe.write(chunk)
                val text = probe.toString(StandardCharsets.UTF_8.name())
                // Match a standalone marker, not the echoed printf source.
                val marker = Regex("(?:^|[\\r\\n])" + Regex.escape(readyMarker) + "\\r?\\n")
                val match = marker.find(text)
                if (match == null) {
                    if (probe.size() > 8192) finish(null, "Shell não inicializou")
                    return
                }
                ready = true
                probe.reset()
                val command = requestedCommand
                // Shell reads user text only after approval. Separate PTY per action.
                pty?.write((command + "\n__seven_result=\$?\nprintf '\\n" +
                    doneMarker + "%s\\n' \"\$__seven_result\"\nexit\n")
                    .toByteArray(StandardCharsets.UTF_8))
                return
            }

            val remaining = 131072 - transcript.size()
            if (remaining > 0) {
                transcript.write(chunk, 0, minOf(chunk.size, remaining))
            }
            if (chunk.size > remaining) truncated = true

            // Maintain a rolling suffix for the marker even when output is truncated.
            probe.write(chunk)
            if (probe.size() > 8192) {
                val bytes = probe.toByteArray()
                probe.reset()
                probe.write(bytes, bytes.size - 4096, 4096)
            }
            val tail = probe.toString(StandardCharsets.UTF_8.name())
            val end = Regex("(?:^|[\\r\\n])" + Regex.escape(doneMarker) + "(\\d+)\\r?\\n")
                .find(tail)
            if (end != null) {
                val code = end.groupValues[1].toIntOrNull()
                finish(code, null)
            } else {
                onOutput(String(chunk, StandardCharsets.UTF_8))
            }
        }
    }

    fun cancel() = finish(null, "Execução cancelada")

    private fun finish(code: Int?, error: String?) {
        if (!finished.compareAndSet(false, true)) return
        main.removeCallbacks(timeoutTask)
        pty?.close()
        val raw = synchronized(lock) { transcript.toString(StandardCharsets.UTF_8.name()) }
        val output = raw.substringBefore(doneMarker).take(131072)
        main.post { onComplete(AiTerminalResult(code, output, truncated, error)) }
    }
}
