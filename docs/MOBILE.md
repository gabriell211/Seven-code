# Seven Code Mobile — workbench Code OSS original

**Estado em 23/10/2026:** o repositório contém o workbench Code OSS original. O host Android compila em GitHub Actions, e o host iOS compila para simulador. A homologação da sessão real, do login e das extensões ainda depende de testes com um Seven Code Web Server implantado.

## Objetivo e arquitetura

O Seven Code **não recria a interface do VS Code**: Android e iOS apresentam o *web workbench do mesmo Code OSS* da versão desktop. O app nativo hospeda o workbench servido por um endpoint HTTPS autenticado e administra integrações específicas da plataforma.

- O **servidor** executa o Code OSS web e disponibiliza workspaces, filesystem, language servers, Git e extensão host Node.js onde suportado.
- O **web extension host** do Code OSS executa extensões com entrada \`browser\` compatíveis com Web Worker.
- As extensões são descobertas no catálogo **Open VSX**, configurado em \`product.json\`; a API de extensões e o gerenciador originais continuam no workbench.
- As extensões com entrada somente \`main\`/Node.js necessitam de extensão host de workspace remoto; não podem executar Node livremente dentro de WebView/WKWebView.
- O **terminal integrado** mantém a interface, abas e comandos originais do VS Code. No Android, a extensão interna \`seven-code-mobile-terminal\` oferece o perfil \`Android (Seven Code)\`, usando \`Pseudoterminal\` + BroadcastChannel + ponte de mensagens para o PTY JNI Android. Nenhum painel xterm alternativo precisa abrir.
- No **iOS**, o editor usa o mesmo workbench remoto. O adaptador opcional \`ios_system\` em \`SevenLocalTerminal.swift\` ainda não está ligado ao app Xcode; um shell local interativo de uso geral **não** está disponível. O terminal remoto é a rota funcional esperada no iPhone.

## Iniciar o servidor Code OSS

Na máquina Linux/macOS/Windows compatível que executará os workspaces, prepare dependências e compile o **servidor e workbench web da mesma revisão do Seven Code** conforme os scripts oficiais em \`scripts/code-server.sh\` e \`scripts/code-web.sh\`. O servidor Code OSS deve ser inicializado em modo \`--serve-web\` com a hospedagem de extensões remotas ativa.

**Segurança obrigatória:** coloque-o atrás de HTTPS com autenticação, controle de acesso por workspace e proxy reverso. Não publique o serviço de desenvolvimento diretamente na internet e não utilize \`--without-connection-token\` num endpoint público. Não adicione chaves de API, login ou token à URL do aplicativo. O host Android aceita exclusivamente HTTPS; redirecionamentos de página principal para outras origens são bloqueados.

O host mobile não inclui servidor Node.js, compiladores ou containers dentro do APK/IPA.

## Android

1. Entre no workflow \`Seven Code Android terminal build\` e baixe o artefato APK de teste compilado.
2. Instale o APK de depuração.
3. Informe **o endereço HTTPS do seu servidor Seven Code Web**, usando a mesma revisão do editor e da extensão embutida. Confirme a confiança no servidor.
4. O aplicativo carrega o web workbench original. Abra \`Terminal: Create New Terminal (With Profile)\` e escolha \`Android (Seven Code)\` para iniciar o shell nativo.
5. Aprove cada nova sessão de terminal no diálogo nativo do Android. O processo roda dentro do sandbox do aplicativo como \`/system/bin/sh\`, **não** com as permissões do servidor.
6. Para \`npm\`, \`php\`, \`cargo\`, depuração e extensões Node, abra um terminal do workspace remoto, com os runtimes instalados no servidor.

A ponte com terminal local só responde à origem HTTPS configurada; arquivos locais fora do sandbox não ficam expostos automaticamente. O APK ainda precisa de testes reais de navegação do workbench, terminal, login, extensões, ciclo de vida e rotação.

## iOS

O projeto \`mobile/ios/project.yml\` gera o target \`SevenCode\` com XcodeGen. O workflow \`Seven Code iOS workbench build\` compila o app para **simulador** sem assinatura e entrega \`SevenCode-iOS-Simulator.zip\`. Isso não é um IPA instalável em iPhone real.

O app solicita o endereço HTTPS do servidor de workbench e bloqueia navegações principais fora da origem aprovada. A instalação em iPhone e assinatura exigem equipe Apple Developer e homologação real. Shell arbitrário, compiladores e extensões Node devem rodar no workspace remoto, conforme as restrições iOS.

## Critérios pendentes antes de chamar de versão estável

- [x] Código-fonte Code OSS importado, mantendo workbench e extension host originais
- [x] Open VSX configurado no produto
- [x] Extensão browser para terminal nativo Android e ponte de mensagens no workbench
- [x] Build do host Android e projeto iOS de simulador
- [ ] Subir servidor HTTPS autenticado e validar edição, salvamento, navegação, busca, Git e extensões
- [ ] Testar extensão browser instalada via Open VSX e extensão Node com host remoto real
- [ ] Testar terminal Android real com saída ANSI, Unicode, Ctrl+C, sessões concorrentes e retorno do background
- [ ] Homologar Android arm64 em dispositivo físico e iOS em iPhone físico
- [ ] Gerar build desktop e versões móveis assinadas e prontas para produção

**Não afirmar paridade com todas as extensões** sem testes: extensões proprietárias, de API proposta, dependências nativas e extensões desktop-only podem precisar de runtime remoto, implementação adicional ou não ser redistribuíveis.
