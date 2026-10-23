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
    Number, JSON, Uint8Array, Error, String, console,
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
    proc.onProcessReady(info => ready.push(info));
    proc.onProcessExit(code => exit.push(code));
    assert.equal(await proc.start(), undefined);
    const sessionId = app.writes[0].sessionId;
    assert.equal(app.writes[0].type, 'start');
    proc.input('printf "native-ok\\n"\r');
    proc.resize(140, 45);
    assert.equal(app.writes.some(w => w.type === 'input'), false, 'Must not execute before permission');
    app.publish({ type: 'ready', sessionId, pid: 4012, cwd: '/data/user/0/dev.seven.code/files' });
    await flush();
    assert.equal(ready.length, 1);
    assert.equal(ready[0].pid, 4012);
    assert.equal(ready[0].cwd, '/data/user/0/dev.seven.code/files');
    const requests = app.writes.filter(w => w.type === 'resize' || w.type === 'input');
    assert.equal(requests[0].type, 'resize');
    assert.equal(requests[0].cols, 140);
    assert.equal(requests[1].type, 'input');
    assert.equal(Buffer.from(requests[1].data, 'base64').toString('utf8'), 'printf "native-ok\\n"\r');
    app.publish({ type: 'data', sessionId, value: Buffer.from('native-ok\r\n').toString('base64') });
    app.publish({ type: 'exit', sessionId, exitCode: 0 });
    await flush();
    assert.equal(data.join(''), 'native-ok\r\n');
    assert.equal(exit[0], 0);
    proc.input('must-not-run\r');
    assert.equal(app.writes.filter(w => w.type === 'input').length, 1);
    app.native.close();
});

test('native denial does not execute queued text', async () => {
    const app = openHarness();
    const proc = new SevenAndroidTerminalProcess(80, 24);
    await proc.start();
    proc.input('do-not-run\r');
    app.publish({ type: 'error', sessionId: app.writes[0].sessionId, value: 'Denied' });
    app.publish({ type: 'exit', sessionId: app.writes[0].sessionId });
    await flush();
    assert.equal(app.writes.some(w => w.type === 'input'), false);
    app.native.close();
});

test('an unapproved queue overflow closes the PTY without executing it', async () => {
    const app = openHarness();
    const proc = new SevenAndroidTerminalProcess(80, 24);
    await proc.start();
    proc.input('z'.repeat(131073));
    assert.ok(app.writes.some(w => w.type === 'close'));
    assert.equal(app.writes.some(w => w.type === 'input'), false);
    app.native.close();
});
