# Seven Code para Android e iOS

## Arquitetura

A base Code - OSS inclui um editor web. O desktop usa Electron e não vira APK simplesmente alterando o nome. Para o celular, a direção definida é **PWA usando editor web hospedado em servidor**.

- Acesso por HTTPS com autenticação forte; bloquear instâncias públicas anônimas.
- Executar terminais, builds e repositórios em workspaces isolados no servidor.
- Adicionar manifest, service worker e ícones ao build web para instalação na tela inicial.
- Ajustar touch, menus, teclado virtual, seletor de arquivos e retorno do segundo plano.

## Limites da primeira versão

A instalação de PWA e o uso de terminal remoto dependem do deployment; um APK nativo e edição offline **não estão implementados** neste bootstrap.

## Homologação futura

1. CI de build do Web Workbench e publicação segura.
2. Autenticação por sessão e expiração; isolamento e cotas por usuário.
3. Testes com Android/iOS (teclado, viewport, upload, arquivos, rede intermitente).
4. Empacotamento Android/iOS somente após a camada mobile funcionar.
