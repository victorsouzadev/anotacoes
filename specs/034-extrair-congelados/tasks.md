# Tasks: Extrair e congelar as ferramentas sem uso

## Phase 1: Setup

- [X] T001 Criar `hub-criativo` e `hub-treino` no GitHub a partir do `hub-modelo` (032). Criados em 21/11/2026, privados.
- [X] T002 Medir o tempo da CI do núcleo (linha de base para SC-003): `backend-build` 204 s, `desktop-build` 65 s, soma dos jobs ~590 s (run 44875380875).

## Phase 2: User Story 1 - Criativo no ar (P1) 🎯 MVP

- [X] T003 [US1] Mover `ImagemEndpoints`, `MoldesEndpoints`, `ViihMimosEndpoints`, `Services/Imagens`, `Services/Moldes`, `CriativoMcpTools` para `hub-criativo/src/Plugin` com o SDK; `AppDbContext` só com `imagem_*` e migração `Base` (modelo copiado do snapshot do núcleo). A IA e a chave própria de ampliação vêm do `/api/core/ia`; sites e backup do `criativo_resumo` vêm de `/api/core/criativo/resumo`.
- [X] T004 [US1] Mover telas `imagem`, `moldes`, `cake`, `precificacao` para `hub-criativo/web` (base `/criativo/`, com cópia de `shared/pdf.ts`, `shared/heic.ts` e das fontes) e os testes delas (356 no Angular, 80 no .NET). O `social-mcp-catalog.spec.ts` não foi: o catálogo do MCP `viih` fica fixo no núcleo (`mcp/src/viih/modelos.ts`).
- [ ] T005 [US1] Mover `desktop/` e trocar `NotasApp.Build` por `CriativoApp.Build`; workflow do instalador no `hub-criativo`. **Parcial**: o `desktop/` e o `desktop.yml` foram para o hub-criativo e compilam contra o núcleo no commit fixo `NUCLEO_REF` (o último com o código do Editor), sem reescrita. Falta a troca para o app do plug-in, que exige login local, banco próprio e a tela do criativo dentro do programa, e cadastrar `VPS_HOST`, `VPS_USER` e `VPS_SSH_KEY` no hub-criativo.
- [ ] T006 [US1] `plugin.json` com rotas legadas; ensaio com cópia de produção. `plugin.json` pronto. Ensaio local feito: núcleo criou o `notas.db` pelas migrações reais, os dois plug-ins subiram contra ele, a `Base` conferiu, o esquema só ganhou `__EFMigrationsHistory_criativo` e `__EFMigrationsHistory_treino` e o `integrity_check` deu ok. Falta o ensaio com a cópia de produção na VPS (precisa de confirmação).

## Phase 3: User Story 1 - Treino no ar (P1)

- [X] T007 [US1] Mover `TreinoEndpoints`, `TreinoMcpTools`, tela `treino` e testes para `hub-treino`; `BancoDoTreino` com `treino_*` e base; rotas legadas (`/api/treino`, `/api/mcp/treino`). O app Android segue com o token do hub.

## Phase 4: User Story 2 - Núcleo menor (P1)

- [X] T008 [US2] Remover do núcleo endpoints, services, MCP tools e entidades (migração `ExtracaoCongelados`, vazia, sem `DropTable`), telas e rotas, `desktop/`, `desktop.yml`, jobs da CI. Na branch `feat/034-remover-do-nucleo`: só vai para a main depois dos dois plug-ins no ar (DEPLOY.md, "Plug-ins congelados").
- [X] T009 [US2] Marcar os dois como `congelado` no manifesto (campo novo no schema, no SDK 1.2.0, no deployer e em Configurações → Servidor). As linhas do `plugins.lock` entram depois que as imagens forem publicadas.

## Phase 5: Polish

- [X] T010 [P] Atualizar specs 006–009, 013, 017, README e `DEPLOY.md`
- [X] T011 Medir a CI de novo (SC-003): `backend-build` 149 s (−27%), sem `desktop-build`, soma dos jobs ~377 s (run 44875783380).
