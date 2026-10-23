# Seven Code v0.1.0-alpha.1

**Pré-release de engenharia**, não homologada para produção.

## Conteúdo

- Aplicativo **Android de depuração** com host WebView para o **workbench original do Code OSS** servido por URL HTTPS autenticada.
- Extensão interna **Seven Code Mobile Terminal**: perfil de terminal do VS Code usando PTY nativo Android, com autorização do usuário antes de abrir a sessão.
- Aplicativo **iOS compilado somente para simulador**, distribuído como ZIP para teste. Não é um IPA assinado para instalação no iPhone.
- Fonte do Code OSS renomeada Seven Code, configuração de **Open VSX**, e suporte às extensões do workbench em seu host compatível.

## Importante antes de instalar

É indispensável **ter um Seven Code Web Server autenticado, em HTTPS e compatível com esta revisão do repositório**. Não existe servidor público configurado no APK. Sem isso, o aplicativo exibe somente a tela para informar o servidor.

Extensões com entrada \`browser\` podem executar no **web extension host**. Extensões que dependem de \`node\`, executáveis nativos, terminal de ferramentas, depuração e language servers exigem um **host de extensão de workspace remoto**. A presença desses mecanismos no Code OSS não garante compatibilidade de todas as extensões; os testes end-to-end com servidor externo estão pendentes.

### Limitações conhecidas

- Android: não homologado em aparelho físico; o APK é de depuração.
- iOS: ZIP de simulador, **não** instalável em iPhone físico; terminal local via \`ios_system\` ainda não integrado.
- Builds/compiladores e ferramentas npm/cargo/php rodam no workspace remoto, não automaticamente dentro do aplicativo.
- Não há builds desktop assinados ou release estável.
- O trabalho de login, extensão host remoto e uso real do editor depende de configuração do servidor e homologação.

Instalação e arquitetura em [docs/MOBILE.md](https://github.com/gabriell211/Seven-code/blob/main/docs/MOBILE.md).
