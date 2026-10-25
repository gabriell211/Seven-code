import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetching } from '../../extensions/github-authentication/src/browser/fetch.ts';

const native = readFileSync('mobile/android/app/src/main/java/dev/seven/code/SevenGitHubDeviceFlow.kt', 'utf8');
const activity = readFileSync('mobile/android/app/src/main/java/dev/seven/code/MainActivity.kt', 'utf8');
const bridge = readFileSync('src/vs/workbench/browser/sevenMobileTerminalBridge.ts', 'utf8');
const flows = readFileSync('extensions/github-authentication/src/flows.ts', 'utf8');

test('GitHub mobile device authentication is native only, non-generic, and separate from fake Copilot acceptance', () => {
  assert.match(native, /https:\/\/github\.com/);
  assert.match(native, /path == "\/login\/device\/code"/);
  assert.match(native, /path == "\/login\/oauth\/access_token"/);
  assert.match(native, /instanceFollowRedirects = false/);
  assert.match(native, /require\(form\.length <= 1024\)/);
  assert.match(activity, /handleGitHubDeviceRequest\(data\)/);
  assert.match(bridge, /seven-code-mobile-github-device-v1/);
  assert.match(flows, /globalThis\.location\.origin === 'https:\/\/appassets\.androidplatform\.net'/);
  assert.match(flows, /accessTokenJson\.error === 'slow_down'/);
});

test('real browser-auth transport forwards ONLY two trusted GitHub POST paths and rejects malicious URLs', async () => {
  const previous = { location: globalThis.location, BroadcastChannel: globalThis.BroadcastChannel, fetch: globalThis.fetch };
  class Channel {
    static all = new Set();
    constructor(name) { this.name = name; this.onmessage = null; Channel.all.add(this); }
    postMessage(data) {
      for (const x of Channel.all) if (x !== this && x.name === this.name)
        queueMicrotask(() => x.onmessage?.({ data }));
    }
    close() { Channel.all.delete(this); }
  }
  const host = new Channel('seven-code-mobile-github-device-v1');
  const seen = [];
  host.onmessage = event => {
    seen.push(event.data);
    host.postMessage({ type: 'github-device-result', requestId: event.data.requestId,
      status: 200, body: { user_code: 'ABCD-EFGH', device_code: 'FAKE', verification_uri: 'https://github.com/login/device', interval: 5 } });
  };
  const webCalls = [];
  try {
    globalThis.location = { origin: 'https://appassets.androidplatform.net' };
    globalThis.BroadcastChannel = Channel;
    globalThis.fetch = async (...args) => { webCalls.push(args); return new Response('{}', {status:200}); };
    const body = await fetching('https://github.com/login/device/code?client_id=01ab8ac9400c4e429b23&scope=read%3Auser',
      {method: 'POST'});
    assert.equal((await body.json()).user_code, 'ABCD-EFGH');
    assert.equal(seen[0].op, 'begin');
    assert.equal(seen[0].clientId, '01ab8ac9400c4e429b23');
    assert.equal(webCalls.length, 0);
    await fetching('https://api.github.com/user', {method: 'GET'});
    await fetching('https://example.invalid/login/device/code?client_id=01ab8ac9400c4e429b23', {method:'POST'});
    assert.equal(webCalls.length, 2, 'never proxy arbitrary requests');
    await assert.rejects(fetching('https://github.com/login/device/code?client_id=01ab8ac9400c4e429b23&extra=evil', {method:'POST'}), /rejected/);
    assert.equal(seen.length, 1);
    globalThis.location = { origin: 'https://vscode.dev' };
    await fetching('https://github.com/login/device/code?client_id=01ab8ac9400c4e429b23', {method:'POST'});
    assert.equal(webCalls.length, 3, 'ordinary Code OSS browser must use upstream fetch');
  } finally {
    host.close();
    globalThis.location = previous.location;
    globalThis.BroadcastChannel = previous.BroadcastChannel;
    globalThis.fetch = previous.fetch;
  }
});
