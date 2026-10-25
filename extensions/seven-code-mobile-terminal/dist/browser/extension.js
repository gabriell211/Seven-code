/* The VS Code web extension host uses the original TerminalProfileProvider API. */
const vscode = require('vscode');
const CHANNEL = 'seven-code-mobile-terminal-v1';
const encoder = new TextEncoder();

function encode(bytes) {
    let raw = '';
    for (const byte of bytes) raw += String.fromCharCode(byte);
    return btoa(raw);
}

class SevenAndroidPty {
    constructor() {
        this.sessionId = crypto.randomUUID().replace(/-/g, '');
        this.closed = false;
        this.ready = false;
        this.pendingInput = [];
        this.pendingInputBytes = 0;
        this.pendingDimensions = undefined;
        this.onDidWriteEmitter = new vscode.EventEmitter();
        this.onDidCloseEmitter = new vscode.EventEmitter();
        this.onDidWrite = this.onDidWriteEmitter.event;
        this.onDidClose = this.onDidCloseEmitter.event;
        this.decoder = new TextDecoder();
        this.channel = new BroadcastChannel(CHANNEL);
        this.channel.onmessage = event => {
            const message = event.data;
            if (!message || message.sessionId !== this.sessionId || this.closed) return;
            if (message.type === 'ready') {
                if (this.ready) return;
                this.ready = true;
                if (this.pendingDimensions) this.send({ type: 'resize', ...this.pendingDimensions });
                this.pendingDimensions = undefined;
                for (const bytes of this.pendingInput) this.postInputBytes(bytes);
                this.pendingInput = [];
                this.pendingInputBytes = 0;
                return;
            }
            if (message.type === 'data' && typeof message.value === 'string') {
                try {
                    const bytes = Uint8Array.from(atob(message.value), c => c.charCodeAt(0));
                    this.onDidWriteEmitter.fire(this.decoder.decode(bytes, { stream: true }));
                } catch {
                    this.onDidWriteEmitter.fire('\r\n[Seven Code] Saída de terminal inválida.');
                }
            }
            if (message.type === 'error') {
                this.onDidWriteEmitter.fire('\r\n[Seven Code] ' + String(message.value || 'Erro no terminal') + '\r\n');
            }
            if (message.type === 'exit') {
                this.closed = true;
                this.pendingInput = [];
                this.pendingInputBytes = 0;
                this.pendingDimensions = undefined;
                this.onDidWriteEmitter.fire(this.decoder.decode());
                this.onDidCloseEmitter.fire(typeof message.exitCode === 'number' ? message.exitCode : undefined);
                this.channel.close();
                this.onDidWriteEmitter.dispose();
                this.onDidCloseEmitter.dispose();
            }
        };
    }
    send(message) {
        if (!this.closed) this.channel.postMessage({ sessionId: this.sessionId, ...message });
    }
    open(dimensions) {
        this.send({
            type: 'start',
            cols: Math.max(1, Math.min(1000, dimensions?.columns || 80)),
            rows: Math.max(1, Math.min(1000, dimensions?.rows || 24)),
        });
    }
    postInputBytes(bytes) {
        for (let i = 0; i < bytes.length; i += 48_000) {
            this.send({ type: 'input', data: encode(bytes.subarray(i, i + 48_000)) });
        }
    }
    handleInput(data) {
        if (this.closed) return;
        const bytes = encoder.encode(data);
        if (!this.ready) {
            // Copilot/VS Code can sendText before the Android user approves
            // the native shell. Never silently lose the command.
            if (this.pendingInputBytes + bytes.length > 131_072) {
                this.onDidWriteEmitter.fire('\r\n[Seven Code] Terminal ainda não autorizado: limite da fila de comandos.\r\n');
                return;
            }
            this.pendingInputBytes += bytes.length;
            this.pendingInput.push(bytes);
            return;
        }
        this.postInputBytes(bytes);
    }
    setDimensions(dimensions) {
        if (this.closed) return;
        const size = {
            cols: Math.max(1, Math.min(1000, Math.round(dimensions.columns))),
            rows: Math.max(1, Math.min(1000, Math.round(dimensions.rows))),
        };
        if (!Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return;
        // The native session does not exist until permission is granted.
        if (!this.ready) {
            this.pendingDimensions = size;
            return;
        }
        this.send({ type: 'resize', ...size });
    }
    close() {
        if (this.closed) return;
        this.send({ type: 'close' });
        this.closed = true;
        this.pendingInput = [];
        this.pendingInputBytes = 0;
        this.pendingDimensions = undefined;
        this.channel.close();
        this.onDidWriteEmitter.dispose();
        this.onDidCloseEmitter.dispose();
    }
}

async function hasNativeHost() {
    if (typeof BroadcastChannel === 'undefined' || vscode.env.uiKind !== vscode.UIKind.Web) {
        return false;
    }
    const channel = new BroadcastChannel(CHANNEL);
    const nonce = crypto.randomUUID();
    return new Promise(resolve => {
        let settled = false;
        function finish(value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            channel.close();
            resolve(value);
        }
        channel.onmessage = event => {
            if (event.data?.type === 'probe-result' && event.data.nonce === nonce &&
                event.data.platform === 'android') {
                finish(true);
            }
        };
        const timer = setTimeout(() => finish(false), 1500);
        channel.postMessage({ type: 'probe', nonce });
    });
}


/* FileSystemProvider is registered in the original Code OSS web extension host.
 * The real bytes remain under a user-selected Android SAF document tree. */
const FILES_CHANNEL = 'seven-code-mobile-files-v1';
const FILES_SCHEME = 'sevenmobile';
const FILE_LIMIT = 10 * 1024 * 1024;
const CHUNK = 32 * 1024;

class SevenAndroidDocuments {
    constructor() {
        this.channel = new BroadcastChannel(FILES_CHANNEL);
        this.pending = new Map();
        this.changed = new vscode.EventEmitter();
        this.onDidChangeFile = this.changed.event;
        this.channel.onmessage = event => {
            const response = event.data;
            if (response?.type !== 'fs-result' || typeof response.requestId !== 'string') return;
            const item = this.pending.get(response.requestId);
            if (!item) return;
            this.pending.delete(response.requestId);
            clearTimeout(item.timer);
            if (!response.ok) item.reject(new Error(String(response.error || 'Erro ao acessar pasta Android')));
            else item.resolve(response.value);
        };
    }
    request(op, path = '/', extras = {}, id = crypto.randomUUID().replace(/-/g, ''), timeout = 30000) {
        if (this.pending.has(id)) return Promise.reject(new Error('Requisição anterior em andamento'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Android não respondeu à operação de arquivos'));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.channel.postMessage({ type: 'fs-request', op, requestId: id, path, ...extras });
        });
    }
    emitChange(uri, type) {
        this.changed.fire([{ type, uri }]);
    }
    watch() { return new vscode.Disposable(() => {}); }
    async stat(uri) {
        const r = await this.request('stat', uri.path);
        return {
            type: r.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
            ctime: 0, mtime: Number(r.mtime) || 0, size: Number(r.size) || 0
        };
    }
    async readDirectory(uri) {
        const r = await this.request('list', uri.path);
        return r.entries.map(x => [
            x.name, x.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File
        ]);
    }
    async readFile(uri) {
        const meta = await this.stat(uri);
        if (meta.type !== vscode.FileType.File) throw vscode.FileSystemError.FileIsADirectory(uri);
        if (meta.size > FILE_LIMIT) throw vscode.FileSystemError.Unavailable('Arquivo excede 10 MiB no bridge Android');
        const result = new Uint8Array(meta.size);
        let offset = 0;
        while (offset < result.length) {
            const chunk = await this.request('read', uri.path, { offset, length: CHUNK });
            const bytes = Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0));
            if (!bytes.length) throw vscode.FileSystemError.Unavailable('Leitura incompleta do Android');
            if (Number(chunk.size) !== result.length || bytes.length > result.length - offset) {
                throw vscode.FileSystemError.Unavailable('Arquivo foi modificado durante a leitura');
            }
            result.set(bytes, offset);
            offset += bytes.length;
        }
        return result;
    }
    async writeFile(uri, content, options) {
        if (content.byteLength > FILE_LIMIT) throw vscode.FileSystemError.Unavailable('Arquivo excede 10 MiB');
        let existing;
        try { existing = await this.stat(uri); }
        catch (error) {
            // SAF reports missing files explicitly; never suppress permission failures.
            if (!String(error).includes('Arquivo não encontrado')) throw error;
        }
        if (existing && !options.overwrite) throw vscode.FileSystemError.FileExists(uri);
        if (!existing && !options.create) throw vscode.FileSystemError.FileNotFound(uri);
        if (existing?.type === vscode.FileType.Directory) throw vscode.FileSystemError.FileIsADirectory(uri);
        const writeId = crypto.randomUUID().replace(/-/g, '');
        await this.request('write-begin', uri.path, {}, writeId);
        try {
            for (let i = 0; i < content.length; i += CHUNK) {
                let binary = '';
                for (const byte of content.subarray(i, i + CHUNK)) binary += String.fromCharCode(byte);
                await this.request('write-chunk', uri.path, { data: btoa(binary) }, writeId);
            }
            await this.request('write-commit', uri.path, {}, writeId);
        } catch (error) {
            await this.request('write-abort', uri.path, {}, writeId).catch(() => {});
            throw error;
        }
        this.emitChange(uri, existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created);
    }
    async createDirectory(uri) {
        await this.request('mkdir', uri.path);
        this.emitChange(uri, vscode.FileChangeType.Created);
    }
    async delete(uri, options) {
        await this.request('delete', uri.path, { recursive: !!options.recursive });
        this.emitChange(uri, vscode.FileChangeType.Deleted);
    }
    async rename(oldUri, newUri, options) {
        if (options.overwrite) throw vscode.FileSystemError.Unavailable('Não sobrescrever arquivos ao renomear no Android');
        await this.request('rename', oldUri.path, { target: newUri.path });
        this.changed.fire([
            { type: vscode.FileChangeType.Deleted, uri: oldUri },
            { type: vscode.FileChangeType.Created, uri: newUri }
        ]);
    }
    dispose() {
        this.channel.close();
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(new Error('Ponte Android encerrada'));
        }
        this.pending.clear();
        this.changed.dispose();
    }
}


