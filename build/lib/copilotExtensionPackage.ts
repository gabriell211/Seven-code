/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import path from 'node:path';

/** Select the extension's installed SDK using its VSIX runtime allowlist. */
export function getBuiltInCopilotSdkFiles(extensionPath: string): string[] {
	const packagePath = path.join(extensionPath, 'node_modules', '@github', 'copilot');
	const sdkPath = path.join(packagePath, 'sdk');
	const sdkEntryPoint = path.join(sdkPath, 'index.js');
	if (!fs.existsSync(sdkEntryPoint)) {
		throw new Error(`Built-in Copilot SDK not materialized at ${sdkEntryPoint}. Run the extension's postinstall before packaging.`);
	}
	const rules = fs.readFileSync(path.join(extensionPath, '.vscodeignore'), 'utf8')
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line && !line.startsWith('#'));
	const isIncluded = (file: string) => {
		const relativePath = path.relative(extensionPath, file).split(path.sep).join('/');
		let included = false;
		for (const rule of rules) {
			const include = rule.startsWith('!');
			if (path.posix.matchesGlob(relativePath, include ? rule.slice(1) : rule)) {
				included = include;
			}
		}
		return included;
	};
	const files = [path.join(packagePath, 'package.json')];
	const visit = (directory: string) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(entryPath);
			} else if (entry.isFile()) {
				files.push(entryPath);
			}
		}
	};
	visit(sdkPath);
	const selected = files.filter(isIncluded);
	if (!selected.includes(sdkEntryPoint) || !selected.includes(path.join(packagePath, 'package.json'))) {
		throw new Error('The built-in Copilot runtime allowlist must include its package metadata and SDK entry point.');
	}
	return selected;
}
