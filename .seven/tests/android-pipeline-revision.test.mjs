import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const compile = readFileSync('.github/workflows/seven-android-codeoss-arm64.yml', 'utf8');
const native = readFileSync('.github/workflows/seven-android-bionic-addons.yml', 'utf8');
const apk = readFileSync('.github/workflows/seven-android-single-apk.yml', 'utf8');

test('every Code OSS source and Android runtime change triggers a fresh ARM64 build', () => {
  for (const path of ['src/**', 'extensions/**', 'remote/**', 'build/**',
    'mobile/android/**', '.seven/android/**', 'product.json',
    'package.json', 'package-lock.json']) {
    assert.ok(compile.includes(JSON.stringify(path)), 'Missing rebuild trigger: ' + path);
  }
});

test('native addons and APK reuse an actual successful upstream commit, never historic CI artifacts', () => {
  assert.match(native, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(apk, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(native, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(apk, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(apk, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  for (const flow of [native, apk]) {
    assert.doesNotMatch(flow, /^  workflow_dispatch:/m);
    assert.doesNotMatch(flow, /^  push:/m);
    assert.doesNotMatch(flow, /40052793301|40054225003/);
  }
});

test('incomplete native ABI remains a hard stop, not a successful staging build', () => {
  assert.match(native, /grep -Fxq 'ABI_STATUS=READY'/);
  assert.match(native, /exit 1/);
  assert.match(apk, /--stage android-bionic/);
  assert.match(apk, /require-single-apk-release\.mjs/);
});