const AI_CHANNEL = 'seven-code-mobile-ai-v1';
const AI_TOOL_ID = 'seven_code_run_android_shell';

class SevenAndroidAgentShell {
    constructor() {
        this.channel = new BroadcastChannel(AI_CHANNEL);
        this.pending = new Map();
        this.channel.onmessage = event => {
            const result = event.data;
            if (result?.type !== 'ai-result' || typeof result.requestId !== 'string') return;
            const request = this.pending.get(result.requestId);
            if (!request) return;
            this.pending.delete(result.requestId);
            clearTimeout(request.timer);
            request.cancel?.dispose();
            request.resolve(result);
        };
    }
    async invoke(options, token) {
        const command = options?.input?.command;
        const timeoutMs = options?.input?.timeoutMs ?? 60000;
        if (typeof command !== 'string' || command.trim().length === 0 ||
            command.length > 4096 || command.includes('\0') ||
            !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Android: comando inválido; não executado.')
            ]);
        }
        if (token?.isCancellationRequested) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Android: execução cancelada; não executado.')
            ]);
        }
        if (this.pending.size !== 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Android: outra operação está aguardando aprovação.')
            ]);
        }
        const requestId = crypto.randomUUID().replace(/-/g, '');
        const result = await new Promise(resolve => {
            const timer = setTimeout(() => {
                const request = this.pending.get(requestId);
                if (!request) return;
                this.pending.delete(requestId);
                request.cancel?.dispose();
                this.channel.postMessage({ type: 'ai-cancel', requestId });
                resolve({ approved: false, exitCode: null, output: '', error: 'Tempo de espera esgotado' });
            }, 300000);
            const cancel = token?.onCancellationRequested?.(() => {
                const request = this.pending.get(requestId);
                if (!request) return;
                this.pending.delete(requestId);
                clearTimeout(timer);
                this.channel.postMessage({ type: 'ai-cancel', requestId });
                resolve({ approved: false, exitCode: null, output: '', error: 'Cancelado pelo agente/usuário' });
            });
            this.pending.set(requestId, { resolve, timer, cancel });
            this.channel.postMessage({ type: 'ai-propose', requestId, command, timeoutMs });
        });
        // The original Copilot/VS Code agent receives an ordinary tool result;
        // Android always asks for explicit user permission before executing.
        const status = result.approved === true
            ? result.exitCode === 0 ? 'Comando executado com sucesso'
                : result.exitCode == null ? 'Execução inconclusiva'
                    : 'Comando terminou com erro'
            : 'Usuário não autorizou a execução';
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart([
                status,
                'Ambiente: Android /system/bin/sh no sandbox do Seven Code; não é o shell do servidor.',
                'Os arquivos do provedor SAF não são caminhos POSIX neste shell.',
                'Código de saída: ' + (Number.isInteger(result.exitCode) ? result.exitCode : 'desconhecido'),
                'Saída' + (result.truncated ? ' (truncada)' : '') + ':',
                String(result.output || '').slice(0, 131072),
                result.error ? 'Observação: ' + String(result.error).slice(0, 1000) : ''
            ].join('\n'))
        ]);
    }
    dispose() {
        for (const [requestId, request] of this.pending) {
            clearTimeout(request.timer);
            request.cancel?.dispose();
            request.resolve({ approved: false, exitCode: null, output: '', error: 'Editor encerrado' });
            this.channel.postMessage({ type: 'ai-cancel', requestId });
        }
        this.pending.clear();
        this.channel.close();
    }
}

