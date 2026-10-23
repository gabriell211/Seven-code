import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const path=(name)=>resolve(process.cwd(),name);
const json=(name)=>JSON.parse(readFileSync(path(name),'utf8'));
const save=(name,obj)=>writeFileSync(path(name),JSON.stringify(obj,null,2)+'\n');
if (!existsSync(path('product.json'))) throw new Error('Fonte Code - OSS ausente');

const p=json('product.json');
Object.assign(p,{
  nameShort:'Seven Code',nameLong:'Seven Code',applicationName:'seven-code',
  dataFolderName:'.seven-code',sharedDataFolderName:'.seven-code-shared',
  win32MutexName:'sevencode',win32DirName:'Seven Code',win32NameVersion:'Seven Code',
  win32RegValueName:'SevenCode',win32AppUserModelId:'Seven.Code',
  win32ShellNameShort:'Seven Code',win32TunnelServiceMutex:'sevencode-tunnelservice',
  win32TunnelMutex:'sevencode-tunnel',darwinBundleIdentifier:'dev.seven.code',
  linuxDesktopName:'dev.seven.code',linuxIconName:'seven-code',
  serverApplicationName:'seven-code-server',serverDataFolderName:'.seven-code-server',
  tunnelApplicationName:'seven-code-tunnel',urlProtocol:'seven-code',
  reportIssueUrl:'https://github.com/gabriell211/Seven-code/issues/new'
});
// Microsoft Visual Studio Marketplace is not licensed for Code - OSS forks.
// The vendor-neutral Open VSX registry provides VS Code compatible packages.
p.extensionsGallery = {
  serviceUrl: 'https://open-vsx.org/vscode/gallery',
  itemUrl: 'https://open-vsx.org/vscode/item',
  resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
  extensionUrlTemplate: 'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest'
};
p.linkProtectionTrustedDomains = [
  ...new Set([...(p.linkProtectionTrustedDomains ?? []), 'https://open-vsx.org'])
];
save('product.json',p);
const pkg=json('package.json');pkg.name='seven-code-dev';save('package.json',pkg);
if(existsSync(path('package-lock.json'))){
  const lock=json('package-lock.json');lock.name='seven-code-dev';
  if(lock.packages?.['']) lock.packages[''].name='seven-code-dev';
  save('package-lock.json',lock);
}
const ts='src/vs/workbench/services/themes/common/workbenchThemeService.ts';
if(existsSync(path(ts))){
  const orig=readFileSync(path(ts),'utf8');
  const branded=orig.replace(/(export const COLOR_THEME_DARK\s*=\s*)'[^']+'/,"$1'Seven Code Dark'");
  if(branded===orig&&!orig.includes("COLOR_THEME_DARK = 'Seven Code Dark'")) throw new Error('Padrão do tema alterado no upstream');
  writeFileSync(path(ts),branded);
}
console.log('Seven Code: identidade aplicada e licenças MIT preservadas.');
