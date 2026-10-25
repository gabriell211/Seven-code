import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

const extensionSource = readFileSync('extensions/seven-code-mobile-terminal/dist/browser/extension.js', 'utf8');
const nativeSource = readFileSync('mobile/android/app/src/main/java/dev/seven/code/SevenMobileDocuments.kt', 'utf8');
const activitySource = readFileSync('mobile/android/app/src/main/java/dev/seven/code/MainActivity.kt', 'utf8');
const browserSource = readFileSync('src/vs/workbench/browser/sevenMobileTerminalBridge.ts', 'utf8');

class Channel {
    static all = new Set();
    constructor(name) { this.name = name; this.onmessage = null; Channel.all.add(this); }
    postMessage(data) {
        for (const x of Channel.all) if (x !== this && x.name === this.name)
            queueMicrotask(() => x.onmessage?.({ data }));
    }
    close() { Channel.all.delete(this); }
}

function harness() {
    Channel.all.clear();
    const files = new Map([['/hello.txt', new TextEncoder().encode('olá mundo')]]);
    const folders = new Set(['/']);
    const drafts = new Map();
    let authorized = false;
    const workspaceFolders = [];
    const pickQueue = [];
    const inputQueue = [];
    const actions = [];
    const providers = new Map();
    const commands = new Map();
    const messages = [];
    const nativeTerminal = new Channel('seven-code-mobile-terminal-v1');
    nativeTerminal.onmessage = e => {
        if (e.data?.type === 'probe') {
            nativeTerminal.postMessage({ type: 'probe-result', nonce: e.data.nonce, platform: 'android' });
        }
    };
    const nativeFiles = new Channel('seven-code-mobile-files-v1');
    nativeFiles.onmessage = e => {
        const msg = e.data;
        if (msg.type !== 'fs-request') return;
        actions.push(msg);
        let value = {};
        let error = null;
        try {
            switch (msg.op) {
                case 'select': authorized = true; value = { folder: 'Projetos' }; break;
                case 'status': if (!authorized) throw Error('Escolha uma pasta do celular'); value = { folder: 'Projetos' }; break;
                case 'stat':
                    if (folders.has(msg.path)) value = { type: 'directory', size: 0, mtime: 0 };
                    else if (files.has(msg.path)) value = { type: 'file', size: files.get(msg.path).length, mtime: 0 };
                    else throw Error('Arquivo não encontrado: ' + msg.path);
                    break;
                case 'list':
                    if (!folders.has(msg.path)) throw Error('Pasta não encontrada');
                    value = { entries: [
                        ...[...folders].filter(x => x !== '/' && x.startsWith(msg.path === '/' ? '/' : msg.path + '/') &&
                            !x.slice(msg.path.length + (msg.path === '/' ? 0 : 1)).includes('/'))
                            .map(x => ({ name: x.slice(x.lastIndexOf('/') + 1), type: 'directory' })),
                        ...[...files.keys()].filter(x => x.startsWith(msg.path === '/' ? '/' : msg.path + '/') &&
                            !x.slice(msg.path.length + (msg.path === '/' ? 0 : 1)).includes('/'))
                            .map(x => ({ name: x.slice(x.lastIndexOf('/') + 1), type: 'file' }))
                    ] };
                    break;
                case 'read': {
                    if (!files.has(msg.path)) throw Error('Arquivo não encontrado');
                    const bytes = files.get(msg.path);
                    const chunk = bytes.subarray(msg.offset, msg.offset + msg.length);
                    value = { data: Buffer.from(chunk).toString('base64'), size: bytes.length };
                    break;
                }
                case 'write-begin':
                    drafts.set(msg.requestId, { path: msg.path, bytes: [] }); break;
                case 'write-chunk':
                    if (!drafts.has(msg.requestId)) throw Error('Gravação não iniciada');
                    drafts.get(msg.requestId).bytes.push(Buffer.from(msg.data, 'base64')); break;
                case 'write-commit': {
                    const draft = drafts.get(msg.requestId);
                    if (!draft) throw Error('Gravação não iniciada');
                    files.set(draft.path, new Uint8Array(Buffer.concat(draft.bytes)));
                    drafts.delete(msg.requestId);
                    break;
                }
                case 'write-abort': drafts.delete(msg.requestId); break;
                case 'mkdir':
                    folders.add(msg.path); break;
                case 'rename':
                    if (!files.has(msg.path)) throw Error('Arquivo não encontrado');
                    files.set(msg.target, files.get(msg.path)); files.delete(msg.path); break;
                case 'delete':
                    files.delete(msg.path); folders.delete(msg.path); break;
                default: throw Error('Unsupported op: ' + msg.op);
            }
        } catch (e) { error = String(e.message); }
        nativeFiles.postMessage({ type: 'fs-result', requestId: msg.requestId,
            ok: error == null, ...(error ? { error } : { value }) });
    };
    const v = {
        UIKind: { Web: 2 }, env: { uiKind: 2 },
        EventEmitter: class {
            constructor() { this.listeners = []; this.event = fn => {
                this.listeners.push(fn); return { dispose() {} };
            }; }
            fire(arg) { this.listeners.forEach(fn => fn(arg)); }
            dispose() {}
        },
        TerminalProfile: class { constructor(options) { this.options = options; } },
        FileType: { File: 1, Directory: 2 },
        FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
        Disposable: class { constructor(fn) { this.dispose = fn; } },
        Uri: { from: x => x, joinPath: (root, name) => ({ scheme: root.scheme, path: root.path.replace(/\/$/, '') + '/' + name }) },
        FileSystemError: Object.fromEntries(
            ['FileExists', 'FileNotFound', 'FileIsADirectory', 'Unavailable'].map(type =>
                [type, value => new Error(type + ': ' + (value?.path || value))])
        ),
        workspace: {
            workspaceFolders,
            updateWorkspaceFolders: (index, remove, ...items) => {
                workspaceFolders.splice(index, remove, ...items.map(x => ({ uri: x.uri, name: x.name })));
                return true;
            },
            registerFileSystemProvider: (scheme, provider) => {
                providers.set(scheme, provider); return { dispose() {} };
            },
            fs: {
                stat: uri => providers.get('sevenmobile').stat(uri),
                writeFile: (uri, bytes) => providers.get('sevenmobile').writeFile(uri, bytes,
                    { create: true, overwrite: false }),
                createDirectory: uri => providers.get('sevenmobile').createDirectory(uri),
            }
        },
        commands: {
            registerCommand: (name, cb) => { commands.set(name, cb); return { dispose() {} }; },
            executeCommand: async (...args) => messages.push(args)
        },
        window: {
            registerTerminalProfileProvider: () => ({ dispose() {} }),
            showInformationMessage: async msg => { messages.push(['info', msg]); return 'Selecionar pasta'; },
            showErrorMessage: async msg => { messages.push(['error', msg]); },
            showInputBox: async () => inputQueue.shift(),
            showQuickPick: async options => {
                const name = pickQueue.shift();
                return options.find(option => option.filename === name);
            }
        }
    };
    const module = { exports: {} };
    runInNewContext(extensionSource, {
        module, require: name => {
            assert.equal(name, 'vscode');
            return v;
        },
        BroadcastChannel: Channel, crypto: webcrypto, TextEncoder, TextDecoder,
        Buffer, Uint8Array, atob, btoa, setTimeout, clearTimeout, queueMicrotask
    });
    return {
        activate: () => module.exports.activate({ subscriptions: [] }),
        provider: () => providers.get('sevenmobile'),
        open: () => commands.get('sevenCode.openAndroidFolder')?.(),
        command: (name) => commands.get(name)?.(),
        input: text => inputQueue.push(text),
        choose: name => pickQueue.push(name),
        files, folders, actions, messages, workspaceFolders,
        close: () => { nativeTerminal.close(); nativeFiles.close(); providers.get('sevenmobile')?.dispose(); }
    };
}

