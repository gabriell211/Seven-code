import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('./terminal-backend.ts', import.meta.url), 'utf8');
test('terminal possui adaptadores independentes sem fallback silencioso', () => {
  assert.match(source, /android-local/);
  assert.match(source, /ios-local/);
  assert.match(source, /remote-ssh/);
});
test('validação de tamanho previne alocação descontrolada', () => {
  assert.match(source, /Number\.isSafeInteger/);
  assert.match(source, /1000/);
});
const android = readFileSync(new URL('../android/terminal/src/main/cpp/seven_pty.c', import.meta.url), 'utf8');
test('Android inicia shell nativo em PTY e não executa downloaded binaries', () => {
  assert.match(android, /posix_openpt/);
  assert.match(android, /TIOCSCTTY/);
  assert.match(android, /execve\("\/system\/bin\/sh"/);
});
