# Seven Code — teste real Android ARM64 (APK GNU experimental)

O Android WebView offline pode iniciar o Workbench original sem Node, mas **não**
é prova de que o Code OSS GNU, as extensões Node, o login GitHub ou o Copilot
Agent funcionam no aparelho. O binário GNU falhou com SIGSYS no emulador x86_64;
o emulador ARM64 hospedado no macOS não iniciou por falha do HVF.

## Preparar um runner de dispositivo físico

1. Configure um runner **GitHub Actions self-hosted Linux x86_64**, com o rótulo
   adicional `seven-android-device` (o Android conectado é ARM64; o host pode ser
   x86_64). Não execute isso no emulador.
2. Instale `adb`, `gh`, `jq`, `unzip`, `python3`, `keytool` e ferramentas de
   build usuais no host. A action instala/configura Java 17, Android SDK e Gradle,
   mas o host precisa ter acesso USB ao telefone.
3. Ative **Depuração USB**, autorize o computador na tela do Android e confirme:
   `adb devices -l` deve mostrar **exatamente um** aparelho em estado `device`.
   O aparelho deve responder com `arm64-v8a` em
   `adb shell getprop ro.product.cpu.abilist`.
4. Confirme espaço livre em `/data` para instalar e extrair o APK grande e os
   artefatos da instrumentação. O teste instala dois APKs assinados com uma chave
   **efêmera, somente para CI**; não altera o artefato original no GitHub.

## Executar teste controlado

No GitHub, abra **Actions → Seven Code Android - physical ARM64 GNU runtime
acceptance (experimental) → Run workflow**.

Informe o ID de um run **bem-sucedido** do workflow
`Seven Code Android - experimental isolated GNU ARM64 single APK`.
Exemplo de execução previamente bem-sucedida: `40116669983`
(os artefatos do GitHub Actions expiram; se não existir mais, refaça o build).

O workflow:

- Verifica que o build veio de `main` e corresponde a um commit imutável.
- Faz checkout do commit exato e baixa **um APK experimental completo** do mesmo run.
- Confirma ARM64 físico (recusa emulador), verifica o APK e compila a instrumentação.
- Assina **cópias efêmeras** de app e testes com o mesmo certificado.
- Instala os APKs e exige o resultado da instrumentação real;
  em falha, registra fase de inicialização e `logcat` com tokens redigidos.

## Interpretação dos resultados

**Verde aqui:** o servidor original GNU Code OSS passou seu E2E de inicialização
em um dispositivo físico, para o commit e aparelho testados.

**Não significa:** que autenticação do GitHub, Copilot Chat/Agent,
extensões Node arbitrárias, instalação via loja ou release final passaram.
Esses casos têm verificações E2E independentes e obrigatórias. Nunca publicar
uma release com base apenas em testes de compilação, HTML, tamanho do APK,
emuladores sem boot ou este workflow isolado.
