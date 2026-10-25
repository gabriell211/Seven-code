import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gradle = readFileSync('mobile/android/app/build.gradle.kts', 'utf8');
const manifest = readFileSync('mobile/android/app/src/main/AndroidManifest.xml', 'utf8');
const workflow = readFileSync('.github/workflows/seven-android-offline-web.yml', 'utf8');

test('unmodified Seven Code keeps the original package ID and release name', () => {
    assert.match(gradle, /applicationId = "dev\.seven\.code"/);
    assert.match(gradle, /namespace = "dev\.seven\.code"/);
    assert.match(gradle, /versionCode = 2/);
    assert.match(gradle, /manifestPlaceholders\["sevenAppLabel"\] = "Seven Code"/);
    assert.match(manifest, /android:label="\$\{sevenAppLabel\}"/);
});

test('test Web preview is separately installable, with isolated Android sandbox and unmistakable label', () => {
    assert.match(gradle, /gradleProperty\("sevenPreviewIsolated"\)/);
    assert.match(gradle, /applicationIdSuffix = "\.preview"/);
    assert.match(gradle, /versionCode = 3/);
    assert.match(gradle, /versionName = "0\.2\.0-preview\.3"/);
    assert.match(gradle, /manifestPlaceholders\["sevenAppLabel"\] = "Seven Code Preview"/);
    assert.match(workflow, /:app:assembleDebug -PsevenPreviewIsolated=true/);
    assert.match(workflow, /connectedDebugAndroidTest.*-PsevenPreviewIsolated=true/);
});

test('Android packaging must reject malformed signatures and prove old and new app coexist', () => {
    assert.match(workflow, /apksigner" verify --verbose --print-certs/);
    assert.match(workflow, /aapt" dump badging/);
    assert.match(workflow, /gh release download v0\.2\.0-android-web-preview\.2/);
    assert.match(workflow, /adb install -r "\$apk"/);
    assert.match(workflow, /adb shell pm path dev\.seven\.code\.preview/);
    assert.match(workflow, /adb shell pm path dev\.seven\.code \| grep/);
    assert.doesNotMatch(workflow, /adb uninstall dev\.seven\.code(?:\s|$)/m);
});
