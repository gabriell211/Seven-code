#!/usr/bin/env node
/**
 * Prepares the Android self-contained Code OSS inputs. Requires a Bionic ARM64
 * server and a directly executable Android Node runtime built/obtained and
 * legally redistributed separately. Never relabel a Linux glibc server as Android.
 *
 * Usage:
 *   node .seven/package-android-local-runtime.mjs \
 *     /path/to/android-arm64-codeoss-server /path/to/android-arm64-node \
 *     /path/to/Node-copyright [/path/to/android-arm64-shared-libraries]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, openSync, closeSync, readSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [serverDirRaw, nodePathRaw, nodeNoticeRaw, depsRaw] = process.argv.slice(2);
const fatal = message => { console.error('Seven Code Android local bundle: ' + message); process.exit(1); };
if (!serverDirRaw || !nodePathRaw || !nodeNoticeRaw) {
    fatal('Expected server directory, Android/Bionic Node ELF, and Node copyright notice.');
}
const serverDir = resolve(serverDirRaw);
const nodePath = resolve(nodePathRaw);
const nodeNotice = resolve(nodeNoticeRaw);
const deps = depsRaw ? resolve(depsRaw) : undefined;
const mustExist = path => { if (!existsSync(path) || !statSync(path).isFile()) fatal('Missing required file: ' + path); };
mustExist(join(serverDir, 'out/server-main.js'));
mustExist(join(serverDir, 'out/vs/code/browser/workbench/workbench.js'));
mustExist(join(serverDir, 'extensions/copilot/dist/extension.js'));
mustExist(nodePath);
mustExist(nodeNotice);
if (deps && (!existsSync(deps) || !statSync(deps).isDirectory())) fatal('Native library directory missing: ' + deps);

function verifyBionicElf(path) {
    const bytes = readFileSync(path).subarray(0, 20);
    if (bytes.length < 20 || bytes[0] !== 127 || String.fromCharCode(...bytes.subarray(1, 4)) !== 'ELF') {
        fatal('Android binary is not an ELF: ' + path);
    }
    if (bytes[4] !== 2 || bytes.readUInt16LE(18) !== 183) fatal('ELF is not 64-bit AArch64: ' + path);
    const programHeaders = execFileSync('readelf', ['-l', path], { encoding: 'utf8', maxBuffer: 8_000_000 });
    const dynamic = execFileSync('readelf', ['-d', path], { encoding: 'utf8', maxBuffer: 8_000_000 });
    if (/\b(?:libc\.so\.6|libstdc\+\+\.so\.6|libgcc_s\.so\.1)\b/.test(dynamic)) {
        fatal('Linux glibc dependency is not Android Bionic: ' + path);
    }
    const symbols = execFileSync('readelf', ['--version-info', path], { encoding: 'utf8', maxBuffer: 20_000_000 });
    if (/GLIBC_[0-9]/.test(symbols)) fatal('ELF imports glibc symbols: ' + path);
    return programHeaders;
}
const nodeHeaders = verifyBionicElf(nodePath);
if (!nodeHeaders.includes('/system/bin/linker64')) {
    fatal('Node must be directly executable through /system/bin/linker64 (Android/Bionic).');
}
let scanned = 0;
function scanBinaries(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.isDirectory()) { scanBinaries(path); continue; }
        if (!item.isFile()) continue;
        const fd = Buffer.alloc(4);
        const handle = openSync(path, 'r');
        let bytes;
        try { bytes = readSync(handle, fd, 0, 4, 0); } finally { closeSync(handle); }
        if (bytes === 4 && fd[0] === 127 && fd[1] === 69 && fd[2] === 76 && fd[3] === 70) {
            verifyBionicElf(path);
            scanned++;
        }
    }
}
scanBinaries(serverDir);
if (scanned === 0) fatal('No Android native ELF components found in the server; missing extension host runtime.');
const assets = join(projectRoot, 'mobile/android/app/src/main/assets/seven-local');
const jni = join(projectRoot, 'mobile/android/app/src/main/jniLibs/arm64-v8a');
mkdirSync(assets, { recursive: true });
mkdirSync(jni, { recursive: true });
const archive = join(assets, 'server.zip');
rmSync(archive, { force: true });
execFileSync('zip', ['-q', '-r', '-X', archive, '.'], {
    cwd: serverDir, stdio: 'inherit', timeout: 1_200_000
});
const zipSize = statSync(archive).size;
if (zipSize < 30_000_000 || zipSize > 500_000_000) {
    rmSync(archive, { force: true });
    fatal('Code OSS archive size is outside the expected 30-500MB range: ' + zipSize);
}
const sha = createHash('sha256');
await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(archive);
    stream.on('data', chunk => sha.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', resolveHash);
});
const hash = sha.digest('hex');
writeFileSync(join(assets, 'server.sha256'), hash + '\n');
copyFileSync(nodeNotice, join(assets, 'NOTICE-node.txt'));
copyFileSync(nodePath, join(jni, 'libnode.so'));
if (deps) {
    for (const lib of readdirSync(deps)) {
        if (!lib.endsWith('.so')) continue;
        const src = join(deps, lib);
        if (!statSync(src).isFile()) continue;
        verifyBionicElf(src);
        copyFileSync(src, join(jni, lib));
    }
}
console.log('Bundled Code OSS:', archive, zipSize + ' bytes');
console.log('SHA-256:', hash);
console.log('Verified Bionic AArch64 ELF binaries:', scanned);
console.log('NEXT: run the real Android emulator/device standalone E2E before any release.');
