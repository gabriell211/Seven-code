import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_APK_ENTRIES, verifyApkEntries, verifyArm64ElfPageAlignment } from '../verify-android-apk.mjs';

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

test('Android ARM64 16 KiB memory pages reject 4 KiB ELF PT_LOAD alignment', () => {
  const program = align => [
    'Elf file type is DYN (Shared object file)',
    '  LOAD   0x000000 0x0000000000000000 0x0000000000000000 0x020000 0x020000 R E  ' + align,
    '  LOAD   0x020000 0x0000000000030000 0x0000000000030000 0x001000 0x001000 RW   ' + align
  ].join('\\n');
  assert.equal(verifyArm64ElfPageAlignment(program('0x1000')), false);
  assert.equal(verifyArm64ElfPageAlignment(program('0x4000')), true);
  assert.equal(verifyArm64ElfPageAlignment(program('0x10000')), true);
  assert.equal(verifyArm64ElfPageAlignment('There are no program headers in this file.'), false);
  assert.equal(verifyArm64ElfPageAlignment(program('0x4000').replace('0x4000', '0x1000')), false);
});
