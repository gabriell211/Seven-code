#!/usr/bin/env bash
# The emulator action starts its script through /bin/sh; explicitly run Bash
# so pipefail and [[ .. ]] are supported. NEVER report a simulated green run.
set -euo pipefail

abi=$(adb shell getprop ro.product.cpu.abilist | tr -d '\r')
echo "Android ABI availability: $abi"
if [[ "$abi" != *arm64-v8a* ]]; then
  echo "::error::This Android emulator does not report ARM64 translation. Cannot validate original GNU Code OSS on an unsupported CPU."
  exit 1
fi
adb shell df -h /data
app="$RUNNER_TEMP/experimental-apk/SevenCode-gnu-arm64-EXPERIMENTAL-debug.apk"
test -s "$app"
test -s mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
# The release/debug APK was built in a DIFFERENT GitHub Actions runner.
# Every runner creates its own default debug key. Android instrumentation is
# forbidden across signing identities, even when both APKs are genuine.
# Re-sign ONLY this CI copy with the same ephemeral debug key that Gradle used
# for app-debug-androidTest.apk; do not overwrite or release the original APK.
keystore="$HOME/.android/debug.keystore"
signer="$ANDROID_HOME/build-tools/36.0.0/apksigner"
test -s "$keystore"
test -x "$signer"
instrumented="$RUNNER_TEMP/SevenCode-gnu-original-e2e-debug-resigned.apk"
"$signer" sign \
  --ks "$keystore" --ks-key-alias androiddebugkey \
  --ks-pass pass:android --key-pass pass:android \
  --out "$instrumented" "$app"
"$signer" verify --verbose "$instrumented"
python3 .seven/android/verify-gnu-apk.py "$instrumented"
adb install -r -t "$instrumented"
adb install -r -t mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

# Test the editor delivered by the *single original 300+ MB APK*, not a fake
# remote browser or a standalone .html test fixture. Keep the result in CI.
adb shell am instrument -w -r \
  -e class dev.seven.code.SevenStandaloneGnuDeviceTest \
  dev.seven.code.test/androidx.test.runner.AndroidJUnitRunner \
  | tee "$RUNNER_TEMP/gnu-android-instrumentation.txt"
grep -Fq 'OK (1 test)' "$RUNNER_TEMP/gnu-android-instrumentation.txt"
grep -Fq 'INSTRUMENTATION_CODE: -1' "$RUNNER_TEMP/gnu-android-instrumentation.txt"
echo "Original embedded GNU Code OSS editor initialized on this Android system image."
echo "Copilot OAuth/Agent E2E and production release qualification remain separate."
