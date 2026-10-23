import SwiftUI
import WebKit

@main
struct SevenCodeApp: App {
    var body: some Scene {
        WindowGroup {
            SevenCodeHome()
        }
    }
}

private func trustedWorkbenchURL(_ candidate: String) -> URL? {
    guard let components = URLComponents(string: candidate.trimmingCharacters(in: .whitespacesAndNewlines)),
          components.scheme?.lowercased() == "https",
          let host = components.host, !host.isEmpty,
          components.user == nil, components.password == nil,
          components.fragment == nil,
          components.port != 0,
          let url = components.url else {
        return nil
    }
    return url
}

struct SevenCodeHome: View {
    @AppStorage("sevenCodeTrustedServer") private var trustedServer = ""
    @State private var candidate = ""
    @State private var confirmServer = false

    var body: some View {
        Group {
            if let url = trustedWorkbenchURL(trustedServer) {
                SevenCodeWebWorkbench(url: url)
                    .ignoresSafeArea(edges: .bottom)
            } else {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Seven Code").font(.largeTitle.bold())
                    Text("Conecte-se ao servidor web padrão do Code OSS compatível com esta versão. O editor e as extensões usam o mesmo backend do VS Code.")
                    TextField("https://seu-servidor-code-oss.exemplo", text: $candidate)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textContentType(.URL)
                    Button("Abrir editor") { confirmServer = true }
                        .disabled(trustedWorkbenchURL(candidate) == nil)
                }
                .padding(24)
                .alert("Confiar neste servidor?", isPresented: $confirmServer) {
                    Button("Cancelar", role: .cancel) {}
                    Button("Confiar e abrir") {
                        if trustedWorkbenchURL(candidate) != nil {
                            trustedServer = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                    }
                } message: {
                    Text("Use o servidor Code OSS compatível e autenticado. Não é necessário criar servidor Seven Code independente; extensões Node.js usam o host remoto original.")
                }
            }
        }
    }
}

struct SevenCodeWebWorkbench: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(allowedURL: url)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let allowedScheme: String
        private let allowedHost: String
        private let allowedPort: Int?

        init(allowedURL: URL) {
            self.allowedScheme = allowedURL.scheme ?? "https"
            self.allowedHost = allowedURL.host ?? ""
            self.allowedPort = allowedURL.port
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard navigationAction.targetFrame?.isMainFrame == true else {
                decisionHandler(.allow)
                return
            }
            let next = navigationAction.request.url
            if next?.scheme == allowedScheme && next?.host == allowedHost &&
                (next?.port ?? 443) == (allowedPort ?? 443) &&
                next?.user == nil && next?.password == nil {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }
    }
}
