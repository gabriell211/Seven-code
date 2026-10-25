import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('extensions/seven-code-node-runtime-smoke/package.json'));
const source = readFileSync('extensions/seven-code-node-runtime-smoke/extension.js', 'utf8');
const android = readFileSync('mobile/android/app/src/main/java/dev/seven/code/SevenLocalCodeOssServer.kt', 'utf8');
const device = readFileSync('mobile/android/app/src/androidTest/java/dev/seven/code/SevenStandaloneGnuDeviceTest.kt', 'utf8');
const workflow = readFileSync('.github/workflows/seven-android-codeoss-arm64.yml', 'utf8');

test('Only a genuine Node workspace extension host can create Android Node acceptance evidence', () => {
  assert.equal(manifest.main, './extension.js');
  assert.deepEqual(manifest.extensionKind, ['workspace']);
  assert.ok(manifest.activationEvents.includes('onStartupFinished'));
  assert.match(source, /require\('node:child_process'\)/);
  assert.match(source, /childProcess\.fork\(/);
  assert.match(source, /child\.once\('message'/);
  assert.match(source, /SEVEN_ANDROID_NODE_PROOF_DIR/);
  assert.match(source, /copilotNativeAddonLoaded/);
  assert.match(source, /runtime\.node/);
  assert.match(android, /put\("SEVEN_ANDROID_NODE_PROOF_DIR", context\.filesDir\.absolutePath\)/);
  assert.match(workflow, /cp extensions\/seven-code-node-runtime-smoke\/package\.json/);
});
test('physical Android GNU acceptance cannot be faked by Web-only editor or Linux ARM64 CI', () => {
  assert.match(device, /seven-code-node-runtime-proof\.json/);
  assert.match(device, /testStartedAt/);
  assert.match(device, /nodeForkOk/);
  assert.match(device, /copilotNativeAddonLoaded/);
  assert.match(device, /Original Android Node workspace extension host did not activate/);
});

test('Linux-only development smoke REALLY forks a Node child and receives IPC (NOT Android E2E)', async () => {
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const require = createRequire(import.meta.url);
  const extensionFile = resolve('extensions/seven-code-node-runtime-smoke/extension.js');
  const testModule = { exports: {} };
  const fakeVsCode = { commands: { registerCommand: () => ({ dispose() {} }) },
    window: { showInformationMessage: async () => undefined } };
  const factory = vm.runInNewContext(
    '(function(require,module,exports,__dirname,process,setTimeout,clearTimeout) {\\n' +
      source + '\\n})',
    { console }
  );
  factory(name => name === 'vscode' ? fakeVsCode : require(name),
    testModule, testModule.exports, dirname(extensionFile),
    process, setTimeout, clearTimeout);
  const result = await testModule.exports.verifyNodeHost();
  assert.equal(result.kind, 'seven-code-original-node-extension-host-live');
  assert.equal(result.nodeForkOk, true, 'real Node fork+IPC must work on CI Linux');
  assert.equal(result.node, process.versions.node);
  assert.equal(result.pid, process.pid);
  // A GNU/Linux test is NOT evidence of Android/Bionic.
  assert.equal(result.platform, process.platform);
});