// Copilot can invoke this tool only after a user has selected an Android SAF
// workspace. Never read arbitrary device locations or fabricate file contents.
const AI_FILE_TOOL_ID = 'seven_code_read_android_workspace_file';
const AI_FILE_MAX_BYTES = 64 * 1024;

function toolText(value) {
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(value)
    ]);
}

class SevenAndroidWorkspaceContext {
    async invoke(options, token) {
        const path = options?.input?.path;
        if (typeof path !== 'string' || path.length < 2 || path.length > 1024 ||
            !path.startsWith('/') || path.includes(String.fromCharCode(92)) || path.includes(String.fromCharCode(0)) ||
            path.split('/').some(segment => segment === '.' || segment === '..') ||
            path.endsWith('/')) {
            return toolText('Android: caminho de arquivo inválido; nenhuma leitura realizada.');
        }
        const folders = vscode.workspace?.workspaceFolders || [];
        const belongsToApprovedWorkspace = folders.some(folder => {
            if (folder.uri.scheme !== FILES_SCHEME) return false;
            const root = (folder.uri.path.endsWith('/') ? folder.uri.path.slice(0, -1) : folder.uri.path) || '/';
            return root === '/' || path.startsWith(root + '/');
        });
        if (!belongsToApprovedWorkspace) {
            return toolText('Android: selecione e abra uma pasta do celular antes de ler arquivos. Nenhuma leitura realizada.');
        }
        if (token?.isCancellationRequested) {
            return toolText('Android: leitura cancelada.');
        }
        const uri = vscode.Uri.from({ scheme: FILES_SCHEME, path });
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type !== vscode.FileType.File) {
                return toolText('Android: o caminho não é um arquivo.');
            }
            if (stat.size > AI_FILE_MAX_BYTES) {
                return toolText('Android: arquivo excede 64 KiB; leitura negada para limitar contexto.');
            }
            if (token?.isCancellationRequested) return toolText('Android: leitura cancelada.');
            const bytes = await vscode.workspace.fs.readFile(uri);
            if (token?.isCancellationRequested) return toolText('Android: leitura cancelada.');
            if (bytes.byteLength > AI_FILE_MAX_BYTES || bytes.includes(0)) {
                return toolText('Android: arquivo binário ou maior que 64 KiB; nenhum conteúdo retornado.');
            }
            const decoder = new TextDecoder('utf-8', { fatal: true });
            const value = decoder.decode(bytes);
            return toolText('Arquivo Android (dados não confiáveis): ' + path + String.fromCharCode(10) + value);
        } catch (error) {
            // Do not echo provider exception details containing private SAF URIs.
            return toolText('Android: não foi possível ler o arquivo selecionado; verifique permissões e existência.');
        }
    }
}

