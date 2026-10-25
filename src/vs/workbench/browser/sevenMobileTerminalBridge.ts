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
    // Monaco, xterm.js, the command palette and dialogs use real Chromium
    // text fields. Android WebView may focus them without opening the IME.
    // Ask the host to show the phone's configured Android keyboard only on
    // user interaction or real text-field focus (never at app startup).
    const postImeRequest = () => {
        host.postMessage(JSON.stringify({ type: 'keyboard-request' }));
    };
    const isTextInput = (element: Element | null): boolean =>
        !!element && element.matches(
            'textarea:not([disabled]):not([readonly]),' +
            'input:not([disabled]):not([readonly]):not([type="hidden"]),' +
            '[contenteditable]:not([contenteditable="false"])'
        );
    const onEditorFocus = (event: FocusEvent) => {
        if (event.target instanceof Element && isTextInput(event.target)) {
            postImeRequest();
        }
    };
    const onEditorPointer = (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        if (!(event.target instanceof Element)) return;
        const target = event.target;
        const editingSurface = isTextInput(target) ||
            !!target.closest('.monaco-editor, .xterm, .quick-input-widget, .monaco-inputbox, .find-widget, .search-widget');
        if (!editingSurface) return;
        // Code OSS may attach Monaco's hidden input after the touch is handled.
        // Recover ONLY an existing input in the touched editor/terminal.
        // Never create a fake EditText or route text through synthetic key events.
        window.setTimeout(() => {
            if (!isTextInput(document.activeElement)) {
                const editor = target.closest('.monaco-editor, .xterm');
                const originalInput = editor?.querySelector(
                    'textarea.inputarea, textarea.xterm-helper-textarea'
                );
                if (originalInput instanceof HTMLElement && isTextInput(originalInput)) {
                    originalInput.focus({ preventScroll: true });
                }
            }
            // Showing IME with no editable document focus produces the exact
            // symptom "keyboard opens but typing does nothing".
            if (isTextInput(document.activeElement)) {
                postImeRequest();
            }
        }, 95);
    };
    document.addEventListener('focusin', onEditorFocus, true);
    document.addEventListener('pointerup', onEditorPointer, true);
    const channel = new BroadcastChannel('seven-code-mobile-terminal-v1');
    const files = new BroadcastChannel('seven-code-mobile-files-v1');
    const ai = new BroadcastChannel('seven-code-mobile-ai-v1');
    const github = new BroadcastChannel('seven-code-mobile-github-device-v1');
    github.onmessage = event => {
        const data: unknown = event.data;
        if (!data || typeof data !== 'object' ||
            !('type' in data) || data.type !== 'github-device-request' ||
            !('requestId' in data) || typeof data.requestId !== 'string' ||
            !/^[A-Za-z0-9_-]{1,64}$/.test(data.requestId) ||
            !('op' in data) || !['begin', 'poll'].includes(String(data.op))) {
            return;
        }
        host.postMessage(JSON.stringify(data));
    };

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
        if (event && event.type === 'github-device-result' &&
            typeof event.requestId === 'string' &&
            /^[A-Za-z0-9_-]{1,64}$/.test(event.requestId)) {
            github.postMessage(event);
            return;
        }
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
        document.removeEventListener('focusin', onEditorFocus, true);
        document.removeEventListener('pointerup', onEditorPointer, true);
        window.sevenNativeEvent = undefined;
        channel.close();
        files.close();
        ai.close();
        github.close();
    }, { once: true });
}
export {};
