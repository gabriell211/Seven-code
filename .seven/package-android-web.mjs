#!/usr/bin/env node
/**
 * Packages Code - OSS's real, standalone "web" bundle in an Android APK.
 * The web gulp target exports the embedder API, NOT the server-side HTML shell.
 * Rendering the editor therefore does not require running Node on the phone.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const buildRoot = resolve(process.argv[2] ?? '../vscode-web');
const destination = resolve(process.argv[3] ?? 'mobile/android/app/src/main/assets/seven-web');
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
  noNodeRequiredForUi: true,
}, null, 2) + '\n');
console.log('Bundled original standalone Code OSS Web Workbench into:', destination);
