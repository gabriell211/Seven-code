# Seven Code Mobile — paridade com o VS Code

**Status em 23/10/2026:** contrato de capacidades e protótipo local do terminal Android desenvolvidos. A importação do Code - OSS, builds oficiais, execução das ferramentas remotas e UI completa ainda exigem validação. Nenhuma função é marcada como operacional sem confirmação do runtime.

## Regra principal

Todas as áreas do VS Code devem existir na experiência Seven Code para Android e iOS. A interface usa o Code - OSS Web Workbench; os executores são:

- **Local UI:** editor, abas, navegação, busca, preferências, temas, diffs e extensões compatíveis com browser.
- **Android native:** armazenamento no sandbox, teclado, PTY/shell Android e adaptadores nativos explicitamente homologados.
- **iOS native:** Files/iCloud e comandos embarcados, sem tentar executar binários Unix arbitrários fora do sandbox.
- **Remote workspace:** ambiente Seven Code Server em Linux/macOS/Windows ou container autorizado para runtimes/compiladores, Git CLI, debugging, testes, language servers, plugins Node.js e tarefas avançadas.
- **Off-line:** o editor e os recursos locais confirmados continuam disponíveis, mas builds remotos, depuração remota e extensões de servidor **não** fingem funcionar sem conexão.

A feature catalog declarativa [feature-catalog.ts](../mobile/capabilities/feature-catalog.ts) enumera requisitos individualmente. [capability-resolver.ts](../mobile/capabilities/capability-resolver.ts) só retorna `available` se um host local integrado ou workspace remoto autenticado anunciar suporte real. [feature-dispatcher.ts](../mobile/capabilities/feature-dispatcher.ts) encaminha operações exclusivamente ao executor correspondente, sem simular resultados.

## Áreas que precisam funcionar

| Área | O que o usuário exige | Motor esperado | Estado atual |
|---|---|---|---|
| Editor | Abas, múltiplos cursores, seleção, mini map, syntax, Emmet, diff, snippets, format | Code - OSS Web Workbench | Pendente integrar |
| Linguagens | IntelliSense, LSP, lint, hover, refactor, navegação por definições | Browser LSP ou servidor | Pendente |
| Arquivos | Explorador, workspace, criar/mover/renomear, upload, salvar, localizar, busca/substituição | Files/Sandbox ou FS remoto | Pendente |
| Terminal | Shell, abas, teclas especiais, copiar/colar, retorno ao app, background | PTY Android, comandos iOS, servidor | Protótipo Android |
| Git | Clone, diff, status, commit, branches, push/pull, conflitos, worktrees | Servidor Git ou provedor local validado | Pendente |
| Depuração | Launch/attach, breakpoints, stack, watch, step, console | Debug adapters em servidor | Pendente |
| Testes | Descobrir, executar, depurar, coverage | Testing API e runtime compatível | Pendente |
| Extensões | Buscar, instalar, remover, atualizar, configurações, ícones, temas, VSIX, LSP | Open VSX + web extension host e remote Node host | Pendente |
| Tasks | task.json, scripts, npm, pnpm, cargo, php, composer, python, rustc | Exec local habilitado ou remoto | Pendente |
| Notebooks | Células, outputs e execução de kernels | Render browser + kernel remoto | Pendente |
| Preview | Markdown, webview, preview de servidor, portas | Workbench, túnel seguro | Pendente |
| Dev Containers | Listar, iniciar, abrir workspace container | Docker/Podman remoto | Pendente |
| IA | Chat, edição, contexto do projeto, ferramentas, comando no terminal e testes | SDK + backend autorizado | Contrato + execução Android isolada; modelo ainda não integrado |
| Settings | Preferências, atalhos, perfis, keymaps, snippets e sync | Store local + serviço próprio | Pendente |
| Colaboração | PRs/issues/revisões e fluxos de equipe | API GitHub/Git compatível | Pendente |
| UX móvel | Touch, teclado, split responsivo, gestos, landscape, retomada, permissões | Android Activity/iOS WKWebView | Pendente |
| Segurança | Origem permitida, autorização, logs, sandbox, sessões, trust, segredos | Host nativo + gateway remoto | Parcial; precisa auditoria |

**Licenças:** VS Code Code - OSS é MIT, mas não se pode copiar arbitrariamente Copilot, Live Share, extensões e Marketplace proprietários. Usar implementações próprias/OSS e Open VSX. Referência: https://code.visualstudio.com/Docs/supporting/FAQ

## Critérios de aceitação por recurso

1. **Disponibilidade verdadeira.** A área não pode exibir sucesso sem executor conectado nem importar host Node.js no browser de forma inválida.
2. **Mesmo projeto.** O usuário pode abrir o projeto no PC, Android ou iOS, respeitando permissões. Em ambiente remoto, a fonte do projeto é a mesma; offline requer sync explícito e resolução de conflitos.
3. **Mesmo esquema de comandos.** Comandos VS Code trabalham com workspaces, URIs, file-system providers, extension APIs e tasks; nem toda operação local tem equivalente no SO.
4. **Executor adequado.** Build de Rust/Laravel/Node/React que não rode legal e tecnicamente no dispositivo passa para workspace remoto autorizado; shell local continua local.
5. **Terminal pela IA.** Toda execução deve solicitar permissão, expor resultado e código de saída; nunca misturar uma sessão de IA com a sessão interativa do usuário.
6. **Extensões sem fraude de compatibilidade.** Web extensions executam no browser; Node extensions somente em host de extensão compatível e autorizado.
7. **Bons estados de erro.** Ausência de permissão, internet, toolchain ou capacidade retorna ação indisponível + causa, não botão mudo.
8. **Testes reproduzíveis.** Testar no host de verdade (Android arm64 e x86_64, iOS simulador e aparelho, Linux/Windows/macOS remotos), junto a testes E2E de cada área e medições de performance.
9. **Publicação legal.** Respeitar licença, notices, política de marketplace e as regras de distribuição Apple/Google.

## Pendências de engenharia em sequência

**Fundação:** importar Code - OSS e rodar Web Workbench no celular; garantir teclado, assets offline, storage e versões da API.

**Comunicação com nativos:** implementar ponte para filesystem Android/iOS, seleção Files/iCloud, PTY, shell local e controle de sessão para retomada.

**Gateway remoto:** cliente WebSocket e testes de handshake em `mobile/remote/` já versionados; ainda é preciso criar Seven Code Server compatível com extensão Node host, terminal, LSP, DAP, Git, testes e APIs de arquivos. Usar TLS e sessão com autenticação + autorização por workspace. Nunca utilizar credenciais persistentes em mensagens WebView.

**Experiência completa:** passar cada feature catalog para estado `available` somente depois de compilar, usar e provar em E2E. Adicionar screenshots e logs nos PRs e GitHub Actions; manter matriz gerada e revisável.

### Por que não prometer 100% local

A própria documentação do VS Code afirma que o browser tem limitações de terminal, debugger e extensões. Um aplicativo iOS ainda é obrigado a respeitar a regra 2.5.2 de código executável. Portanto, **paridade de funcionalidade**, não execução de qualquer binário localmente, é o contrato possível.

Referências:
- https://code.visualstudio.com/docs/remote/vscode-web
- https://code.visualstudio.com/docs/remote/remote-overview
- https://code.visualstudio.com/api/extension-guides/web-extensions
- https://developer.apple.com/app-store/review/guidelines/
- https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code
