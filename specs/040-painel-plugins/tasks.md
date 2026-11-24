# Tasks: Painel de plug-ins

**Input**: os documentos em `specs/040-painel-plugins/`: plan, research, data-model, contracts e quickstart.

**Organização**: por história da spec. Os testes entram porque a constituição (princípio V) e a CI pedem. "[dono]" marca o que depende do dono.

## Phase 1: Setup

- [ ] T001 Criar `PainelOptions` (administradores, tokens, validades) em `backend/Notas.Api/Services/Painel/PainelOptions.cs` e registrar em `backend/Notas.Api/NotasApp.cs`.
- [ ] T002 [P] Declarar `HUB_ADMINISTRADORES`, `PAINEL_GITHUB_LEITURA`, `PAINEL_GITHUB_DISPARO` e as validades em `docker-compose.yml` e `.env.example`, sem valor.

## Phase 2: Foundational (bloqueia todas as histórias)

- [ ] T003 [P] Pôr os ids reservados (research R5) em `pacotes/Hub.Plugin.Sdk/Manifestos/RegrasDoManifesto.cs`, com teste em `pacotes/Hub.Plugin.Sdk.Tests/SdkTests.cs`; subir a versão do SDK. Conferir antes que nenhum plug-in no ar passa a ser recusado.
- [ ] T004 Criar o filtro de administrador e `GET /permissao` em `backend/Notas.Api/Endpoints/PainelPluginsEndpoints.cs`, conforme `contracts/painel-api.md`.
- [ ] T005 Testar 401 sem sessão, com token de MCP e com segredo de serviço, e 403 para outra conta, em `backend/Notas.Api.Tests/PainelAcessoTests.cs` (todas as rotas do grupo, inclusive as futuras).
- [ ] T006 [P] Criar `GithubDoPainel` (só as URLs de `contracts/workflow.md`, limite de 5 s, sem token em erro) em `backend/Notas.Api/Services/Painel/GithubDoPainel.cs`, com GitHub falso em `backend/Notas.Api.Tests/GithubDoPainelTests.cs`: outra URL é recusada.

## Phase 3: User Story 1 - Ver os plug-ins e o que falta (P1) 🎯 MVP

**Goal**: painel só de leitura. **Independent Test**: ferramenta mesclada e sem banco aparece com "imagem publicada" e "falta: banco, registro".

- [ ] T007 [P] [US1] Criar a conferência só de leitura em `deployer/Notas.Deployer/PreparoDoBanco.cs` e a rota `GET /plugins/{id}/preparo` de `contracts/deployer.md` em `deployer/Notas.Deployer/Program.cs`.
- [ ] T008 [US1] Criar `GET /imagens/{id}/{versao}` e `GET /recursos` em `deployer/Notas.Deployer/Program.cs`, com as leituras em `deployer/Notas.Deployer/Recursos.cs` e testes em `deployer/Notas.Deployer.Tests/RecursosTests.cs`. Conferir que o `docker manifest inspect` funciona no `docker-cli` da imagem.
- [ ] T009 [P] [US1] Criar `SituacaoDoPlugin` (função pura: etapas e situação de `data-model.md`) em `backend/Notas.Api/Services/Painel/SituacaoDoPlugin.cs`, com teste em `backend/Notas.Api.Tests/SituacaoDoPluginTests.cs`, incluindo a primeira subida que falhou com manifesto nulo.
- [ ] T010 [P] [US1] Criar `RecursosLivres` (função pura: avisos do research R8) em `backend/Notas.Api/Services/Painel/RecursosLivres.cs`, com teste.
- [ ] T011 [US1] Criar o cliente das leituras do deployer em `backend/Notas.Api/Services/Painel/DeployerDoPainel.cs`.
- [ ] T012 [US1] Criar `GET /` e `GET /{id}/versoes` em `backend/Notas.Api/Endpoints/PainelPluginsEndpoints.cs`: fontes em paralelo, e fonte fora do ar vira `nao-conferida`. Teste em `backend/Notas.Api.Tests/PainelListaTests.cs` (sem GitHub, sem deployer, 10 s).
- [ ] T013 [US1] Criar a tela `/plugins` em `frontend/src/app/features/plugins/` (lista, etapas, recursos, avisos de token; Grafite, claro e escuro, celular), a rota em `frontend/src/app/app.routes.ts` e o card do administrador em `frontend/src/app/features/hub/hub.page.ts`.
- [ ] T014 [US1] Conferir que o Caddy (`caddy/`) entrega `/plugins` ao frontend e que nenhum plug-in pode ocupar a rota (`Reservadas` do `RegrasDoManifesto`).
- [ ] T015 [US1] [dono] Entrega 1: PR da US1, token de leitura e administradores no `.env`, cenários 1, 2 e 9 do `quickstart.md`.

