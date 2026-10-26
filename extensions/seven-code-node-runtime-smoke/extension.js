'use strict';
// Workspace-only Code OSS extension, NEVER a fake Web Worker. A proof file is
// written only after the real Node extension host has required fs/crypto,
// forked a child process with working IPC, and optionally loaded the original
// GitHub Copilot ARM64 native addon. This is not itself an E2E pass.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const os = require('node:os');

async function verifyNodeHost() {
  const proof = {
    kind: 'seven-code-original-node-extension-host-live',
    time: Date.now(),
    node: process.versions.node,
    pid: process.pid,
    arch: process.arch,
    platform: process.platform,
    nodeForkOk: false,
    copilotNativeAddonLoaded: false
  };
  const file = path.join(os.tmpdir(), 'seven-node-ipc-' + crypto.randomBytes(8).toString('hex') + '.cjs');
  fs.writeFileSync(file,
    'process.send({kind:"seven-code-node-child",pid:process.pid,node:process.versions.node});\n',
    { mode: 0o600 });
  try {
    await new Promise((resolve, reject) => {
      const child = childProcess.fork(file, [], { silent: true, execArgv: [] });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Original Node fork IPC timed out')); }, 12000);
      let done = false;
      const end = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        try { child.disconnect(); } catch {}
        if (error) reject(error); else resolve();
      };
      child.once('message', value =>
        value?.kind === 'seven-code-node-child' && value.node === process.versions.node
          ? end() : end(new Error('Bad Node child IPC response')));
      child.once('error', end);
      child.once('exit', code => end(new Error('Node child exited before IPC: ' + code)));
    });
    proof.nodeForkOk = true;
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
  // Loading the actual COPILOT N-API module is independent of the Node IPC
  // check: an original GNU addon failing on Bionic must stay visibly blocked.
  const addon = path.join(__dirname, '..', 'copilot', 'node_modules',
    '@github', 'copilot', 'sdk', 'prebuilds', 'linux-arm64', 'runtime.node');
  if (fs.existsSync(addon)) {
    try {
      const moduleExports = require(addon);
      proof.copilotNativeAddonLoaded = moduleExports != null;
    } catch {
      proof.copilotNativeAddonLoaded = false;
    }
  }
  // Only the Android runtime can opt into on-device proof. No fake green from
  // Linux CI, mocks, Web-only editor, or an extension running on another host.
  const evidenceDir = process.env.SEVEN_ANDROID_NODE_PROOF_DIR;
  if (evidenceDir && path.isAbsolute(evidenceDir) && proof.nodeForkOk) {
    const resolved = fs.realpathSync(evidenceDir);
    const evidenceFile = path.join(resolved, 'seven-code-node-runtime-proof.json');
    fs.writeFileSync(evidenceFile, JSON.stringify(proof), { mode: 0o600 });
  }
  return proof;
}

/**
 * Manual ONLINE acceptance inside the real Android GNU workspace extension host.
 * No synthetic model output, shared token cache or persistent chat transcripts.
 * The account owner must complete the regular GitHub authentication first.
 */
