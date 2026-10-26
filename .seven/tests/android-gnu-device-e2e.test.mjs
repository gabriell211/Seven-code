import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/seven-android-gnu-device-e2e.yml', 'utf8');
const bash = readFileSync('.seven/android/run-gnu-apk-e2e.sh', 'utf8');
const android = readFileSync('mobile/android/app/src/androidTest/java/dev/seven/code/SevenStandaloneGnuDeviceTest.kt', 'utf8');
const terminalWorkflow = readFileSync('.github/workflows/seven-mobile-android.yml', 'utf8');

test('full GNU single APK device test uses actual prebuilt 300 MB artifact and no faux editor', () => {
  assert.match(workflow, /SevenCode-gnu-Android-arm64-EXPERIMENTAL-debug-only/);
  assert.match(workflow, /SevenCode-gnu-arm64-EXPERIMENTAL-debug\.apk/);
  assert.match(workflow, /:app:assembleDebugAndroidTest/);
  assert.ok(workflow.includes('script: bash .seven/android/run-gnu-apk-e2e.sh'));
  assert.match(bash, /adb install -r -t/);
  assert.match(bash, /set -euo pipefail/);
  assert.ok(bash.includes('seven-gnu-e2e.keystore'));
  assert.ok(bash.includes('diagnose_android_codeoss_failure'));
  assert.ok(bash.includes('redacted-local-token'));
  assert.ok(bash.includes('server.log'));
  assert.ok(bash.includes('startup-phase.txt'));
  assert.ok(android.includes('startup-phase.txt'));
  assert.ok(android.includes('startsWith("failed-at:")'));
  assert.ok(android.includes('Original local runtime failed:'));

  assert.ok(bash.includes('keytool -genkeypair'));
  assert.ok(bash.includes('test -n "$app_cert" && test "$app_cert" = "$test_cert"'));
  assert.ok(bash.includes('apksigner'));
  assert.ok(bash.includes('verify-gnu-apk.py'));
  assert.ok(bash.includes('same certificate'));

  assert.match(bash, /arm64-v8a/);
  assert.match(workflow, /verify-gnu-apk\.py/);
  assert.match(workflow, /android-emulator-runner@v2/);
  assert.match(workflow, /native-arm64-codeoss:/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /arch: arm64-v8a/);
  assert.match(workflow, /Prove this is a genuine Apple Silicon ARM64 runner/);

  assert.match(bash, /SevenStandaloneGnuDeviceTest/);
});

test('Android instrumentation requires real original Code OSS workbench DOM and local auth', () => {
  assert.match(android, /SevenLocalGnuRuntime\(/);
  assert.match(android, /ActivityScenario\.launch\(MainActivity::class\.java\)/);
  assert.match(android, /http:\/\/127\.0\.0\.1:/);
  assert.match(android, /vscode-workbench-web-configuration|monaco-workbench/);
  assert.match(android, /Boolean\(document\.querySelector/);
  assert.match(android, /version/);
  assert.match(android, /SUPPORTED_ABIS\.firstOrNull\(\) == "arm64-v8a"/);
  assert.match(android, /android\.os\.Process\.is64Bit\(\)/);
  assert.match(bash, /ro\.product\.cpu\.abi/);
  assert.match(bash, /GNU native ARM64 acceptance cannot run/);
});

test('GNU device diagnostic installs as an isolated APK without replacing Seven Code', () => {
  const gradle = readFileSync('mobile/android/app/build.gradle.kts', 'utf8');
  const gnuWorkflow = readFileSync('.github/workflows/seven-android-gnu-apk-experiment.yml', 'utf8');
  const physical = readFileSync('.github/workflows/seven-android-physical-arm64-e2e.yml', 'utf8');
  const testScript = readFileSync('mobile/android/tools/test-gnu-node-arm64-device.ps1', 'utf8');
  assert.match(gradle, /sevenGnuExperiment/);
  assert.match(gradle, /applicationIdSuffix = "\.gnu"/);
  assert.match(gradle, /Seven Code GNU Test/);
  assert.match(gnuWorkflow, /-PsevenGnuExperiment=true/);
  assert.match(gnuWorkflow, /package: name='dev\.seven\.code\.gnu'/);
  assert.match(workflow, /-PsevenGnuExperiment=true/);
  assert.match(physical, /-PsevenGnuExperiment=true/);
  assert.match(bash, /dev\.seven\.code\.gnu\.test\/androidx\.test\.runner\.AndroidJUnitRunner/);
  assert.match(bash, /run-as dev\.seven\.code\.gnu/);
  assert.match(testScript, /ro\.product\.cpu\.abi/);
  assert.match(testScript, /ro\.kernel\.qemu/);
  assert.match(testScript, /adb -s \$serial install -t \$apk/);
  assert.doesNotMatch(testScript, /adb .*uninstall|install -r/i);
  assert.match(testScript, /SEVEN_GNU_FORK_IPC_OK/);
  assert.match(testScript, /gnu-node-version-probe\.log/);
});

test('native GNU startup records failure evidence before claiming Node success', () => {
  const runtime = readFileSync('mobile/android/app/src/main/java/dev/seven/code/SevenLocalGnuRuntime.kt', 'utf8');
  const server = readFileSync('mobile/android/app/src/main/java/dev/seven/code/SevenLocalCodeOssServer.kt', 'utf8');
  assert.match(runtime, /SUPPORTED_ABIS\.firstOrNull\(\)/);
  assert.match(runtime, /Process\.is64Bit\(\)/);
  assert.match(server, /gnu-node-version-probe\.log/);
  assert.match(server, /gnu-platform-probe\.txt/);
  assert.match(server, /redirectOutput\(log\)/);
  assert.match(server, /waitFor\(15, TimeUnit\.SECONDS\)/);
  assert.match(server, /SIGSYS possível/);
  assert.match(bash, /gnu-node-version-probe\.log/);
  assert.match(bash, /gnu-platform-probe\.txt/);
});

test('passing an emulator does not claim Copilot OAuth or final release', () => {
  assert.ok(bash.includes('Copilot OAuth/Agent E2E'));
  assert.match(workflow, /NO release/);
  assert.doesNotMatch(workflow, /gh release create/);
});

test('native PTY emulator never runs full GNU editor E2E against a thin test APK', () => {
  assert.ok(terminalWorkflow.includes('android.testInstrumentationRunnerArguments.notClass=dev.seven.code.SevenStandaloneGnuDeviceTest'));
  assert.ok(bash.includes('-e class dev.seven.code.SevenStandaloneGnuDeviceTest'));
});

test('end-to-end emulator checks wait for successful complete APK and do not race unfinished builds', () => {
  assert.doesNotMatch(workflow.split('permissions:')[0], /\\n  push:/);
  assert.ok(workflow.includes("github.event.workflow_run.conclusion == 'success'"));
  assert.ok(workflow.includes('run-id: ${{ steps.apk_source.outputs.run_id }}'));
  const upstream = readFileSync('.github/workflows/seven-android-codeoss-arm64.yml', 'utf8');
  const assembler = readFileSync('.github/workflows/seven-android-gnu-apk-experiment.yml', 'utf8');
  // The GNU APK now starts only from the compiled/provenanced ARM64 chain.
  // Changes in Android proof scripts must restart that upstream chain.
  assert.ok(upstream.includes('".seven/android/**"'));
  assert.ok(assembler.includes('workflow_run:'));
  assert.ok(readFileSync('.github/workflows/seven-android-gnu-device-e2e.yml', 'utf8')
    .includes('script: bash .seven/android/run-gnu-apk-e2e.sh'));
});
