import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gradle = readFileSync('mobile/android/app/build.gradle.kts', 'utf8');
const manifest = readFileSync('mobile/android/app/src/main/AndroidManifest.xml', 'utf8');
const workflow = readFileSync('.github/workflows/seven-android-offline-web.yml', 'utf8');
const emulator = readFileSync('.seven/android/verify-preview-coinstall-emulator.sh', 'utf8');

test('unmodified Seven Code keeps the original package ID and release name', () => {
    assert.match(gradle, /applicationId = "dev\.seven\.code"/);
    assert.match(gradle, /namespace = "dev\.seven\.code"/);
    assert.match(gradle, /versionCode = 2/);
    assert.match(gradle, /manifestPlaceholders\["sevenAppLabel"\] = "Seven Code"/);
    assert.match(manifest, /android:label="\$\{sevenAppLabel\}"/);
});

test('test Web preview is separately installable, with isolated Android sandbox and unmistakable label', () => {
    assert.match(gradle, /gradleProperty\("sevenPreviewIsolated"\)/);
    assert.match(gradle, /applicationIdSuffix = "\.preview4"/);
    assert.match(gradle, /versionCode = 4/);
    assert.match(gradle, /versionName = "0\.2\.0-preview\.4"/);
    assert.match(gradle, /manifestPlaceholders\["sevenAppLabel"\] = "Seven Code Preview 4"/);
    assert.match(workflow, /:app:assembleDebug -PsevenPreviewIsolated=true/);
    assert.match(emulator, /connectedDebugAndroidTest[\s\S]*-PsevenPreviewIsolated=true/);
});

test('Android packaging must reject malformed signatures and prove old and new app coexist', () => {
    assert.match(workflow, /apksigner" verify --verbose --print-certs/);
    assert.match(workflow, /aapt" dump badging/);
    assert.match(emulator, /gh release download v0\.2\.0-android-web-preview\.2/);
    assert.match(emulator, /gh release download v0\.2\.0-android-web-preview\.3/);
    assert.match(emulator, /adb shell pm path dev\.seven\.code\.preview \| grep/);
    assert.match(emulator, /adb install -r "\$new_apk"/);
    assert.match(emulator, /adb shell pm path dev\.seven\.code\.preview4/);
    assert.match(emulator, /adb shell pm path dev\.seven\.code \| grep/);
    assert.doesNotMatch(emulator, /adb uninstall dev\.seven\.code(?:\s|$)/m);
});

test('real emulator co-install steps execute in one bash process, not separate POSIX sh commands', () => {
    assert.match(workflow, /bash \.seven\/android\/verify-preview-coinstall-emulator\.sh/);
    assert.match(emulator, /^#!\/usr\/bin\/env bash/m);
    assert.match(emulator, /set -euo pipefail/);
    assert.match(emulator, /sha256sum -c SHA256SUMS\.txt/);
    assert.match(emulator, /SEVEN_PREVIEW_SIDE_BY_SIDE_INSTALL_E2E_OK/);
});
