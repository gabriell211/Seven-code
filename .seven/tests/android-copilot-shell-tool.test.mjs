import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

const source = readFileSync('extensions/seven-code-mobile-terminal/dist/browser/extension.js', 'utf8');
const manifest = JSON.parse(readFileSync('extensions/seven-code-mobile-terminal/package.json', 'utf8'));
const bridge = readFileSync('src/vs/workbench/browser/sevenMobileTerminalBridge.ts', 'utf8');
const activity = readFileSync('mobile/android/app/src/main/java/dev/seven/code/MainActivity.kt', 'utf8');

class Channel {
    static clients = new Set();
    constructor(name) { this.name = name; this.onmessage = null; Channel.clients.add(this); }
    postMessage(data) {
        for (const peer of Channel.clients) {
            if (peer !== this && peer.name === this.name) {
                queueMicrotask(() => peer.onmessage?.({ data }));
            }
        }
    }
    close() { Channel.clients.delete(this); }
}
function setup(native = true) {
    Channel.clients.clear();
    let tool;
    const received = [];
    const nativeTerminal = native ? new Channel('seven-code-mobile-terminal-v1') : null;
    if (nativeTerminal) nativeTerminal.onmessage = e => {
        if (e.data?.type === 'probe') nativeTerminal.postMessage({
            type: 'probe-result', nonce: e.data.nonce, platform: 'android'
        });
    };
    const nativeAi = native ? new Channel('seven-code-mobile-ai-v1') : null;
    if (nativeAi) nativeAi.onmessage = e => received.push(e.data);
    class TextPart { constructor(value) { this.value = value; } }
    class Result { constructor(content) { this.content = content; } }
    const vscode = {
        UIKind: { Web: 2 },
        env: { uiKind: 2 },
        LanguageModelTextPart: TextPart,
        LanguageModelToolResult: Result,
        lm: {
            registerTool(id, implementation) {
                tool = { id, implementation };
                return { dispose() { tool = undefined; } };
            }
        },
        window: { registerTerminalProfileProvider() { return { dispose() {} }; } }
    };
    const module = { exports: {} };
    runInNewContext(source, {
        module,
        require(id) {
            assert.equal(id, 'vscode');
            return vscode;
        },
        BroadcastChannel: Channel, crypto: webcrypto, TextEncoder, TextDecoder,
        atob, btoa, queueMicrotask, setTimeout: (cb, ms) => setTimeout(cb, native ? ms : 1),
        clearTimeout
    });
    return {
        activate: () => module.exports.activate({ subscriptions: [] }),
        tool: () => tool,
        reply: value => nativeAi?.postMessage({ type: 'ai-result', ...value }),
        received,
        close() { nativeTerminal?.close(); nativeAi?.close(); }
    };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const text = value => value.content[0].value;

test('uses standard VS Code LM tool extension point, never a Copilot fork or hidden shell', () => {
    const contrib = manifest.contributes.languageModelTools;
    assert.equal(contrib.length, 2);
    assert.equal(contrib[0].name, 'seven_code_run_android_shell');
    assert.equal(contrib[0].inputSchema.required[0], 'command');
    assert.equal(contrib[1].name, 'seven_code_read_android_workspace_file');
    assert.equal(contrib[1].inputSchema.required[0], 'path');
    assert.ok(manifest.contributes.commands.some(x => x.command === 'sevenCode.openCopilotChat'));
    assert.match(bridge, /seven-code-mobile-ai-v1/);
    assert.match(bridge, /host.postMessage\(JSON.stringify\(data\)\)/);
    assert.match(activity, /private fun proposeAiCommand/);
    assert.match(activity, /\.setTitle\("Permitir comando da IA\?"\)/);
    assert.match(activity, /private fun cancelAiCommand/);
    assert.match(activity, /SevenAiCommandRunner\(this/);
});

test('agent shell tool only registers with trusted native Android workbench', async () => {
    const absent = setup(false);
    await absent.activate();
    assert.equal(absent.tool(), undefined);
    absent.close();
    const present = setup();
    await present.activate();
    assert.equal(present.tool()?.id, 'seven_code_run_android_shell');
    present.close();
});

test('agent receives real approval status, output and exit code from Android bridge', async () => {
    const app = setup();
    await app.activate();
    const task = app.tool().implementation.invoke({ input: { command: 'pwd', timeoutMs: 2000 } });
    await tick();
    assert.equal(app.received.filter(e => e.type === 'ai-propose').length, 1);
    const request = app.received.find(e => e.type === 'ai-propose');
    assert.equal(request.command, 'pwd');
    app.reply({ requestId: request.requestId, approved: true, exitCode: 0,
        output: '/data/user/0/dev.seven.code/files', truncated: false });
    const result = text(await task);
    assert.match(result, /Comando executado com sucesso/);
    assert.match(result, /Código de saída: 0/);
    assert.match(result, /data\/user\/0/);
    assert.match(result, /não é o shell do servidor/);
    app.close();
});

test('Android denial and nonzero exit code cannot be reported as success', async () => {
    const app = setup();
    await app.activate();
    let task = app.tool().implementation.invoke({ input: { command: 'false' } });
    await tick();
    let request = app.received.find(e => e.type === 'ai-propose');
    app.reply({ requestId: request.requestId, approved: false, exitCode: null,
        output: '', error: 'Negado pelo usuário' });
    assert.match(text(await task), /Usuário não autorizou/);
    task = app.tool().implementation.invoke({ input: { command: 'false' } });
    await tick();
    request = app.received.filter(e => e.type === 'ai-propose').at(-1);
    app.reply({ requestId: request.requestId, approved: true, exitCode: 127,
        output: 'not found', error: null });
    const failed = text(await task);
    assert.match(failed, /terminou com erro/);
    assert.match(failed, /Código de saída: 127/);
    app.close();
});

test('cancellation asks the Android app to revoke approval or terminate execution', async () => {
    const app = setup();
    await app.activate();
    let onCancel;
    const token = { isCancellationRequested: false,
        onCancellationRequested(fn) { onCancel = fn; return { dispose() {} }; } };
    const promise = app.tool().implementation.invoke({ input: { command: 'sleep 30' } }, token);
    await tick();
    const request = app.received.find(e => e.type === 'ai-propose');
    onCancel();
    assert.match(text(await promise), /não autorizou/);
    await tick();
    assert.ok(app.received.some(e => e.type === 'ai-cancel' && e.requestId === request.requestId));
    app.close();
});

test('invalid or parallel requests never ask Android to run another shell', async () => {
    const app = setup();
    await app.activate();
    assert.match(text(await app.tool().implementation.invoke({ input: { command: ' ' } })), /inválido/);
    assert.match(text(await app.tool().implementation.invoke({
        input: { command: 'pwd', timeoutMs: 999 }
    })), /inválido/);
    const pending = app.tool().implementation.invoke({ input: { command: 'pwd' } });
    await tick();
    assert.match(text(await app.tool().implementation.invoke({ input: { command: 'rm -rf /' } })),
        /outra operação/);
    const request = app.received.find(e => e.type === 'ai-propose');
    app.reply({ requestId: request.requestId, approved: false, exitCode: null, output: '' });
    await pending;
    assert.equal(app.received.filter(e => e.type === 'ai-propose').length, 1);
    app.close();
});
