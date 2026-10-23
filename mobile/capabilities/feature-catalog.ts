/**
 * Seven Code mobile compatibility contract.
 *
 * Catalog entries are a REQUIREMENTS CHECKLIST, not claims that the feature works.
 * "available" is awarded only if a trusted native workbench or an authenticated
 * remote workspace actually advertises the feature at runtime.
 */
export type MobilePlatform = 'android' | 'ios';
export type FeatureArea =
  | 'editor' | 'files' | 'terminal' | 'git' | 'debug' | 'testing'
  | 'extensions' | 'notebooks' | 'preview' | 'ai' | 'settings' | 'dev' | 'collaboration';

export interface FeatureDefinition {
  readonly id: string;
  readonly area: FeatureArea;
  readonly label: string;
  readonly localPlatforms: readonly MobilePlatform[];
  readonly remoteSupported: boolean;
  readonly requiresTrustedWorkspace: boolean;
}

type FeatureTuple = readonly [id: string, label: string];
const both = ['android', 'ios'] as const;
const androidOnly = ['android'] as const;
const noLocal: readonly MobilePlatform[] = [];

/** UI and browser-compatible functionality: the host still has to implement it. */
const browserFeatures: Readonly<Record<FeatureArea, readonly FeatureTuple[]>> = {
  editor: [
    ['editor.text', 'Editor de texto'], ['editor.tabs', 'Abas e grupos'],
    ['editor.split', 'Editor dividido'], ['editor.multicursor', 'Múltiplos cursores'],
    ['editor.folding', 'Dobrar blocos'], ['editor.minimap', 'Minimapa'],
    ['editor.breadcrumbs', 'Breadcrumbs'], ['editor.syntax', 'Syntax highlighting'],
    ['editor.snippets', 'Snippets'], ['editor.diff', 'Comparador de arquivos'],
    ['editor.commandPalette', 'Paleta de comandos'], ['editor.format', 'Formatação'],
  ],
  files: [
    ['files.explorer', 'Explorador de arquivos'], ['files.workspace', 'Pastas e workspaces'],
    ['files.openSave', 'Abrir e salvar'], ['files.search', 'Busca em arquivos'],
    ['files.replace', 'Substituição em arquivos'], ['files.uploadDownload', 'Upload e download'],
  ],
  terminal: [],
  git: [['git.diff', 'Visualização de diff']],
  debug: [['debug.views', 'Painéis de depuração']],
  testing: [['testing.views', 'Painel de testes']],
  extensions: [['extensions.webHost', 'Extensões web'], ['extensions.themes', 'Temas e ícones']],
  notebooks: [['notebooks.view', 'Visualização de notebooks']],
  preview: [['preview.markdown', 'Pré-visualização Markdown'], ['preview.html', 'Pré-visualização HTML']],
  ai: [['ai.chat', 'Chat com IA'], ['ai.inline', 'Edição inline com IA']],
  settings: [
    ['settings.preferences', 'Configurações'], ['settings.keybindings', 'Atalhos de teclado'],
    ['settings.profiles', 'Perfis'], ['settings.theme', 'Personalização visual'],
  ],
  dev: [['dev.problems', 'Problemas e diagnósticos'], ['dev.output', 'Painel de saída']],
  collaboration: [['collaboration.review', 'Revisão de código']],
};

/** Local native or web-host bridges are required; implementations MUST advertise them. */
const nativeFeatures: Readonly<Record<FeatureArea, readonly FeatureTuple[]>> = {
  editor: [['editor.intellisense', 'IntelliSense / LSP'], ['editor.refactor', 'Refatoração']],
  files: [['files.watch', 'Observação de arquivos'], ['files.localProviders', 'Document providers locais']],
  terminal: [['terminal.shell', 'Shell local'], ['terminal.keyboard', 'Terminal e teclas especiais']],
  git: [['git.status', 'Git status'], ['git.commit', 'Commit'], ['git.stage', 'Stage/unstage']],
  debug: [],
  testing: [],
  extensions: [['extensions.installVsix', 'Instalação autorizada de VSIX']],
  notebooks: [],
  preview: [],
  ai: [['ai.terminalTool', 'IA executa comandos com autorização']],
  settings: [],
  dev: [],
  collaboration: [],
};

