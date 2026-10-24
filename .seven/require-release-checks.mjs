import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * These checks must be produced by actual GitHub Actions E2E workflows on
 * exactly the release commit, never by compilation-only or mocked tests.
 * Release stays BLOCKED until those jobs exist and pass. Do not rename
 * build/simulator/unit jobs to match this list without implementing E2E.
 */
export const ANDROID_RELEASE_E2E_CHECKS = Object.freeze([
  'Seven Code Android workbench and native PTY E2E',
  'Seven Code Copilot real OAuth and terminal Agent E2E',
  'Seven Code server auth, web extensions and remote extension host E2E',
]);

export const IOS_RELEASE_E2E_CHECKS = Object.freeze([
  'Seven Code iOS real-device workbench E2E',
  'Seven Code Copilot real OAuth and terminal Agent E2E',
  'Seven Code server auth, web extensions and remote extension host E2E',
]);

export const REQUIRED_E2E_CHECKS = Object.freeze([
  ...new Set([...ANDROID_RELEASE_E2E_CHECKS, ...IOS_RELEASE_E2E_CHECKS]),
]);

export function evaluateReleaseChecks(checks, sha, platform = 'all') {
  assert.match(sha, /^[a-f0-9]{40}$/, 'Invalid release commit');
  assert.ok(Array.isArray(checks), 'Checks must be an array');
  assert.ok(['android', 'ios', 'all'].includes(platform), 'Unknown release platform');
  const expected = platform === 'android' ? ANDROID_RELEASE_E2E_CHECKS :
    platform === 'ios' ? IOS_RELEASE_E2E_CHECKS : REQUIRED_E2E_CHECKS;
  const missing = expected.filter(name => !checks.some(check =>
    check?.name === name &&
    check?.head_sha === sha &&
    check?.status === 'completed' &&
    check?.conclusion === 'success' &&
    check?.app?.slug === 'github-actions'
  ));
  return { ready: missing.length === 0, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_SHA: sha, GITHUB_REPOSITORY: repo, GH_TOKEN: token } = process.env;
  assert.ok(token && repo && /^[\w.-]+\/[\w.-]+$/.test(repo), 'Missing GitHub Actions authentication context');
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Missing release SHA');
  const output = execFileSync('gh', [
    'api', '--paginate', 'repos/' + repo + '/commits/' + sha + '/check-runs?per_page=100',
    '--jq', '.check_runs[] | {name,head_sha,status,conclusion,app: {slug: .app.slug}}'
  ], { encoding: 'utf8', maxBuffer: 12_000_000 });
  const checks = output.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const platform = process.env.SEVEN_RELEASE_PLATFORM ?? 'all';
  const result = evaluateReleaseChecks(checks, sha, platform);
  if (!result.ready) {
    console.error('RELEASE BLOCKED: missing real end-to-end evidence on this exact commit:');
    for (const name of result.missing) console.error(' - ' + name);
    console.error('Compilation, mocks and an APK file are not release qualification.');
    process.exitCode = 1;
  } else {
    console.log('All required non-mocked release acceptance checks passed for ' + sha);
  }
}
