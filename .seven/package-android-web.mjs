#!/usr/bin/env node
/**
 * Packages Code - OSS's real, standalone "web" bundle in an Android APK.
 * The web gulp target exports the embedder API, NOT the server-side HTML shell.
 * Rendering the editor therefore does not require running Node on the phone.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const buildRoot = resolve(process.argv[2] ?? '../vscode-web');
const destination = resolve(process.argv[3] ?? 'mobile/android/app/src/main/assets/seven-web');
const copilotSource = resolve(process.argv[4] ?? 'extensions/copilot');
const githubSource = resolve(process.argv[5] ?? 'extensions/github-authentication');
const base = '/assets/seven-web';
const jsEntrypoint = 'out/vs/workbench/workbench.web.main.internal.js';
const cssEntrypoint = 'out/vs/workbench/workbench.web.main.internal.css';
const required = [jsEntrypoint, cssEntrypoint, 'out/nls.messages.js'];
for (const relative of required) {
  if (!existsSync(join(buildRoot, relative))) {
    throw new Error('Compiled Code OSS standalone web asset missing: ' + relative +
      ' (required command: npm run gulp vscode-web-min)');
  }
}
if (statSync(join(buildRoot, jsEntrypoint)).size < 1_000_000) {
  throw new Error('Original Code OSS standalone workbench is unexpectedly small');
}
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(join(buildRoot, 'out'), join(destination, 'out'), {
  recursive: true,
  filter: name => !name.endsWith('.map'),
});
if (existsSync(join(buildRoot, 'extensions'))) {
  cpSync(join(buildRoot, 'extensions'), join(destination, 'extensions'), { recursive: true });
}
const terminalExtension = 'seven-code-mobile-terminal';
const terminalRoot = join(destination, 'extensions', terminalExtension);
for (const relative of ['package.json', 'dist/browser/extension.js']) {
  if (!existsSync(join(terminalRoot, relative))) {
    cpSync(resolve('extensions', terminalExtension), terminalRoot, {
      recursive: true, force: true,
    });
    break;
  }
}
for (const relative of ['package.json', 'dist/browser/extension.js']) {
  if (!existsSync(join(terminalRoot, relative))) {
    throw new Error('Android native terminal web extension missing: ' + relative);
  }
}

// This is Microsoft's/GitHub's real open-source Copilot WEB extension entry,
// not the Node-only dist/extension.js or a fake chat widget. Only build output
// produced from the current repository is accepted. No VSIX is downloaded.
const copilotManifestFile = join(copilotSource, 'package.json');
const copilotWorker = join(copilotSource, 'dist', 'web.js');
const copilotLicense = join(copilotSource, 'LICENSE.txt');
if (!existsSync(copilotManifestFile) || !existsSync(copilotWorker) || !existsSync(copilotLicense)) {
  throw new Error('Copilot WEB host not compiled; run npm --prefix extensions/copilot run compile first');
}
if (statSync(copilotWorker).size < 100_000) {
  throw new Error('Real Copilot Web worker is missing or unexpectedly small');
}
const copilotManifest = JSON.parse(readFileSync(copilotManifestFile, 'utf8'));
if (copilotManifest.name !== 'copilot-chat' || copilotManifest.publisher !== 'GitHub' ||
    !readFileSync(copilotLicense, 'utf8').includes('MIT License')) {
  throw new Error('Unverified Copilot Chat source or license');
}
const copilotDest = join(destination, 'extensions', 'copilot-chat');
mkdirSync(join(copilotDest, 'dist'), { recursive: true });
cpSync(copilotWorker, join(copilotDest, 'dist', 'web.js'));
cpSync(copilotLicense, join(copilotDest, 'LICENSE.txt'));
for (const dir of ['assets', 'l10n']) {
  const source = join(copilotSource, dir);
  if (existsSync(source)) cpSync(source, join(copilotDest, dir), { recursive: true });
}
const copilotDist = join(copilotSource, 'dist');
// The web worker reads grammars, tokenizers and its child web workers by URI.
// Shipping web.js alone silently breaks language-aware Chat / inline edits.
const childWebWorkers = new Set([
  'suggestionsPanelWebview.js', 'webview.js', 'worker2.js',
  'tikTokenizerWorker.js', 'diffWorker.js',
]);
for (const filename of readdirSync(copilotDist)) {
  const source = join(copilotDist, filename);
  if (!statSync(source).isFile()) continue;
  if (childWebWorkers.has(filename) || /\.(?:wasm|json|bpe|tiktoken)$/.test(filename)) {
    cpSync(source, join(copilotDest, 'dist', filename));
  }
}
for (const notice of ['ThirdPartyNotices.txt', 'telemetry.json']) {
  const file = join(copilotSource, notice);
  if (existsSync(file)) cpSync(file, join(copilotDest, notice));
}
for (const filename of ['package.nls.json']) {
  if (existsSync(join(copilotSource, filename))) {
    cpSync(join(copilotSource, filename), join(copilotDest, filename));
  }
}
// The upstream manifest's main is a Node extension host. Android WebView
// cannot run it. Preserve all contributions, commands and auth requirements,
// but select the upstream Web extension worker for this APK's Web host.
delete copilotManifest.main;
copilotManifest.browser = './dist/web.js';
copilotManifest.extensionKind = ['ui'];
writeFileSync(join(copilotDest, 'package.json'), JSON.stringify(copilotManifest, null, 2) + '\n');

// Embed the verified ORIGINAL GitHub authentication browser extension.
const githubWorker = join(githubSource, 'dist/browser/extension.js');
const githubManifestFile = join(githubSource, 'package.json');
if (!existsSync(githubWorker) || !existsSync(githubManifestFile) ||
    statSync(githubWorker).size < 15000) {
  throw new Error('GitHub browser authentication worker must be compiled first');
}
const githubManifest = JSON.parse(readFileSync(githubManifestFile, 'utf8'));
if (githubManifest.name !== 'github-authentication' ||
    githubManifest.publisher !== 'vscode' ||
    githubManifest.browser !== './dist/browser/extension.js') {
  throw new Error('Unexpected GitHub authentication source');
}
delete githubManifest.main;
const githubDest = join(destination, 'extensions/github-authentication');
rmSync(githubDest, { recursive: true, force: true });
mkdirSync(join(githubDest, 'dist/browser'), { recursive: true });
cpSync(githubWorker, join(githubDest, 'dist/browser/extension.js'));
for (const name of ['images', 'package.nls.json', 'LICENSE.txt']) {
  const file = join(githubSource, name);
  if (existsSync(file)) cpSync(file, join(githubDest, name), { recursive: true });
}
writeFileSync(join(githubDest, 'package.json'), JSON.stringify(githubManifest, null, 2) + '\n');
for (const notice of ['LICENSE.txt', 'ThirdPartyNotices.txt']) {
  if (!existsSync(resolve(notice))) throw new Error('Missing Code OSS notice: ' + notice);
  cpSync(resolve(notice), join(destination, notice));
}
mkdirSync(join(destination, 'resources/server'), { recursive: true });
for (const file of ['favicon.ico', 'manifest.json', 'code-192.png', 'code-512.png']) {
  if (existsSync(join(buildRoot, file))) {
    cpSync(join(buildRoot, file), join(destination, 'resources/server', file));
  }
}

const options = {
  additionalBuiltinExtensions: [{
    scheme: 'https',
    authority: 'appassets.androidplatform.net',
    path: base + '/extensions/seven-code-mobile-terminal',
  }, {
    scheme: 'https',
    authority: 'appassets.androidplatform.net',
    path: base + '/extensions/copilot-chat',
  }, {
    scheme: 'https',
    authority: 'appassets.androidplatform.net',
    path: base + '/extensions/github-authentication',
  }],
  enableWorkspaceTrust: true,
  settingsSyncOptions: { enabled: false },
  windowIndicator: {
    label: '$(device-mobile)',
    tooltip: 'Seven Code Android — Code OSS Web offline',
  },
};
const bootstrap = [
  "'use strict';",
  "// Start the original bundled Code OSS Web Workbench on Android's trusted asset origin.",
  "globalThis._VSCODE_FILE_ROOT = new URL('./out/', window.location.href).toString();",
  "try {",
  "  await import('./out/nls.messages.js');",
  "  const { create } = await import('./" + jsEntrypoint + "');",
  "  create(document.getElementById('seven-code-root'), " + JSON.stringify(options) + ");",
  "  document.getElementById('seven-code-loading')?.remove();",
  "} catch (error) {",
  "  const notice = document.getElementById('seven-code-loading');",
  "  if (notice) notice.textContent = 'Falha ao iniciar o Code OSS Web: ' + String(error?.message || error);",
  "  console.error('Seven Code Web startup failed', error);",
  "}",
].join('\n') + '\n';
const html = [
  '<!doctype html>',
  '<html lang="pt-BR">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">',
  '  <meta name="theme-color" content="#1f1f1f">',
  '  <title>Seven Code</title>',
  '  <link rel="stylesheet" href="./' + cssEntrypoint + '">',
  '  <style>',
  '    html,body,#seven-code-root {margin:0;width:100%;height:100%;overflow:hidden}',
  '    #seven-code-loading {position:fixed;inset:0;display:flex;align-items:center;justify-content:center;',
  '      background:#1f1f1f;color:#ddd;font:16px system-ui;z-index:2147483647;padding:24px;text-align:center}',
  '  </style>',
  '</head>',
  '<body>',
  '  <div id="seven-code-root"></div>',
  '  <div id="seven-code-loading" role="status">Iniciando o editor Code OSS...</div>',
  '  <script type="module" src="./bootstrap.js"></script>',
  '</body>',
  '</html>',
].join('\n') + '\n';
writeFileSync(join(destination, 'index.html'), html);
writeFileSync(join(destination, 'bootstrap.js'), bootstrap);
writeFileSync(join(destination, 'bundle.json'), JSON.stringify({
  kind: 'original-code-oss-standalone-web',
  entrypoint: jsEntrypoint,
  mode: 'browser-only-offline',
  remoteNodeExtensions: false,
  nativeAndroidTerminalExtension: true,
  copilotWebWorkerPackaged: true,
  githubAuthWebWorkerPackaged: true,
  githubDeviceFlowNativeBridge: true,
  githubAuthenticationE2EVerified: false,
  copilotNodeExtensionHostReady: false,
  copilotAuthenticationE2EVerified: false,
  noNodeRequiredForUi: true,
}, null, 2) + '\n');
console.log('Bundled original standalone Code OSS Web Workbench into:', destination);
