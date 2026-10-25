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
    assert.doesNotMatch(kotlin, /requestFocusFromTouch\(\)/);
    assert.ok(kotlin.includes('document.activeElement'));
    assert.ok(kotlin.includes('focused != "true"'));
    assert.match(kotlin, /getSystemService\(Context\.INPUT_METHOD_SERVICE\)/);
    assert.match(kotlin, /ime\.showSoftInput\(editorView, InputMethodManager\.SHOW_IMPLICIT\)/);
    assert.match(kotlin, /if \(data\.optString\("type"\) == "keyboard-request"\)/);
    assert.match(kotlin, /sourceOrigin\.toString\(\) != trustedOrigin/);
    assert.match(kotlin, /!isMainFrame/);
    assert.doesNotMatch(kotlin, /MANAGE_EXTERNAL_STORAGE|BIND_INPUT_METHOD/);
});

class Element {
    constructor({ editable = false, editor = false, input = null, onFocus = null } = {}) {
        this.editable = editable;
        this.editor = editor;
        this.input = input;
        this.onFocus = onFocus;
    }
    matches(selector) {
        return this.editable && selector.includes('textarea');
    }
    closest(selector) {
        return this.editor && selector.includes('.monaco-editor') ? this : null;
    }
    querySelector() { return this.input; }
    focus() { this.onFocus?.(this); }
}
function render({ trusted }) {
    const messages = [];
    const listeners = new Map();
    const document = {
        activeElement: null,
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
    const menus = [];
    const MenuId = { AccountsContext: 'AccountsContext', EditorTitle: 'EditorTitle', ChatTitleBarMenu: 'ChatTitleBarMenu' };
    const MenuRegistry = {
        appendMenuItem(id, item) {
            const entry = { id, item, disposed: false };
            menus.push(entry);
            return { dispose() { entry.disposed = true; } };
        }
    };
    const js = stripTypeScriptTypes(source, { mode: 'transform' })
        .replace(/export \{\s*\};?\s*$/, '');
    runInNewContext(js.replace(/^import.*MenuId.*MenuRegistry.*$/m, ''),
        { window, document, Element, HTMLElement: Element, BroadcastChannel: Channel, JSON, MenuId, MenuRegistry });
    return { messages, listeners, document, menus };
}

test('focus on Monaco textarea asks for the native Android keyboard', () => {
    const app = render({ trusted: true });
    assert.ok(app.listeners.has('focusin'));
    app.listeners.get('focusin')({ target: new Element({ editable: true }) });
    assert.deepEqual(app.messages, [{ type: 'keyboard-request' }]);
});

test('tap sends IME only when a real HTML input is focused', () => {
    const app = render({ trusted: true });
    const pointer = app.listeners.get('pointerup');
    const editor = new Element({ editor: true });
    pointer({ pointerType: 'touch', target: editor });
    assert.equal(app.messages.length, 0, 'unfocused editor must not open a disconnected keyboard');
    app.document.activeElement = new Element({ editable: true });
    pointer({ pointerType: 'touch', target: editor });
    pointer({ pointerType: 'mouse', target: editor });
    pointer({ pointerType: 'touch', target: new Element() });
    assert.deepEqual(app.messages, [{ type: 'keyboard-request' }]);
});

test('Monaco tap restores its ORIGINAL textarea instead of swallowing typed text', () => {
    const app = render({ trusted: true });
    const input = new Element({
        editable: true,
        onFocus: element => { app.document.activeElement = element; }
    });
    const editor = new Element({ editor: true, input });
    app.listeners.get('pointerup')({ pointerType: 'touch', target: editor });
    assert.equal(app.document.activeElement, input);
    assert.deepEqual(app.messages, [{ type: 'keyboard-request' }]);
});

test('ordinary web browser without trusted Android host never opens a native IME', () => {
    const app = render({ trusted: false });
    assert.equal(app.listeners.has('focusin'), false);
    assert.equal(app.listeners.has('pointerup'), false);
    assert.equal(app.messages.length, 0);
});

test('real Android Accounts and Editor ellipsis menus expose actionable commands', () => {
    const app = render({ trusted: true });
    assert.deepEqual(app.menus.map(menu => [menu.id, menu.item.command.id]), [
        ['AccountsContext', 'sevenCode.githubSignIn'],
        ['EditorTitle', 'sevenCode.openAndroidFolder'],
        ['EditorTitle', 'sevenCode.newAndroidFile'],
        ['ChatTitleBarMenu', 'sevenCode.githubSignIn'],
        ['ChatTitleBarMenu', 'sevenCode.copilotStatus']
    ]);
    app.listeners.get('pagehide')();
    assert.ok(app.menus.every(menu => menu.disposed));
});

test('pagehide unregisters IME listeners and native channels', () => {
    const app = render({ trusted: true });
    assert.ok(app.listeners.has('focusin'));
    app.listeners.get('pagehide')();
    assert.equal(app.listeners.has('focusin'), false);
    assert.equal(app.listeners.has('pointerup'), false);
});
