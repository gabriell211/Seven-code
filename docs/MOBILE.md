# Seven Code Mobile — servidor e editor originais do Code OSS

**Decisão de arquitetura (23/10/2026):** reutilizar o **mesmo stack de servidor e web workbench do Code OSS/VS Code**. Não criar um servidor Seven Code independente, nem substituir APIs de edição, Git, depuração, extensões ou workspace. A personalização mobile é no **terminal**, adaptado ao SO.

## O que permanece original

- `src/vs/workbench` e o web workbench original do Code OSS;
- servidor web e extension host remoto de `src/vs/server`, com os scripts originais `scripts/code-server.sh` / `scripts/code-web.sh`, na mesma revisão do cliente;
- arquivo, abas, busca, language servers, Git, debug, tasks, configurações e APIs do Code OSS;
- a API de extensões do VS Code, incluindo o **web extension host** para extensões `browser` e o **remote Node extension host** para extensões `main` onde suportado;
- galeria Open VSX configurada em `product.json`, sem uso indevido do Microsoft Marketplace proprietário.

Nenhum gateway HTTP/API próprio é necessário para substituir o servidor do editor. **Um servidor Code OSS compatível e autenticado precisa estar disponível**, pois o APK/iOS não empacota e executa o Node extension host dentro do celular.

### Diferença entre Code OSS e o VS Code Server da Microsoft

O objetivo é manter a **mesma implementação upstream de servidor** do Code OSS, compilada e distribuída sob as licenças apropriadas junto com o Seven Code. Isso **não** significa que possamos embutir ou redistribuir o VS Code Server binário oficial da Microsoft: sua licença impõe condições específicas para clientes de terceiros.

Referências oficiais:
- https://code.visualstudio.com/docs/remote/vscode-server
- https://code.visualstudio.com/docs/remote/faq
- https://code.visualstudio.com/api/advanced-topics/extension-host
- https://code.visualstudio.com/api/extension-guides/web-extensions

## Única substituição de funcionalidade: terminal mobile

O painel de terminal e o mecanismo de registro de perfis **permanecem os originais do VS Code**.

**Android:** a extensão interna `extensions/seven-code-mobile-terminal` registra o perfil `Android (Seven Code)`. O perfil usa `vscode.Pseudoterminal`, a ponte `src/vs/workbench/browser/sevenMobileTerminalBridge.ts` e o PTY JNI em `mobile/android/terminal`. O shell local `/system/bin/sh` requer autorização explícita para cada sessão e opera no sandbox do aplicativo. Os terminais remotos padrão do Code OSS continuam disponíveis.

**iPhone/iPad:** o app SwiftUI/WKWebView carrega o mesmo web workbench do servidor original. O adaptador local experimental `ios_system` existe no repositório, mas ainda não está integrado ao aplicativo; até lá, o terminal permanece remoto e o shell iOS local não pode ser declarado operacional. Não afirmar que iOS suporta `fork/exec` tradicional.

**Windows/macOS/Linux:** nenhuma mudança no backend desktop do terminal.

## Extensões sem reimplementar um gerenciador

O próprio Code OSS escolhe o host de execução conforme o manifesto da extensão e a disponibilidade do workspace:
- Extensões `browser` podem executar no Web Worker do cliente.
- Extensões `main` dependem de Node.js num extension host compatível do workspace remoto.
- Extensões nativas, proprietárias ou com APIs restritas podem exigir configurações adicionais ou não serem suportadas.

A extensão que fornece o terminal Android **não** substitui o gerenciador original de extensões e não deve alterar a política de instalação das demais.

## GitHub Copilot — comportamento original

O **GitHub Copilot não será reimplementado nem substituído** por outro provedor. Preservar `extensions/copilot` (`GitHub.copilot-chat`), a API de Chat/Agent, o serviço de extensões e `extensions/github-authentication` do Code OSS.

- **Sugestões, Chat, Inline Chat, Agent Mode e alterações de arquivos:** dependem de instalar/disponibilizar a extensão compatível, autenticar a conta GitHub e ter acesso ao serviço Copilot.
- **Execução do Copilot:** o manifesto atual de `extensions/copilot` possui entrada `main` (Node.js) e não possui `browser`; no web workbench mobile, exige o **remote Node extension host do Code OSS**, na revisão correta. Não prometer que funcionará dentro de uma WebView isolada nem que qualquer instalação do VS Code Server oficial aceitará esta fork.
- **Comandos executados pelo Copilot:** preservar as APIs originais do terminal do VS Code. No Android, o perfil local `Android (Seven Code)` fornece um `Pseudoterminal` nativo quando explicitamente selecionado e aprovado. **A entrada enviada antes da aprovação fica em fila até o Android emitir `ready`, evitando perder comandos do agente.** Para a execução ocorrer no dispositivo, é preciso usar o perfil Android; quando o Copilot utiliza um terminal do workspace remoto, a execução continua no servidor, **não** no Android.
- **No iOS**, ferramentas que executam processos precisam usar o terminal remoto até que uma integração local compatível com iOS seja homologada.
- **Segurança:** não transmitir tokens GitHub/Copilot ao bridge PTY, não executar comandos sem permissão e não simular sucesso sem `exitCode` e saída verificáveis.

O teste `.seven/tests/mobile-workbench.test.mjs` verifica que o manifesto original do Copilot, a autenticação GitHub e o extension host remoto continuam presentes. Também exercita com eventos simulados a sequência de comando do agente, aprovação nativa, transporte ao PTY, saída e código de encerramento. Esse teste roda no CI e deve bloquear a release se falhar. **Isso não é um E2E:** ainda falta validar login OAuth, disponibilidade da extensão no build, sugestões, Chat/Agent, seleção do terminal e execução de ferramentas reais com uma conta autorizada. Não declarar o Copilot operacional no mobile antes dessa homologação.

## Como abrir o editor em Android/iOS

1. Execute o **servidor web original do Code OSS na mesma revisão** do Seven Code, seguindo os scripts/etapas oficiais do repositório. Não publicar o servidor de desenvolvimento diretamente na internet.
2. Proteja o serviço com HTTPS, autenticação e autorização de workspace. Não use credenciais em URLs nem exponha o servidor sem controle de acesso.
3. Informe a URL HTTPS dessa instância no aplicativo Android ou iOS.
4. O aplicativo carrega a interface Code OSS; no Android, selecione o perfil `Android (Seven Code)` no terminal integrado para executar comandos **no celular**. Outros perfis continuam correspondendo ao servidor remoto.
5. Instale extensões compatíveis pelo gerenciador original do Code OSS e pelo Open VSX.

`vscode.dev` ou outro editor hospedado pela Microsoft **não** recebe automaticamente as modificações da fork Seven Code e não fornece, por si só, a extensão de terminal nativo.

## Situação de homologação

- [x] Fonte Code OSS, workbench e backend upstream presentes no repositório
- [x] Android: WebView HTTPS + ponte de terminal + PTY local compilados no CI
- [x] iOS: WKWebView e host de simulador compilados no CI
- [x] Contratos de extensão de terminal testados no CI
- [ ] Testar ponta a ponta uma sessão real do servidor Code OSS, extensões web e remotas
- [ ] Validar terminal Android em aparelho real, retomada, múltiplas sessões, Unicode e sinais
- [ ] Integrar/validar a alternativa de terminal iOS e assinar app para aparelho real
- [ ] Homologar builds, segurança e publicação estável

**Aviso:** builds e testes unitários não comprovam ainda funcionamento de todo o VS Code ou de todas as extensões em Android e iOS.
