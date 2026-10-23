# Seven Code v0.2.0 — Android remote editor developer preview

**What works (subject to validation in this release workflow):**

- The real Code OSS web editor, built from the repository, loaded by the mobile Android WebView from an authenticated HTTPS Code OSS server.
- Native Android `/system/bin/sh` PTY through JNI, including binary IO, resize and explicit native permission dialog.
- Code OSS terminal creation routes to Android's PTY in the trusted app WebView. The desktop implementation remains unchanged.
- GitHub Actions compiles and tests the emulator-native PTY and renders the authenticated editor in desktop Chromium.
- Source build of the Code OSS web server and its packaged extension hosts is provided as a separate Linux x64 archive.

**Before installing:**

1. Download the Android **debug-signed developer-preview APK** and the separately compiled Linux x64 Code OSS server.
2. Extract/deploy that Code OSS server behind **authenticated HTTPS** using your own infrastructure and a valid TLS certificate. The APK does not contain or host the Node.js Code OSS server.
3. Install the APK, enter your own server HTTPS URL, and authorize the server and each native shell session.

**Not yet qualified — do not mistake this for a full standalone VS Code mobile release:**

- Android JNI and the web editor are tested separately; a full WebView-to-live-Code-OSS-server test on a real Android phone is still pending.
- GitHub Copilot authentication and terminal agent execution with a real account have **not** passed end-to-end tests.
- Native Android shell operates inside the Android application sandbox; remote server workspace files are **not** transparently mounted there.
- Node-based extensions execute on the remote Code OSS server; Android locally cannot run arbitrary desktop Node modules.
- No iPhone/iOS installation or App Store distribution is provided in this Android-only preview.
- The APK is **debug signed** in CI; future builds may require reinstalling due to changing debug signatures. This is **not** a production-signed stable build.

**Evidence required for publishing this preview:** Android instrumented tests and artifact inspection, actual Code OSS server build, authenticated Chromium workbench E2E, both artifacts from the same Git commit, SHA-256 checksum file. If either test job fails, publishing is skipped.

See [release qualification](RELEASE-QUALIFICATION.md) for stricter stable/full-mobile E2E gates. Do not interpret this scoped preview as satisfying them.
