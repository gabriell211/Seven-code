import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = readFileSync('mobile/android/app/src/main/AndroidManifest.xml', 'utf8');
const activity = readFileSync('mobile/android/app/src/main/java/dev/seven/code/MainActivity.kt', 'utf8');
const androidE2e = readFileSync(
  'mobile/android/app/src/androidTest/java/dev/seven/code/SevenOfflineWebWorkbenchDeviceTest.kt', 'utf8'
);
const flows = readFileSync('extensions/github-authentication/src/flows.ts', 'utf8');
const dashboard = readFileSync('src/vs/workbench/contrib/chat/browser/chatStatus/chatStatusDashboard.ts', 'utf8');

test('Android rotation and multiwindow resize preserve the running editor/WebView', () => {
  const changes = manifest.match(/android:configChanges="([^"]+)"/)?.[1]?.split('|') || [];
  for (const change of ['orientation', 'screenSize', 'screenLayout', 'smallestScreenSize', 'keyboardHidden', 'density']) {
    assert.ok(changes.includes(change), change + ' must not recreate Chromium');
  }
  assert.match(activity, /override fun onConfigurationChanged\(newConfig: Configuration\)/);
  const handler = activity.split('override fun onConfigurationChanged(newConfig: Configuration)')[1]?.split('override fun onCreate')[0] || '';
  assert.match(handler, /super\.onConfigurationChanged\(newConfig\)/);
  assert.match(handler, /webView\.requestLayout\(\)/);
  assert.doesNotMatch(handler, /openWorkbench|loadUrl|reload\(/);
  assert.match(androidE2e, /rotatingAndroidDoesNotRestartCodeOssOrDestroyUnsavedEditorState/);
  assert.match(androidE2e, /SCREEN_ORIENTATION_LANDSCAPE/);
  assert.match(androidE2e, /SCREEN_ORIENTATION_PORTRAIT/);
  assert.match(androidE2e, /sevenRotationProof/);
  assert.match(androidE2e, /beforeWebView\.get\(\)/);
});

test('GitHub device grant remains pending long enough for real browser approval', () => {
  assert.match(flows, /expires_in\?: number/);
  assert.match(flows, /Math\.min\(900, Math\.floor\(expiresIn\)\)/);
  assert.match(flows, /token\.isCancellationRequested/);
  assert.match(flows, /accessTokenJson\.error === 'authorization_pending'/);
  assert.match(flows, /accessTokenJson\.error === 'slow_down'/);
  assert.doesNotMatch(flows, /Date\.now\(\) \+ 120_000/);
});

test('Use AI Features is actionable on native Android, unchanged in desktop and normal browser', () => {
  assert.match(dashboard, /const androidAction = typeof window !== 'undefined' && 'SevenTerminalNative' in window/);
  assert.match(dashboard, /'sevenCode\.configureAndroidAiFeatures' : commandId/);
  assert.match(dashboard, /runCommandAndClose\(androidAction\)/);
});
