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
