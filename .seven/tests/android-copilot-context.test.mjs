import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

const extension = readFileSync('extensions/seven-code-mobile-terminal/dist/browser/extension.js', 'utf8');
const manifest = JSON.parse(readFileSync('extensions/seven-code-mobile-terminal/package.json', 'utf8'));

function harness({ native = true, workspaceRoot = '/project', copilot = false, github = false, models = false } = {}) {
    class Channel {
        static all = new Set();
        constructor(name) { this.name = name; this.onmessage = null; Channel.all.add(this); }
        postMessage(data) {
            for (const peer of Channel.all) {
                if (peer !== this && peer.name === this.name)
                    queueMicrotask(() => peer.onmessage?.({ data }));
            }
        }
        close() { Channel.all.delete(this); }
    }
    const host = native ? new Channel('seven-code-mobile-terminal-v1') : null;
    if (host) host.onmessage = event => {
        if (event.data?.type === 'probe') host.postMessage({
            type: 'probe-result', nonce: event.data.nonce, platform: 'android'
        });
    };
    const commands = new Map(), tools = new Map(), calls = [], messages = [], accesses = [];
    const data = new Map([['/project/hello.ts', new TextEncoder().encode('export const hello = 42;')]]);
    class Emitter {
        constructor() { this.event = () => ({ dispose() {} }); }
        fire() {}
        dispose() {}
    }
    class TextPart { constructor(value) { this.value = value; } }
    class Result { constructor(content) { this.content = content; } }
    const vscode = {
        UIKind: { Web: 2 },
        env: { uiKind: 2 },
        EventEmitter: Emitter,
        FileType: { File: 1, Directory: 2 },
        Uri: { from: value => ({ scheme: value.scheme, path: value.path }) },
        LanguageModelTextPart: TextPart,
        LanguageModelToolResult: Result,
        workspace: {
            workspaceFolders: [{ uri: { scheme: 'sevenmobile', path: workspaceRoot } }],
            registerFileSystemProvider() { return { dispose() {} }; },
            fs: {
                async stat(uri) {
                    accesses.push({ op: 'stat', path: uri.path });
                    if (!data.has(uri.path)) throw new Error('Not found: private path');
                    return { type: 1, size: data.get(uri.path).byteLength };
                },
                async readFile(uri) {
                    accesses.push({ op: 'read', path: uri.path });
                    return data.get(uri.path);
                }
            }
        },
        commands: {
            registerCommand(id, fn) {
                commands.set(id, fn);
                return { dispose() { commands.delete(id); } };
            },
            async executeCommand(id) { calls.push(id); }
        },
        authentication: {
            async getSession(provider, scopes, options) {
                assert.equal(provider, 'github');
                assert.deepEqual(Array.from(scopes), ['read:user', 'user:email']);
                calls.push('authentication.getSession');
                return github ? { account: { label: 'fixture.user' }, accessToken: 'TEST_SECRET_DO_NOT_DISPLAY' } : undefined;
            }
        },
        extensions: { getExtension: id => id === 'GitHub.copilot-chat' && copilot
            ? { isActive: true } : undefined },
        lm: { registerTool(id, impl) {
            tools.set(id, impl);
            return { dispose() { tools.delete(id); } };
        },
        async selectChatModels(query) {
            assert.equal(query.vendor, 'copilot');
            calls.push('languageModels.selectChatModels');
            return models ? [{ vendor: 'copilot', id: 'fixture-model' }] : [];
        }},
        window: {
            registerTerminalProfileProvider() { return { dispose() {} }; },
            async showWarningMessage(text) { messages.push({ severity: 'warning', text }); },
            async showErrorMessage(text) { messages.push({ severity: 'error', text }); },
            async showInformationMessage(text) { messages.push({ severity: 'info', text }); }
        }
    };
    const mod = { exports: {} };
    runInNewContext(extension, {
        module: mod, require(name) {
            assert.equal(name, 'vscode');
            return vscode;
        },
        BroadcastChannel: Channel, crypto: webcrypto, TextEncoder, TextDecoder,
        atob, btoa, queueMicrotask,
        setTimeout: (fn, ms) => setTimeout(fn, native ? ms : 1), clearTimeout
    });
    return {
        async activate() { await mod.exports.activate({ subscriptions: [] }); },
        tool(id) { return tools.get(id); },
        command(id) { return commands.get(id); },
        calls, messages, accesses, data,
        close() { host?.close(); }
    };
}
const result = response => response.content[0].value;
const FILE = 'seven_code_read_android_workspace_file';

test('Android Copilot contribution uses original Chat command and advertises genuine SAF-only tool', () => {
    assert.equal(manifest.contributes.languageModelTools.find(x => x.name === FILE)?.toolReferenceName, 'androidFile');
    assert.ok(manifest.contributes.commands.some(x => x.command === 'sevenCode.openCopilotChat'));
    assert.ok(manifest.contributes.commands.some(x => x.command === 'sevenCode.copilotStatus'));
    assert.match(extension, /workbench.action.chat.open/);
    assert.equal(extension.includes('https://api.github.com/copilot'), false);
});

