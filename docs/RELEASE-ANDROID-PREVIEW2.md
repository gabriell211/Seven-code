# Seven Code v0.2.0 Android Preview 2 — Code OSS on mobile

This is an **Android developer preview, not a standalone/full VS Code mobile port**.

**What is tested on the GitHub Actions release commit:**
- Actual Code OSS web editor and remote Node extension host built from the repo.
- Playwright Chromium opens the authenticated Code OSS workbench.
- Chromium launches a *real Code OSS terminal UI command* through a simulated Android-native bridge.
- Android emulator runs WebView → native user approval → JNI PTY → WebView output, plus explicit denial.
- Android /system/bin/sh PTY, AI command runner and sandbox validation on a real Android emulator.
- APK contains manifest, DEX and ARM64/x86_64 native JNI binaries.
- APK and Code OSS server archive are produced from the same git commit and checksummed.

**What was fixed since Preview 1:**
- External HTTPS login popups launched from the workbench route through the Android system browser.
- Async authorization links without a gesture require Android native confirmation.
- Untrusted popup pages never receive the native terminal bridge.
- More accurate WebView/PTY transport validation.

**Important limitations:**
- Install both the APK and matching Code OSS server (Linux x64). The APK is a **client of a remotely hosted Code OSS server**, not an offline desktop IDE.
- Set up your own authenticated HTTPS URL. The Linux server is **not automatically deployed**.
- GitHub Copilot authenticating with a real account, Copilot Agent shell tools, persistent remote workspace files through the local Android shell and third-party extension compatibility are **not yet end-to-end qualified**.
- The local Android shell has Android sandbox commands, not the remote Linux host's commands or filesystem.
- iPhone/iOS physical-device support is **not included**.
- APK is debug-signed for development; this is not a production-signed version.

Use the [Android server installation guide](INSTALL-ANDROID-SERVER.md) and read [qualification policy](RELEASE-QUALIFICATION.md).
