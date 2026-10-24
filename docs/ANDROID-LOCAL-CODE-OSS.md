# Seven Code — Android local Code OSS boot (experimental)

## Intended behavior

A **complete** Android distribution will include the Code OSS web workbench,
remote extension host built for Bionic ARM64, native module dependencies and
an Android ARM64 Node.js ELF runtime. On first launch the app checks the bundle
SHA-256, unpacks Code OSS to its private directory, starts the original
`out/server-main.js` bound **only** to loopback with a random 256-bit connection
token, then opens the upstream workbench automatically in the existing WebView.
There is no custom imitation of the VS Code editor and no user-entered URL.
The original terminal UI is preserved; the Android native PTY adapter remains.

### Required APK inputs

The APK must contain all three items:

- `app/src/main/assets/seven-local/server.zip`: a **Bionic ARM64-compatible**
  Code OSS server distribution zipped with `out/server-main.js` at its root,
  including extension hosts, native addons, resources and bundled extensions.
- `app/src/main/assets/seven-local/server.sha256`: **only** the 64 hexadecimal
  characters of the ZIP archive digest (sha256sum before signing the APK).
- `app/src/main/jniLibs/arm64-v8a/libnode.so`: directly executable Android
  ARM64/Bionic Node ELF, with compatible runtime shared libraries packaged in
  `jniLibs`, linked/verified for Android and carrying their redistribution
  copyright notices.

The Android app now contains `SevenLocalCodeOssServer`, which verifies and
unpacks the bundle and boots Code OSS. The embedded Node process is isolated to
`127.0.0.1` with a random token. Only its exact origin receives the
`SevenTerminalNative` bridge. Other HTTP domains remain blocked.

**No binary inputs have been supplied to the repository yet.** Current small
APK preview builds remain remote-only and will continue showing the explicit
server-configuration screen, rather than falsely claiming to contain Code OSS.
Do not upload a purported standalone release until:

1. Android ARM64 Code OSS and **all** native modules are compiled and run on a
   physical Android device with a Bionic Node.js executable.
2. The ZIP is generated reproducibly, signed/checksummed, and shipped in the APK.
3. The application launches directly into the actual editor without any URL;
   editing, saving, Git, debugging, web and Node extensions are tested.
4. Native terminal and genuine GitHub Copilot sign-in and agent commands are
   verified end-to-end with an authorized account, no fabricated responses.
5. iOS is separately qualified. This Android Bionic implementation does **not**
   magically add an iOS Node host.

See also `docs/RELEASE-QUALIFICATION.md`. Microsoft-hosted official VS Code
Server binaries are **not** repackaged in this fork.


## Proteções do servidor localhost

- O Android mantém HTTP público **bloqueado**. Só `127.0.0.1`
  pode usar HTTP, via `network_security_config.xml`.
- Os binários `jniLibs` são extraídos para dar ao Node Bionic um caminho
  ELF executável em `nativeLibraryDir`.
- Uma conexão TCP não basta para declarar o editor pronto: o app espera
  a mensagem de inicialização do **seu próprio processo Node**,
  compara `/version` com o commit do servidor empacotado e carrega
  o workbench com o token de sessão exigindo configuração real no HTML.
- Isso ainda não substitui o build e o E2E Android ARM64 do runtime completo.
