/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getBuiltInCopilotSdkFiles } from '../copilotExtensionPackage.ts';

const runtimeIgnore = fs.readFileSync(new URL('../../../extensions/copilot/.vscodeignore', import.meta.url), 'utf8');

function fixture() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seven-copilot-package-'));
	fs.writeFileSync(path.join(directory, '.vscodeignore'), runtimeIgnore);
	const write = (relative: string, contents: string) => {
		const target = path.join(directory, 'node_modules', '@github', 'copilot', relative);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, contents);
		return target;
	};
	return { directory, write, dispose: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('preserves the installed extension SDK runtime and metadata while excluding standalone CLI files', () => {
	const f = fixture();
	try {
		const expected = new Map([
			[f.write('package.json', '{"version":"1.0.73","exports":{"./sdk":"./sdk/index.js"}}'), '{"version":"1.0.73","exports":{"./sdk":"./sdk/index.js"}}'],
			[f.write('sdk/index.js', 'export const version = "1.0.73";'), 'export const version = "1.0.73";'],
			[f.write('sdk/worker/worker.js', 'worker-runtime'), 'worker-runtime'],
			[f.write('sdk/definitions/task.agent.yaml', 'name: task'), 'name: task'],
			[f.write('sdk/builtin-skills/example/SKILL.yaml', 'name: skill'), 'name: skill'],
			[f.write('sdk/prebuilds/linux-x64/runtime.node', 'VERSION-MATCHED-NATIVE'), 'VERSION-MATCHED-NATIVE'],
			[f.write('sdk/tgrep/bin/linux-x64/tgrep', 'TGREP'), 'TGREP'],
		]);
		f.write('index.js', 'STANDALONE CLI');
		f.write('prebuilds/linux-x64/copilot', 'STANDALONE EXECUTABLE');
		f.write('sdk/index.d.ts', 'BUILD-TIME TYPES');
		f.write('sdk/tests/test.js', 'TEST CODE');
		f.write('sdk/unlisted-runtime.bin', 'NOT IN VSIX ALLOWLIST');
		const platformPackage = path.join(f.directory, 'node_modules', '@github', 'copilot-linux-x64');
		fs.mkdirSync(platformPackage, { recursive: true });
		fs.writeFileSync(path.join(platformPackage, 'package.json'), '{"version":"wrong-version"}');

		const selected = getBuiltInCopilotSdkFiles(f.directory);
		assert.deepEqual(new Set(selected), new Set(expected.keys()));
		for (const file of selected) {
			assert.equal(fs.readFileSync(file, 'utf8'), expected.get(file));
		}
	} finally {
		f.dispose();
	}
});

test('fails when postinstall has not materialized the actual SDK entry point', () => {
	const f = fixture();
	try {
		f.write('package.json', '{"version":"1.0.73"}');
		assert.throws(() => getBuiltInCopilotSdkFiles(f.directory), /SDK not materialized/);
	} finally {
		f.dispose();
	}
});

test('honors later SDK exclusions in the extension runtime allowlist', () => {
	const f = fixture();
	try {
		const metadata = f.write('package.json', '{"version":"1.0.73"}');
		const entry = f.write('sdk/index.js', 'SDK');
		f.write('sdk/worker/worker.js', 'NO LONGER SHIPPED');
		fs.appendFileSync(path.join(f.directory, '.vscodeignore'), '\nnode_modules/@github/copilot/sdk/worker/**\n');
		assert.deepEqual(new Set(getBuiltInCopilotSdkFiles(f.directory)), new Set([metadata, entry]));
	} finally {
		f.dispose();
	}
});
