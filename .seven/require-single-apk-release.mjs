import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Hard release policy: A Seven Code Android release contains exactly one
 * self-contained Android APK. Never publish a thin APK plus a server tarball.
 * A checksum text file may accompany the single APK, but not another runtime.
 *
 * Staging/debug Actions artifacts may remain separate during compilation.
 * They are NOT releases and may never be linked as an installation dependency.
 */
export const ALLOWED_RELEASE_SIDECARS = Object.freeze(['SHA256SUMS.txt']);

export function qualifyReleaseAssets(fileNames) {
  assert.ok(Array.isArray(fileNames), 'Release assets must be an array');
  const names = [...fileNames];
  const apks = names.filter(name => /^SevenCode-[a-zA-Z0-9._-]+\.apk$/.test(name));
  const invalid = names.filter(name => !apks.includes(name) &&
    !ALLOWED_RELEASE_SIDECARS.includes(name));
  if (apks.length !== 1 || invalid.length !== 0 ||
      names.length !== new Set(names).size) {
    return {
      ready: false,
      reason: 'Only one standalone SevenCode-*.apk and optional SHA256SUMS.txt are permitted. ' +
        'Server tarballs, extra ZIPs and separately downloaded runtimes are prohibited.',
      apks, invalid
    };
  }
  return { ready: true, apk: apks[0] };
}

export const MANDATORY_STANDALONE_ENTRIES = Object.freeze([
  'AndroidManifest.xml',
  'classes.dex',
  'lib/arm64-v8a/libnode.so',
  'lib/arm64-v8a/libsevenpty.so',
  'assets/seven-local/server.zip',
  'assets/seven-local/server.sha256',
  'assets/seven-local/native-libs.zip',
  'assets/seven-local/termux-provenance.json',
  'assets/seven-local/NOTICE-node.txt'
]);

export function qualifyApkEntries(entries) {
  const set = new Set(entries);
  return MANDATORY_STANDALONE_ENTRIES.filter(entry => !set.has(entry));
}

const current = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (current) {
  const folder = resolve(process.argv[2] ?? 'release-assets');
  const names = readdirSync(folder).filter(name => statSync(join(folder, name)).isFile());
  const verdict = qualifyReleaseAssets(names);
  assert.ok(verdict.ready, verdict.reason);
  const apk = join(folder, verdict.apk);
  assert.ok(statSync(apk).size > 30_000_000,
    'Thin client APK is not a standalone Code OSS distribution');

  const listed = execFileSync('unzip', ['-Z1', apk], {
    encoding: 'utf8', maxBuffer: 30_000_000
  }).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(qualifyApkEntries(listed), [],
    'APK is missing the embedded Android/Bionic Code OSS server runtime');

  execFileSync('python3', [
    join(dirname(fileURLToPath(import.meta.url)), 'verify-standalone-apk.py'), apk
  ], { stdio: 'inherit', timeout: 10 * 60_000 });

  // Compilations and emulators are insufficient: on-device E2E + Copilot
  // authentication are separately required by require-release-checks.mjs.
  console.log('Verified ONE self-contained Seven Code Android APK. ' +
    'Real-device E2E acceptance must also pass before publication.');
}
