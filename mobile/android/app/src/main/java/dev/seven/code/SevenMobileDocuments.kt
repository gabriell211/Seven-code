package dev.seven.code

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap

/**
 * Android Storage Access Framework implementation for the original Code OSS
 * FileSystemProvider. Files remain in a user-selected phone folder.
 *
 * Never let a remote extension host access content:// URIs or expose a general
 * HTTP file server. Only the trusted, foreground workbench main frame can
 * request bounded filesystem operations after the Android folder picker.
 */
internal class SevenMobileDocuments(private val activity: Activity) {
    companion object {
        const val PICK_FOLDER = 7114
        const val CHANNEL = "seven-code-mobile-files-v1"
        private const val PREFS = "seven-mobile-documents"
        private const val KEY_TREE = "tree-uri"
        private const val MAX_PATH_DEPTH = 48
        private const val MAX_NAME_LENGTH = 255
        private const val MAX_READ_CHUNK = 32 * 1024
        private const val MAX_FILE_SIZE = 10 * 1024 * 1024L
        private const val MAX_ENTRIES = 2048
        // Reject cloud document providers: project data should live on the phone.
        private val LOCAL_AUTHORITIES = setOf(
            "com.android.externalstorage.documents",
            "com.android.providers.downloads.documents"
        )
    }

    private data class PendingWrite(
        val path: String, val treeUri: String, val stage: File, val output: RandomAccessFile,
        val baselineSize: Long?, val baselineMtime: Long?,
        var count: Long = 0
    )

    private val writes = ConcurrentHashMap<String, PendingWrite>()
    private var choosing: String? = null

    private fun selectedTree(): DocumentFile {
        val text = activity.getSharedPreferences(PREFS, 0).getString(KEY_TREE, null)
            ?: error("Escolha uma pasta do celular antes de acessar os arquivos.")
        val uri = Uri.parse(text)
        check(uri.authority in LOCAL_AUTHORITIES) { "A pasta deve estar no armazenamento local." }
        val permitted = activity.contentResolver.persistedUriPermissions.any {
            it.uri == uri && it.isReadPermission && it.isWritePermission
        }
        check(permitted) { "A permissão da pasta expirou. Selecione-a novamente." }
        val root = DocumentFile.fromTreeUri(activity, uri)
        check(root != null && root.isDirectory) { "Pasta do celular indisponível." }
        return root
    }

    private fun segments(path: String): List<String> {
        check(path.startsWith("/")) { "Caminho deve ser absoluto." }
        if (path == "/") return emptyList()
        val result = path.drop(1).split("/")
        check(result.size <= MAX_PATH_DEPTH && result.all {
            it.isNotEmpty() && it.length <= MAX_NAME_LENGTH &&
                it != "." && it != ".." && !it.contains('\\') &&
                it.none { char -> char.code < 32 }
        }) { "Caminho não permitido." }
        return result
    }

    private fun resolve(path: String): DocumentFile {
        var current = selectedTree()
        for (name in segments(path)) {
            check(current.isDirectory) { "Pasta intermediária inválida." }
            current = current.findFile(name) ?: error("Arquivo não encontrado: $path")
        }
        return current
    }

    private fun parentFor(path: String): Pair<DocumentFile, String> {
        val parts = segments(path)
        check(parts.isNotEmpty()) { "Não é permitido alterar a pasta principal." }
        val name = parts.last()
        val parent = resolve("/" + parts.dropLast(1).joinToString("/"))
        check(parent.isDirectory) { "Diretório não encontrado." }
        return parent to name
    }

