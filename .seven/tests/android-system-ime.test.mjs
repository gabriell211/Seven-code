import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const kotlin = readFileSync('mobile/android/app/src/main/java/dev/seven/code/MainActivity.kt', 'utf8');
const manifest = readFileSync('mobile/android/app/src/main/AndroidManifest.xml', 'utf8');
const source = readFileSync('src/vs/workbench/browser/sevenMobileTerminalBridge.ts', 'utf8');

test('Android requests the configured IME through real InputMethodManager, never a fake keyboard', () => {
    assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
    assert.match(kotlin, /isFocusableInTouchMode = true/);
    assert.match(kotlin, /requestFocusFromTouch\(\)/);
    assert.match(kotlin, /getSystemService\(Context\.INPUT_METHOD_SERVICE\)/);
    assert.match(kotlin, /ime\.showSoftInput\(editorView, InputMethodManager\.SHOW_IMPLICIT\)/);
    assert.match(kotlin, /if \(data\.optString\("type"\) == "keyboard-request"\)/);
    assert.match(kotlin, /sourceOrigin\.toString\(\) != trustedOrigin/);
    assert.match(kotlin, /!isMainFrame/);
    assert.doesNotMatch(kotlin, /MANAGE_EXTERNAL_STORAGE|BIND_INPUT_METHOD/);
});

class Element {
    constructor({ editable = false, editor = false } = {}) {
        this.editable = editable;
        this.editor = editor;
    }
    matches(selector) {
        return this.editable && selector.includes('textarea');
    }
    closest(selector) {
        return this.editor && selector.includes('.monaco-editor') ? this : null;
    }
}
function render({ trusted }) {
    const messages = [];
    const listeners = new Map();
    const document = {
        addEventListener(name, callback) { listeners.set(name, callback); },
        removeEventListener(name, callback) {
            if (listeners.get(name) === callback) listeners.delete(name);
        }
    };
    const window = {
        SevenTerminalNative: trusted ? { postMessage: raw => messages.push(JSON.parse(raw)) } : undefined,
        addEventListener(name, callback) { listeners.set(name, callback); },
        setTimeout(callback) { callback(); }
    };
    class Channel {
        constructor() { this.onmessage = null; }
        close() {}
        postMessage() {}
    }
    const js = stripTypeScriptTypes(source, { mode: 'transform' })
        .replace(/export \{\s*\};?\s*$/, '');
    runInNewContext(js, { window, document, Element, BroadcastChannel: Channel, JSON });
    return { messages, listeners };
}

test('focus on Monaco textarea asks for the native Android keyboard', () => {
    const app = render({ trusted: true });
    assert.ok(app.listeners.has('focusin'));
    app.listeners.get('focusin')({ target: new Element({ editable: true }) });
    assert.deepEqual(app.messages, [{ type: 'keyboard-request' }]);
});

test('tap in Monaco or terminal asks IME, but unrelated taps do not', () => {
    const app = render({ trusted: true });
    const pointer = app.listeners.get('pointerup');
    pointer({ pointerType: 'touch', target: new Element({ editor: true }) });
    pointer({ pointerType: 'mouse', target: new Element({ editor: true }) });
    pointer({ pointerType: 'touch', target: new Element() });
    assert.deepEqual(app.messages, [{ type: 'keyboard-request' }]);
});

test('ordinary web browser without trusted Android host never opens a native IME', () => {
    const app = render({ trusted: false });
    assert.equal(app.listeners.has('focusin'), false);
    assert.equal(app.listeners.has('pointerup'), false);
    assert.equal(app.messages.length, 0);
});

test('pagehide unregisters IME listeners and native channels', () => {
    const app = render({ trusted: true });
    assert.ok(app.listeners.has('focusin'));
    app.listeners.get('pagehide')();
    assert.equal(app.listeners.has('focusin'), false);
    assert.equal(app.listeners.has('pointerup'), false);
});
