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

async function activate(context) {
  let latest;
  try {
    latest = await verifyNodeHost();
  } catch {
    latest = { kind: 'seven-code-original-node-extension-host-live',
      nodeForkOk: false, copilotNativeAddonLoaded: false };
  }
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
module.exports = { activate, deactivate, verifyNodeHost };
