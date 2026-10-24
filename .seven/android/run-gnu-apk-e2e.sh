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
adb install -r -t "$app"
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
