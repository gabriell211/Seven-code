#!/usr/bin/env node
/**
 * Localize the already-compiled original Code OSS Web workbench.
 * The build's own nls.keys.json is the index: never assume a different
 * VS Code version has the same translation offsets.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const workbenchRoot = resolve(process.argv[2] ?? '');
const languagePackFile = resolve(process.argv[3] ?? '');
if (process.argv.length < 4) {
    throw new Error('Usage: node localize-codeoss-web.mjs <seven-web-assets> <pinned-main.i18n.json>');
}

const outputRoot = join(workbenchRoot, 'out');
const keys = JSON.parse(readFileSync(join(outputRoot, 'nls.keys.json'), 'utf8'));
const original = JSON.parse(readFileSync(join(outputRoot, 'nls.messages.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(languagePackFile, 'utf8'));
assert.equal(catalog.version, '1.0.0', 'Unsupported localization catalog version');
assert.ok(catalog.contents && typeof catalog.contents === 'object', 'No translation modules');
assert.ok(Array.isArray(keys) && Array.isArray(original), 'Missing original Code OSS NLS data');
const localized = [...original];
let cursor = 0;
let translated = 0;
let rejectedPlaceholders = 0;
const placeholders = value => [...String(value).matchAll(/\{[0-9]+\}/g)].map(match => match[0]).sort().join(',');
for (const entry of keys) {
    assert.ok(Array.isArray(entry) && typeof entry[0] === 'string' && Array.isArray(entry[1]),
        'Malformed upstream NLS module entry');
    const [moduleId, moduleKeys] = entry;
    const strings = catalog.contents[moduleId];
    for (const key of moduleKeys) {
        assert.ok(cursor < original.length, 'NLS key count exceeds source message count');
        const candidate = strings?.[key];
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            if (placeholders(candidate) === placeholders(original[cursor])) {
                localized[cursor] = candidate;
                translated++;
            } else {
                rejectedPlaceholders++;
            }
        }
        cursor++;
    }
}
assert.equal(cursor, original.length, 'NLS translation index drift detected');
const minimum = Math.min(500, Math.max(1, Math.floor(original.length * 0.12)));
assert.ok(translated >= minimum,
    `Too few pt-BR translations (${translated}/${original.length}; minimum ${minimum}). Refusing English-only release.`);

// The original workbench reads these globals before any modules are imported.
// Merely marking <html lang="pt-BR"> DOES NOT translate Code OSS.
writeFileSync(join(outputRoot, 'nls.messages.js'),
    'globalThis._VSCODE_NLS_MESSAGES = ' + JSON.stringify(localized) +
    ';\nglobalThis._VSCODE_NLS_LANGUAGE = "pt-br";\n');
const bundleFile = join(workbenchRoot, 'bundle.json');
const bundle = JSON.parse(readFileSync(bundleFile, 'utf8'));
bundle.uiLanguage = 'pt-br';
bundle.uiTranslations = { translated, total: original.length, rejectedPlaceholders };
writeFileSync(bundleFile, JSON.stringify(bundle, null, 2) + '\n');
console.log(`Seven Code pt-BR: translated ${translated}/${original.length}; fallback to original English where missing; rejected ${rejectedPlaceholders} invalid placeholders.`);
