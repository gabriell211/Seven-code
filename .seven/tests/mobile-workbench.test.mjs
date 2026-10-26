import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

const extensionSource = readFileSync(
    join(process.cwd(), 'extensions/seven-code-mobile-terminal/dist/browser/extension.js'), 'utf8'
);
const workbenchEntry = readFileSync(
    join(process.cwd(), 'src/vs/workbench/workbench.web.main.ts'), 'utf8'
);
const packageJson = JSON.parse(readFileSync(
    join(process.cwd(), 'extensions/seven-code-mobile-terminal/package.json'), 'utf8'
));

test('terminal is a built-in browser extension wired to the original web workbench', () => {
    assert.equal(packageJson.browser, './dist/browser/extension.js');
    assert.equal(packageJson.extensionKind[0], 'ui');
    assert.match(workbenchEntry, /sevenMobileTerminalBridge\.js/);
    assert.ok(packageJson.contributes.terminal.profiles.some(p => p.id === 'sevenCode.android.local'));
});

class FakeChannel {
    static entries = new Set();
    constructor(name) {
        this.name = name;
        this.onmessage = null;
        FakeChannel.entries.add(this);
    }
    postMessage(data) {
        for (const peer of FakeChannel.entries) {
            if (peer !== this && peer.name === this.name) {
                queueMicrotask(() => peer.onmessage?.({ data }));
            }
        }
    }
    close() {
        FakeChannel.entries.delete(this);
    }
}

function launch(withNative) {
    FakeChannel.entries.clear();
    let provider;
    const commands = new Map();
    const openedTerminals = [];
    const updatedDefaults = [];
    const vscode = {
        UIKind: { Web: 2 },
        ConfigurationTarget: { Global: 1 },
        env: { uiKind: 2 },
        commands: {
            registerCommand(id, cb) {
                commands.set(id, cb);
                return { dispose() { commands.delete(id); } };
            }
        },
        workspace: {
            getConfiguration(section) {
                assert.equal(section, 'terminal.integrated');
                return {
                    get(name) { return undefined; },
                    async update(name, value, target) { updatedDefaults.push({ name, value, target }); }
                };
            }
        },
        EventEmitter: class {
            constructor() { this.listeners = []; this.event = listener => {
                this.listeners.push(listener);
                return { dispose() {} };
            }; }
            fire(value) { this.listeners.forEach(cb => cb(value)); }
            dispose() {}
        },
        TerminalProfile: class { constructor(options) { this.options = options; } },
        window: {
            createTerminal(options) {
                const opened = { options, shown: false, show() { this.shown = true; } };
                openedTerminals.push(opened);
                return opened;
            },
            registerTerminalProfileProvider(_id, value) {
                provider = value;
                return { dispose() {} };
            }
        }
    };
    const host = withNative ? new FakeChannel('seven-code-mobile-terminal-v1') : null;
    const messages = [];
    if (host) host.onmessage = e => {
        messages.push(e.data);
        if (e.data?.type === 'probe') {
            host.postMessage({ type: 'probe-result', nonce: e.data.nonce, platform: 'android' });
        }
    };
    const context = {
        module: { exports: {} }, require: name => {
            if (name !== 'vscode') throw new Error('Unknown module: ' + name);
            return vscode;
        },
        BroadcastChannel: FakeChannel,
        TextEncoder, TextDecoder, crypto: webcrypto, atob, btoa, queueMicrotask,
        setTimeout: (fn, delay) => setTimeout(fn, withNative ? delay : 1),
        clearTimeout
    };
    runInNewContext(extensionSource, context);
    return {
        provider: () => provider,
        activate: () => context.module.exports.activate({ subscriptions: [] }),
        commands, openedTerminals, updatedDefaults,
        host, messages
    };
}

test('touch command opens real native Android PTY and selects profile for new terminal', async () => {
    const app = launch(true);
    await app.activate();
    assert.ok(packageJson.activationEvents.includes('onCommand:sevenCode.openAndroidTerminal'));
    assert.ok(packageJson.contributes.commands.some(c => c.command === 'sevenCode.openAndroidTerminal'));
    assert.ok(packageJson.contributes.menus['menubar/terminal'].some(c =>
        c.command === 'sevenCode.openAndroidTerminal'));
    assert.deepEqual(app.updatedDefaults, [{
        name: 'defaultProfile.linux', value: 'Android (Seven Code)', target: 1
    }]);
    const open = app.commands.get('sevenCode.openAndroidTerminal');
    assert.equal(typeof open, 'function');
    await open();
    assert.equal(app.openedTerminals.length, 1);
    const terminal = app.openedTerminals[0];
    assert.equal(terminal.shown, true);
    assert.equal(terminal.options.name, 'Android • Seven Code');
    terminal.options.pty.open({columns: 80, rows: 24});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(app.messages.some(m => m.type === 'start'));
    terminal.options.pty.close();
    app.host.close();
});

