# Seven Code

Editor multiplataforma baseado no [Code - OSS](https://github.com/microsoft/vscode), com marca e tema independentes.

> **Estado:** infraestrutura de importação e personalização em implantação. A presença destes arquivos ainda não significa que existam APKs ou instaladores homologados.

## Plataformas

- **Windows, Linux e macOS:** distribuição desktop baseada no Electron do Code - OSS, após importar, compilar e assinar os artefatos.
- **Android e iOS:** edição pela interface web/PWA hospedada em servidor autenticado. **Não** é possível rodar o Electron desktop como APK. Execução de código e terminais exigem ambiente remoto apropriado.

## Fonte original e licença

Origem: [microsoft/vscode](https://github.com/microsoft/vscode). O núcleo Code - OSS é MIT. Preservamos `LICENSE.txt` e `ThirdPartyNotices.txt`, e usamos identidade, identificadores e ícones próprios. Nenhum produto Microsoft, marca ou licença comercial da distribuição oficial está sendo redistribuído.

## Estrutura inicial

- `.github/workflows/import-code-oss.yml`: importação e aplicação da marca no GitHub Actions.
- `.seven/apply-brand.mjs`: aplica metadados e ajustes visuais de forma repetível.
- `.seven/assets/seven-code.svg`: logotipo vetorial original.
- `docs/MOBILE.md`: estratégia de uso no celular.

**Importante:** uma execução bem-sucedida do workflow de importação não equivale a uma build de produção. Builds, instaladores, CI multiplataforma e homologação são etapas distintas.

## Terminal no celular e acesso da IA

- **Android:** `mobile/android` contém um host de teste com xterm.js e shell local PTY. O usuário pode interagir com o shell no próprio dispositivo; não é um PowerShell.
- **iOS:** `mobile/ios` contém um adaptador `ios_system` para comandos locais compatíveis. É necessário criar e integrar o aplicativo Xcode.
- **IA:** `mobile/terminal-core/ai-terminal-tool.ts` implementa o contrato `execute_command`. No Android, **todo comando proposto exige aprovação visível na interface nativa** antes de ser executado em uma sessão separada do terminal do usuário.
- **Limitações:** a camada que conecta um provedor de IA ao contrato, a integração de todo o editor Code - OSS e o build homologado dos aplicativos móveis ainda não foram concluídos. Veja [arquitetura do terminal](docs/AI-TERMINAL.md).

Build de teste Android: a workflow `seven-mobile-android.yml` valida o TypeScript e tenta gerar `SevenCode-android-debug-apk` como artefato do GitHub Actions. A execução da workflow deve ser conferida antes de declarar o APK funcional.

## Compatibilidade de recursos no celular

**Objetivo:** manter todos os módulos do VS Code disponíveis por meio de um runtime local (Android/iOS) ou de um workspace remoto autenticado. A [matriz de funcionalidades](docs/MOBILE-PARITY.md) descreve cada parte, com critérios de aceitação e limitações. O núcleo [mobile/capabilities](mobile/capabilities) contém um contrato executável para impedir que funcionalidades sem suporte sejam apresentadas como concluídas.

- No Android, a base de terminal local usa PTY/JNI. Isso não equivale a compilar qualquer projeto no dispositivo.
- No iOS, comandos locais usam bibliotecas embarcadas; funcionalidades que exigem processos arbitrários utilizam ambiente remoto autorizado.
- Depuração, extensões Node.js, servidores de linguagem, containers, compiladores e ferramentas externas requerem um runtime realmente compatível. A implementação atual ainda **não** fornece um servidor/workspace remoto operacional.
- As extensões devem ser obtidas de fontes legalmente compatíveis com Code - OSS, como **Open VSX**; o Marketplace da Microsoft não é redistribuível em forks independentes.

> A matriz registra requisitos e testa roteamento. Ela **não** significa que todas as ferramentas já estejam implementadas ou homologadas.
