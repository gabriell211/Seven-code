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
    const out = join(compiled, 'out/vs/code/browser/workbench');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'workbench.js'), Buffer.alloc(1_000_001, 33));
    writeFileSync(join(out, 'workbench.css'), '.monaco-workbench{display:block}');
    writeFileSync(join(compiled, 'out/nls.messages.js'), 'globalThis._VSCODE_NLS_MESSAGES=[];');
    execFileSync(process.execPath, [
      '.seven/package-android-web.mjs', compiled, destination,
    ], { encoding: 'utf8' });
    const html = readFileSync(join(destination, 'index.html'), 'utf8');
    assert.match(html, /id="vscode-workbench-web-configuration"/);
    assert.match(html, /seven-web\/out\/vs\/code\/browser\/workbench\/workbench\.js/);
    assert.match(html, /seven-web\/out\/nls\.messages\.js/);
    assert.doesNotMatch(html, /\{\{WORKBENCH_/);
    assert.doesNotMatch(html, /remoteAuthority|https:\/\/vscode\.dev|127\.0\.0\.1/);
    assert.ok(existsSync(join(destination, 'out/vs/code/browser/workbench/workbench.js')));
    const metadata = JSON.parse(readFileSync(join(destination, 'bundle.json'), 'utf8'));
    assert.equal(metadata.noNodeRequiredForUi, true);
    assert.equal(metadata.remoteNodeExtensions, false);
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
