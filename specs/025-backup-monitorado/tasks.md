# Tasks: Backup monitorado

## Phase 2: Foundational

- [ ] T001 No fim de `scripts/backup.sh`, montar o JSON com os arquivos desta execução e gravar em `data/db/backup-status.json` via temporário + `mv`
- [ ] T002 `BackupStatus` (lê, valida, calcula idade e atraso) em `backend/Notas.Api/Services/Sistema/BackupStatus.cs`, caminho por configuração (`Sistema__BackupStatus`, padrão `/data/db/backup-status.json`)
- [ ] T003 [P] Testes em `backend/Notas.Api.Tests/BackupStatusTests.cs`

## Phase 3: User Story 1 - Alerta (P1) 🎯 MVP

- [ ] T004 [US1] `GET /api/sistema/backup` só para `PUBLICADORES` em `backend/Notas.Api/Endpoints/SistemaEndpoints.cs`, mapeado em `NotasApp.cs`; teste de 403
- [ ] T005 [US1] Faixa de alerta no topo de `frontend/src/app/features/hub/hub.page.ts` para publicadores

## Phase 4: User Story 2 - Detalhe e Cérebro (P2)

- [ ] T006 [US2] Seção "Servidor" em `frontend/src/app/features/configuracoes/configuracoes.page.*`
- [ ] T007 [US2] Linha de backup no `criativo_resumo` em `backend/Notas.Api/Mcp/CriativoMcpTools.cs`

## Phase 5: Polish

- [ ] T008 [P] DEPLOY.md (conferir cron e estado) e README (Roadmap: tirar o item; tirar também "HTTPS", que já existe)
- [ ] T009 `dotnet test` (também invariant) e `npx ng test`/`ng build`