test('Copilot Chat opens original Code OSS panel and reports missing Node extension honestly', async () => {
    const app = harness(); await app.activate();
    await app.command('sevenCode.openCopilotChat')();
    assert.deepEqual(app.calls, ['workbench.action.chat.open']);
    assert.match(app.messages[0].text, /não está ativo no host/);
    await app.command('sevenCode.copilotStatus')();
    assert.match(app.messages[1].text, /Nenhuma extensão de Copilot Chat ativa foi encontrada/);
    app.close();
});

test('Copilot Chat installed status does not pretend to verify OAuth', async () => {
    const app = harness({ copilot: true }); await app.activate();
    await app.command('sevenCode.openCopilotChat')();
    assert.deepEqual(app.calls, ['workbench.action.chat.open']);
    assert.equal(app.messages.length, 0);
    await app.command('sevenCode.copilotStatus')();
    assert.match(app.messages[0].text, /NÃO comprovam acesso/);
    app.close();
});

test('agent reads actual text bytes through the approved Android SAF file provider', async () => {
    const app = harness(); await app.activate();
    assert.ok(app.tool(FILE));
    const response = result(await app.tool(FILE).invoke({ input: { path: '/project/hello.ts' } }));
    assert.match(response, /export const hello = 42;/);
    assert.match(response, /dados não confiáveis/);
    assert.deepEqual(app.accesses.map(x => x.op), ['stat', 'read']);
    app.close();
});

test('agent cannot escape the approved Android workspace or read unselected paths', async () => {
    const app = harness(); await app.activate();
    for (const path of ['/secrets.txt', '/project/../secrets.txt', '/project/../../x',
        '//project/hello.ts', 'project/hello.ts', '/project/other\\\\secret', '/project/']) {
        const response = result(await app.tool(FILE).invoke({ input: { path } }));
        assert.match(response, /inválido|selecione e abra|não foi possível ler/);
    }
    assert.equal(app.accesses.length, 0);
    app.close();
});

test('agent refuses oversized, binary, nonexistent and cancelled file reads', async () => {
    const app = harness(); await app.activate();
    app.data.set('/project/huge.ts', new Uint8Array(65537));
    app.data.set('/project/image.dat', new Uint8Array([0, 1, 2]));
    assert.match(result(await app.tool(FILE).invoke({ input: { path: '/project/huge.ts' } })), /excede 64 KiB/);
    assert.match(result(await app.tool(FILE).invoke({ input: { path: '/project/image.dat' } })), /binário/);
    assert.match(result(await app.tool(FILE).invoke({ input: { path: '/project/missing.ts' } })), /não foi possível ler/);
    const before = app.accesses.length;
    assert.match(result(await app.tool(FILE).invoke(
        { input: { path: '/project/hello.ts' } }, { isCancellationRequested: true }
    )), /cancelada/);
    assert.equal(app.accesses.length, before);
    app.close();
});

test('commands and workspace reading are inactive outside trusted native Android host', async () => {
    const app = harness({ native: false }); await app.activate();
    assert.equal(app.command('sevenCode.openCopilotChat'), undefined);
    assert.equal(app.tool(FILE), undefined);
    app.close();
});

test('Use AI Features button checks active GitHub session rather than assuming external device success', async () => {
    const app = harness({ copilot: true }); await app.activate();
    await app.command('sevenCode.configureAndroidAiFeatures')();
    assert.deepEqual(app.calls, ['authentication.getSession']);
    assert.match(app.messages[0].text, /GitHub ainda não confirmou uma sessão/);
    assert.ok(app.messages.every(m => !m.text.includes('TEST_SECRET_DO_NOT_DISPLAY')));
    app.close();
});

test('Use AI Features button gives honest missing Copilot host diagnosis after GitHub session', async () => {
    const app = harness({ github: true }); await app.activate();
    await app.command('sevenCode.configureAndroidAiFeatures')();
    assert.match(app.messages[0].text, /host de extensões não carregou o Copilot Chat oficial/);
    assert.deepEqual(app.calls, ['authentication.getSession']);
    assert.ok(app.messages.every(m => !m.text.includes('TEST_SECRET_DO_NOT_DISPLAY')));
    app.close();
});

test('Use AI Features button opens original Chat only after official model is actually registered', async () => {
    const app = harness({ github: true, copilot: true, models: true }); await app.activate();
    await app.command('sevenCode.configureAndroidAiFeatures')();
    assert.deepEqual(app.calls, [
        'authentication.getSession',
        'languageModels.selectChatModels',
        'workbench.action.chat.open'
    ]);
    assert.match(app.messages[0].text, /modelo Copilot detectado/);
    assert.ok(app.messages.every(m => !m.text.includes('TEST_SECRET_DO_NOT_DISPLAY')));
    app.close();
});
