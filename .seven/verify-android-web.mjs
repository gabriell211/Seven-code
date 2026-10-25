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
  'assets/seven-web/out/vs/workbench/workbench.web.main.internal.js',
  'assets/seven-web/out/vs/workbench/workbench.web.main.internal.css',
  'assets/seven-web/out/nls.messages.js',
  'assets/seven-web/bootstrap.js',
  'assets/seven-web/bundle.json',
  'assets/seven-web/licenses/vscode-loc-LICENSE.md',
  'assets/seven-web/extensions/seven-code-mobile-terminal/package.json',
  'assets/seven-web/extensions/seven-code-mobile-terminal/dist/browser/extension.js',
  'assets/seven-web/extensions/copilot-chat/package.json',
  'assets/seven-web/extensions/copilot-chat/dist/web.js',
  'assets/seven-web/extensions/copilot-chat/LICENSE.txt',
  'assets/seven-web/extensions/github-authentication/package.json',
  'assets/seven-web/extensions/github-authentication/dist/browser/extension.js',
  'lib/arm64-v8a/libsevenpty.so',
  'classes.dex',
]) {
  assert.ok(entries.has(entry), 'APK is missing required original Code OSS web asset: ' + entry);
}
const html = unzip(['-p', apk, 'assets/seven-web/index.html']).toString('utf8');
const bootstrap = unzip(['-p', apk, 'assets/seven-web/bootstrap.js']).toString('utf8');
assert.ok(bootstrap.includes('./out/vs/workbench/workbench.web.main.internal.js'));
assert.ok(!html.includes('{{WORKBENCH_'), 'Server template tokens were not replaced');
assert.ok(bootstrap.includes('additionalBuiltinExtensions') && bootstrap.includes('seven-code-mobile-terminal'),
  'Android native terminal extension is not registered with original Web Workbench');
assert.ok(bootstrap.includes('/extensions/copilot-chat') &&
  bootstrap.includes('/extensions/github-authentication'),
  'Real Copilot and GitHub auth are not registered with the original Web Workbench');
const copilotWeb = unzip(['-p', apk, 'assets/seven-web/extensions/copilot-chat/dist/web.js']);
assert.ok(copilotWeb.length > 100_000, 'Real compiled Copilot web worker is missing');
const copilotManifest = JSON.parse(unzip(['-p', apk,
  'assets/seven-web/extensions/copilot-chat/package.json']).toString('utf8'));
assert.equal(copilotManifest.publisher, 'GitHub');
assert.equal(copilotManifest.name, 'copilot-chat');
assert.equal(copilotManifest.browser, './dist/web.js');
assert.ok(!copilotManifest.main,
  'Android WebView cannot load the upstream Node-only Copilot entrypoint');
const githubWorker = unzip(['-p', apk,
  'assets/seven-web/extensions/github-authentication/dist/browser/extension.js']);
assert.ok(githubWorker.length > 15000, 'GitHub auth Web Worker is missing');
const githubManifest = JSON.parse(unzip(['-p', apk,
  'assets/seven-web/extensions/github-authentication/package.json']).toString('utf8'));
assert.equal(githubManifest.browser, './dist/browser/extension.js');
assert.ok(!githubManifest.main);
const metadata = JSON.parse(unzip(['-p', apk, 'assets/seven-web/bundle.json']).toString('utf8'));
assert.equal(metadata.noNodeRequiredForUi, true);
assert.equal(metadata.uiLanguage, 'pt-br', 'Unlocalized APK must not pass verification');
assert.ok(metadata.uiTranslations?.translated >= 500, 'Too few authentic Portuguese translations');
const translations = unzip(['-p', apk, 'assets/seven-web/out/nls.messages.js']).toString('utf8');
assert.ok(translations.includes('globalThis._VSCODE_NLS_LANGUAGE = "pt-br"'),
  'Workbench NLS locale missing even though HTML has lang=pt-BR');
assert.equal(metadata.remoteNodeExtensions, false);
assert.equal(metadata.copilotWebWorkerPackaged, true);
assert.equal(metadata.githubAuthWebWorkerPackaged, true);
assert.equal(metadata.githubDeviceFlowNativeBridge, true);
assert.equal(metadata.githubAuthenticationE2EVerified, false);
assert.equal(metadata.copilotNodeExtensionHostReady, false);
assert.equal(metadata.copilotAuthenticationE2EVerified, false);
console.log('Android APK contains compiled original Code OSS offline Web UI.');
console.log('Genuine Copilot Web worker is present; GitHub OAuth/Chat/Agent E2E remain unverified.');
