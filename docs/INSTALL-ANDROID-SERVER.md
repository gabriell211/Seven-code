# Seven Code Android — instalação do servidor Code OSS original

> O APK Android é um cliente do **editor Code OSS real**. Não inclui
> o backend Node.js nem todas as extensões nativas no celular. O
> terminal integrado, quando aberto no APK, é executado pelo Android.
> Não anuncie esta arquitetura como uma versão autônoma/offline do VS Code.

## 1. Servidor Linux x64

Use **o arquivo de servidor fornecido na mesma release do APK**. Ele contém
o workbench web, hosts de extensões e extensões distribuídas com o Code OSS.
Não misture artefatos de commits ou versões diferentes.

```bash
mkdir -p "$HOME/seven-code"
cd "$HOME/seven-code"
tar -xzf SevenCode-Server-Web-linux-x64-v0.2.0-android-preview.1.tar.gz
chmod 700 vscode-reh-web-linux-x64/bin/seven-code-server

# Gere o segredo no próprio servidor e não o inclua no repositório.
umask 077
openssl rand -hex 32 > connection-token.txt

# O processo HTTP deve ficar APENAS na interface local do host,
# atrás de um proxy HTTPS autenticado.
./vscode-reh-web-linux-x64/bin/seven-code-server \
  --host 127.0.0.1 --port 8080 \
  --connection-token-file "$PWD/connection-token.txt" \
  --accept-server-license-terms \
  --telemetry-level off
```

Mantenha este processo ativo com um serviço do sistema, usando um usuário Linux
dedicado e sem privilégios de administrador. Não exponha a porta 8080 diretamente
à internet. A opção `--accept-server-license-terms` só deve ser usada após
ler e aceitar esses termos.

## 2. HTTPS e WebSocket

Configure um domínio e certificado TLS válido. Um exemplo de bloco Nginx
*(substitua seu domínio e os caminhos dos certificados)*:

```nginx
map $http_upgrade $seven_code_upgrade {
    default upgrade;
    '' close;
}
server {
    listen 443 ssl;
    server_name code.example.com;
    ssl_certificate /etc/letsencrypt/live/code.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/code.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $seven_code_upgrade;
        proxy_read_timeout 3600;
    }
}
```

Além do token de conexão, aplique controle de acesso adequado ao seu
ambiente (por exemplo VPN ou autenticação adicional no proxy). Proteja o
servidor de extensões, que executa código com as permissões do usuário
do sistema operacional.

## 3. Conectar o celular

1. Abra primeiro o servidor no navegador com
   `https://code.example.com/?tkn=SEU_TOKEN` para validar o editor e o login.
2. Instale o APK Android correspondente **à mesma release**.
3. Informe essa URL HTTPS no Seven Code e confirme a confiança no servidor.
4. Abra o terminal integrado. O Android pedirá autorização antes de iniciar
   `/system/bin/sh`. Os comandos executam nas permissões do aplicativo.
5. Verifique o Code OSS, arquivos do workspace e extensões que rodam
   no host remoto.

**Atenção:** os arquivos do workspace remoto **não são montados
automaticamente** no filesystem do Android. Um comando local como `npm test`
não executará contra os arquivos do servidor, a menos que estejam
disponíveis localmente. A homologação completa de Copilot e do acesso
bidirecional aos arquivos continua pendente.

## 4. Problemas conhecidos

- **Tela pedindo URL:** o APK é servidor-dependente. Não há backend
  embutido ou URL pública padrão.
- **HTTP 401/403:** o token/cookie do servidor está ausente ou expirou.
- **Erro TLS:** instale um certificado válido no servidor e confira o domínio.
  O aplicativo não desativa a verificação de certificados.
- **Copilot autenticação:** OAuth externo, credenciais reais e comandos de
  agent no Android ainda precisam de teste ponta a ponta.
- **APK de ~1,5 MB:** é esperado em uma arquitetura de cliente remoto;
  a distribuição acompanha separadamente o servidor Code OSS completo.
- **Assinatura:** APK da preview é assinado com chave debug do CI; uma
  atualização poderá exigir desinstalação. Guarde seus dados e backups.
- **iPhone:** esta release não inclui um pacote iOS instalável em aparelho.

**Não considere uma execução de CI de compilação suficiente para
afirmar que há suporte completo a todas as extensões.** A workflow da
release valida apenas os cenários descritos em suas notas.
