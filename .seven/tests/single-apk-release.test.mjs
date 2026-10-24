import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qualifyReleaseAssets, qualifyApkEntries, MANDATORY_STANDALONE_ENTRIES } from '../require-single-apk-release.mjs';

test('release policy accepts one standalone APK, optionally with checksum text', () => {
  assert.equal(qualifyReleaseAssets(['SevenCode-v1.0.0-Android.apk']).ready, true);
  assert.equal(qualifyReleaseAssets(['SevenCode-v1.0.0-Android.apk', 'SHA256SUMS.txt']).ready, true);
});
test('release policy rejects old 1 MB thin APK + separately downloaded server', () => {
  assert.equal(qualifyReleaseAssets([
    'SevenCode-v0.2.0-Android.apk', 'SevenCode-Server-Web-linux-x64.tar.gz'
  ]).ready, false);
  assert.equal(qualifyReleaseAssets(['SevenCode-v1.0.apk', 'SevenCode-Node-Android.zip']).ready, false);
});
test('release policy rejects two APKs, missing APK and simulator-only ZIP', () => {
  assert.equal(qualifyReleaseAssets(['SevenCode-A.apk', 'SevenCode-B.apk']).ready, false);
  assert.equal(qualifyReleaseAssets(['SHA256SUMS.txt']).ready, false);
  assert.equal(qualifyReleaseAssets(['SevenCode-iOS-Simulator.zip']).ready, false);
  assert.equal(qualifyReleaseAssets(['SevenCode-A.apk', 'SevenCode-A.apk']).ready, false);
});
test('standalone APK requires Code OSS, Node Bionic and native dependencies inside same package', () => {
  assert.deepEqual(qualifyApkEntries(MANDATORY_STANDALONE_ENTRIES), []);
  const thin = ['AndroidManifest.xml', 'classes.dex', 'lib/arm64-v8a/libsevenpty.so'];
  assert.ok(qualifyApkEntries(thin).includes('assets/seven-local/server.zip'));
  assert.ok(qualifyApkEntries(thin).includes('lib/arm64-v8a/libnode.so'));
  assert.ok(qualifyApkEntries(thin).includes('assets/seven-local/native-libs.zip'));
});
test('retired preview and alpha workflows on main cannot publish split assets', () => {
  for (const file of [
    'seven-android-preview-release.yml', 'seven-android-preview2-release.yml',
    'seven-alpha-release.yml', 'seven-alpha2-release.yml', 'seven-alpha3-release.yml'
  ]) {
    const text = readFileSync('.github/workflows/' + file, 'utf8');
    const legacy = /^  (publish|release):\n\s+# DISABLED:[^\n]+\n(?:[^\n]*\n)*?\s+if: \$\{\{ false \}\}/m.test(text);
    assert.ok(legacy, 'Legacy publisher must remain disabled: ' + file);
  }
});
