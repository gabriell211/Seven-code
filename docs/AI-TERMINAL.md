# Seven Code — terminal unificado e ferramenta execute_command

## Contrato

Objetivo: usuário e IA operam o mesmo conceito de **terminal**, com processos de shell do sistema quando disponíveis. A interface do terminal (xterm.js, abas, copiar/colar, UTF-8, ANSI, resize, histórico visual) é comum; o **executor** varia conforme o SO.

| Ambiente | Shell/execução | Observações |
|---|---|---|
| Windows | PowerShell + ConPTY | Base desktop Code - OSS |
| macOS | Zsh + PTY | Base desktop Code - OSS |
| Linux | Bash/Zsh + PTY | Base desktop Code - OSS |
| Android | `/system/bin/sh` em PTY criado por JNI | Ambiente de app Android; comandos disponíveis dependem do SO, sem root |
| iOS | `ios_system` / `ios_popen` com comandos embarcados | Não possui `fork/exec` de processos arbitrários; retorno de exit status depende da integração |

### Fluxo de ferramenta da IA no Android

```text
Modelo (ainda não conectado) -> execute_command(requestId, command, timeoutMs)
      -> mobile/terminal-core/ai-terminal-tool.ts
      -> WebView local (origem appassets.androidplatform.net)
      -> MainActivity: AlertDialog nativo para aprovação
         -> Negado: responde approved=false, não executa
         -> Permitido: SevenAiCommandRunner
            -> PTY separado em /system/bin/sh
            -> coleta saída limitada, status por sentinela aleatória, timeout
            -> retorna approved, exitCode, output, truncated, error
      -> resultado disponível para o provedor/modelo de IA
```

**Não há execução silenciosa de comandos pela IA.** O host Android exige um gesto explícito do usuário para autorizar cada comando. Um provedor de IA não deve ser conectado a `window.SevenCodeTerminalTools` sem autenticação, consentimento e isolamento apropriados.

O Android implementa **o transporte e execução da ferramenta**; **não** inclui ainda um provedor/SDK de modelos, uma interface de chat completa, um loop de chamadas de ferramenta ou políticas completas de autorização por workspace. A IA não está pronta para uso de ponta a ponta.

O limite de comando é de 4096 caracteres, tempo de 1 a 120 segundos, buffer de resposta de no máximo 128 KiB e no máximo uma execução de ferramenta por host. O shell roda sem root no contexto do aplicativo. Em caso de retorno sem código, a IA deve tratar como **inconclusivo**, não presumir sucesso.

### Android: terminal do usuário x terminal da IA

São instâncias PTY **separadas**. Isso evita corromper entrada, prompt ou saída do terminal que o usuário esteja usando. Uma consequência: comando da IA não herda `cd`, variáveis ou processos interativos do terminal humano. Quando necessário, a futura integração deve passar explicitamente `cwd` validado no sandbox.

O exec Android usa um shell interativo PTY com marcadores aleatórios para delimitar comando e retorno, não um protocolo binário próprio. Esse bootstrap exige homologação contra eco de shell, saída volumosa, encoding UTF-8, múltiplas linhas e interrupção; ambientes hostis podem tentar produzir saída com aparência de marcador. Para endurecimento posterior, substituir por `execve("/system/bin/sh", ["sh","-c",command])` em processo separado com status nativo `waitpid` e pipes próprios.

### iOS

O `ios_system` possui funções de comandos pré-embarcados e `ios_popen`. É possível oferecer comandos úteis localmente, sem servidor, inclusive em conjunto com bibliotecas Python/WASM portadas para iOS. Não é equivalente à instalação irrestrita de binários. O código em `mobile/ios/SevenIosAiCommandTool.swift` adapta os pedidos à implementação local, porém **a compilação e integração real em um alvo Xcode ainda faltam**. Para compilações ou servidores que dependem de processos não suportados localmente, usar um backend remoto autenticado como opção, e sinalizar a mudança ao usuário.

### Segurança e UX

- O host WebView deve carregar somente assets locais empacotados; não conceder `SevenTerminalNative` a páginas de internet ou iframes não confiáveis.
- Exibir **comando completo** antes de executar e dar opção de negar; pedir nova autorização se mudar.
- Impedir duas execuções concorrentes, validar `requestId`, tamanho, timeout e origem.
- Não expor segredos, tokens, variáveis protegidas e prompts da IA nos logs por padrão.
- Tratar comandos destrutivos como alto risco; confirmação é necessária, mas pode não ser suficiente. Incluir revisão do usuário, backups e isolamento.
- Na interface exibir retorno e status com clareza: exitCode 0 é sucesso; diferente de zero é falha; null é desconhecido.
- Caso o app seja suspenso ou perca a atividade, cancelar sessões e informar resultado inconclusivo; não fingir sucesso.

### Testes

- [x] Testes básicos do contrato TypeScript: solicitação, aprovação, negativa, comando malformado, simultaneidade, descarte tardio.
- [ ] Build de APK com GitHub Actions confirmado.
- [ ] Testes instrumentados Android com PTY, eco, sentinela, timeout, UTF-8, muitos dados e saída sem código.
- [ ] Testes iOS com comandos locais e retorno, após integrar frameworks ao Xcode.
- [ ] Integração de um modelo de IA com tool calling real.
- [ ] Homologação de experiência unificada dentro do Code - OSS em PC e celular.

Referências:
- VS Code terminal: https://code.visualstudio.com/docs/terminal/shell-integration
- VS Code agent terminal: https://code.visualstudio.com/docs/agents/run/tools
- Android W^X: https://developer.android.com/about/versions/10/behavior-changes-10
- Apple App Store 2.5.2: https://developer.apple.com/app-store/review/guidelines/
- ios_system: https://github.com/holzschu/ios_system