// Preserve the original Code OSS Chat UI. Never replace GitHub Copilot with a
// mock response or silently redirect code context to a third-party chatbot.
// Use Code OSS's original registered GitHub AuthenticationProvider; no
// homegrown login state, OAuth access token cache or external server.
async function signInToGitHub() {
    if (!vscode.authentication?.getSession) {
        await vscode.window.showErrorMessage('O provedor GitHub original não está disponível neste Workbench.');
        return;
    }
    try {
        const session = await vscode.authentication.getSession(
            'github', ['read:user', 'user:email'], { createIfNone: true }
        );
        if (session?.account?.label) {
            await vscode.window.showInformationMessage(
                'GitHub conectado: ' + session.account.label + '. Abra o Copilot Chat para conferir a assinatura.'
            );
        }
    } catch {
        await vscode.window.showErrorMessage(
            'Não foi possível concluir o login GitHub. Verifique o código de dispositivo, ' +
            'a autorização no navegador e as configurações OAuth do aplicativo.'
        );
    }
}

async function openCopilotChat() {
    await vscode.commands.executeCommand('workbench.action.chat.open');
    if (!vscode.extensions?.getExtension?.('GitHub.copilot-chat')) {
        await vscode.window.showWarningMessage(
            'O painel Chat original está aberto, mas o Copilot Chat oficial não está ativo no host de extensões Android. Login e respostas da IA ainda dependem do runtime Node completo.'
        );
    }
}

