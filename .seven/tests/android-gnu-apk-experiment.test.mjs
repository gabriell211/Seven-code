import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { validateGnuBundle } from '../package-android-gnu-experiment.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const required = [
  'out/server-main.js',
  'out/vs/code/browser/workbench/workbench.js',
  'out/vs/workbench/api/node/extensionHostProcess.js',
  'extensions/copilot/dist/extension.js',
  'product.json', 'LICENSE.txt', 'ThirdPartyNotices.txt'
];
const originals = [
  'extensions/copilot/node_modules/@github/copilot/sdk/prebuilds/linux-arm64/runtime.node',
  'extensions/copilot/node_modules/@github/copilot/sdk/prebuilds/linux-arm64/cli-native.node',
  'node_modules/@github/copilot-sdk-linux-arm64/prebuilds/linux-arm64/runtime.node',
  'node_modules/@github/copilot-sdk-linux-arm64/prebuilds/linux-arm64/copilot-runtime'
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'seven-gnu-experiment-'));
  const server = join(root, 'server');
  const closure = join(root, 'gnu');
  const put = (base, path, bytes) => {
    const target = join(base, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return target;
  };
  for (const name of required) put(server, name, Buffer.from(name));
  const commit = 'f'.repeat(40);
  put(server, 'product.json', JSON.stringify({ nameShort: 'Seven Code', commit }));
  const native = {};
  for (const name of originals) native[name] = sha(readFileSync(put(server, name, Buffer.from(name))));
  const elf = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(elf);
  elf.writeUInt16LE(183, 18);
  put(closure, 'node', elf);
  put(closure, 'ld-linux-aarch64.so.1', elf);
  const libraries = {};
  for (const lib of ['libc.so.6', 'libm.so.6', 'libgcc_s.so.1']) {
    libraries[lib] = { sha256: sha(readFileSync(put(closure, 'lib/' + lib, Buffer.from(lib)))) };
  }
  const manifest = {
    mode: 'research-only-gnu-aarch64-separate-process',
    releaseEligible: false, androidVerified: false, sourceSha: commit,
    nodeSha256: sha(elf), loaderSha256: sha(elf), libraries,
    originalCopilotElf: native
  };
  const file = put(closure, 'manifest.json', JSON.stringify(manifest));
  return { root, server, closure, file, manifest, original: originals[0] };
}

test('only all four original Copilot ARM64 binaries with SHA256-verified GNU closure are accepted for experimental packaging', () => {
  const o = fixture();
  try {
    const result = validateGnuBundle(o.server, o.closure);
    assert.equal(result.product.commit, o.manifest.sourceSha);
    assert.equal(Object.keys(result.manifest.originalCopilotElf).length, 4);
    assert.equal(result.manifest.androidVerified, false);
    assert.equal(result.manifest.releaseEligible, false);
  } finally { rmSync(o.root, { recursive: true, force: true }); }
});

test('tampered original Copilot native addons cannot be packaged', () => {
  const o = fixture();
  try {
    writeFileSync(join(o.server, o.original), 'tampered!');
    assert.throws(() => validateGnuBundle(o.server, o.closure), /Modified proprietary Copilot ELF/);
  } finally { rmSync(o.root, { recursive: true, force: true }); }
});

test('Android acceptance and release eligibility cannot be faked by a GNU research manifest', () => {
  const o = fixture();
  try {
    o.manifest.androidVerified = true;
    writeFileSync(o.file, JSON.stringify(o.manifest));
    assert.throws(() => validateGnuBundle(o.server, o.closure), /Only non-certified research input/);
    o.manifest.androidVerified = false;
    o.manifest.releaseEligible = true;
    writeFileSync(o.file, JSON.stringify(o.manifest));
    assert.throws(() => validateGnuBundle(o.server, o.closure), /Never relabel GNU staging/);
  } finally { rmSync(o.root, { recursive: true, force: true }); }
});
