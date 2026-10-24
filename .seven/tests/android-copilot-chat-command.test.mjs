import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('extensions/seven-code-mobile-terminal/dist/browser/extension.js', 'utf8');
const manifest = JSON.parse(readFileSync('extensions/seven-code-mobile-terminal/package.json', 'utf8'));

test('Android exposes the original Code OSS Chat and an explicit Copilot status command', () => {
  const commands = manifest.contributes.commands;
  assert.equal(commands.find(x => x.command === 'sevenCode.openCopilotChat')?.title,
    'Seven Code: Abrir Copilot Chat');
  assert.ok(commands.some(x => x.command === 'sevenCode.copilotStatus'));
  assert.ok(manifest.activationEvents.includes('onCommand:sevenCode.openCopilotChat'));
  assert.match(source, /workbench\.action\.chat\.open/);
  assert.match(source, /sevenCode\.copilotStatus/);
});

test('Copilot authentication and Agent remain unverified until device E2E', () => {
  assert.match(source, /A autenticação e o Agent devem ser testados no dispositivo/);
  assert.match(source, /não está ativo no host de extensões Android/);
  assert.doesNotMatch(source, /https:\/\/api\.github\.com\/copilot/);
});

test('Preserves local Android terminal and approved workspace tool while enabling Web Copilot', () => {
  assert.ok(manifest.contributes.terminal.profiles.some(p => p.id === 'sevenCode.android.local'));
  assert.ok(manifest.contributes.languageModelTools.some(t => t.name === 'seven_code_run_android_shell'));
  assert.ok(manifest.contributes.languageModelTools.some(t => t.name === 'seven_code_read_android_workspace_file'));
});