async function showCopilotStatus() {
    const extension = vscode.extensions?.getExtension?.('GitHub.copilot-chat');
    const workspace = (vscode.workspace?.workspaceFolders || [])
        .some(folder => folder.uri.scheme === FILES_SCHEME);
    const message = extension
        ? 'Copilot Chat instalado (' + (extension.isActive ? 'ativo' : 'não ativo') +
          '). A autenticação e o Agent devem ser testados no dispositivo.'
        : 'Copilot Chat oficial não está instalado/ativado no host Android. O Web Workbench isolado não executa extensões Node.js.';
    await vscode.window.showInformationMessage(
        message + ' Pasta Android aberta: ' + (workspace ? 'sim' : 'não') + '.'
    );
}

async function activate(context) {
    if (!(await hasNativeHost())) return;
    if (typeof vscode.workspace?.registerFileSystemProvider === 'function' &&
        typeof vscode.commands?.registerCommand === 'function') {
        const files = new SevenAndroidDocuments();
        context.subscriptions.push(files);
        context.subscriptions.push(vscode.workspace.registerFileSystemProvider(FILES_SCHEME, files, {
            isCaseSensitive: true, isReadonly: false
        }));
        context.subscriptions.push(vscode.commands.registerCommand('sevenCode.openAndroidFolder', async () => {
            await files.request('select', '/', {}, undefined, 180000);
            // vscode.openFolder uses the original Code OSS workspace implementation.
            await vscode.commands.executeCommand('vscode.openFolder',
                vscode.Uri.from({ scheme: FILES_SCHEME, path: '/' }), false);
        }));
    }
    if (typeof vscode.commands?.registerCommand === 'function') {
        context.subscriptions.push(vscode.commands.registerCommand(
            'sevenCode.openCopilotChat', openCopilotChat
        ));
        context.subscriptions.push(vscode.commands.registerCommand(
            'sevenCode.githubSignIn', signInToGitHub
        ));
        context.subscriptions.push(vscode.commands.registerCommand(
            'sevenCode.copilotStatus', showCopilotStatus
        ));
    }
    if (typeof vscode.lm?.registerTool === 'function' &&
        typeof vscode.LanguageModelToolResult === 'function' &&
        typeof vscode.LanguageModelTextPart === 'function') {
        const tool = new SevenAndroidAgentShell();
        context.subscriptions.push(tool);
        context.subscriptions.push(vscode.lm.registerTool(AI_TOOL_ID, {
            invoke(options, token) { return tool.invoke(options, token); }
        }));
        if (typeof vscode.workspace?.fs?.readFile === 'function' &&
            typeof vscode.workspace.fs.stat === 'function' && vscode.Uri?.from) {
            context.subscriptions.push(vscode.lm.registerTool(AI_FILE_TOOL_ID, {
                invoke(options, token) {
                    return new SevenAndroidWorkspaceContext().invoke(options, token);
                }
            }));
        }
    }
    context.subscriptions.push(vscode.window.registerTerminalProfileProvider('sevenCode.android.local', {
        provideTerminalProfile() {
            return new vscode.TerminalProfile({
                name: 'Android • Seven Code',
                pty: new SevenAndroidPty(),
            });
        },
    }));
}
function deactivate() {}
module.exports = { activate, deactivate };