**Checkpoint**: painel de leitura no ar; nada grava.

## Phase 4: User Story 2 - Pôr no ar (P2)

**Goal**: preparar o banco e abrir o PR. **Independent Test**: plug-in de teste no ar só pelo painel e um merge.

- [ ] T016 [P] [US2] Escrever os testes do preparo com Postgres real em `deployer/Notas.Deployer.Tests/PreparoDoBancoTests.cs` e o serviço Postgres no job `deployer-build` de `.github/workflows/ci.yml`: as quatro linhas da tabela do R3, interrupção em cada etapa, plug-in ativo sem arquivo, id reservado, dois pedidos juntos, outros papéis iguais (`pg_authid` e permissões) e senha ausente de logs, respostas e log do Postgres.
- [ ] T017 [US2] Criar `POST /plugins/{id}/preparo` em `deployer/Notas.Deployer/PreparoDoBanco.cs` e `Program.cs`, até o T016 passar.
- [ ] T018 [P] [US2] Criar `scripts/plugins-lock.py` (ligar, versao, desligar; comentários e finais de linha preservados) e `scripts/tests/test_plugins_lock.py`, rodado no job `scripts` de `.github/workflows/ci.yml`.
- [ ] T019 [US2] Criar `.github/workflows/plugins-lock.yml` conforme `contracts/workflow.md`, e o gatilho manual em `.github/workflows/ci.yml`.
- [ ] T020 [US2] Criar em `scripts/tests/test_plugins_lock.py` o teste que falha se surgir outro workflow com gatilho manual além de `ci.yml`, `pacotes.yml` e `plugins-lock.yml`.
- [ ] T021 [P] [US2] Criar a entidade em `backend/Notas.Api/Data/OperacaoDoPainel.cs` e em `AppDbContext.cs`, com as regras de `data-model.md`: `OperacaoDoPainel.Id`, `OperacaoDoPainel.PluginId` (e o índice único parcial), `OperacaoDoPainel.Acao`, `OperacaoDoPainel.Imagem`, `OperacaoDoPainel.Versao`, `OperacaoDoPainel.VersaoAntes`, `OperacaoDoPainel.AutorId`, `OperacaoDoPainel.Estado`, `OperacaoDoPainel.Etapas`, `OperacaoDoPainel.PrNumero`, `OperacaoDoPainel.ConcluidaEm`. Teste em `backend/Notas.Api.Tests/EsquemaNucleoTests.cs`, inclusive num banco que já existe.
- [ ] T022 [US2] Criar as transições (função pura) e o serviço em `backend/Notas.Api/Services/Painel/OperacoesDoPainel.cs`, com teste em `backend/Notas.Api.Tests/OperacoesDoPainelTests.cs`: cada estado, prazos, PR fechado, núcleo reiniciado no meio.
- [ ] T023 [US2] Criar `revisar` e a confirmação de uso único (`ConfirmacaoDoPainel` de `data-model.md`) em `backend/Notas.Api/Services/Painel/Confirmacoes.cs` e nos endpoints, com os códigos 409, 410, 422 e 503 do contrato.
- [ ] T024 [US2] Criar `executar`, `operacoes` e `operacoes/{op}` nos endpoints: preparo no deployer, disparo do workflow e leitura do PR. Teste em `backend/Notas.Api.Tests/PainelOperacoesTests.cs`, com duas abas juntas e nenhuma gravação quando a regra falha.
- [ ] T025 [US2] Pôr na tela `frontend/src/app/features/plugins/` a revisão, a confirmação, o acompanhamento (a cada 10 s) e o histórico, com testes do frontend. Avisar quando a ferramenta precisa de configuração própria.
- [ ] T026 [US2] Teste de vazamento (SC-004) em `backend/Notas.Api.Tests/PainelSegredosTests.cs`: tokens e senha fora de respostas, logs, histórico e entradas do workflow.
- [ ] T027 [US2] [dono] Entrega 2: PR da US2; ligar a opção do Actions; token de disparo; pôr no ar um plug-in de teste (cenários 3 a 6, 8, 10 e 11). Grava na VPS: só com confirmação.

