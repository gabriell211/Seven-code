import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = fileURLToPath(new URL('../android/gnu-node-fork-probe.cjs', import.meta.url));

test('GNU IPC preflight proves real child_process.fork messaging, not a static marker', () => {
    const result = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        timeout: 12000,
        env: { ...process.env }
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /^SEVEN_GNU_FORK_IPC_OK\s*$/);
});

test('GNU-style loader wrapper and process.execPath override preserve child fork IPC on Linux', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seven-gnu-node-fork-'));
    try {
        const wrapper = join(dir, 'node-wrapper.sh');
        const bootstrap = join(dir, 'bootstrap.cjs');
        writeFileSync(wrapper, '#!/bin/sh\\nexec ' + JSON.stringify(process.execPath) + ' "$@"\\n');
        chmodSync(wrapper, 0o700);
        writeFileSync(bootstrap,
            'Object.defineProperty(process, "execPath", {configurable:true, writable:true, value:' +
            JSON.stringify(wrapper) + '});\\n');
        const result = spawnSync(process.execPath, [script], {
            encoding: 'utf8',
            timeout: 12000,
            env: { ...process.env, NODE_OPTIONS: '--require=' + bootstrap }
        });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        assert.match(result.stdout, /^SEVEN_GNU_FORK_IPC_OK\\s*$/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('fork child refuses a direct invocation without actual IPC channel', () => {
    const result = spawnSync(process.execPath, [script, '--seven-child'], {
        encoding: 'utf8',
        timeout: 12000
    });
    assert.equal(result.status, 64);
    assert.doesNotMatch(result.stdout, /SEVEN_GNU_FORK_IPC_OK/);
});

test('Android preflight accepts actual GNU IPC before launching Code OSS and not merely Node --version', async () => {
    const { readFileSync } = await import('node:fs');
    const root = new URL('../../', import.meta.url);
    const activity = readFileSync(new URL('mobile/android/app/src/main/java/dev/seven/code/SevenLocalCodeOssServer.kt', root), 'utf8');
    const runtime = readFileSync(new URL('mobile/android/app/src/main/java/dev/seven/code/SevenLocalGnuRuntime.kt', root), 'utf8');
    const bundler = readFileSync(new URL('.seven/package-android-gnu-experiment.mjs', root), 'utf8');
    assert.match(activity, /probeGnuNodeForkIpc\(launch\)/);
    assert.match(activity, /original-gnu-node-fork-ipc-verified/);
    assert.match(activity, /SEVEN_GNU_FORK_IPC_OK/);
    assert.match(runtime, /nodeForkProbeSha256/);
    assert.match(runtime, /hash\(forkProbe\)/);
    assert.match(bundler, /gnu-node-fork-probe\.cjs/);
    assert.match(bundler, /nodeForkProbeSha256: sha\(forkProbeInApk\)/);
});
