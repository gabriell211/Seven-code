#!/usr/bin/env node
/**
 * Embeds the ORIGINAL compiled Code OSS web workbench in Android assets.
 * No Node process or hosted URL is necessary merely to display the editor.
 * This does NOT bundle a Node extension host or prove desktop feature parity.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const buildRoot = resolve(process.argv[2] ?? '../vscode-web');
const destination = resolve(process.argv[3] ?? 'mobile/android/app/src/main/assets/seven-web');
const template = resolve('src/vs/code/browser/workbench/workbench.html');
const base = '/assets/seven-web';
const required = [
  'out/vs/code/browser/workbench/workbench.js',
  'out/vs/code/browser/workbench/workbench.css',
  'out/nls.messages.js',
];
for (const relative of required) {
  if (!existsSync(join(buildRoot, relative))) {
    throw new Error('Code OSS Web production bundle missing: ' + relative + ' (run npm run gulp vscode-web-min)');
  }
}
if (statSync(join(buildRoot, required[0])).size < 1_000_000) {
  throw new Error('Code OSS Web workbench is unexpectedly small: refusing incomplete APK assets');
}
if (!existsSync(template)) throw new Error('Original Code OSS workbench HTML template is missing');

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(join(buildRoot, 'out'), join(destination, 'out'), {
  recursive: true,
  filter: name => !name.endsWith('.map'),
});
if (existsSync(join(buildRoot, 'extensions'))) {
  cpSync(join(buildRoot, 'extensions'), join(destination, 'extensions'), { recursive: true });
}
mkdirSync(join(destination, 'resources/server'), { recursive: true });
// License and notices remain inside the single distributable APK.
for (const notice of ['LICENSE.txt', 'ThirdPartyNotices.txt']) {
  const from = resolve(notice);
  if (!existsSync(from)) throw new Error('Missing required upstream notice: ' + notice);
  cpSync(from, join(destination, notice));
}
for (const file of ['favicon.ico', 'manifest.json', 'code-192.png', 'code-512.png']) {
  const original = join(buildRoot, file);
  if (existsSync(original)) {
    cpSync(original, join(destination, 'resources/server', file));
  }
}

// The upstream server normally injects these values dynamically. In Android,
// the trusted HTTPS app-asset origin supplies the same files without Node.
// Initial launch intentionally starts with an empty workspace, not a fake FS.
const options = {
  callbackRoute: base + '/callback',
  enableWorkspaceTrust: true,
  settingsSyncOptions: { enabled: false },
  windowIndicator: { label: '$(device-mobile)', tooltip: 'Seven Code Android — Web offline' },
};
const escapeAttr = value => value.replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const replacements = {
  WORKBENCH_SCRIPT_NONCE: 'seven-code-local-web',
  WORKBENCH_WEB_BASE_URL: base,
  WORKBENCH_WEB_CONFIGURATION: escapeAttr(JSON.stringify(options)),
  WORKBENCH_AUTH_SESSION: '',
  WORKBENCH_NLS_FALLBACK_URL: base + '/out/nls.messages.js',
  WORKBENCH_NLS_URL: base + '/out/nls.messages.js',
};
let html = readFileSync(template, 'utf8');
for (const [key, value] of Object.entries(replacements)) {
  html = html.replaceAll('{{' + key + '}}', value);
}
if (/\{\{WORKBENCH_[A-Z_]+\}\}/.test(html)) {
  throw new Error('Unresolved upstream workbench HTML token: refusing broken APK');
}
html = html.replace('<meta name="apple-mobile-web-app-title" content="Code">',
  '<meta name="apple-mobile-web-app-title" content="Seven Code">');
writeFileSync(join(destination, 'index.html'), html);
writeFileSync(join(destination, 'bundle.json'), JSON.stringify({
  kind: 'original-code-oss-web',
  mode: 'browser-only-offline',
  remoteNodeExtensions: false,
  noNodeRequiredForUi: true,
}, null, 2) + '\n');
console.log('Bundled original Code OSS Web workbench into Android assets:', destination);
