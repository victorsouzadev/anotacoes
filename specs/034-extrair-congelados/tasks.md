# Tasks: Extrair e congelar as ferramentas sem uso

## Phase 1: Setup

- [X] T001 Criar `hub-criativo` e `hub-treino` no GitHub a partir do `hub-modelo` (032). Criados em 21/11/2026, privados.
- [X] T002 Medir o tempo da CI do núcleo (linha de base para SC-003): `backend-build` 204 s, `desktop-build` 65 s, soma dos jobs ~590 s (run 44875380875).

## Phase 2: User Story 1 - Criativo no ar (P1) 🎯 MVP

- [X] T003 [US1] Mover `ImagemEndpoints`, `MoldesEndpoints`, `ViihMimosEndpoints`, `Services/Imagens`, `Services/Moldes`, `CriativoMcpTools` para `hub-criativo/src/Plugin` com o SDK; `AppDbContext` só com `imagem_*` e migração `Base` (modelo copiado do snapshot do núcleo). A IA e a chave própria de ampliação vêm do `/api/core/ia`; sites e backup do `criativo_resumo` vêm de `/api/core/criativo/resumo`.
- [X] T004 [US1] Mover telas `imagem`, `moldes`, `cake`, `precificacao` para `hub-criativo/web` (base `/criativo/`, com cópia de `shared/pdf.ts`, `shared/heic.ts` e das fontes) e os testes delas (356 no Angular, 80 no .NET). O `social-mcp-catalog.spec.ts` não foi: o catálogo do MCP `viih` fica fixo no núcleo (`mcp/src/viih/modelos.ts`).
- [X] T005 [US1] Mover `desktop/` e trocar `NotasApp.Build` por `CriativoApp.Build`; workflow do instalador no `hub-criativo`. O programa hospeda o próprio plug-in (`CriativoApp.Build` em modo desktop): banco próprio (o `editor.db` de antes, com o mesmo usuário local), login `POST /api/auth/local` com a chave da janela e token ES256 de chave que muda a cada abertura, sem MCP, textos de IA no modo heurístico; a tela é a do `web/` e os workflows não baixam mais o núcleo. Os segredos `VPS_HOST`, `VPS_USER` e `VPS_SSH_KEY` do hub-criativo ficam com o dono do repositório (só o envio do instalador para a VPS depende deles).
- [X] T006 [US1] `plugin.json` com rotas legadas; ensaio com cópia de produção. Ensaio local: o núcleo criou o `notas.db` pelas migrações reais, os dois plug-ins subiram contra ele, a `Base` conferiu, o esquema só ganhou `__EFMigrationsHistory_criativo` e `__EFMigrationsHistory_treino` e o `integrity_check` deu ok. Em produção (21/11/2026) a `Base` dos dois conferiu com o `notas.db` real na primeira subida e o `quick_check` deu ok, o que substitui o ensaio com a cópia.

## Phase 3: User Story 1 - Treino no ar (P1)

- [X] T007 [US1] Mover `TreinoEndpoints`, `TreinoMcpTools`, tela `treino` e testes para `hub-treino`; `BancoDoTreino` com `treino_*` e base; rotas legadas (`/api/treino`, `/api/mcp/treino`). O app Android segue com o token do hub.

## Phase 4: User Story 2 - Núcleo menor (P1)

- [X] T008 [US2] Remover do núcleo endpoints, services, MCP tools e entidades (migração `ExtracaoCongelados`, vazia, sem `DropTable`), telas e rotas, `desktop/`, `desktop.yml`, jobs da CI. Na branch `feat/034-remover-do-nucleo`: só vai para a main depois dos dois plug-ins no ar (DEPLOY.md, "Plug-ins congelados").
- [X] T009 [US2] Marcar os dois como `congelado` no manifesto (campo novo no schema, no SDK 1.2.0, no deployer e em Configurações → Servidor). As linhas do `plugins.lock` entraram no PR #88 (`treino@9f50297`, `criativo@a33ca6c`, `cerebro@48cf58b`); telas, redirecionamentos, APIs e MCPs nas URLs antigas conferidos na VPS em 21/11/2026, servidos pelos plug-ins.

## Phase 5: Polish

- [X] T010 [P] Atualizar specs 006–009, 013, 017, README e `DEPLOY.md`
- [X] T011 Medir a CI de novo (SC-003): `backend-build` 149 s (−27%), sem `desktop-build`, soma dos jobs ~377 s (run 44875783380).