**Checkpoint**: uma ferramenta nova vai ao ar sem comando na VPS.

## Phase 5: User Story 3 - Atualizar, voltar e desligar (P3)

**Goal**: as outras ações pelo mesmo caminho. **Independent Test**: trocar a versão, voltar e desligar o plug-in de teste, com os dados intactos.

- [ ] T028 [US3] Aceitar `atualizar`, `voltar`, `desligar` e `religar` em `OperacoesDoPainel.cs` e nos endpoints, com a segunda confirmação do congelado. Teste em `backend/Notas.Api.Tests/PainelOperacoesTests.cs`.
- [ ] T029 [P] [US3] Cobrir em `scripts/tests/test_plugins_lock.py` a troca com `versao_antes` diferente, desligar e religar, sempre com uma linha só.
- [ ] T030 [US3] Pôr na tela a escolha da versão e os botões das quatro ações em `frontend/src/app/features/plugins/`, com testes.
- [ ] T031 [US3] [dono] Entrega 3: PR da US3 e cenário 7, conferindo que tabelas, arquivos e conexão continuam.

## Phase 6: Polish

- [ ] T032 [P] Atualizar `README.md`, `DEPLOY.md` e `.claude/skills/plugin-hub/SKILL.md` (o painel como caminho normal, o manual como reserva).
- [ ] T033 [P] Atualizar `specs/README.md` e registrar os resultados e as ressalvas neste arquivo.
- [ ] T034 [dono] Recomendar a proteção da `main` e a limpeza do plug-in de teste; só fazer com confirmação.

## Dependencies

- Setup → Foundational → US1 → US2 → US3 → Polish.
- T017 depende de T007 e T016; T019 de T018; T022 de T021; T024 de T017, T019, T022 e T023; T025 de T024.
- T007 e T008 mudam o mesmo `Program.cs`: um de cada vez.

## Parallel Example

- US1: T007, T009 e T010 ao mesmo tempo.
- US2: T016, T018 e T021 ao mesmo tempo.

## Implementation Strategy

Três entregas, cada uma com PR próprio e parada para o dono. A entrega 1 (MVP) só lê, e já responde por que uma ferramenta não está disponível. As entregas 2 e 3 só começam com o "sim" do dono.

## Cobertura

| Requisito | Tarefas |
|---|---|
| FR-001, FR-002 | T007–T013 |
| FR-003, FR-013 | T004, T005 |
| FR-004 | T023, T025, T028 |
| FR-005, FR-006, FR-007 | T016, T017, T026 |
| FR-008, FR-014 | T006, T018–T020 |
| FR-009 | T003, T023, T024 |
| FR-010 | T008, T010, T023 |
| FR-011 | T028, T031 |
| FR-012 | T021, T022, T024 |
