# Seven Code

Editor multiplataforma baseado no [Code - OSS](https://github.com/microsoft/vscode), com marca e tema independentes.

> **Estado em 23/10/2026:** fonte Code - OSS importada na `main` e identidade Seven Code aplicada. A aplicação Android carrega o Code OSS Web Workbench original, com perfil de PTY nativo, e há um projeto iOS com build de simulador aprovado. A execução real do workbench e das extensões em servidor autenticado ainda requer homologação.

## Experimento Android Web offline (24/10/2026)

A nova rota `seven-android-offline-web.yml` testa a abordagem de **compilar o Web Workbench original** via `npm run gulp vscode-web-min`, incluir seus recursos no APK e carregar `https://appassets.androidplatform.net/assets/seven-web/index.html` por `WebViewAssetLoader`, sem iniciar Node.js somente para exibir a interface nem pedir URL ao usuário.

O bundle também inclui avisos de licença. O terminal PTY nativo continua protegido por autorização de sessão. **Este é um experimento separado da release oficial**: a publicação de APK só como *artifact* de CI depende da compilação completa, inspeção dos bytes empacotados e prova de abertura real no emulador. O código Web isolado não fornece, por si só, filesystem de projetos Android plenamente integrado, extensões Node.js, GitHub Copilot autenticado, depuradores ou compiladores nativos. Nenhuma release estável é autorizada apenas por esse build.

## Status real da release Android

**A versão `v0.1.0-alpha.3` é uma prévia, não um VS Code completo para uso sem configuração.** Seu APK de aproximadamente 1,46 MB contém o host Android/WebView e o terminal PTY; o workbench Code OSS e os hosts de extensões vêm do servidor Linux publicado separadamente, que precisa ser instalado e protegido com HTTPS/autenticação. Não há um servidor pré-configurado e a conta Copilot ainda não passou por E2E em dispositivo.

**Política de publicação:** novas releases só poderão ser publicadas pelo fluxo atualizado após verificações reais, no mesmo commit, de Android/workbench, iOS físico, Copilot autenticado com execução no terminal nativo e servidor/extensões. Testes unitários, simulações, artefatos gerados ou status verde de build **não** comprovam essas condições. Consulte [critérios de homologação](docs/RELEASE-QUALIFICATION.md).

## Plataformas

- **Windows, Linux e macOS:** distribuição desktop baseada no Electron do Code - OSS, após importar, compilar e assinar os artefatos.
- **Android e iOS:** aplicativos nativos WebView/WKWebView para acessar o **servidor e web workbench originais do Code OSS** por HTTPS autenticado, sem redesenhar o editor ou criar outro backend. Extensões browser rodam no web extension host e extensões Node.js precisam de um host de workspace remoto. O terminal Android tem PTY nativo; o iOS usa terminal remoto enquanto o adaptador local não estiver integrado.

## Fonte original e licença

Origem: [microsoft/vscode](https://github.com/microsoft/vscode). O núcleo Code - OSS é MIT. Preservamos `LICENSE.txt` e `ThirdPartyNotices.txt`, e usamos identidade, identificadores e ícones próprios. Nenhum produto Microsoft, marca ou licença comercial da distribuição oficial está sendo redistribuído.

## Estrutura do projeto

- `.github/workflows/import-code-oss.yml`: importação e aplicação da marca no GitHub Actions.
- `.seven/apply-brand.mjs`: aplica metadados e ajustes visuais de forma repetível.
- `.seven/assets/seven-code.svg`: logotipo vetorial original.
- `docs/MOBILE.md`: estratégia de uso no celular.

**Importante:** uma execução bem-sucedida do workflow de importação não equivale a uma build de produção. Builds, instaladores, CI multiplataforma e homologação são etapas distintas.

## Terminal no celular e acesso da IA

- **Android:** `mobile/android` abre o Code OSS Web Workbench hospedado via HTTPS. A extensão interna `extensions/seven-code-mobile-terminal` oferece o terminal local PTY dentro do painel original do Code OSS; o host exige autorização nativa por sessão.
- **iOS:** `mobile/ios/project.yml` e `mobile/ios/App` contêm o aplicativo SwiftUI compilável para simulador, hospedando o workbench web. O adaptador experimental `ios_system` existe, mas não foi associado ao target iOS.
- **IA:** `mobile/terminal-core/ai-terminal-tool.ts` implementa o contrato `execute_command`. No Android, **todo comando proposto exige aprovação visível na interface nativa** antes de ser executado em uma sessão separada do terminal do usuário.
- **Limitações:** a conexão de um provedor de IA e a homologação completa de workbench, backend remoto e extensões ainda não foram concluídas. Veja [arquitetura do terminal](docs/AI-TERMINAL.md).

Os workflows `seven-mobile-android.yml` e `seven-ios.yml` geram builds de depuração do host Android e do app de simulador iOS. **O APK usa o **servidor web original do Code OSS/VS Code (compilado da mesma revisão)** via HTTPS; não existe backend proprietário Seven Code separado.** Veja [instruções de instalação e extensões](docs/MOBILE.md).

## Compatibilidade de recursos no celular

**Objetivo:** manter todos os módulos do VS Code disponíveis por meio de um runtime local (Android/iOS) ou de um workspace remoto autenticado. A [matriz de funcionalidades](docs/MOBILE-PARITY.md) descreve cada parte, com critérios de aceitação e limitações. O núcleo [mobile/capabilities](mobile/capabilities) contém um contrato executável para impedir que funcionalidades sem suporte sejam apresentadas como concluídas.

- No Android, a base de terminal local usa PTY/JNI. Isso não equivale a compilar qualquer projeto no dispositivo.
- No iOS, comandos locais usam bibliotecas embarcadas; funcionalidades que exigem processos arbitrários utilizam ambiente remoto autorizado.
- Depuração, extensões Node.js, servidores de linguagem, containers, compiladores e ferramentas externas requerem um runtime realmente compatível. O repositório contém a implementação upstream de servidor/workspace do Code OSS, mas **a implantação autenticada e os testes ponta a ponta ainda não foram homologados**.
- As extensões devem ser obtidas de fontes legalmente compatíveis com Code - OSS, como **Open VSX**; o Marketplace da Microsoft não é redistribuível em forks independentes.

> A matriz registra requisitos e testa roteamento. Ela **não** significa que todas as ferramentas já estejam implementadas ou homologadas.
