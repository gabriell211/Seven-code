/* Seven Code mobile transport: only present in the web workbench of a trusted native host. */
interface SevenNativeTerminalHost {
    postMessage(message: string): void;
}
interface SevenMobileEvent {
    type: string;
    sessionId?: string;
    value?: string;
    exitCode?: number | null;
    pid?: number;
    cwd?: string;
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
        if (event && ['ready', 'data', 'error', 'exit'].includes(event.type) &&
            typeof event.sessionId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(event.sessionId)) {
            channel.postMessage(event);
        }
    };
    window.addEventListener('pagehide', () => {
        window.sevenNativeEvent = undefined;
        channel.close();
    }, { once: true });
}
export {};
