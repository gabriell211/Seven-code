import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withBundle(run) {
    const dir = mkdtempSync(join(tmpdir(), 'seven-ptbr-'));
    const root = join(dir, 'seven-web');
    const out = join(root, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(root, 'bundle.json'), '{"kind":"original-code-oss-standalone-web"}');
    const keys = [['vs/code/welcome', ['start', 'openFile', 'openFolder', 'missing']]];
    const originals = ['Start', 'Open File...', 'Open Folder...', 'Not translated'];
    writeFileSync(join(out, 'nls.keys.json'), JSON.stringify(keys));
    writeFileSync(join(out, 'nls.messages.json'), JSON.stringify(originals));
    writeFileSync(join(out, 'nls.messages.js'), 'globalThis._VSCODE_NLS_MESSAGES=[];');
    const pack = join(dir, 'main.i18n.json');
    const translations = {
        version: '1.0.0',
        contents: { 'vs/code/welcome': {
            start: 'Iniciar', openFile: 'Abrir arquivo...', openFolder: 'Abrir pasta...'
        } }
    };
    writeFileSync(pack, JSON.stringify(translations));
    try { run({ root, out, pack, translations }); }
    finally { rmSync(dir, { recursive: true, force: true }); }
}

test('real Web workbench NLS strings become pt-BR, retaining upstream key order', () => {
    withBundle(({ root, out, pack }) => {
        execFileSync(process.execPath, ['.seven/android/localize-codeoss-web.mjs', root, pack]);
        const js = readFileSync(join(out, 'nls.messages.js'), 'utf8');
        assert.match(js, /_VSCODE_NLS_LANGUAGE = "pt-br"/);
        assert.match(js, /"Iniciar","Abrir arquivo\.\.\.","Abrir pasta\.\.\.","Not translated"/);
        const meta = JSON.parse(readFileSync(join(root, 'bundle.json'), 'utf8'));
        assert.equal(meta.uiLanguage, 'pt-br');
        assert.equal(meta.uiTranslations.translated, 3);
    });
});

test('invalid translation placeholders must fall back to original English', () => {
    withBundle(({ root, out, pack, translations }) => {
        const originals = ['Hello {0}', 'Open File...', 'Open Folder...', 'Not translated'];
        writeFileSync(join(out, 'nls.messages.json'), JSON.stringify(originals));
        translations.contents['vs/code/welcome'].start = 'Olá {1}';
        writeFileSync(pack, JSON.stringify(translations));
        execFileSync(process.execPath, ['.seven/android/localize-codeoss-web.mjs', root, pack]);
        const js = readFileSync(join(out, 'nls.messages.js'), 'utf8');
        assert.match(js, /"Hello \{0\}"/);
        const meta = JSON.parse(readFileSync(join(root, 'bundle.json'), 'utf8'));
        assert.equal(meta.uiTranslations.rejectedPlaceholders, 1);
    });
});

test('English-only or malformed language pack fails the build instead of lying', () => {
    withBundle(({ root, pack }) => {
        writeFileSync(pack, JSON.stringify({version:'1.0.0',contents:{}}));
        assert.throws(() => execFileSync(process.execPath,
            ['.seven/android/localize-codeoss-web.mjs', root, pack], {stdio:'pipe'}),
            /Command failed/);
    });
});
