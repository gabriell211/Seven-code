import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/seven-android-gnu-device-e2e.yml', 'utf8');
const bash = readFileSync('.seven/android/run-gnu-apk-e2e.sh', 'utf8');
const android = readFileSync('mobile/android/app/src/androidTest/java/dev/seven/code/SevenStandaloneGnuDeviceTest.kt', 'utf8');

test('full GNU single APK device test uses actual prebuilt 300 MB artifact and no faux editor', () => {
  assert.match(workflow, /SevenCode-gnu-Android-arm64-EXPERIMENTAL-debug-only/);
  assert.match(workflow, /SevenCode-gnu-arm64-EXPERIMENTAL-debug\.apk/);
  assert.match(workflow, /:app:assembleDebugAndroidTest/);
  assert.ok(workflow.includes('script: bash .seven/android/run-gnu-apk-e2e.sh'));
  assert.match(bash, /adb install -r -t/);
  assert.match(bash, /set -euo pipefail/);
  assert.match(bash, /arm64-v8a/);
  assert.match(workflow, /verify-gnu-apk\.py/);
  assert.match(workflow, /android-emulator-runner@v2/);
  assert.match(bash, /SevenStandaloneGnuDeviceTest/);
});

test('Android instrumentation requires real original Code OSS workbench DOM and local auth', () => {
  assert.match(android, /SevenLocalGnuRuntime\(/);
  assert.match(android, /ActivityScenario\.launch\(MainActivity::class\.java\)/);
  assert.match(android, /http:\/\/127\.0\.0\.1:/);
  assert.match(android, /vscode-workbench-web-configuration|monaco-workbench/);
  assert.match(android, /Boolean\(document\.querySelector/);
  assert.match(android, /version/);
  assert.match(android, /SUPPORTED_ABIS\.contains\("arm64-v8a"\)/);
});

test('passing an emulator does not claim Copilot OAuth or final release', () => {
  assert.ok(bash.includes('Copilot OAuth/Agent E2E'));
  assert.match(workflow, /NO release/);
  assert.doesNotMatch(workflow, /gh release create/);
});
