import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReleaseChecks, REQUIRED_E2E_CHECKS, ANDROID_RELEASE_E2E_CHECKS, IOS_RELEASE_E2E_CHECKS } from '../require-release-checks.mjs';

const sha = 'a'.repeat(40);
const evidence = name => ({
  name, head_sha: sha, status: 'completed', conclusion: 'success',
  app: { slug: 'github-actions' }
});

test('rejects an entirely untested APK, even when compilation is green', () => {
  const result = evaluateReleaseChecks([evidence('android'), evidence('server')], sha);
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, REQUIRED_E2E_CHECKS.length);
});
test('rejects mocks, failures, stale commits and non-Actions statuses', () => {
  for (const index of REQUIRED_E2E_CHECKS.keys()) {
    const checks = REQUIRED_E2E_CHECKS.map(evidence);
    checks[index] = { ...checks[index], head_sha: 'b'.repeat(40) };
    assert.equal(evaluateReleaseChecks(checks, sha).ready, false);
    checks[index] = { ...evidence(REQUIRED_E2E_CHECKS[index]), conclusion: 'failure' };
    assert.equal(evaluateReleaseChecks(checks, sha).ready, false);
    checks[index] = { ...evidence(REQUIRED_E2E_CHECKS[index]), app: { slug: 'external' } };
    assert.equal(evaluateReleaseChecks(checks, sha).ready, false);
  }
});
test('accepts only all four real E2E check records on the exact SHA', () => {
  assert.equal(evaluateReleaseChecks(REQUIRED_E2E_CHECKS.map(evidence), sha).ready, true);
});

test('Android-only release cannot be blocked by unrelated iOS hardware validation', () => {
  const android = ANDROID_RELEASE_E2E_CHECKS.map(evidence);
  assert.equal(evaluateReleaseChecks(android, sha, 'android').ready, true);
  assert.equal(evaluateReleaseChecks(android, sha, 'all').ready, false);
  assert.equal(evaluateReleaseChecks(android, sha, 'ios').ready, false);
});
test('Android cannot bypass Copilot OAuth, native PTY or server extension-host checks', () => {
  for (const expected of ANDROID_RELEASE_E2E_CHECKS) {
    const checks = ANDROID_RELEASE_E2E_CHECKS.filter(x => x !== expected).map(evidence);
    const result = evaluateReleaseChecks(checks, sha, 'android');
    assert.equal(result.ready, false);
    assert.deepEqual(result.missing, [expected]);
  }
});
test('iOS-only release still requires its own real device and Copilot checks', () => {
  const ios = IOS_RELEASE_E2E_CHECKS.map(evidence);
  assert.equal(evaluateReleaseChecks(ios, sha, 'ios').ready, true);
  assert.equal(evaluateReleaseChecks(ios, sha, 'android').ready, false);
  assert.throws(() => evaluateReleaseChecks(ios, sha, 'linux'), /Unknown release platform/);
});
