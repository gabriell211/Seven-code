# Seven Code v0.1.0-alpha.2 — Code OSS Web + Mobile

**Pré-release de testes. Não homologada para produção.**

Esta versão corrige a interpretação equivocada da alpha.1: o APK pequeno contém somente o contêiner Android, não o editor. O editor de verdade será distribuído em **um pacote separado de servidor web Code OSS compilado**, da mesma revisão do APK e do aplicativo iOS.

## Arquivos

- `SevenCode-Server-Web-linux-x64.tar.gz` — servidor web Code OSS original com interface workbench, recursos, extensões web e hosts de extensão Node.js do mesmo commit.
- `SevenCode-v0.1.0-alpha.2-Android-debug.apk` — aplicativo Android de teste para conectar ao servidor via HTTPS; usa terminal PTY nativo local.
- `SevenCode-v0.1.0-alpha.2-iOS-Simulator.zip` — build iOS para simulador, **não IPA para iPhone físico**.
- `SHA256SUMS.txt` — checksums SHA-256 dos artefatos.

O tamanho do APK **não** mede o tamanho do editor: o Code OSS original é servido ao cliente pelo servidor completo. Este repositório reutiliza o servidor upstream do Code OSS, **não distribui o binário VS Code Server proprietário da Microsoft**.

## Terminal e Copilot

As APIs de terminal e Copilot do Code OSS permanecem originais. No Android, `Android (Seven Code)` é um perfil de terminal que redireciona bytes ao PTY do aplicativo. O comando iniciado antes da aprovação do shell nativo fica em fila até que o host envie `ready`, evitando perder a entrada durante o diálogo de permissão.

A suíte de testes simula o caminho Copilot/API terminal original → Pseudoterminal → autorização Android → comando → saída e código de encerramento; **não é uma homologação real de uma conta GitHub Copilot**. O Copilot original ainda depende de um host remoto Node.js compatível, autenticação, assinatura/autorização e E2E em aparelhos reais. Um terminal de workspace remoto executará os comandos no **servidor**, não no celular.

## Uso e segurança

1. Extraia o servidor Linux x64 e verifique os hashes.
2. Consulte `bin/seven-code-server --help` e execute-o com proteção de rede adequada.
3. Configure um endpoint **HTTPS autenticado** em um proxy reverso. Nunca exponha servidor anônimo e não ponha tokens no endereço.
4. Informe a URL no app Android ou iOS.
5. No Android, selecione e aprove explicitamente o perfil de terminal local.

Mais detalhes: [docs/MOBILE.md](https://github.com/gabriell211/Seven-code/blob/main/docs/MOBILE.md).

**Pendências:** testar autenticação e workbench em aparelhos reais; extensão Copilot funcional em conta elegível; terminal e ferramentas do agente com o servidor implantado; iOS nativo em iPhone e versões assinadas.