/** Require a full execution runtime (usually a remote authenticated workspace). */
const remoteFeatures: Readonly<Record<FeatureArea, readonly FeatureTuple[]>> = {
  editor: [['editor.index', 'Indexação de projeto completo']],
  files: [['files.remote', 'Sistema de arquivos remoto']],
  terminal: [['terminal.tasks', 'Tasks'], ['terminal.multipleShells', 'Shells de toolchains'],
    ['terminal.ssh', 'Conexões SSH'], ['terminal.environment', 'Ambientes e variáveis']],
  git: [
    ['git.clone', 'Clonar repositório'], ['git.branch', 'Branches'],
    ['git.pullPush', 'Pull, push e fetch'], ['git.merge', 'Merge'],
    ['git.rebase', 'Rebase'], ['git.conflicts', 'Resolução de conflitos'],
    ['git.history', 'Histórico de commits'], ['git.worktrees', 'Git worktrees'],
  ],
  debug: [
    ['debug.launch', 'Iniciar depuração'], ['debug.attach', 'Anexar a processo'],
    ['debug.breakpoints', 'Breakpoints'], ['debug.step', 'Step in/out/over'],
    ['debug.watch', 'Watch e variáveis'], ['debug.console', 'Console de debug'],
  ],
  testing: [
    ['testing.discover', 'Descoberta de testes'], ['testing.run', 'Executar testes'],
    ['testing.coverage', 'Cobertura de testes'], ['testing.debug', 'Depurar testes'],
  ],
  extensions: [
    ['extensions.nodeHost', 'Extensões Node.js'], ['extensions.languageServer', 'Language servers externos'],
    ['extensions.registry', 'Catálogo Open VSX'],
  ],
  notebooks: [['notebooks.kernel', 'Kernel de notebooks'], ['notebooks.execute', 'Executar células']],
  preview: [['preview.portForward', 'Encaminhamento de portas'], ['preview.localServer', 'Preview de servidor']],
  ai: [
    ['ai.editFiles', 'IA edita arquivos'], ['ai.runTests', 'IA executa testes'],
    ['ai.toolCalling', 'IA chama ferramentas'], ['ai.workspaceContext', 'Contexto do workspace'],
  ],
  settings: [['settings.sync', 'Sincronização própria do Seven Code']],
  dev: [
    ['dev.build', 'Compilação de projetos'], ['dev.run', 'Execução de projetos'],
    ['dev.tasks', 'Automação de tarefas'], ['dev.containers', 'Dev Containers'],
    ['dev.deploy', 'Deploy'], ['dev.packageManager', 'npm/pnpm/cargo/pip/composer'],
  ],
  collaboration: [['collaboration.pullRequests', 'Pull requests'], ['collaboration.issues', 'Issues']],
};

function add(
  source: Readonly<Record<FeatureArea, readonly FeatureTuple[]>>,
  platforms: readonly MobilePlatform[],
  trusted: boolean
): FeatureDefinition[] {
  return (Object.entries(source) as [FeatureArea, readonly FeatureTuple[]][])
    .flatMap(([area, pairs]) => pairs.map(([id, label]) => ({
      id, label, area, localPlatforms: platforms,
      remoteSupported: true, requiresTrustedWorkspace: trusted
    })));
}

export const FEATURE_CATALOG: readonly FeatureDefinition[] = Object.freeze([
  ...add(browserFeatures, both, false),
  ...add(nativeFeatures, androidOnly, true),
  ...add(remoteFeatures, noLocal, true),
]);

/**
 * Explicit exception: iOS can provide a local COMMAND LIBRARY through ios_system,
 * not a general-purpose PTY. This is a different capability from terminal.shell.
 */
export const IOS_EMBEDDED_COMMAND_FEATURE: FeatureDefinition = Object.freeze({
  id: 'terminal.iosEmbeddedCommands',
  area: 'terminal',
  label: 'Comandos embarcados no iOS',
  localPlatforms: ['ios'],
  remoteSupported: false,
  requiresTrustedWorkspace: true,
});

export const ALL_FEATURES: readonly FeatureDefinition[] = Object.freeze([
  ...FEATURE_CATALOG, IOS_EMBEDDED_COMMAND_FEATURE
]);