test('Code OSS native phone folder remains a user-granted SAF tree, not cloud storage', () => {
    assert.match(nativeSource, /Intent\.ACTION_OPEN_DOCUMENT_TREE/);
    assert.match(nativeSource, /takePersistableUriPermission/);
    assert.match(nativeSource, /persistedUriPermissions/);
    assert.match(nativeSource, /MAX_FILE_SIZE/);
    assert.match(nativeSource, /"write-commit"/);
    assert.match(activitySource, /"fs-request"/);
    assert.match(activitySource, /isMainFrame/);
    assert.match(browserSource, /seven-code-mobile-files-v1/);
});

test('original Code OSS opens the authorized Android folder without choosing a server', async () => {
    const app = harness();
    await app.activate();
    assert.ok(app.provider(), 'original FileSystemProvider must register');
    await app.open();
    assert.equal(app.actions.find(x => x.op === 'select')?.type, 'fs-request');
    assert.equal(app.workspaceFolders.length, 1);
    assert.equal(app.workspaceFolders[0].uri.scheme, 'sevenmobile');
    assert.equal(app.workspaceFolders[0].uri.path, '/');
    assert.ok(app.messages.some(x => x[0] === 'workbench.view.explorer'));
    app.close();
});

test('file changes round-trip through native messages in multiple chunks, including Unicode', async () => {
    const app = harness();
    await app.activate();
    const provider = app.provider();
    const uri = { scheme: 'sevenmobile', path: '/hello.txt' };
    assert.equal(new TextDecoder().decode(await provider.readFile(uri)), 'olá mundo');
    const next = new TextEncoder().encode('café 🥐 '.repeat(12000));
    await provider.writeFile(uri, next, { create: true, overwrite: true });
    assert.ok(app.actions.filter(x => x.op === 'write-chunk').length > 2);
    assert.deepEqual(Buffer.from(await provider.readFile(uri)), Buffer.from(next));
    assert.deepEqual(Buffer.from(app.files.get('/hello.txt')), Buffer.from(next));
    await provider.rename(uri, { scheme: 'sevenmobile', path: '/novo.txt' }, { overwrite: false });
    assert.equal(app.files.has('/hello.txt'), false);
    await provider.delete({ scheme: 'sevenmobile', path: '/novo.txt' }, { recursive: false });
    assert.equal(app.files.has('/novo.txt'), false);
    app.close();
});

