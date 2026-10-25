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
  assert.equal(commands.find(x => x.command === 'sevenCode.githubSignIn')?.title,
    'Seven Code: Entrar com GitHub para Copilot');
  assert.ok(manifest.activationEvents.includes('onCommand:sevenCode.openCopilotChat'));
  assert.match(source, /workbench\.action\.chat\.open/);
  assert.match(source, /sevenCode\.copilotStatus/);
  assert.match(source, /vscode\.authentication\.getSession/);
  assert.match(source, /createIfNone: true/);
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

test('Live Copilot acceptance requires real GitHub /user and streamed real model response', () => {
  const commands = manifest.contributes.commands;
  assert.ok(commands.some(c => c.command === 'sevenCode.copilotLiveAcceptance'));
  assert.ok(commands.some(c => c.command === 'sevenCode.copilotAgentAcceptance'));
  assert.ok(manifest.activationEvents.includes('onCommand:sevenCode.copilotLiveAcceptance'));
  assert.match(source, /https:\/\/api\.github\.com\/user/);
  assert.match(source, /createIfNone: false/);
  assert.match(source, /vscode\.lm\.selectChatModels\(\{ vendor: 'copilot' \}\)/);
  assert.match(source, /candidate\.vendor === 'copilot'/);
  assert.match(source, /model\.sendRequest/);
  assert.match(source, /for await \(const chunk of response\.text\)/);
  assert.match(source, /sevenCode\.copilotAgentAcceptance/);
  assert.match(source, /SEVEN_CODE_AGENT_REAL_OK/);
  assert.doesNotMatch(source, /FAKE[_-]COPILOT|mockResponse|fakeCompletion/i);
});
