/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '../vscode-reh-web-linux-x64');
const product = JSON.parse(await readFile(join(root, 'product.json'), 'utf8'));
const resources = [
	'out/vs/code/browser/workbench/workbench.js',
	'out/vs/workbench/api/node/extensionHostProcess.js',
	'out/vs/workbench/api/worker/extensionHostWorkerMain.js',
	'extensions/seven-code-mobile-terminal/dist/browser/extension.js',
	'extensions/github-authentication/package.json',
	'extensions/github-authentication/dist/extension.js',
	'extensions/github-authentication/dist/browser/extension.js',
	'extensions/copilot/package.json',
	'extensions/copilot/dist/extension.js',
];
for (const resource of resources) {
	assert.ok((await stat(join(root, resource))).size > 0, `Missing packaged resource: ${resource}`);
}
assert.equal(product.nameShort, 'Seven Code');
assert.match(product.commit, /^[a-f0-9]{40}$/);

const dataDir = await mkdtemp(join(tmpdir(), 'seven-code-server-smoke-'));
const token = randomBytes(32).toString('hex');
const tokenFile = join(dataDir, 'token');
await writeFile(tokenFile, token, { mode: 0o600 });
const server = spawn(join(root, 'node'), [
	join(root, 'out/server-main.js'), '--host', '127.0.0.1', '--port', '0',
	'--connection-token-file', tokenFile, '--server-data-dir', dataDir,
	'--accept-server-license-terms', '--telemetry-level', 'off', '--disable-experiments',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const capture = chunk => { output = (output + chunk.toString()).slice(-32_768); };
server.stdout.on('data', capture);
server.stderr.on('data', capture);

try {
	const port = await new Promise((resolvePort, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			server.stdout.off('data', checkReady);
			server.off('error', fail);
			server.off('exit', failExit);
		};
		const fail = error => { cleanup(); reject(error); };
		const failExit = code => fail(new Error(`Server exited before readiness (${code})`));
		const checkReady = () => {
			const match = /Web UI available at http:\/\/localhost:(\d+)/.exec(output);
			if (match) { cleanup(); resolvePort(match[1]); }
		};
		const timeout = setTimeout(() => fail(new Error('Server startup timed out')), 60_000);
		server.stdout.on('data', checkReady);
		server.once('error', fail);
		server.once('exit', failExit);
		checkReady();
	});
	const base = `http://127.0.0.1:${port}`;
	const request = (path, authenticated = true) => fetch(base + path, {
		headers: authenticated ? { Cookie: `vscode-tkn=${token}` } : {},
		redirect: 'manual', signal: AbortSignal.timeout(15_000),
	});
	const version = await request('/version', false);
	assert.equal(await version.text(), product.commit);
	const denied = await request('/', false);
	assert.equal(denied.status, 403, 'Workbench must reject unauthenticated access');
	const page = await request('/');
	assert.equal(page.status, 200, 'Authenticated workbench must load');
	const html = await page.text();
	assert.match(html, /vscode-workbench-web-configuration/);
	assert.ok(!html.includes('{{WORKBENCH_'), 'Workbench template must be rendered');
	for (const resource of resources) {
		const response = await request(`/static/${resource}`);
		assert.equal(response.status, 200, `Packaged resource must be served: ${resource}`);
		assert.ok((await response.arrayBuffer()).byteLength > 0);
	}

	// Browser-level smoke test executes the compiled workbench JavaScript and
	// connects through the authenticated Code OSS server. HTTP 200 alone is
	// insufficient to prove that a real editor can render.
	if (process.env.SEVEN_CODE_BROWSER_E2E === '1') {
		const { chromium } = await import('playwright-core');
		const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
		try {
			const context = await browser.newContext();
			await context.addCookies([{ name: 'vscode-tkn', value: token, url: base + '/' }]);
			const page = await context.newPage();
			const errors = [];
			page.on('pageerror', error => errors.push(error.message));
			const response = await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
			assert.equal(response?.status(), 200, 'Authenticated real browser must load Code OSS page');
			await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 90_000 });
			await page.locator('.monaco-workbench .part.editor').waitFor({ state: 'attached', timeout: 60_000 });
			assert.equal(await page.locator('.monaco-workbench').count(), 1,
				'Original Code OSS workbench must initialize once');
			assert.equal(errors.length, 0,
				'Runtime errors in compiled editor: ' + errors.slice(0, 5).join(' | '));
			console.log('Authenticated Chromium loaded the compiled Code OSS workbench and editor part.');
			await context.close();
		} finally {
			await browser.close();
		}
	}

	console.log('Verified server startup, commit, authentication, workbench and packaged extension hosts.');
} catch (error) {
	console.error(output.replaceAll(token, '<redacted>'));
	throw error;
} finally {
	if (server.pid !== undefined && server.exitCode === null && server.signalCode === null) {
		const exited = once(server, 'exit');
		server.kill('SIGTERM');
		const forceKill = setTimeout(() => server.kill('SIGKILL'), 5_000);
		await exited;
		clearTimeout(forceKill);
	}
	await rm(dataDir, { recursive: true, force: true });
}
