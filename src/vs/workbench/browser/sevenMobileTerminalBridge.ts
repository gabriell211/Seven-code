/* Seven Code mobile transport: only present in the web workbench of a trusted native host. */
interface SevenNativeTerminalHost {
    postMessage(message: string): void;
}
interface SevenMobileEvent {
    type: string;
    sessionId?: string;
    exitCode?: number | null;
    pid?: number;
    cwd?: string;
    requestId?: string;
    ok?: boolean;
    value?: unknown;
    error?: string;
}
declare global {
    interface Window {
        SevenTerminalNative?: SevenNativeTerminalHost;
        sevenNativeEvent?: (event: SevenMobileEvent) => void;
    }
}
const host = window.SevenTerminalNative;
if (host && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('seven-code-mobile-terminal-v1');
    const files = new BroadcastChannel('seven-code-mobile-files-v1');
    const ai = new BroadcastChannel('seven-code-mobile-ai-v1');
    ai.onmessage = event => {
        const data: unknown = event.data;
        if (!data || typeof data !== 'object' || !('type' in data) ||
            !['ai-propose', 'ai-cancel'].includes(String(data.type)) ||
            !('requestId' in data) || typeof data.requestId !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(data.requestId)) {
            return;
        }
        host.postMessage(JSON.stringify(data));
    };
    const fileOps = new Set(['select', 'status', 'stat', 'list', 'read', 'mkdir', 'delete', 'rename', 'write-begin', 'write-chunk', 'write-commit', 'write-abort']);
    files.onmessage = event => {
        const data: unknown = event.data;
        if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'fs-request' ||
            !('requestId' in data) || typeof data.requestId !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(data.requestId) ||
            !('op' in data) || typeof data.op !== 'string' || !fileOps.has(data.op)) {
            return;
        }
        host.postMessage(JSON.stringify(data));
    };

    channel.onmessage = event => {
        const data: unknown = event.data;
        if (!data || typeof data !== 'object' || !('type' in data) || typeof data.type !== 'string') {
            return;
        }
        if (data.type === 'probe' && 'nonce' in data && typeof data.nonce === 'string') {
            channel.postMessage({ type: 'probe-result', nonce: data.nonce, platform: 'android' });
            return;
        }
        if (!['start', 'input', 'resize', 'close'].includes(data.type)) {
            return;
        }
        if (!('sessionId' in data) || typeof data.sessionId !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(data.sessionId)) {
            return;
        }
        host.postMessage(JSON.stringify(data));
    };
    window.sevenNativeEvent = event => {
        if (event && event.type === 'ai-result' &&
            typeof event.requestId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(event.requestId)) {
            ai.postMessage(event);
            return;
        }
        if (event && event.type === 'fs-result' &&
            typeof event.requestId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(event.requestId)) {
            files.postMessage(event);
            return;
        }
        if (event && ['ready', 'data', 'error', 'exit'].includes(event.type) &&
            typeof event.sessionId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(event.sessionId)) {
            channel.postMessage(event);
        }
    };
    window.addEventListener('pagehide', () => {
        window.sevenNativeEvent = undefined;
        channel.close();
        files.close();
        ai.close();
    }, { once: true });
}
export {};
