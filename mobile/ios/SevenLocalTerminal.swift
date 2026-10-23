import Foundation
import Darwin

// ios_system BSD-3-Clause: adicionar o pacote holzschu/ios_system ao projeto Xcode
// e associar seus frameworks de comandos + commandDictionary.plist antes de compilar.
@_silgen_name("ios_popen")
private func iosPopen(
    _ command: UnsafePointer<CChar>,
    _ mode: UnsafePointer<CChar>
) -> UnsafeMutablePointer<FILE>?

@_silgen_name("ios_setMiniRoot")
private func iosSetMiniRoot(_ directory: NSString) -> Int32

/// Motor local limitado às bibliotecas de comandos embarcadas (não é um PTY POSIX).
/// A UI de terminal é compartilhada com Seven Code, mas recursos interativos
/// que dependem de fork/exec/pty devem usar o backend remoto autenticado.
final class SevenLocalTerminal {
    enum TerminalError: Error {
        case invalidCommand
        case commandUnavailable
    }

    private let commandQueue = DispatchQueue(label: "dev.seven.code.ios.terminal")
    private let workspace: URL

    init(workspace: URL) throws {
        let canonical = workspace.standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: canonical.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw TerminalError.invalidCommand
        }
        self.workspace = canonical
    }

    /// Executar apenas a partir de gesto explícito do usuário no editor.
    func run(
        _ command: String,
        onChunk: @escaping (String) -> Void,
        onComplete: @escaping (Result<Void, Error>) -> Void
    ) {
        commandQueue.async {
            guard !command.isEmpty, command.utf8.count <= 4096,
                  !command.contains("\0") else {
                DispatchQueue.main.async { onComplete(.failure(TerminalError.invalidCommand)) }
                return
            }

            // ios_system possui miniroot lógico, que não substitui o sandbox do SO.
            guard iosSetMiniRoot(self.workspace.path as NSString) == 1 else {
                DispatchQueue.main.async { onComplete(.failure(TerminalError.commandUnavailable)) }
                return
            }

            let pipe = command.withCString { cmd in
                "r".withCString { mode in iosPopen(cmd, mode) }
            }
            guard let pipe else {
                DispatchQueue.main.async { onComplete(.failure(TerminalError.commandUnavailable)) }
                return
            }

            var buffer = [CChar](repeating: 0, count: 4096)
            while fgets(&buffer, Int32(buffer.count), pipe) != nil {
                let piece = String(cString: buffer)
                DispatchQueue.main.async { onChunk(piece) }
            }
            fclose(pipe)
            DispatchQueue.main.async { onComplete(.success(())) }
        }
    }
}
