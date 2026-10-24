# Seven Code — salvar projetos no armazenamento do próprio celular

O workspace **não precisa ficar na Vercel**. O Code OSS original
pode acessar uma pasta do Android pelo esquema de arquivos `sevenmobile:/`,
registrado através da API original `vscode.workspace.registerFileSystemProvider`.

## Como o usuário abre os projetos

1. No Seven Code para Android, abra a paleta de comandos.
2. Execute **Seven Code: Abrir pasta do celular**.
3. No seletor nativo Android, escolha uma pasta do armazenamento interno ou cartão SD
   disponibilizada pelo provedor local do sistema.
4. O app solicita e preserva a autorização de leitura/escrita dessa **pasta escolhida**.
   O explorador original do Code OSS usa o workspace `sevenmobile:/`.
5. Os bytes lidos ou editados transitam somente entre a WebView de origem confiável
   e a API Storage Access Framework. Os arquivos são gravados na pasta Android
   escolhida, não no filesystem efêmero da Vercel.

Se o editor estiver hospedado numa máquina remota, o servidor remoto **não**
recebe automaticamente acesso ao filesystem privado do Android. O acesso aos
arquivos locais funciona pela ponte do cliente. Os terminais executados
remotamente não enxergam esses arquivos como se fossem arquivos Linux; o
terminal Android pode acessar apenas os arquivos que o sandbox Android ou o
provedor SAF permitam.

## Limites e segurança

- Apenas o documento principal da WebView na origem aprovada pode fazer
  solicitações nativas. O seletor de pastas exige ação do usuário.
- Aceita somente provedores SAF de armazenamento local do Android, não provedores
  de arquivos em nuvem. O app persiste a permissão apenas após aprovação.
- Caminhos absolutos são validados; `..` e separadores inválidos são rejeitados.
- Leituras e gravações são transferidas em blocos de 32 KiB.
- Tamanho máximo por arquivo nesta versão: **10 MiB**.
- Renomear dentro da mesma pasta é suportado; mover entre pastas ainda não.
- A pasta SAF não oferece transações universais entre provedores: gravações no
  documento de destino podem falhar durante a cópia. Mantenha backups dos projetos.
- A ponte não incorpora uma cópia completa do Code OSS no APK, não substitui um
  ambiente de execução Node compatível para extensões e não comprova Copilot
  Agent operando sobre arquivos locais. Essas validações continuam pendentes.
- Ao remover o aplicativo, o usuário perde as permissões salvas, mas **não**
  deve perder os arquivos guardados na pasta escolhida.

## Testes

`.seven/tests/android-phone-workspace.test.mjs` testa o protocolo JS da extensão
original: seleção, abrir workspace, leitura e escrita em múltiplos blocos, Unicode,
renomear, excluir e recusa de gravar arquivo ausente quando `create=false`.

Os testes simulam a resposta Android e **não substituem** a homologação SAF
em um aparelho real com diferentes provedores, reinícios e edições simultâneas.
