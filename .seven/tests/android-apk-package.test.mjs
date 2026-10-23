import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_APK_ENTRIES, verifyApkEntries } from '../verify-android-apk.mjs';

test('a packed ARM64/x86_64 Android runtime contains all indispensable files', () => {
  assert.deepEqual(verifyApkEntries(REQUIRED_APK_ENTRIES), []);
});
test('APK without ARM64 PTY cannot pass release validation', () => {
  assert.deepEqual(
    verifyApkEntries(REQUIRED_APK_ENTRIES.filter(name => !name.includes('arm64-v8a'))),
    ['lib/arm64-v8a/libsevenpty.so']
  );
});
test('APK containing only the Android manifest is never a valid packaged runtime', () => {
  assert.equal(verifyApkEntries(['AndroidManifest.xml']).length, 4);
});
