# Seven Code Android — homologação de login GitHub e Copilot

## Implementado

- A interface original Code OSS continua embutida no APK offline, sem pedir URL.
- O comando **Seven Code: Entrar com GitHub para Copilot** usa a extensão original `github-authentication`.
- O fluxo OAuth **Device Flow** abre `https://github.com/login/device` no navegador do sistema.
- Apenas dois POST HTTPS oficiais (`/login/device/code` e `/login/oauth/access_token`) atravessam o proxy nativo Android com origem WebView verificada. Nenhuma URL arbitrária, segredo de cliente ou token é guardado pelo processo Kotlin.
- A sessão OAuth é administrada pelo AuthenticationProvider original. O usuário pode cancelar o fluxo.
- No build Android Web, o Copilot usa o `extensions/copilot/dist/web.js` original, não uma interface de chat inventada.

## Critérios de homologação manual REAL (não validados apenas pelo CI)

1. Instalar o APK do workflow **Seven Code Android - original Web workbench OFFLINE APK (test only)** no aparelho Android real. Confirmar que abre o editor original offline, sem URL, e que a extensão GitHub aparece ativa.
2. Executar **Seven Code: Entrar com GitHub para Copilot**. Confirmar que o GitHub exibe um código temporário e abre **no navegador externo** `https://github.com/login/device`.
3. Autorizar o aplicativo GitHub OAuth **identificado na tela do próprio GitHub**, somente se esperado. Se aparecer `device_flow_disabled`, `incorrect_client_credentials` ou `bad_verification_code`, validar o client ID de um aplicativo GitHub próprio com Device Flow habilitado; não tentar burlar a autorização.
4. Retornar ao editor; conferir a conta exibida, persistência da sessão após reiniciar o app, seleção da conta e logout pelo provedor original. Nunca enviar para logs/screenshots tokens, códigos ativos, cookies ou respostas com `access_token`.
5. Abrir **Seven Code: Abrir Copilot Chat**. Enviar uma pergunta simples e **verificar a resposta real** do Copilot, uso de uma sessão autorizada e ausência de resposta simulada. Verificar licença, quota e política da conta.
6. Testar Copilot Agent lendo arquivos apenas de pasta SAF autorizada. Solicitar um comando ao terminal: o Android deve pedir aprovação antes de executar; cancelar deve bloquear toda execução.
7. Repetir com rede desativada, login cancelado, código expirado e troca de rede; verificar erros compreensíveis, sem revelar tokens nem travar a interface.
8. Testar se autenticação e Copilot continuam coerentes após o app ir para segundo plano e voltar.

## Limites e release

Os testes automatizados validam **estrutura**, origens, transporte, respostas OAuth simuladas e inicialização do editor no emulador; não autorizam uma conta GitHub real. Mesmo se o CI ficar verde, os campos `githubAuthenticationE2EVerified` e `copilotAuthenticationE2EVerified` permanecem **false** até provas autenticadas de uma sessão real, e o runtime Node/Agent completo ainda necessita homologação própria.

A aplicação GitHub de Device Flow usada deve ser autorizada pelo proprietário com cliente OAuth habilitado para Device Flow. Código/segredo de cliente não deve ser obtido dos tokens do usuário nem embutido em arquivos privados.
