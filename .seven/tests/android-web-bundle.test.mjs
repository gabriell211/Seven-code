import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Android packages ORIGINAL static Code OSS web workbench with no URL prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seven-code-web-'));
  const compiled = join(dir, 'vscode-web');
  const destination = join(dir, 'android-assets');
  try {
    const out = join(compiled, 'out/vs/workbench');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'workbench.web.main.internal.js'), Buffer.alloc(1_000_001, 33));
    writeFileSync(join(out, 'workbench.web.main.internal.css'), '.monaco-workbench{display:block}');
    writeFileSync(join(compiled, 'out/nls.messages.js'), 'globalThis._VSCODE_NLS_MESSAGES=[];');
    const copilot = join(dir, 'copilot-source-fixture');
    mkdirSync(join(copilot, 'dist'), { recursive: true });
    writeFileSync(join(copilot, 'dist/web.js'), Buffer.alloc(100_001, 33));
    writeFileSync(join(copilot, 'dist/tree-sitter.wasm'), Buffer.alloc(32, 42));
    writeFileSync(join(copilot, 'dist/tikTokenizerWorker.js'), 'self.onmessage=()=>{}');
    writeFileSync(join(copilot, 'package.json'), JSON.stringify({
      name: 'copilot-chat', publisher: 'GitHub',
      version: '0.72.0', main: './dist/extension.js', contributes: { commands: [] },
    }));
    writeFileSync(join(copilot, 'LICENSE.txt'), 'MIT License fixture for build test');
    execFileSync(process.execPath, [
      '.seven/package-android-web.mjs', compiled, destination, copilot,
    ], { encoding: 'utf8' });
    const html = readFileSync(join(destination, 'index.html'), 'utf8');
    const bootstrap = readFileSync(join(destination, 'bootstrap.js'), 'utf8');
    assert.match(html, /id="seven-code-root"/);
    assert.match(bootstrap, /workbench\.web\.main\.internal\.js/);
    assert.match(html, /workbench\.web\.main\.internal\.css/);
    assert.match(bootstrap, /out\/nls\.messages\.js/);
    assert.doesNotMatch(html, /\{\{WORKBENCH_/);
    assert.doesNotMatch(html, /remoteAuthority|https:\/\/vscode\.dev|127\.0\.0\.1/);
    assert.ok(existsSync(join(destination, 'out/vs/workbench/workbench.web.main.internal.js')));
    assert.ok(existsSync(join(destination, 'extensions/seven-code-mobile-terminal/package.json')));
    assert.ok(existsSync(join(destination, 'extensions/seven-code-mobile-terminal/dist/browser/extension.js')));
    assert.match(bootstrap, /additionalBuiltinExtensions/);
    assert.match(bootstrap, /seven-code-mobile-terminal/);
    assert.match(bootstrap, /copilot-chat/);
    assert.match(bootstrap, /github-authentication/);
    const copilotManifest = JSON.parse(readFileSync(
      join(destination, 'extensions/copilot-chat/package.json'), 'utf8'
    ));
    assert.equal(copilotManifest.browser, './dist/web.js');
    assert.equal(copilotManifest.main, undefined);
    assert.ok(existsSync(join(destination, 'extensions/copilot-chat/dist/web.js')));
    assert.ok(existsSync(join(destination, 'extensions/copilot-chat/dist/tree-sitter.wasm')));
    assert.ok(existsSync(join(destination, 'extensions/copilot-chat/dist/tikTokenizerWorker.js')));
    assert.ok(existsSync(join(destination, 'extensions/copilot-chat/LICENSE.txt')));
    const metadata = JSON.parse(readFileSync(join(destination, 'bundle.json'), 'utf8'));
    assert.equal(metadata.noNodeRequiredForUi, true);
    assert.equal(metadata.remoteNodeExtensions, false);
    assert.equal(metadata.copilotWebWorkerPackaged, true);
    assert.equal(metadata.copilotNodeExtensionHostReady, false);
    assert.equal(metadata.copilotAuthenticationE2EVerified, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Android virtual HTTPS origin only serves bundled Web assets', () => {
  const kotlin = readFileSync('mobile/android/app/src/main/java/dev/seven/code/MainActivity.kt', 'utf8');
  assert.match(kotlin, /WebViewAssetLoader\.AssetsPathHandler/);
  assert.match(kotlin, /https:\/\/appassets\.androidplatform\.net\/assets\/seven-web\/index\.html/);
  assert.match(kotlin, /openWorkbench\(embeddedWebUrl\)/);
  assert.match(kotlin, /webAssetLoader\.shouldInterceptRequest/);
  assert.match(kotlin, /WebViewCompat\.addWebMessageListener/);
  assert.match(kotlin, /sourceOrigin\.toString\(\) != trustedOrigin/);
});
