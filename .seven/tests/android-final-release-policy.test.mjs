import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const release = readFileSync('.github/workflows/seven-android-final-release.yml', 'utf8');
const packagePolicy = readFileSync('.seven/require-single-apk-release.mjs', 'utf8');
const acceptance = readFileSync('.seven/require-release-checks.mjs', 'utf8');

test('release triggers only after real single-APK compilation success', () => {
  assert.match(release, /Seven Code Android - assemble single self-contained APK/);
  assert.match(release, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(release, /download-artifact@v4/);
  assert.match(release, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(release, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
});

test('release refuses split artifacts, stale SHAs, unverified binaries and debug signatures', () => {
  assert.match(release, /require-single-apk-release\.mjs release-assets/);
  assert.match(release, /sha256sum --check SHA256SUMS\.txt/);
  assert.match(release, /Main advanced since Code OSS was compiled/);
  assert.match(release, /SEVEN_ANDROID_RELEASE_KEYSTORE_BASE64/);
  assert.match(release, /--ks-pass env:RELEASE_STORE_PASSWORD/);
  assert.match(release, /Android debug certificate detected/);
  assert.match(release, /zipalign/);
  assert.ok(release.includes('sha256sum SevenCode-Android-arm64-local-release.apk'));
  assert.match(packagePolicy, /Only one standalone/);
});

test('release cannot bypass on-device and authenticated Copilot acceptance', () => {
  assert.match(release, /SEVEN_RELEASE_PLATFORM: android/);
  assert.match(release, /require-release-checks\.mjs/);
  assert.match(acceptance, /Seven Code Copilot real OAuth and terminal Agent E2E/);
  assert.match(acceptance, /Seven Code Android workbench and native PTY E2E/);
});
