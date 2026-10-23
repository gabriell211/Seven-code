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
    const vscode = {
        UIKind: { Web: 2 },
        env: { uiKind: 2 },
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
        host, messages
    };
}

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
});
