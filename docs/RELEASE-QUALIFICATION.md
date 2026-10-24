# Seven Code — release qualification (fail closed)

**Do not publish another download as a complete Seven Code until these gates pass.**

The 1.46 MB Android alpha APK is a **thin HTTPS WebView client**. It does **not** embed VS Code, offline extensions or a Node extension host. The compiled Code OSS web server is a separate 252 MB artifact, and it still requires authenticated deployment. Build success is not end-to-end proof.

## Evidence required for the exact release commit

The release workflow queries GitHub Actions check-runs on the candidate SHA, and blocks publication unless **all four independently executed E2E jobs** report successful completion:

1. \`Seven Code Android workbench and native PTY E2E\`: install the produced APK on Android, authenticate against the matching Code OSS server, open real workbench, edit/save/reopen a file, run a real JNI PTY, test background/foreground and reconnect.
2. \`Seven Code iOS real-device workbench E2E\`: install on an actual iPhone/iPad, authenticate against the matching server and verify editor/extension/UI/lifecycle functionality, not merely compile a simulator.
3. \`Seven Code Copilot real OAuth and terminal Agent E2E\`: log in with a permitted GitHub account, load the authentic Copilot extension on its supported Node host and verify suggestions, Chat, Agent Mode and \`run_in_terminal\` reaching the Android native shell with visible approval and verifiable output/exit status.
4. \`Seven Code server auth, web extensions and remote extension host E2E\`: deploy the matching commit through authenticated HTTPS, check web workbench, browser and Node extensions, Git, debug and terminal host end to end.

These job names are **reserved for real E2E**, not unit tests, mocks, manifest checks, packaging checks or smoke HTTP probes. Merely renaming a CI build job to a reserved name is not proof and must not be done.

The Android build workflow now runs a **real emulator PTY test**; that is useful regression evidence, **not** enough to pass the complete Android acceptance job. No Copilot secrets should be committed or printed. Use encrypted CI credentials with strict scopes and a controlled test workspace for the live Copilot suite.

The prerelease automation is designed to **fail closed** whenever any evidence is missing, expired, failed or belongs to another commit. A passing CI build is not itself approval to publish. Existing alpha assets remain explicitly non-production previews.

See \`.seven/require-release-checks.mjs\` and \`.seven/tests/release-qualification.test.mjs\`.


## Regra irrevogável do empacotamento Android — APK único

O Seven Code **não deve publicar um APK remoto/fino com servidor Code OSS,
Node, extensões ou bibliotecas como downloads separados**. O único artefato
instalável de uma release Android é `SevenCode-*.apk` (acompanhado, se
necessário, somente de `SHA256SUMS.txt`). Os artefatos temporários do CI
podem continuar separados durante a compilação, porém **não são releases**.

Antes de autorizar um novo workflow de publicação, ele deverá executar, sobre
os arquivos finais exatos, **ambas** as validações independentes:

```bash
node .seven/require-single-apk-release.mjs release-assets
node .seven/require-release-checks.mjs
```

O primeiro verificador exige dentro do **mesmo APK** o Code OSS original
(`assets/seven-local/server.zip`), SHA-256 do servidor, Node Bionic
(`lib/arm64-v8a/libnode.so`), bibliotecas Termux verificadas, licenças e
extensões, auditando incompatibilidades glibc. O segundo só libera mediante
evidência E2E real do commit. Mesmo com ambos verdes, a publicação só poderá
ser ativada após homologação em aparelho Android ARM64.

Os cinco publicadores antigos (Alpha 1–3 e Preview 1–2) estão **desativados
por padrão em main**. Os três branches Alpha históricos já tinham seus
workflows aposentados; os dois branches Preview foram igualmente bloqueados.
Esse bloqueio não restringe uma pessoa com acesso de manutenção que publique
manualmente via GitHub UI/API; tal ação deve continuar proibida pela política
de distribuição do projeto.