test('extension activates only when the trusted Android host replies', async () => {
    const missing = launch(false);
    await missing.activate();
    assert.equal(missing.provider(), undefined);
    const present = launch(true);
    await present.activate();
    assert.ok(present.provider());
    present.host.close();
});

test('PTY forwards terminal input/resize to native and streams UTF-8 output', async () => {
    const app = launch(true);
    await app.activate();
    const terminalProfile = app.provider().provideTerminalProfile().options;
    assert.equal(terminalProfile.name, 'Android • Seven Code');
    const pty = terminalProfile.pty;
    let output = '';
    pty.onDidWrite(data => { output += data; });
    pty.open({ columns: 80, rows: 24 });
    pty.handleInput('echo café\n');
    pty.setDimensions({ columns: 100, rows: 30 });
    await new Promise(resolve => setTimeout(resolve, 0));
    const start = app.messages.find(m => m.type === 'start');
    assert.equal(app.messages.find(m => m.type === 'input'), undefined, 'Never send command before Android permission');
    app.host.postMessage({ type: 'ready', sessionId: start.sessionId });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(start.cols, 80);
    assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(start.sessionId));
    const input = app.messages.find(m => m.type === 'input');
    assert.equal(new TextDecoder().decode(Uint8Array.from(atob(input.data), c => c.charCodeAt(0))), 'echo café\n');
    assert.equal(app.messages.find(m => m.type === 'resize').rows, 30);
    app.host.postMessage({
        type: 'data',
        sessionId: start.sessionId,
        value: btoa(String.fromCharCode(...new TextEncoder().encode('olá\r\n')))
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(output, 'olá\r\n');
    pty.close();
    app.host.close();
});

test('PTY applies the latest dimensions after approval before flushing commands', async () => {
    const app = launch(true);
    await app.activate();
    const pty = app.provider().provideTerminalProfile().options.pty;
    pty.open({ columns: 80, rows: 24 });
    pty.setDimensions({ columns: 100, rows: 30 });
    pty.setDimensions({ columns: 120, rows: 40 });
    pty.handleInput('stty size\r');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(app.messages.filter(m => m.type === 'resize').length, 0);
    const start = app.messages.find(m => m.type === 'start');
    app.host.postMessage({ type: 'ready', sessionId: start.sessionId });
    app.host.postMessage({ type: 'ready', sessionId: start.sessionId });
    await new Promise(resolve => setTimeout(resolve, 0));
    const forwarded = app.messages.filter(m => m.type === 'resize' || m.type === 'input');
    assert.equal(forwarded.length, 2);
    assert.equal(forwarded[0].type, 'resize');
    assert.equal(forwarded[0].cols, 120);
    assert.equal(forwarded[0].rows, 40);
    assert.equal(forwarded[1].type, 'input');
    pty.close();
    app.host.close();
});

test('PTY never flushes queued commands after permission denial or local close', async () => {
    for (const localClose of [false, true]) {
        const app = launch(true);
        await app.activate();
        const pty = app.provider().provideTerminalProfile().options.pty;
        pty.open({ columns: 80, rows: 24 });
        pty.handleInput('echo pending\r');
        pty.setDimensions({ columns: 100, rows: 30 });
        await new Promise(resolve => setTimeout(resolve, 0));
        const start = app.messages.find(m => m.type === 'start');
        if (localClose) pty.close();
        else {
            app.host.postMessage({ type: 'error', sessionId: start.sessionId, value: 'Permission denied' });
            app.host.postMessage({ type: 'exit', sessionId: start.sessionId });
        }
        app.host.postMessage({ type: 'ready', sessionId: start.sessionId });
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(app.messages.filter(m => m.type === 'input' || m.type === 'resize').length, 0);
        assert.equal(app.messages.filter(m => m.type === 'close').length, localClose ? 1 : 0);
        pty.close();
        app.host.close();
    }
});

test('PTY clamps native dimensions and ignores invalid resize values', async () => {
    const app = launch(true);
    await app.activate();
    const pty = app.provider().provideTerminalProfile().options.pty;
    pty.open({ columns: 80, rows: 24 });
    await new Promise(resolve => setTimeout(resolve, 0));
    const start = app.messages.find(m => m.type === 'start');
    app.host.postMessage({ type: 'ready', sessionId: start.sessionId });
    await new Promise(resolve => setTimeout(resolve, 0));
    pty.setDimensions({ columns: 9000, rows: -4 });
    pty.setDimensions({ columns: NaN, rows: 24 });
    await new Promise(resolve => setTimeout(resolve, 0));
    const resizes = app.messages.filter(m => m.type === 'resize');
    assert.equal(resizes.length, 1);
    assert.equal(resizes[0].cols, 1000);
    assert.equal(resizes[0].rows, 1);
    pty.close();
    app.host.close();
});


test('Copilot and GitHub authentication still use upstream Code OSS extension hosts', () => {
    const copilot = JSON.parse(readFileSync(
        join(process.cwd(), 'extensions/copilot/package.json'), 'utf8'
    ));
    const auth = JSON.parse(readFileSync(
        join(process.cwd(), 'extensions/github-authentication/package.json'), 'utf8'
    ));
    const browserHost = readFileSync(
        join(process.cwd(), 'src/vs/workbench/services/extensions/browser/extensionService.ts'), 'utf8'
    );
    assert.equal(copilot.name, 'copilot-chat');
    assert.equal(copilot.publisher, 'GitHub');
    assert.equal(typeof copilot.main, 'string');
    assert.equal(copilot.browser, undefined, 'Copilot is not a Web Worker extension and needs a compatible Node extension host');
    assert.equal(auth.name, 'github-authentication');
    assert.equal(typeof auth.browser, 'string', 'GitHub login still has a browser extension entrypoint');
    assert.match(browserHost, /RemoteExtensions|RemoteExtensionHost|RemoteRunningLocation|RemoteAgentService/);
    assert.equal(packageJson.name, 'seven-code-mobile-terminal', 'Mobile must only replace the terminal adapter');
    const copilotAdapter = readFileSync(
        join(process.cwd(), 'extensions/copilot/src/platform/terminal/vscode/terminalServiceImpl.ts'), 'utf8'
    );
    assert.match(copilotAdapter, /window\.createTerminal\(name, shellPath, shellArgs\)/);
});

test('terminal API command reaches the mobile PTY after simulated Android approval', async () => {
    // Exercise the mobile adapter directly; native permission and output are simulated.
    const nativeActivity = readFileSync(
        join(process.cwd(), 'mobile/android/app/src/main/java/dev/seven/code/MainActivity.kt'), 'utf8'
    );
    const browserBridge = readFileSync(
        join(process.cwd(), 'src/vs/workbench/browser/sevenMobileTerminalBridge.ts'), 'utf8'
    );
    assert.match(nativeActivity, /sendPayload\(JSONObject\(\)\.put\("type", "ready"\)/);
    assert.match(nativeActivity, /SevenPty\(this/);
    assert.match(browserBridge, /'ready', 'data', 'error', 'exit'/);

    const app = launch(true);
    await app.activate();
    const pty = app.provider().provideTerminalProfile().options.pty;
    const chunks = [];
    let exitCode = undefined;
    pty.onDidWrite(text => chunks.push(text));
    pty.onDidClose(code => { exitCode = code; });
    pty.open({ columns: 80, rows: 24 });
    // Model Terminal.sendText before native permission has been granted.
    pty.handleInput('printf "copilot-native-ok\\n"\r');
    await new Promise(resolve => setTimeout(resolve, 0));
    const started = app.messages.find(m => m.type === 'start');
    assert.ok(started, 'A native session must be requested');
    assert.equal(app.messages.filter(m => m.type === 'input').length, 0, 'No command sent without approval');

    // Simulated user approval triggers native SevenPty.start followed by ready.
    app.host.postMessage({ type: 'ready', sessionId: started.sessionId });
    await new Promise(resolve => setTimeout(resolve, 0));
    const inputs = app.messages.filter(m => m.type === 'input');
    assert.equal(inputs.length, 1, 'Queued command must be flushed once, never dropped or duplicated');
    assert.equal(new TextDecoder().decode(Uint8Array.from(
        atob(inputs[0].data), c => c.charCodeAt(0)
    )), 'printf "copilot-native-ok\\n"\r');

    app.host.postMessage({ type: 'data', sessionId: started.sessionId,
        value: btoa('copilot-native-ok\r\n') });
    app.host.postMessage({ type: 'exit', sessionId: started.sessionId, exitCode: 0 });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(chunks.join(''), 'copilot-native-ok\r\n', 'Terminal buffer should receive stdout with CRLF');
    assert.equal(exitCode, 0, 'Native exit status should be returned to the editor');
    app.host.close();
});


test('mobile routes ordinary and extension-created terminals through trusted native ITerminalChildProcess', () => {
    const service = readFileSync(join(process.cwd(), 'src/vs/workbench/contrib/terminal/browser/terminalService.ts'), 'utf8');
    const terminalProcessSource = readFileSync(join(process.cwd(), 'src/vs/workbench/contrib/terminal/browser/sevenAndroidTerminalProcess.ts'), 'utf8');
    const native = readFileSync(join(process.cwd(), 'mobile/android/app/src/main/java/dev/seven/code/MainActivity.kt'), 'utf8');
    assert.match(service, /hasSevenAndroidTerminal\(\)/);
    assert.match(service, /shellLaunchConfig\.customPtyImplementation = .*SevenAndroidTerminalProcess/);
    assert.match(terminalProcessSource, /implements ITerminalChildProcess/);
    assert.match(terminalProcessSource, /onProcessReady/);
    assert.match(terminalProcessSource, /onProcessExit/);
    assert.match(terminalProcessSource, /MAX_PENDING_INPUT = 131072/);
    assert.match(native, /"pid", pty\.shellPid\(\)/);
    assert.match(native, /"cwd", filesDir\.canonicalPath/);
});
