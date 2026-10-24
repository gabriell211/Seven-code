import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

const source = readFileSync('extensions/seven-code-mobile-terminal/dist/browser/extension.js', 'utf8');
const manifest = JSON.parse(readFileSync('extensions/seven-code-mobile-terminal/package.json', 'utf8'));

function createHost({ installed = true, activateError = null } = {}) {
  const channels = new Set();
  const commands = new Map();
  const executed = [];
  const warnings = [];
  const errors = [];
  let activations = 0;
  class Channel {
    constructor(name) { this.name = name; this.onmessage = null; channels.add(this); }
    postMessage(data) {
      for (const other of channels) {
        if (other !== this && other.name === this.name) {
          queueMicrotask(() => other.onmessage?.({ data }));
        }
      }
    }
    close() { channels.delete(this); }
  }
  const native = new Channel('seven-code-mobile-terminal-v1');
  native.onmessage = event => {
    if (event.data?.type === 'probe') {
      native.postMessage({ type: 'probe-result', nonce: event.data.nonce, platform: 'android' });
    }
  };
  const vscode = {
    UIKind: { Web: 2 },
    env: { uiKind: 2 },
    commands: {
      registerCommand(name, implementation) {
        commands.set(name, implementation);
        return { dispose() { commands.delete(name); } };
      },
      async executeCommand(name) { executed.push(name); },
    },
    extensions: {
      getExtension(name) {
        assert.equal(name, 'GitHub.copilot-chat');
        return installed ? { async activate() {
          activations++;
          if (activateError) throw activateError;
        } } : undefined;
      },
    },
    window: {
      registerTerminalProfileProvider() { return { dispose() {} }; },
      async showWarningMessage(message) { warnings.push(message); },
      async showErrorMessage(message) { errors.push(message); },
    },
  };
  const module = { exports: {} };
  runInNewContext(source, {
    module, BroadcastChannel: Channel, TextEncoder, TextDecoder, crypto: webcrypto,
    atob, btoa, queueMicrotask, setTimeout, clearTimeout,
    require(name) { assert.equal(name, 'vscode'); return vscode; },
  });
  return {
    async activate() { await module.exports.activate({ subscriptions: [] }); },
    commands, executed, warnings, errors, get activations() { return activations; },
    close() { native.close(); },
  };
}

test('Android contributes an explicit command to open real Copilot Chat', () => {
  const cmd = manifest.contributes.commands.find(x => x.command === 'sevenCode.openCopilotChat');
  assert.equal(cmd?.title, 'Abrir Copilot Chat');
  assert.ok(manifest.activationEvents.includes('onCommand:sevenCode.openCopilotChat'));
});

test('installed Copilot is activated, then the genuine Code OSS Chat view opens', async () => {
  const app = createHost();
  await app.activate();
  assert.ok(app.commands.has('sevenCode.openCopilotChat'));
  await app.commands.get('sevenCode.openCopilotChat')();
  assert.equal(app.activations, 1);
  assert.deepEqual(app.executed, ['workbench.action.chat.open']);
  assert.equal(app.warnings.length, 0);
  app.close();
});

test('missing Copilot must not show mock chat or claim authenticated completion', async () => {
  const app = createHost({ installed: false });
  await app.activate();
  await app.commands.get('sevenCode.openCopilotChat')();
  assert.deepEqual(app.executed, []);
  assert.match(app.warnings[0], /não está instalado/);
  app.close();
});

test('a broken Copilot activation reports failure and never opens a fake chat', async () => {
  const app = createHost({ activateError: new Error('authentication unavailable') });
  await app.activate();
  await app.commands.get('sevenCode.openCopilotChat')();
  assert.deepEqual(app.executed, []);
  assert.match(app.errors[0], /authentication unavailable/);
  app.close();
});
