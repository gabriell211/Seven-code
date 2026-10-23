import Foundation

/// IOS tool adapter for the locally EMBEDDED ios_system commands.
/// The app must show a native approval UI via the approve closure.
struct SevenIosCommandResult {
    let approved: Bool
    let output: String
    let exitCode: Int?
    let truncated: Bool
    let error: String?
}

final class SevenIosAiCommandTool {
    private let terminal: SevenLocalTerminal
    private var busy = false

    init(terminal: SevenLocalTerminal) {
        self.terminal = terminal
    }

    func execute(
        _ command: String,
        approve: @escaping (String, @escaping (Bool) -> Void) -> Void,
        completion: @escaping (SevenIosCommandResult) -> Void
    ) {
        guard !busy, !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              command.utf8.count <= 4096, !command.contains("\0") else {
            completion(SevenIosCommandResult(
                approved: false, output: "", exitCode: nil,
                truncated: false, error: "Invalid or concurrent command"
            ))
            return
        }
        busy = true
        approve(command) { [weak self] allowed in
            guard let self = self else { return }
            if !allowed {
                self.busy = false
                completion(SevenIosCommandResult(
                    approved: false, output: "", exitCode: nil,
                    truncated: false, error: "Denied by user"
                ))
                return
            }
            var output = ""
            var truncated = false
            self.terminal.run(command, onChunk: { chunk in
                let remaining = 131072 - output.utf8.count
                if remaining <= 0 {
                    truncated = true
                } else {
                    if chunk.utf8.count > remaining { truncated = true }
                    output += String(decoding: chunk.utf8.prefix(remaining), as: UTF8.self)
                }
            }, onComplete: { result in
                self.busy = false
                switch result {
                case .success:
                    // ios_popen() does not guarantee an exit status in this adapter.
                    completion(SevenIosCommandResult(
                        approved: true, output: output, exitCode: nil,
                        truncated: truncated, error: nil
                    ))
                case .failure(let error):
                    completion(SevenIosCommandResult(
                        approved: true, output: output, exitCode: nil,
                        truncated: truncated, error: error.localizedDescription
                    ))
                }
            })
        }
    }
}
