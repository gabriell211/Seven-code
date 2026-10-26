# Seven Code Android — GNU Node.js + Copilot real acceptance

This is an **experimental**, local-first GNU/Linux ARM64 runtime in a separate Android app process. It does **not** authorize production releases.

## What CI can verify without a user account

- Code OSS server, original Copilot ARM64 binaries and GNU library closure are present and SHA-256 verified in **one APK**.
- The Node IPC probe packaged in the APK matches `gnu-manifest.json`.
- At Android startup, `SevenLocalCodeOssServer` must execute original Node `--version` and a real `child_process.fork()` round-trip before starting the Code OSS server.
- `SevenStandaloneGnuDeviceTest` checks the real local WebView, Node extension host, fork IPC, and original Copilot `runtime.node` load. No HTML stand-in or model mock counts.

**Important:** x86_64 Android translation has previously rejected GNU Node with `SIGSYS / SYS_SECCOMP` (host syscall 273). A native ARM64 emulator on an ordinary GitHub-hosted macOS runner also failed to boot with `HV_UNSUPPORTED`. Neither is proof of running on a physical ARM64 phone. Use the real-device gate below.

## Physical Android ARM64 acceptance

Use a **dedicated test phone**. The experimental signed debug APK uses its own application ID `dev.seven.code.gnu` (shown as **Seven Code GNU Test**) and `targetSdk=28` solely for research. It installs beside the real Seven Code without overwriting its files or GitHub sessions. Do not confuse this debug-only variant with a production app.

1. On a private GitHub Actions Linux x86_64 runner, install the Android SDK/ADB and connect exactly one unlocked authorized ARM64 phone over USB. Register the custom runner label `seven-android-device`.
2. Confirm `adb devices -l`, `adb shell getprop ro.product.cpu.abilist` (must contain `arm64-v8a`) and `adb shell getprop ro.kernel.qemu` (must not return `1`).
3. After the **experimental GNU single APK** build from current `main` has succeeded, open **Actions → Seven Code Android - physical ARM64 GNU runtime acceptance (experimental) → Run workflow**. Supply its exact successful `experimental_run_id`.
4. The workflow re-verifies the complete APK/compiled revision, re-signs the app and instrumentation with a temporary CI-only certificate, installs them and requires `SevenStandaloneGnuDeviceTest` to pass. On failure it exposes the sanitized `startup-phase.txt`, GNU Node IPC probe output and Android crash messages.

### Windows + Android físico, sem runner próprio

Baixe **somente** um APK experimental GNU cujo build tenha terminado com sucesso. Na raiz do repositório, com Python 3 e `adb` disponíveis no PATH, execute:

```powershell
pwsh -File mobile/android/tools/test-gnu-node-arm64-device.ps1 -ApkPath "C:\\Downloads\\SevenCode-gnu-arm64-EXPERIMENTAL-debug.apk"
```

O teste verifica o APK completo, exige apenas **um** dispositivo físico com ABI principal `arm64-v8a`, instala `dev.seven.code.gnu` sem substituir o aplicativo regular, inicia o Node GNU e só aceita êxito após ler **`node --version` verdadeiro + `child_process.fork()`/IPC real** no sandbox do aparelho. Ele recusa sobrescrever uma instalação prévia do pacote de teste. Se houver falha, apresenta a fase, ABI e logs sanitizados; não libera release nem considera Copilot homologado.

If Node fails before the Code OSS editor appears, check the recorded phase:

- `probe-original-gnu-node-on-android`: original loader/Node process could not start.
- `probe-original-gnu-node-fork-ipc-on-android`: Node started but child `fork()`/IPC failed.
- `await-real-server-auth-and-web-workbench`: Node and IPC passed but the original Code OSS server did not become authenticated and ready.
- A missing/failing `seven-code-node-runtime-proof.json` means the genuine Node workspace extension or Copilot addon was **not** accepted.

## Real GitHub Copilot Chat and Agent (account owner only)

After the **local GNU Code OSS** runtime opens on the Android phone:

1. In the original Code OSS **Accounts** menu, sign into GitHub and confirm an active authentication session **inside** the workbench.
2. Open the Command Palette and run **Seven Code: Diagnóstico REAL do runtime Node.js**. It must report working Node `fork()`/IPC and a loaded original Copilot native addon.
3. Run **Seven Code: Homologar resposta REAL do Copilot no Node Android**. This explicitly requires a GitHub session, a model registered by the official Copilot extension and a nonempty streamed `sendRequest()` response. A green build or login webpage alone does not satisfy this test.
4. Run **Seven Code: Testar Copilot Agent REAL no Android**; choose the real **Agent** mode in Chat and ask it to execute `printf SEVEN_CODE_AGENT_REAL_OK`. Approve the Android-native shell permission and verify the actual output, not just the Chat UI.
5. Also verify user-approved file context, applying an edit, cancellation, portrait/landscape and reopening the app. The terminal/file transport fixes are tracked separately in PR #15.

Do not put OAuth tokens, conversation bodies or private workspace contents in CI logs. The Node acceptance command intentionally does not persist them.

## Release gate

**Not ready for a public release** until the physical ARM64 acceptance succeeds, the real user's authorized Copilot session produces a model response and Agent command, and supported target-SDK execution/signing requirements are met. The `targetSdk=28` debug experiment is **not** a workaround for production Android security policies.

See issues #3 and PRs #15/#16.