test('remote workspace never silently creates a missing phone file when create is denied', async () => {
    const app = harness();
    await app.activate();
    const provider = app.provider();
    await assert.rejects(provider.writeFile({ path: '/not-found.txt' },
        new TextEncoder().encode('secret'), { create: false, overwrite: true }), /FileNotFound/);
    assert.equal(app.files.has('/not-found.txt'), false);
    assert.equal(app.actions.filter(x => x.op === 'write-begin').length, 0);
    app.close();
});

test('new Android file opens the native picker, persists a real zero-byte file and opens the editor', async () => {
    const app = harness();
    await app.activate();
    app.input('main.ts');
    await app.command('sevenCode.newAndroidFile');
    assert.ok(app.actions.some(x => x.op === 'select'), 'permission must be requested via native SAF');
    assert.ok(app.actions.some(x => x.op === 'write-begin' && x.path === '/main.ts'));
    assert.ok(app.actions.some(x => x.op === 'write-commit'));
    assert.equal(app.files.get('/main.ts')?.length, 0);
    assert.ok(app.messages.some(x => x[0] === 'vscode.open' && x[1].path === '/main.ts'));
    app.close();
});

test('Android folder creates directories through SAF and reuses an existing permission grant', async () => {
    const app = harness();
    await app.activate();
    await app.open();
    const before = app.actions.filter(x => x.op === 'select').length;
    app.input('src');
    await app.command('sevenCode.newAndroidFolder');
    assert.ok(app.folders.has('/src'));
    assert.equal(app.actions.filter(x => x.op === 'select').length, before);
    app.close();
});

test('open Android file enumerates SAF directory and opens an actual selected file', async () => {
    const app = harness();
    await app.activate();
    app.choose('hello.txt');
    await app.command('sevenCode.openAndroidFile');
    assert.ok(app.actions.some(x => x.op === 'select'));
    assert.ok(app.actions.some(x => x.op === 'list' && x.path === '/'));
    assert.ok(app.messages.some(x => x[0] === 'vscode.open' && x[1].path === '/hello.txt'));
    app.close();
});

test('Android file creation refuses traversal names and never writes unauthorized paths', async () => {
    const app = harness();
    await app.activate();
    app.input('../outside.ts');
    await app.command('sevenCode.newAndroidFile');
    assert.ok(!app.actions.some(x => x.op === 'write-begin'));
    assert.ok(app.messages.some(x => x[0] === 'error'));
    app.close();
});
