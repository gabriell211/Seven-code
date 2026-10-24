#!/usr/bin/env node
/** Verifies compiled Web Workbench bytes are IN the APK. Device E2E is separate. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const apk = resolve(process.argv[2] ?? 'mobile/android/app/build/outputs/apk/debug/app-debug.apk');
assert.ok(statSync(apk).size > 5_000_000, 'APK is a thin host, not bundled Web Workbench');
const unzip = args => execFileSync('unzip', args, { maxBuffer: 15_000_000 });
const entries = new Set(unzip(['-Z1', apk]).toString().trim().split(/\r?\n/));
for (const entry of [
  'assets/seven-web/index.html',
  'assets/seven-web/out/vs/code/browser/workbench/workbench.js',
  'assets/seven-web/out/vs/code/browser/workbench/workbench.css',
  'assets/seven-web/out/nls.messages.js',
  'assets/seven-web/bundle.json',
  'lib/arm64-v8a/libsevenpty.so',
  'classes.dex',
]) {
  assert.ok(entries.has(entry), 'APK is missing required original Code OSS web asset: ' + entry);
}
const html = unzip(['-p', apk, 'assets/seven-web/index.html']).toString('utf8');
assert.ok(html.includes('/assets/seven-web/out/vs/code/browser/workbench/workbench.js'));
assert.ok(!html.includes('{{WORKBENCH_'), 'Server template tokens were not replaced');
const metadata = JSON.parse(unzip(['-p', apk, 'assets/seven-web/bundle.json']).toString('utf8'));
assert.equal(metadata.noNodeRequiredForUi, true);
assert.equal(metadata.remoteNodeExtensions, false);
console.log('Android APK contains compiled original Code OSS offline Web UI.');
console.log('Only Android emulator/device E2E can prove startup; Node extensions/Copilot remain unverified.');
