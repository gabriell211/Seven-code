import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';

// This is a transport contract test that executes the actual TypeScript class
// in a simulated renderer. It is NOT Android/JNI, Copilot OAuth or a workbench E2E.
class Emitter {
    listeners = new Set();
    event = listener => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
}
class Disposable {
    entries = [];
    _register(entry) { this.entries.push(entry); return entry; }
    dispose() { for (const entry of this.entries) entry.dispose?.(); }
}
class FakeChannel {
    static entries = new Set();
    constructor(name) { this.name = name; this.onmessage = null; FakeChannel.entries.add(this); }
    postMessage(data) {
        for (const peer of FakeChannel.entries) {
            if (peer !== this && peer.name === this.name) {
                queueMicrotask(() => peer.onmessage?.({ data }));
            }
        }
    }
    close() { FakeChannel.entries.delete(this); }
}

const ts = readFileSync(join(process.cwd(), 'src/vs/workbench/contrib/terminal/browser/sevenAndroidTerminalProcess.ts'), 'utf8');
const erasedImports = ts.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/gm, '');
assert.doesNotMatch(erasedImports, /^import /m, 'Test loader must not leave Code OSS imports unresolved');
const source = stripTypeScriptTypes(erasedImports, { mode: 'transform' })
    .replace(/^export (function|class) /gm, '$1 ');
const sandbox = {
    Emitter, Disposable, BroadcastChannel: FakeChannel,
    TextEncoder, TextDecoder, crypto: webcrypto, atob, btoa,
    Number, JSON, Uint8Array, Error, String, console, setTimeout, clearTimeout,
};
sandbox.window = {};
runInNewContext(source + '\n;globalThis.__seven = { SevenAndroidTerminalProcess, hasSevenAndroidTerminal };', sandbox);
const { SevenAndroidTerminalProcess, hasSevenAndroidTerminal } = sandbox.__seven;
const flush = () => new Promise(resolve => setImmediate(resolve));

function openHarness() {
    FakeChannel.entries.clear();
    const writes = [];
    sandbox.window.SevenTerminalNative = { postMessage(raw) { writes.push(JSON.parse(raw)); } };
    const native = new FakeChannel('seven-code-mobile-terminal-v1');
    return { writes, native, publish(value) { native.postMessage(value); } };
}

test('native host never selected in ordinary desktop web browser', () => {
    FakeChannel.entries.clear();
    sandbox.window.SevenTerminalNative = undefined;
    assert.equal(hasSevenAndroidTerminal(), false);
    assert.throws(() => new SevenAndroidTerminalProcess(80, 24), /trusted native/);
});

test('PTY buffers commands until native approval, then delivers real output/exit', async () => {
    const app = openHarness();
    assert.equal(hasSevenAndroidTerminal(), true);
    const proc = new SevenAndroidTerminalProcess(80, 24);
    const data = [], ready = [], exit = [];
    proc.onProcessData(text => data.push(text));
    proc.onProcessReady(info => {
        ready.push(info);
        // The Code OSS terminal manager submits prelaunch commands here.
        proc.input('printf "after-ready\\n"\r');
    });
    proc.onProcessExit(code => exit.push(code));
    const starting = proc.start();
    const sessionId = app.writes[0].sessionId;
    assert.equal(app.writes[0].type, 'start');
    proc.input('printf "native-ok\\n"\r');
    proc.resize(140, 45);
    assert.equal(app.writes.some(w => w.type === 'input'), false, 'Must not execute before permission');
    app.publish({ type: 'ready', sessionId, pid: 4012, cwd: '/data/user/0/dev.seven.code/files' });
    assert.equal(await starting, undefined);
    await flush();
    assert.equal(ready.length, 1);
    assert.equal(ready[0].pid, 4012);
    assert.equal(ready[0].cwd, '/data/user/0/dev.seven.code/files');
    const requests = app.writes.filter(w => w.type === 'resize' || w.type === 'input');
    assert.equal(requests[0].type, 'resize');
    assert.equal(requests[0].cols, 140);
    assert.equal(requests[1].type, 'input');
    assert.equal(requests[2].type, 'input', 'New commands submitted on ready must follow older queued input');
    assert.equal(Buffer.from(requests[1].data, 'base64').toString('utf8'), 'printf "native-ok\\n"\r');
    assert.equal(Buffer.from(requests[2].data, 'base64').toString('utf8'), 'printf "after-ready\\n"\r');
    app.publish({ type: 'data', sessionId, value: Buffer.from('native-ok\r\n').toString('base64') });
    app.publish({ type: 'exit', sessionId, exitCode: 0 });
    await flush();
    assert.ok(data.join('').endsWith('native-ok\r\n'));
    assert.equal(exit[0], 0);
    proc.input('must-not-run\r');
    assert.equal(app.writes.filter(w => w.type === 'input').length, 2);
    app.native.close();
});

