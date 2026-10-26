#!/usr/bin/env bash
# The emulator action starts its script through /bin/sh; explicitly run Bash
# so pipefail and [[ .. ]] are supported. NEVER report a simulated green run.
set -euo pipefail

abi=$(adb shell getprop ro.product.cpu.abilist | tr -d '\r')
echo "Android ABI availability: $abi"
primary_abi=$(adb shell getprop ro.product.cpu.abi | tr -d '\r')
echo "Android primary ABI: $primary_abi"
if [[ "$primary_abi" != "arm64-v8a" ]]; then
  echo "::error::GNU native ARM64 acceptance cannot run on primary ABI $primary_abi. Android native-bridge ARM64 translation on x86_64 is not proof of ARM64 execution."
  exit 1
fi
if [[ "$abi" != *arm64-v8a* ]]; then
  echo "::error::Android does not expose the required ARM64 ABI; cannot validate original GNU Node."
  exit 1
fi
adb shell df -h /data
app="$RUNNER_TEMP/experimental-apk/SevenCode-gnu-arm64-EXPERIMENTAL-debug.apk"
# The package ID must be isolated so a CI/debug test cannot replace
# the user's existing Seven Code app and delete or downgrade private data.
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging "$app" |
  grep -F "package: name='dev.seven.code.gnu'"
test -s "$app"
test -s mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
# Both APKs originate from different CI runners. A separate instrumentation
# process MUST use the exact same certificate as the installed target package.
# Generate one ephemeral CI-only key, then re-sign BOTH APK copies to it.
# No original APK is modified or published, and neither key nor password is a
# distributable production credential.
keystore="$RUNNER_TEMP/seven-gnu-e2e.keystore"
signer="$ANDROID_HOME/build-tools/36.0.0/apksigner"
test -x "$signer" || { echo "::error::apksigner missing"; exit 1; }
keytool -genkeypair -noprompt -alias sevengnue2e -keyalg RSA -keysize 2048 \
  -validity 14 -dname "CN=SevenCode GNU E2E DEBUG" \
  -keystore "$keystore" -storepass android -keypass android >/dev/null 2>&1
test -s "$keystore" || { echo "::error::Could not create fresh CI-only Android signing key"; exit 1; }
instrumented="$RUNNER_TEMP/SevenCode-gnu-original-e2e-debug-resigned.apk"
test_input="mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
test_signed="$RUNNER_TEMP/SevenCode-gnu-e2e-instrumentation-resigned.apk"
"$signer" sign \
  --ks "$keystore" --ks-key-alias sevengnue2e \
  --ks-pass pass:android --key-pass pass:android \
  --out "$instrumented" "$app"
"$signer" sign \
  --ks "$keystore" --ks-key-alias sevengnue2e \
  --ks-pass pass:android --key-pass pass:android \
  --out "$test_signed" "$test_input"
"$signer" verify --verbose "$instrumented"
"$signer" verify --verbose "$test_signed"
# Make the instrumentation signature requirement auditable before adb install.
app_cert=$("$signer" verify --print-certs "$instrumented" | grep -m1 'SHA-256 digest:')
test_cert=$("$signer" verify --print-certs "$test_signed" | grep -m1 'SHA-256 digest:')
test -n "$app_cert" && test "$app_cert" = "$test_cert" || {
  echo "::error::Android instrumentation and full Code OSS APK signatures differ"
  exit 1
}
python3 .seven/android/verify-gnu-apk.py "$instrumented"
adb install -r -t "$instrumented"
adb install -r -t "$test_signed"

# When an authentic on-device editor startup fails, retain the real server
# failure reason, never substitute a mocked workbench or a green check.
# Scrub ephemeral 64-digit connection tokens from CI output.
diagnose_android_codeoss_failure() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "::error::Real Code OSS Android acceptance failed (exit $status)."
    echo "Verified local Code OSS last startup phase:"
    adb shell run-as dev.seven.code.gnu cat files/seven-code-oss-local/startup-phase.txt 2>/dev/null || true
    echo "Android GNU Node child_process.fork IPC preflight (redacted):"
    adb shell run-as dev.seven.code.gnu cat files/seven-code-oss-local/gnu-node-fork-probe.log 2>/dev/null |
      sed -E 's/[[:xdigit:]]{64}/[redacted-local-token]/g' |
      head -n 25 || true
    echo "GNU loader/Node version probe and Android primary ABI (no tokens):"
    adb shell run-as dev.seven.code.gnu cat files/seven-code-oss-local/gnu-platform-probe.txt 2>/dev/null | head -n 4 || true
    adb shell run-as dev.seven.code.gnu cat files/seven-code-oss-local/gnu-node-version-probe.log 2>/dev/null |
      sed -E 's/[[:xdigit:]]{64}/[redacted-local-token]/g' |
      head -n 25 || true
    echo "Original Code OSS server log (local auth token redacted):"
    adb shell run-as dev.seven.code.gnu cat files/seven-code-oss-local/server.log 2>/dev/null |
      sed -E 's/[[:xdigit:]]{64}/[redacted-local-token]/g' |
      tail -n 55 || true
    echo "Android native crash buffer (local tokens redacted):"
    adb logcat -d -b crash -t 350 2>/dev/null |
      sed -E 's/[[:xdigit:]]{64}/[redacted-local-token]/g' |
      tail -n 140 || true
    echo "Android process and linker diagnostics (local tokens redacted):"
    adb logcat -d -b main -t 1000 2>/dev/null |
      grep -Ei 'Fatal signal|SIGSYS|seccomp|bad syscall|libseven-gnu|seven-node-gnu|linker.*(error|failed)' |
      sed -E 's/[[:xdigit:]]{64}/[redacted-local-token]/g' |
      tail -n 80 || true
    echo "Android recorded process exits:"
    adb shell dumpsys activity exit-info dev.seven.code.gnu 2>/dev/null |
      sed -E 's/[[:xdigit:]]{64}/[redacted-local-token]/g' |
      grep -Ei 'dev\.seven\.code|reason|status|signal|description' |
      tail -n 70 || true
  fi
}
trap diagnose_android_codeoss_failure EXIT

# Test the editor delivered by the *single original 300+ MB APK*, not a fake
# remote browser or a standalone .html test fixture. Keep the result in CI.
adb shell am instrument -w -r \
  -e class dev.seven.code.SevenStandaloneGnuDeviceTest \
  dev.seven.code.gnu.test/androidx.test.runner.AndroidJUnitRunner \
  | tee "$RUNNER_TEMP/gnu-android-instrumentation.txt"
grep -Fq 'OK (1 test)' "$RUNNER_TEMP/gnu-android-instrumentation.txt"
grep -Fq 'INSTRUMENTATION_CODE: -1' "$RUNNER_TEMP/gnu-android-instrumentation.txt"
echo "Original embedded GNU Code OSS editor initialized on this Android system image."
echo "Copilot OAuth/Agent E2E and production release qualification remain separate."
