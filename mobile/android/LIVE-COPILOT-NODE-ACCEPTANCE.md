# Homologação REAL — GitHub, Copilot e extensões Node no Seven Code Android

O APK com Code OSS original pode abrir a interface Web sem Node, mas isso **não**
prova o funcionamento de extensões do VS Code. Estes testes não admitem mocks,
respostas fixas ou tokens fabricados.

## 1. Autenticação GitHub com autorização real

1. Instale o APK compilado do commit selecionado (não um artefato antigo).
2. Abra `Seven Code: Entrar com GitHub para Copilot`.
3. Copie o código temporário **somente** para `https://github.com/login/device`
   aberto no navegador do próprio aparelho. Confira o nome do OAuth App
   apresentado pelo GitHub e autorize apenas se reconhecer o aplicativo.
4. Execute `Seven Code: Homologar GitHub + resposta REAL do Copilot`.
   O comando obtém a sessão original de `vscode.authentication`, faz
   **GET real** de `https://api.github.com/user` com o token em memória
   (sem gravá-lo em log) e pede uma resposta à API
   `vscode.lm.selectChatModels({vendor:'copilot'})` → `model.sendRequest`.
5. Resultado positivo exige uma identidade vinda do GitHub e texto **streaming**
   de um modelo oficial Copilot. Sessão criada, modelo instalado ou chat aberto
   **não** bastam; falhas mantêm a homologação reprovada.
6. Reinicie o app e repita para verificar persistência da sessão; teste
   cancelamento, ausência de rede, conta sem Copilot e quotas esgotadas.

O CI de `seven-github-oauth-live-probe.yml` testa apenas a negociação **real**
com os endpoints GitHub Device Flow até `authorization_pending`. Ele nunca
aprova a conta e **não equivale** ao teste dos passos 2–6.

## 2. Copilot Agent de verdade, com shell do Android

Abra `Seven Code: Homologar Copilot Agent com terminal Android`. No chat
original, selecione **Agent** e peça:
`Execute printf SEVEN_CODE_AGENT_REAL_OK no terminal Android e me diga a saída.`

Somente conta autorizada, escolha explícita do usuário de executar e saída
real do shell `/system/bin/sh` podem aprovar. O diálogo nativo precisa
solicitar confirmação; ao negar, nada deve executar. Sem resposta real do Agent
o status continua **não homologado**.

## 3. Runtime Node.js e extensões em dispositivo ARM64 físico

O build Linux ARM64 inclui `seven-code-node-runtime-smoke` como uma extensão
**workspace-only** com entrypoint Node.js, não como Web Worker. Na ativação,
ela carrega os módulos `fs`/`crypto`, abre um processo original
`child_process.fork()`, recebe IPC do filho e tenta `require()` da biblioteca
ARM64 `@github/copilot/sdk/prebuilds/linux-arm64/runtime.node`.

Se o host Node estiver rodando **dentro do Android**, grava uma evidência
sem credenciais em `files/seven-code-node-runtime-proof.json` apenas após
fork+IPC reais. A instrumentação do APK GNU exige prova recente e
`copilotNativeAddonLoaded=true`; se a biblioteca continuar GNU/glibc
incompatível com Android/Bionic, reprova.

Execute `Seven Code: Diagnóstico REAL do runtime Node.js` para consultar
o estado de fork e addon. Num APK Web-only, o comando Node não aparecerá:
isso **não é um bug do teste** — comprova que não há host Node.

Para testar em **hardware** prepare o runner self-hosted e siga
`mobile/android/PHYSICAL-ARM64-E2E.md`. Testes Linux AArch64 são
evidência de compatibilidade Linux, **não** de Android.

## 4. Release

Apenas quando tudo acima passar **no mesmo commit** e com os requisitos de
assinatura Android, SDK, runtime e E2E adicionais de
`.seven/require-release-checks.mjs`, uma release de produção estará liberada.
Nenhum teste unitário, CI com login não autorizado ou screenshot prova sozinho
a sessão, o Agent ou o runtime Android.
