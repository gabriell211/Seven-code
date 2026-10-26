#!/usr/bin/env bash
# Run by reactivecircus/android-emulator-runner as ONE script invocation.
# The action otherwise executes each YAML script line in a separate /bin/sh,
# which neither supports "set -o pipefail" nor shares shell variables.
set -euo pipefail

: "${GITHUB_REPOSITORY:?Missing GitHub repository}"
: "${RUNNER_TEMP:?Missing GitHub runner temporary directory}"

old_dir="$RUNNER_TEMP/seven-preview-previous"
mkdir -p "$old_dir"
gh release download v0.2.0-android-web-preview.2 \
  --repo "$GITHUB_REPOSITORY" \
  --pattern 'SevenCode-v0.2.0-android-web-preview.2-debug.apk' \
  --pattern 'SHA256SUMS.txt' \
  --dir "$old_dir"
(cd "$old_dir" && sha256sum -c SHA256SUMS.txt)

old_apk="$old_dir/SevenCode-v0.2.0-android-web-preview.2-debug.apk"
# The latest publicly installed Preview 3 uses another runner-generated debug
# certificate and must also coexist with Preview 4. Never overwrite its data.
preview3_dir="$RUNNER_TEMP/seven-preview-3-existing"
mkdir -p "$preview3_dir"
gh release download v0.2.0-android-web-preview.3 \
  --repo "$GITHUB_REPOSITORY" \
  --pattern 'SevenCode-v0.2.0-android-web-preview.3-debug.apk' \
  --pattern 'SHA256SUMS.txt' \
  --dir "$preview3_dir"
(cd "$preview3_dir" && sha256sum -c SHA256SUMS.txt)
preview3_apk="$preview3_dir/SevenCode-v0.2.0-android-web-preview.3-debug.apk"
test -s "$preview3_apk"

new_apk="mobile/android/app/build/outputs/apk/debug/app-debug.apk"
test -s "$old_apk"
test -s "$new_apk"

# Test 1: OLD preview is installed into its original package.
adb install -r "$old_apk"
adb shell pm path dev.seven.code | grep '^package:'

# Test 2: Public Preview 3 must also remain installed and unaffected.
adb install -r "$preview3_apk"
adb shell pm path dev.seven.code.preview | grep '^package:'

# Test 3: New Preview 4 must coexist with BOTH publicly installed packages.

adb install -r "$new_apk"
adb shell pm path dev.seven.code.preview4 | grep '^package:'
adb shell pm path dev.seven.code.preview | grep '^package:'
adb shell pm path dev.seven.code | grep '^package:'

# Test 3: Real original Code OSS Workbench renders and Android IME commits
# characters into an editable HTML element while both packages are present.
gradle -p mobile/android :app:connectedDebugAndroidTest \
  --no-daemon --stacktrace \
  -PsevenPreviewIsolated=true \
  -Pandroid.testInstrumentationRunnerArguments.class=dev.seven.code.SevenOfflineWebWorkbenchDeviceTest

# Test 4: Android Gradle Plugin may uninstall the target preview APK
# after connectedDebugAndroidTest as part of test cleanup. This is expected,
# not an installer failure. Original Seven Code must survive that cleanup.
adb shell pm path dev.seven.code | grep '^package:' || {
  echo "::error::Original Seven Code disappeared during Android tests"; exit 1;
}
# Restore only the isolated preview APK with the same verified bytes, then
# prove both package IDs coexist and launch the isolated application.
adb install -r "$new_apk"
adb shell pm path dev.seven.code.preview4 | grep '^package:'
adb shell pm path dev.seven.code.preview | grep '^package:'
adb shell pm path dev.seven.code | grep '^package:'
adb shell am start -W -n dev.seven.code.preview4/dev.seven.code.MainActivity
adb shell pm path dev.seven.code.preview4 | grep '^package:'
adb shell pm path dev.seven.code.preview | grep '^package:'
adb shell pm path dev.seven.code | grep '^package:'
echo "SEVEN_PREVIEW_SIDE_BY_SIDE_INSTALL_E2E_OK"