    fun beginSelection(requestId: String, initialUri: Uri? = null) {
        check(writes.isEmpty()) { "Conclua as gravações antes de trocar de pasta." }
        check(choosing == null) { "Já há uma seleção de pasta em andamento." }
        choosing = requestId
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            if (initialUri != null && initialUri.scheme == "content" &&
                initialUri.authority in LOCAL_AUTHORITIES) {
                putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI, initialUri)
            }
        }
        try {
            activity.startActivityForResult(intent, PICK_FOLDER)
        } catch (e: Exception) {
            choosing = null
            throw e
        }
    }

    fun finishSelection(resultCode: Int, data: Intent?): JSONObject? {
        val requestId = choosing ?: return null
        choosing = null
        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            return failure(requestId, "Seleção de pasta cancelada.")
        }
        return try {
            val uri = data.data!!
            check(writes.isEmpty()) { "Gravações em andamento; mantenha a pasta anterior." }
            check(uri.authority in LOCAL_AUTHORITIES) {
                "Escolha uma pasta do armazenamento local do Android, não na nuvem."
            }
            val mode = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            activity.contentResolver.takePersistableUriPermission(uri, mode)
            val doc = DocumentFile.fromTreeUri(activity, uri)
            check(doc?.isDirectory == true && doc.canRead() && doc.canWrite()) {
                "A pasta precisa permitir leitura e escrita."
            }
            activity.getSharedPreferences(PREFS, 0).edit().putString(KEY_TREE, uri.toString()).apply()
            success(requestId, JSONObject().put("folder", doc.name ?: "Arquivos do celular"))
        } catch (error: Exception) {
            failure(requestId, error.message ?: "Falha ao autorizar pasta.")
        }
    }

    // SAF providers and staged write streams are not thread-safe. Serialize
    // operations from concurrent editor requests, including commit/abort.
    @Synchronized
    fun process(input: JSONObject): JSONObject {
        val id = input.getString("requestId")
        check(id.matches(Regex("[a-zA-Z0-9_-]{1,64}"))) { "Identificador inválido." }
        return try {
            val path = input.optString("path", "/")
            val result = when (input.getString("op")) {
                "status" -> {
                    val root = selectedTree()
                    JSONObject().put("folder", root.name ?: "Arquivos do celular")
                }
                "stat" -> stat(resolve(path))
                "list" -> {
                    val children = resolve(path)
                    check(children.isDirectory) { "Não é uma pasta." }
                    val entries = children.listFiles()
                    check(entries.size <= MAX_ENTRIES) { "Pasta com arquivos demais." }
                    JSONArray().apply {
                        entries.forEach { doc ->
                            put(JSONObject().put("name", doc.name)
                                .put("type", if (doc.isDirectory) "directory" else "file"))
                        }
                    }.let { JSONObject().put("entries", it) }
                }
                "read" -> {
                    val offset = input.optLong("offset", 0)
                    val length = input.optInt("length", MAX_READ_CHUNK)
                    check(offset >= 0 && length in 1..MAX_READ_CHUNK) { "Leitura inválida." }
                    val doc = resolve(path)
                    check(doc.isFile && doc.length() in 0..MAX_FILE_SIZE) { "Arquivo não suportado." }
                    val size = doc.length()
                    val bytes = if (offset >= size) ByteArray(0) else {
                        activity.contentResolver.openInputStream(doc.uri)?.use { stream ->
                            var remaining = offset
                            while (remaining > 0) {
                                val skipped = stream.skip(remaining)
                                if (skipped <= 0) {
                                    check(stream.read() != -1) { "Falha ao localizar trecho do arquivo." }
                                    remaining--
                                } else remaining -= skipped
                            }
                            val buffer = ByteArray(minOf(length.toLong(), size - offset).toInt())
                            var count = 0
                            while (count < buffer.size) {
                                val n = stream.read(buffer, count, buffer.size - count)
                                if (n < 0) break
                                count += n
                            }
                            buffer.copyOf(count)
                        } ?: error("Não foi possível ler o arquivo.")
                    }
                    JSONObject().put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                        .put("size", size)
                }
                "mkdir" -> {
                    val (parent, name) = parentFor(path)
                    check(parent.findFile(name) == null) { "Arquivo já existe." }
                    check(parent.createDirectory(name) != null) { "Falha ao criar pasta." }
                    JSONObject()
                }
                "delete" -> {
                    check(segments(path).isNotEmpty()) { "Não é permitido apagar a pasta principal." }
                    val doc = resolve(path)
                    if (doc.isDirectory && doc.listFiles().isNotEmpty()) {
                        check(input.optBoolean("recursive", false)) { "Pasta não está vazia." }
                    }
                    check(doc.delete()) { "Não foi possível excluir o arquivo." }
                    JSONObject()
                }
                "rename" -> {
                    val destination = input.getString("target")
                    val (fromParent, _) = parentFor(path)
                    val (toParent, name) = parentFor(destination)
                    check(toParent.findFile(name) == null) { "O destino já existe." }
                    val doc = resolve(path)
                    // Android SAF only guarantees renameTo in the same parent.
                    check(fromParent.uri == toParent.uri) {
                        "Mover entre pastas depende do provedor Android; somente renomear é suportado."
                    }
                    check(doc.renameTo(name)) { "Falha ao renomear." }
                    JSONObject()
                }
                "write-begin" -> {
                    val (parent, name) = parentFor(path)
                    val target = parent.findFile(name)
                    check(target == null || (target.isFile && target.canWrite() &&
                        target.length() <= MAX_FILE_SIZE)) {
                        "Arquivo de destino não pode ser gravado ou excede o limite."
                    }
                    check(writes.values.none { it.path == path && it.treeUri ==
                        activity.getSharedPreferences(PREFS, 0).getString(KEY_TREE, null) }) {
                        "Este arquivo já está sendo gravado."
                    }
                    check(writes.size < 4 && !writes.containsKey(id)) {
                        "Limite de gravações simultâneas atingido."
                    }
                    val selected = activity.getSharedPreferences(PREFS, 0)
                        .getString(KEY_TREE, null) ?: error("Selecione uma pasta antes de gravar.")
                    val stage = File.createTempFile("seven-write-", ".tmp", activity.cacheDir)
                    writes[id] = PendingWrite(path, selected, stage, RandomAccessFile(stage, "rw"),
                        target?.length(), target?.lastModified())
                    JSONObject()
                }
                "write-chunk" -> {
                    val pending = writes[id] ?: error("Gravação não iniciada.")
                    val bytes = Base64.decode(input.getString("data"), Base64.NO_WRAP)
                    check(bytes.size <= MAX_READ_CHUNK && pending.count + bytes.size <= MAX_FILE_SIZE) {
                        "Arquivo excede o tamanho permitido."
                    }
                    synchronized(pending) {
                        check(activity.getSharedPreferences(PREFS, 0).getString(KEY_TREE, null) ==
                            pending.treeUri) { "Pasta alterada durante a gravação." }
                        pending.output.write(bytes)
                        pending.count += bytes.size
                        JSONObject().put("count", pending.count)
                    }
                }
                "write-commit" -> {
                    val pending = writes[id] ?: error("Gravação não iniciada.")
                    try {
                        pending.output.close()
                        check(activity.getSharedPreferences(PREFS, 0).getString(KEY_TREE, null) ==
                            pending.treeUri) { "Pasta alterada durante a gravação." }
                        val (parent, name) = parentFor(pending.path)
                        val existing = parent.findFile(name)
                        check((existing == null) == (pending.baselineSize == null)) {
                            "Arquivo alterado fora do Seven Code durante a gravação."
                        }
                        if (existing != null) {
                            check(existing.isFile && existing.length() == pending.baselineSize &&
                                (pending.baselineMtime == 0L || existing.lastModified() == 0L ||
                                    existing.lastModified() == pending.baselineMtime)) {
                                "Arquivo alterado por outro programa. Reabra antes de salvar."
                            }
                        }

                        // Android DocumentsProviders have no universal atomic replace.
                        // Keep a recovery copy outside the SAF provider before
                        // truncating the original; restore it on a failed write.
                        val backup = if (existing != null) {
                            val dir = File(activity.filesDir, "seven-file-recovery")
                            check(dir.isDirectory || dir.mkdirs()) { "Falha ao criar backup local." }
                            val copy = File.createTempFile("seven-recovery-", ".bak", dir)
                            try {
                                activity.contentResolver.openInputStream(existing.uri)?.use { input ->
                                    copy.outputStream().use { output -> input.copyTo(output) }
                                } ?: error("Falha ao fazer cópia de segurança antes de salvar.")
                                check(copy.length() == pending.baselineSize) {
                                    "O arquivo mudou durante o backup. Salvar foi cancelado."
                                }
                                copy
                            } catch (error: Exception) {
                                copy.delete()
                                throw error
                            }
                        } else null
                        var created: DocumentFile? = null
                        try {
                            val target = existing ?: parent.createFile("application/octet-stream", name)
                                ?.also { created = it } ?: error("Não foi possível criar o arquivo.")
                            activity.contentResolver.openOutputStream(target.uri, "wt")?.use { out ->
                                pending.stage.inputStream().use { it.copyTo(out) }
                                out.flush()
                            } ?: error("Não foi possível gravar o arquivo.")
                            backup?.delete()
                            JSONObject().put("size", pending.count)
                        } catch (writeError: Exception) {
                            if (existing != null && backup != null) {
                                val restored = runCatching {
                                    activity.contentResolver.openOutputStream(existing.uri, "wt")?.use { out ->
                                        backup.inputStream().use { it.copyTo(out) }
                                        out.flush()
                                    } ?: error("Backup não pôde ser restaurado.")
                                }
                                if (restored.isFailure) {
                                    error("Falha ao salvar e restaurar. Cópia preservada em " +
                                        backup.absolutePath + ": " + (writeError.message ?: "erro"))
                                }
                                backup.delete()
                            } else {
                                created?.delete()
                            }
                            throw writeError
                        }
                    } finally {
                        writes.remove(id)
                        pending.stage.delete()
                    }
                }
                "write-abort" -> {
                    writes.remove(id)?.let { it.output.close(); it.stage.delete() }
                    JSONObject()
                }
                else -> error("Operação de arquivos não suportada.")
            }
            success(id, result)
        } catch (error: Exception) {
            failure(id, error.message ?: "Erro ao acessar arquivos do celular.")
        }
    }

    private fun stat(doc: DocumentFile): JSONObject =
        JSONObject().put("type", if (doc.isDirectory) "directory" else "file")
            .put("size", doc.length())
            .put("mtime", doc.lastModified())

    fun dispose() {
        writes.values.forEach { runCatching { it.output.close(); it.stage.delete() } }
        writes.clear()
        choosing = null
    }

    private fun success(id: String, data: JSONObject) =
        JSONObject().put("type", "fs-result").put("requestId", id).put("ok", true).put("value", data)

    private fun failure(id: String, message: String) =
        JSONObject().put("type", "fs-result").put("requestId", id).put("ok", false).put("error", message)
}