async function verifyCopilotModelOnAndroid(runtime) {
  if (!runtime?.nodeForkOk || !runtime.copilotNativeAddonLoaded ||
      !process.env.SEVEN_ANDROID_NODE_PROOF_DIR ||
      runtime.arch !== 'arm64' || runtime.platform !== 'linux') {
    await vscode.window.showWarningMessage(
      'Copilot não homologado: primeiro execute o host Node.js GNU ARM64 com IPC e módulo nativo no Android.'
    );
    return false;
  }
  const auth = vscode.authentication;
  if (typeof auth?.getSession !== 'function') {
    await vscode.window.showWarningMessage('O provedor de autenticação GitHub não está disponível.');
    return false;
  }
  let session;
  try {
    session = await auth.getSession('github', ['read:user', 'user:email'], { createIfNone: false });
  } catch {
    await vscode.window.showWarningMessage('Falha ao verificar a sessão GitHub no host Node.js.');
    return false;
  }
  if (!session?.account?.label) {
    await vscode.window.showWarningMessage(
      'Faça login na conta GitHub no Seven Code antes do teste online do Copilot.'
    );
    return false;
  }
  if (typeof vscode.lm?.selectChatModels !== 'function' ||
      typeof vscode.LanguageModelChatMessage?.User !== 'function') {
    await vscode.window.showWarningMessage(
      'Este host não expôs a API de modelos Language Model do Code OSS.'
    );
    return false;
  }
  const cancel = new vscode.CancellationTokenSource();
  const deadline = setTimeout(() => cancel.cancel(), 45000);
  try {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const model = models.find(item => item.vendor === 'copilot');
    if (!model) throw new Error('Nenhum modelo GitHub Copilot disponível');
    const response = await model.sendRequest([
      vscode.LanguageModelChatMessage.User(
        'Teste de conectividade: responda em português com uma frase curta sobre programação.'
      )
    ], {}, cancel.token);
    let answer = '';
    for await (const part of response.text) {
      if (cancel.token.isCancellationRequested) throw new Error('A resposta excedeu o prazo');
      answer += part;
      if (answer.length > 8192) break;
    }
    if (answer.trim().length < 3) throw new Error('Resposta do Copilot vazia');
    await vscode.window.showInformationMessage(
      'Copilot respondeu de verdade no host Node ARM64 (' + model.id + '): ' +
      answer.trim().slice(0, 240)
    );
    return true;
  } catch {
    await vscode.window.showErrorMessage(
      'Host Node iniciado e GitHub conectado, mas o modelo Copilot não retornou resposta real. ' +
      'Verifique licença, rede e logs oficiais do Copilot Chat.'
    );
    return false;
  } finally {
    clearTimeout(deadline);
    cancel.cancel();
    cancel.dispose();
  }
}

async function activate(context) {
  let latest;
  try {
    latest = await verifyNodeHost();
  } catch {
    latest = { kind: 'seven-code-original-node-extension-host-live',
      nodeForkOk: false, copilotNativeAddonLoaded: false };
  }
  context.subscriptions.push(vscode.commands.registerCommand(
    'sevenCode.nodeCopilotLiveAcceptance', () => verifyCopilotModelOnAndroid(latest)
  ));
  context.subscriptions.push(vscode.commands.registerCommand(
    'sevenCode.nodeCopilotAgentAcceptance', async () => {
      // The chat mode and permission decisions are controlled by the actual
      // user. A successful chat model request is a prerequisite, not proof
      // that the multi-step Agent itself works.
      if (!await verifyCopilotModelOnAndroid(latest)) return;
      try {
        await vscode.commands.executeCommand('workbench.action.chat.open');
        await vscode.window.showInformationMessage(
          'Prova do Agent: escolha Agent no Copilot Chat e peça para executar ' +
          '"printf SEVEN_CODE_AGENT_REAL_OK". Autorize a janela nativa Android ' +
          'e confira a saída real. Ainda exige validação manual.'
        );
      } catch {
        await vscode.window.showErrorMessage(
          'O Copilot respondeu, mas o painel Chat original não abriu no host Android.'
        );
      }
    }
  ));
  context.subscriptions.push(vscode.commands.registerCommand(
    'sevenCode.nodeRuntimeSmoke', async () => {
      const message = latest.nodeForkOk
        ? 'Node.js workspace extension host + fork IPC reais: OK. Copilot native addon: ' +
          (latest.copilotNativeAddonLoaded ? 'carregado' : 'NÃO homologado')
        : 'Node.js workspace extension host não passou em fork/IPC; runtime NÃO homologado.';
      await vscode.window.showInformationMessage(message);
    }
  ));
}
function deactivate() {}
module.exports = { activate, deactivate, verifyNodeHost, verifyCopilotModelOnAndroid };
