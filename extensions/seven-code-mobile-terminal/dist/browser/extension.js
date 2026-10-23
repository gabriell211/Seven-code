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

async function activate(context) {
    if (!(await hasNativeHost())) return;
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
