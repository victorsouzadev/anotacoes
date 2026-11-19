# Research: Extrair as ferramentas em uso

- **Ordem**: **Decision** Dieta → Tarefas → Anotação → Finanças → Notas. Critério: uso medido (Dieta 10 dias, Tarefas 4) contra risco (Notas tem a sincronização mais delicada; Finanças tem segredos e IA). As duas primeiras têm Android, então validam cedo as rotas legadas com APK instalado.
- **Android**: **Decision** cada app ganha Gradle próprio no repositório da ferramenta (`mobile/` hoje é um projeto com dois módulos). As URLs base viram configuráveis; a versão nova usa `/<id>/api` e o token `aud=<id>` (030). **Alternatives**: manter `mobile/` como repositório único dos apps (rejeitado: um app parado travaria o outro).
- **Relógio**: `FinancasClock` vira `RelogioDoHub` no SDK (fuso do usuário, injetável em teste). Dieta e Tarefas deixam de depender de Finanças.
- **AUVP**: **Decision** na primeira subida da Finanças, o plug-in pede ao núcleo `POST /api/core/segredos/recifrar` (token de serviço) com o texto cifrado de `configuracoes_auvp`; o núcleo decifra com a chave dele e devolve o texto claro só para o plug-in recifrar com `SEGREDO_PLUGIN`. Uma vez por linha; depois o endpoint recusa.
- **Notas**: **Decision** o e2e de sincronização (lixeira, tags, celular — hoje só no scratchpad) vira suíte Playwright na CI do `hub-notas` antes da extração, para pegar regressões da 021. Lixeira: o `NotesLixeiraWorker` do núcleo é desligado na mesma versão em que o do plug-in sobe.
- **Link público de notas**: `/p/nota/*` e `/api/notes/publico/*` entram em `rotasLegadas` do plug-in Notas (o `/p` deixa de ser reservado do núcleo).
