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
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let allowedScheme: String
        private let allowedHost: String
        private let allowedPort: Int?

        init(allowedURL: URL) {
            self.allowedScheme = allowedURL.scheme ?? "https"
            self.allowedHost = allowedURL.host ?? ""
            self.allowedPort = allowedURL.port
        }

        private func trustedServer(_ url: URL) -> Bool {
            url.scheme == allowedScheme && url.host == allowedHost &&
                (url.port ?? 443) == (allowedPort ?? 443) &&
                url.user == nil && url.password == nil
        }

        private func externalHTTPS(_ url: URL) -> Bool {
            url.scheme?.lowercased() == "https" && url.host?.isEmpty == false &&
                url.user == nil && url.password == nil &&
                !(url.host?.contains("..") ?? true)
        }

        private func openOutsideWorkbench(_ url: URL, requiresConsent: Bool, webView: WKWebView) {
            guard externalHTTPS(url) else { return }
            if !requiresConsent {
                UIApplication.shared.open(url)
                return
            }
            // OAuth windows may open after an asynchronous extension callback.
            // Ask before launching an external app if there is no direct link tap.
            guard let controller = webView.window?.rootViewController,
                  controller.presentedViewController == nil else { return }
            let alert = UIAlertController(
                title: "Abrir autenticação no navegador?",
                message: "O editor quer abrir \(url.host ?? "site externo"). Continue somente se iniciou essa ação.",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel))
            alert.addAction(UIAlertAction(title: "Abrir", style: .default) { _ in
                UIApplication.shared.open(url)
            })
            controller.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard navigationAction.targetFrame?.isMainFrame == true else {
                decisionHandler(.allow)
                return
            }
            if let url = navigationAction.request.url, trustedServer(url) {
                decisionHandler(.allow)
            } else {
                if let url = navigationAction.request.url, externalHTTPS(url) {
                    openOutsideWorkbench(
                        url,
                        requiresConsent: navigationAction.navigationType != .linkActivated,
                        webView: webView
                    )
                }
                decisionHandler(.cancel)
            }
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            // The original Code OSS env.openExternal may use window.open().
            // Never create a privileged child WebView for third-party OAuth.
            if navigationAction.targetFrame == nil,
               let url = navigationAction.request.url, externalHTTPS(url) {
                openOutsideWorkbench(
                    url,
                    requiresConsent: navigationAction.navigationType != .linkActivated,
                    webView: webView
                )
            }
            return nil
        }
    }
}