test('native denial does not execute queued text', async () => {
    const app = openHarness();
    const proc = new SevenAndroidTerminalProcess(80, 24);
    const starting = proc.start();
    proc.input('do-not-run\r');
    app.publish({ type: 'error', sessionId: app.writes[0].sessionId, value: 'Denied' });
    app.publish({ type: 'exit', sessionId: app.writes[0].sessionId });
    assert.match((await starting)?.message ?? '', /Denied/);
    await flush();
    assert.equal(app.writes.some(w => w.type === 'input'), false);
    app.native.close();
});

test('an unapproved queue overflow closes the PTY without executing it', async () => {
    const app = openHarness();
    const proc = new SevenAndroidTerminalProcess(80, 24);
    const starting = proc.start();
    proc.input('z'.repeat(131073));
    assert.match((await starting)?.message ?? '', /encerrado antes de iniciar/);
    assert.ok(app.writes.some(w => w.type === 'close'));
    assert.equal(app.writes.some(w => w.type === 'input'), false);
    app.native.close();
});


test('native PTY preserves split UTF-8 output and ignores duplicate ready events', async () => {
    const app = openHarness();
    const proc = new SevenAndroidTerminalProcess(80, 24);
    const data = [], ready = [];
    proc.onProcessData(value => data.push(value));
    proc.onProcessReady(value => ready.push(value));
    const starting = proc.start();
    const sessionId = app.writes[0].sessionId;
    proc.input('echo one\r');
    app.publish({ type: 'ready', sessionId, pid: 500, cwd: '/data/user/0/dev.seven.code/files' });
    assert.equal(await starting, undefined);
    app.publish({ type: 'ready', sessionId, pid: 500, cwd: '/data/user/0/dev.seven.code/files' });
    const bytes = Buffer.from('café✅');
    app.publish({ type: 'data', sessionId, value: bytes.subarray(0, 4).toString('base64') });
    app.publish({ type: 'data', sessionId, value: bytes.subarray(4).toString('base64') });
    await flush();
    assert.equal(ready.length, 1);
    assert.equal(app.writes.filter(w => w.type === 'input').length, 1);
    assert.ok(data.join('').endsWith('café✅'));
    proc.shutdown(true);
    app.native.close();
});

test('large terminal input is split into native-safe chunks without data loss', async () => {
    const app = openHarness();
    const proc = new SevenAndroidTerminalProcess(80, 24);
    const starting = proc.start();
    const sessionId = app.writes[0].sessionId;
    app.publish({ type: 'ready', sessionId, pid: 431, cwd: '/' });
    assert.equal(await starting, undefined);
    await flush();
    const payload = 'a'.repeat(98_000);
    proc.input(payload);
    const chunks = app.writes.filter(w => w.type === 'input').map(w => Buffer.from(w.data, 'base64'));
    assert.equal(chunks.length, 3);
    assert.ok(chunks.every(chunk => chunk.length <= 48000));
    assert.equal(Buffer.concat(chunks).toString('utf8'), payload);
    proc.shutdown(true);
    app.native.close();
});

test('native terminal session IDs isolate output from other concurrent shells', async () => {
    const app = openHarness();
    const left = new SevenAndroidTerminalProcess(80, 24);
    const right = new SevenAndroidTerminalProcess(80, 24);
    const leftData = [], rightData = [];
    left.onProcessData(v => leftData.push(v));
    right.onProcessData(v => rightData.push(v));
    const leftStarting = left.start();
    const rightStarting = right.start();
    const [leftId, rightId] = app.writes.filter(w => w.type === 'start').map(w => w.sessionId);
    assert.notEqual(leftId, rightId);
    app.publish({ type: 'ready', sessionId: leftId, pid: 401, cwd: '/' });
    app.publish({ type: 'ready', sessionId: rightId, pid: 402, cwd: '/' });
    assert.equal(await leftStarting, undefined);
    assert.equal(await rightStarting, undefined);
    app.publish({ type: 'data', sessionId: leftId, value: Buffer.from('LEFT').toString('base64') });
    app.publish({ type: 'data', sessionId: rightId, value: Buffer.from('RIGHT').toString('base64') });
    await flush();
    assert.ok(leftData.join('').endsWith('LEFT'));
    assert.ok(rightData.join('').endsWith('RIGHT'));
    left.shutdown(true);
    right.shutdown(true);
    app.native.close();
});
