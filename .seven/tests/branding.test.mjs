import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const svg=readFileSync(new URL('../assets/seven-code.svg',import.meta.url),'utf8');
const theme=JSON.parse(readFileSync(new URL('../../extensions/seven-code-theme/themes/seven-code-dark-color-theme.json',import.meta.url),'utf8'));
const ext=JSON.parse(readFileSync(new URL('../../extensions/seven-code-theme/package.json',import.meta.url),'utf8'));
test('marca exclusiva possui base e gradiente',()=>{assert.match(svg,/<svg /);assert.match(svg,/#080f24/);assert.match(svg,/linearGradient/);});
test('tema Seven Code Dark está disponível',()=>{assert.equal(ext.contributes.themes[0].label,'Seven Code Dark');assert.equal(theme.name,'Seven Code Dark');assert.equal(theme.colors['editor.background'],'#0B1124');});
