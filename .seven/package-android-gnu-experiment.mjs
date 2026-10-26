#!/usr/bin/env node
/**
 * BUNDLE RESEARCH ONLY: create one Android debug APK input containing the
 * original Linux/ARM64 Code OSS and Copilot, GNU loader and closure libraries.
 *
 * This never produces a release, never asserts Android compatibility, and
 * MUST NOT bypass the strict Bionic production APK audit/release E2E.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REQUIRED = Object.freeze([
  'out/server-main.js',
  'out/vs/code/browser/workbench/workbench.js',
  'out/vs/workbench/api/node/extensionHostProcess.js',
  'extensions/copilot/dist/extension.js',
  'product.json',
  'LICENSE.txt',
  'ThirdPartyNotices.txt'
]);
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export function validateGnuBundle(server, closure) {
  for (const path of REQUIRED) {
    assert.ok(statSync(join(server, path)).isFile(), 'Missing ORIGINAL Code OSS: ' + path);
  }
  const manifest = JSON.parse(readFileSync(join(closure, 'manifest.json'), 'utf8'));
  assert.equal(manifest.mode, 'research-only-gnu-aarch64-separate-process');
  assert.equal(manifest.androidVerified, false, 'Only non-certified research input allowed');
  assert.equal(manifest.releaseEligible, false, 'Never relabel GNU staging as Android accepted');
  assert.equal(sha(join(closure, 'node')), manifest.nodeSha256);
  assert.equal(sha(join(closure, 'ld-linux-aarch64.so.1')), manifest.loaderSha256);
  assert.equal(Object.keys(manifest.originalCopilotElf).length, 4);
  assert.ok(Object.keys(manifest.libraries).length >= 3);
  for (const [name, metadata] of Object.entries(manifest.libraries)) {
    assert.match(name, /^[a-zA-Z0-9._+-]+$/, 'Unsafe GNU dependency name');
    assert.equal(sha(join(closure, 'lib', name)), metadata.sha256);
  }
  for (const [path, expected] of Object.entries(manifest.originalCopilotElf)) {
    assert.match(path, /^(node_modules|extensions)\//, 'Unsafe Copilot binary relative path');
    assert.ok(!path.includes('..'), 'Unsafe native Copilot path');
    assert.equal(sha(join(server, path)), expected, 'Modified proprietary Copilot ELF: ' + path);
  }
  const product = JSON.parse(readFileSync(join(server, 'product.json'), 'utf8'));
  assert.match(product.commit, /^[a-f0-9]{40}$/);
  assert.equal(product.nameShort, 'Seven Code');
  if (manifest.sourceSha) assert.equal(manifest.sourceSha, product.commit);
  for (const file of ['node', 'ld-linux-aarch64.so.1']) {
    const elf = readFileSync(join(closure, file)).subarray(0, 20);
    assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46');
    assert.equal(elf.readUInt16LE(18), 183, 'GNU runtime must use ARM64');
  }
  return { manifest, product };
}

export function bundle(server, closure) {
  const { manifest } = validateGnuBundle(server, closure);
  const assets = join(project, 'mobile/android/app/src/main/assets/seven-local');
  const jni = join(project, 'mobile/android/app/src/main/jniLibs/arm64-v8a');
  mkdirSync(assets, { recursive: true });
  mkdirSync(jni, { recursive: true });
  const serverZip = join(assets, 'server.zip');
  rmSync(serverZip, { force: true });
  execFileSync('zip', ['-q', '-r', '-X', serverZip, '.'], {
    cwd: server, timeout: 1_200_000
  });
  const bytes = statSync(serverZip).size;
  assert.ok(bytes >= 30_000_000 && bytes <= 500_000_000,
    'Original GNU Code OSS must be complete and fit inside a single APK');
  writeFileSync(join(assets, 'server.sha256'), sha(serverZip) + '\n');

  // Original LGPL/glibc SONAMEs (.so.6 etc.) cannot be Android jniLibs.
  // Keep their SHA256-verified bytes in an asset, extracted in private data
  // at startup by SevenLocalGnuRuntime. No external Termux installation.
  const libzip = join(assets, 'gnu-libs.zip');
  rmSync(libzip, { force: true });
  const names = readdirSync(join(closure, 'lib')).sort();
  execFileSync('zip', ['-q', '-X', '-9', libzip, ...names], {
    cwd: join(closure, 'lib'), timeout: 300_000
  });
  assert.ok(statSync(libzip).size >= 1_000_000);
  // The signed experimental APK supplies the exact Node IPC probe script.
  // Bind it to the GNU provenance manifest so Android can verify bytes
  // before executing it via the already-verified local ARM64 loader.
  const forkProbe = join(project, '.seven/android/gnu-node-fork-probe.cjs');
  const forkProbeInApk = join(assets, 'gnu-node-fork-probe.cjs');
  copyFileSync(forkProbe, forkProbeInApk);
  const gnuManifest = { ...manifest, nodeForkProbeSha256: sha(forkProbeInApk) };
  writeFileSync(join(assets, 'gnu-manifest.json'), JSON.stringify(gnuManifest, null, 2) + '\n');
  const noticesZip = join(assets, 'gnu-notices.zip');
  rmSync(noticesZip, { force: true });
  const notices = readdirSync(join(closure, 'notices')).sort();
  assert.ok(notices.length > 0, 'GNU LGPL/copyright notices must accompany binaries');
  execFileSync('zip', ['-q', '-X', '-9', noticesZip, ...notices], {
    cwd: join(closure, 'notices'), timeout: 300_000
  });
  copyFileSync(join(closure, 'node'), join(jni, 'libseven-gnu-node.so'));
  copyFileSync(join(closure, 'ld-linux-aarch64.so.1'), join(jni, 'libseven-gnu-loader.so'));
  console.log('Experimental single APK GNU staging prepared:', bytes, 'Code OSS ZIP bytes');
  console.log('GNU original Copilot objects:', Object.keys(manifest.originalCopilotElf).length);
  console.log('No Android device, OAuth or release acceptance claimed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [server, closure] = process.argv.slice(2);
  if (!server || !closure) {
    console.error('Usage: node .seven/package-android-gnu-experiment.mjs CODEOSS_DIR GNU_CLOSURE_DIR');
    process.exit(2);
  }
  bundle(resolve(server), resolve(closure));
}
