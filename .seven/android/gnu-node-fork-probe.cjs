'use strict';

// Real Node child_process.fork IPC acceptance for the isolated GNU ARM64
// runtime. This is not a Copilot subscription, OAuth or Agent acceptance.
const { fork } = require('node:child_process');

if (process.argv[2] === '--seven-child') {
  if (typeof process.send !== 'function') process.exit(64);
  process.send({ kind: 'seven-gnu-fork-ipc', pid: process.pid, arch: process.arch }, error => {
    process.exit(error ? 65 : 0);
  });
} else {
  const child = fork(__filename, ['--seven-child'], {
    silent: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let received = false;
  let finished = false;
  const timeout = setTimeout(() => {
    if (finished) return;
    finished = true;
    child.kill('SIGKILL');
    console.error('SEVEN_GNU_FORK_IPC_TIMEOUT');
    process.exitCode = 66;
  }, 7000);
  child.on('message', message => {
    if (message && message.kind === 'seven-gnu-fork-ipc' &&
        Number.isSafeInteger(message.pid) && message.pid === child.pid &&
        message.arch === process.arch) {
      received = true;
    }
  });
  child.on('error', error => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    console.error('SEVEN_GNU_FORK_IPC_ERROR', error.code || 'spawn');
    process.exitCode = 67;
  });
  child.on('exit', (code, signal) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    if (code === 0 && !signal && received) {
      console.log('SEVEN_GNU_FORK_IPC_OK');
    } else {
      console.error('SEVEN_GNU_FORK_IPC_FAILED', code, signal || 'none');
      process.exitCode = 68;
    }
  });
}
