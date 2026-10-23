import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Verifies binary Android artifacts, not app feature completeness.
// A tiny-but-valid APK is still only a thin client if the Code OSS workbench
// and Node extension hosts run on the separately deployed server.
export const REQUIRED_APK_ENTRIES = Object.freeze([
  'AndroidManifest.xml',
  'classes.dex',
  'resources.arsc',
  'lib/arm64-v8a/libsevenpty.so',
  'lib/x86_64/libsevenpty.so',
]);

export function verifyApkEntries(entries) {
  const actual = new Set(entries);
  return REQUIRED_APK_ENTRIES.filter(name => !actual.has(name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const apk = resolve(process.argv[2] ?? 'mobile/android/app/build/outputs/apk/debug/app-debug.apk');
  const bytes = statSync(apk).size;
  assert.ok(bytes > 100_000, 'APK is unexpectedly tiny or empty');
  const entries = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8', maxBuffer: 10_000_000 })
    .split(/\r?\n/).filter(Boolean);
  const missing = verifyApkEntries(entries);
  assert.deepEqual(missing, [], 'Android APK is missing a required native/runtime component');
  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  assert.ok(androidHome, 'Android SDK is required to inspect app manifest');
  const aapt = resolve(androidHome, 'build-tools', '36.0.0', 'aapt');
  const badging = execFileSync(aapt, ['dump', 'badging', apk], {
    encoding: 'utf8', maxBuffer: 2_000_000
  });
  assert.match(badging, /package: name='dev\.seven\.code'/, 'Unexpected Android app ID');
  assert.match(badging, /sdkVersion:'26'/, 'Unexpected min SDK');
  console.log('Android APK verified:', bytes, 'bytes, ARM64/x86_64 JNI, DEX, manifest and app ID.');
  console.log('This proves APK packaging only, NOT full Code OSS/Copilot E2E.');
}
