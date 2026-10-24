#!/usr/bin/env node
/**
 * Fail-closed guard for any APK advertised as standalone/full Code OSS.
 * A debug APK with just the WebView must never pass this check.
 * This is PACKAGE validation, not a substitute for device + Copilot E2E.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const apk = resolve(process.argv[2] ?? 'mobile/android/app/build/outputs/apk/debug/app-debug.apk');
if (!existsSync(apk)) throw new Error('Missing standalone Android APK: ' + apk);
if (statSync(apk).size < 45_000_000) {
    throw new Error('APK is only a thin WebView client. Full Code OSS + Node assets are absent.');
}
const list = (archive) => execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 15_000_000 })
    .split(/\r?\n/).filter(Boolean).map(s => s.replace(/^\.\//, ''));
const apkFiles = new Set(list(apk));
const required = [
    'assets/seven-local/server.zip',
    'assets/seven-local/server.sha256',
    'assets/seven-local/NOTICE-node.txt',
    'lib/arm64-v8a/libnode.so',
    'classes.dex',
];
for (const path of required) {
    if (!apkFiles.has(path)) throw new Error('Standalone APK lacks ' + path);
}
const temporary = mkdtempSync(join(tmpdir(), 'seven-code-standalone-'));
async function fromApk(entry, destination) {
    const p = spawn('unzip', ['-p', apk, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', d => { if (stderr.length < 1024) stderr += d.toString('utf8'); });
    const done = new Promise((resolveDone, rejectDone) => {
        p.on('error', rejectDone);
        p.on('close', code => code === 0 ? resolveDone() : rejectDone(new Error('Cannot extract ' + entry + ': ' + stderr)));
    });
    await Promise.all([pipeline(p.stdout, createWriteStream(destination)), done]);
}
try {
    const zipFile = join(temporary, 'server.zip');
    const nodeFile = join(temporary, 'libnode.so');
    const digestFile = join(temporary, 'server.sha256');
    await Promise.all([
        fromApk('assets/seven-local/server.zip', zipFile),
        fromApk('assets/seven-local/server.sha256', digestFile),
        fromApk('lib/arm64-v8a/libnode.so', nodeFile),
    ]);
    const expected = readFileSync(digestFile, 'utf8').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid Code OSS server SHA-256 manifest');
    const crypto = await import('node:crypto');
    const digest = crypto.createHash('sha256');
    const source = (await import('node:fs')).createReadStream(zipFile);
    for await (const bytes of source) digest.update(bytes);
    if (digest.digest('hex') !== expected) throw new Error('Bundled Code OSS server SHA-256 mismatch');
    if (statSync(zipFile).size < 30_000_000) throw new Error('Bundled Code OSS tree is too small');
    const contents = new Set(list(zipFile));
    for (const name of [
        'out/server-main.js',
        'out/vs/code/browser/workbench/workbench.js',
        'extensions/copilot/dist/extension.js',
    ]) if (!contents.has(name)) throw new Error('Missing original Code OSS component ' + name);
    if (![...contents].some(f => f.startsWith('node_modules/'))) {
        throw new Error('Missing original Code OSS server Node dependencies');
    }
    const header = execFileSync('readelf', ['-h', nodeFile], { encoding: 'utf8' });
    const program = execFileSync('readelf', ['-l', nodeFile], { encoding: 'utf8' });
    if (!header.includes('AArch64') || !program.includes('/system/bin/linker64')) {
        throw new Error('Bundled Node is not an executable Android/Bionic ARM64 ELF');
    }
    console.log('Verified self-contained Android APK contents, Node ABI and full Code OSS checksum.');
    console.log('Device boot, filesystem compatibility, extension host and real Copilot auth E2E are STILL REQUIRED.');
} finally {
    rmSync(temporary, { recursive: true, force: true });
}
