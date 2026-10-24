import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('mobile/android/app/src/main/java/dev/seven/code/MainActivity.kt', 'utf8');
const runtime = readFileSync('mobile/android/app/src/main/java/dev/seven/code/SevenLocalCodeOssServer.kt', 'utf8');

test('Seven Code Android starts only its embedded Code OSS runtime', () => {
  const startup = main.split('override fun onCreate(savedInstanceState: Bundle?)')[1]
    ?.split('private fun startLocalWorkbench()')[0];
  assert.ok(startup, 'MainActivity.onCreate must exist');
  assert.match(startup, /startLocalWorkbench\(\)/);
  assert.doesNotMatch(startup, /showServerSetup|getPreferences|openWorkbench\(/);
  assert.match(runtime, /check\(hasBundle\(\)\)/);
  assert.match(runtime, /127\.0\.0\.1/);
});

test('incomplete APK does not solicit a remote server or silently substitute one', () => {
  assert.doesNotMatch(main, /showServerSetup|workbenchUrl|Usar um servidor Code OSS externo|Alterar servidor/);
  assert.match(main, /Este aplicativo usa somente o Code OSS incluído no APK/);
  assert.match(main, /Tentar abrir o editor novamente/);
  assert.match(runtime, /Pacote Code OSS não está incluído neste APK/);
});

test('Code OSS workbench preserves the native terminal permissions boundary', () => {
  assert.match(main, /WebViewCompat\.addWebMessageListener/);
  assert.match(main, /sourceOrigin\.toString\(\) != trustedOrigin/);
  assert.match(main, /SevenTerminalNative/);
  assert.match(main, /localhost|127\.0\.0\.1/);
});
