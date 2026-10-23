# Seven Code — terminal local no celular

## Decisão técnica (23/10/2026)

O terminal integrado do Code - OSS contém **duas partes separadas**:

1. **Interface:** xterm.js, abas, comandos, seleção de texto, resize, sequências ANSI.
2. **Processo:** desktop usa node-pty para executar a shell do SO, incluindo PowerShell com ConPTY.

O editor web não recebe Node.js e tampouco permissões de executar processos locais. O Seven Code deve encaminhar eventos do xterm.js a um motor com recursos nativos, **apenas no aplicativo instalado**, evitando executar código host a partir de uma página arbitrária.

## Android: PTY verdadeiro no dispositivo

Implementado o primeiro motor nativo em `mobile/android/terminal`:

- JNI em C: `/dev/ptmx`, `grantpt`, `unlockpt`, `ptsname_r`, `fork`, `setsid`, `TIOCSCTTY`, `dup2`, `execve('/system/bin/sh')`.
- Kotlin `SevenPty`: `start`, `write`, `resize`, `close`, leitura em thread dedicada e limpeza de processo.
- Sem root: executa com permissões do aplicativo; workspace limitado ao diretório privado `filesDir`.
- Sem shell fake: bytes ANSI saem do PTY; ainda precisa da integração de eventos com xterm.js do Code - OSS.
- Restrições Android 10+: **não** executar binários baixados na pasta gravável do app. Binários adicionais precisam de empacotamento e homologação própria.
- O Android básico não traz Node/npm/git/pip completos; devem ser tratados como ferramentas opcionais instaladas/embarcadas dentro das regras do SO.

### Build de biblioteca (Android)

Abrir `mobile/android` no Android Studio, instalar SDK 36, NDK e CMake; executar `gradle :terminal:assembleDebug` usando Gradle 8.13/JDK 17. Este módulo é uma **biblioteca nativa**, não um APK instalável: ainda não existe Activity/host WebView e ponte de eventos para o workbench.

## iOS: comandos locais sem fork/exec

A Apple proíbe tratar um iPhone como um PC com processos arbitrários. O a-Shell usa `ios_system` (BSD-3-Clause), que reúne comandos como funções/frameworks embarcados e aceita comandos WASM dentro dos limites de iOS.

- O esqueleto em `mobile/ios/SevenLocalTerminal.swift` invoca `ios_popen` em fila serial para comandos locais pré-integrados.
- É **obrigatório** adicionar a dependência [holzschu/ios_system](https://github.com/holzschu/ios_system) ao Xcode, associar frameworks de comandos e os plists do pacote.
- Não executa PowerShell, bash arbitrário, processos forkados ou comandos instalados de forma irrestrita.
- Programas externos/compilações que exijam processos tradicionais devem usar backend remoto autenticado.
- O projeto Swift é um **adaptador**, não um aplicativo iOS compilado/homologado.

## Protocolo do terminal

Contrato em `mobile/terminal-core/terminal-backend.ts`:

- `start({columns,rows}, onOutput)`: cria sessão e emite bytes/eventos.
- `input(bytes)`: remete as teclas do terminal, incluindo Ctrl-C (0x03).
- `resize`: atualiza colunas e linhas.
- `dispose`: encerra a sessão, libera descritores e filhos.

No Android conectar a superfície xterm.js ao PTY com uma ponte nativa **restrita a assets locais confiáveis**, preferencialmente `WebViewAssetLoader` e `WebMessageListener` com origens permitidas; não habilitar `addJavascriptInterface` em WebView navegando sites arbitrários. No iOS usar `WKScriptMessageHandlerWithReply`/content world isolado, validando o domínio e os comandos recebidos.

## Testes necessários antes de produção

1. Android: shell `echo`, `pwd`, `cd`, `ls`, teclas Ctrl-C, output UTF-8 e ANSI.
2. Android: `resize` com `stty size` se disponível, SIGTERM/SIGHUP, saída longa, fechar e reabrir, rotação, segundo plano e retorno.
3. Android: Android 10 a 16, arm64-v8a; testes em dispositivo real + emulador, permissões de diretório.
4. iOS: comandos distribuídos no pacote, leitura/escrita sandbox, caracteres especiais, sequência de comandos, suspensão e retorno.
5. Segurança: uma página externa não pode iniciar PTY; validar origem, sessão, lifecycle, limites de mensagem; nenhum terminal remoto sem autenticação/autorização.
6. CI: compilar a biblioteca JNI e o futuro host Android; compilar projeto iOS quando existir Xcode target.

## Estado comprovável

- [x] Estudo técnico sobre os terminais do VS Code, Android e iOS.
- [x] Implementação inicial de motor PTY Android (fonte C + Kotlin).
- [x] Adaptador iOS com dependência explícita `ios_system` (fonte Swift).
- [x] Contrato de eventos com backend local/remoto.
- [ ] Integração real com workbench/xterm.js.
- [ ] Build Android executado e testes em aparelho.
- [ ] Host Android + instalador APK.
- [ ] Projeto Xcode completo, linkagem `ios_system`, testes no iPhone.
- [ ] CI/release dos aplicativos móveis.

### Referências

- VS Code: https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalProcess.ts
- node-pty: https://github.com/microsoft/node-pty
- Termux JNI: https://github.com/termux/termux-app/blob/master/terminal-emulator/src/main/jni/termux.c
- Android exec W^X: https://developer.android.com/about/versions/10/behavior-changes-10
- Apple regras 2.5.2: https://developer.apple.com/app-store/review/guidelines/
- a-Shell: https://github.com/holzschu/a-shell
- ios_system: https://github.com/holzschu/ios_system
