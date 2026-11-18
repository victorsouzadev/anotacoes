# Tasks: Texto de PDFs e imagens

## Phase 2: Foundational

- [ ] T001 Opção `LerAnexos` (padrão false) em `cerebro/src/Hub/Pipeline/AiSettings.cs` e endpoints GET/PUT em `cerebro/src/Hub/Api/WebEndpoints.cs`
- [ ] T002 `AttachmentReader` em `cerebro/src/Hub/Pipeline/AttachmentReader.cs`: tipos aceitos, limites (10 MB, 20 páginas), pedido Anthropic (image/document) e OpenRouter (image_url/file), leitura da resposta
- [ ] T003 [P] Testes em `cerebro/tests/Hub.Tests/AttachmentReaderTests.cs`

## Phase 3: User Story 1 - Imagens (P1) 🎯 MVP

- [ ] T004 [US1] Chamar `AttachmentReader` em `ProcessingWorker.ProcessAsync` (após transcrição, antes da classificação), idempotente por `## Texto extraído`, com `hub_note` quando desligado
- [ ] T005 [US1] Chave e aviso de custo na tela de Configurações do Cérebro (`frontend/src/app/features/cerebro/`)

## Phase 4: User Story 2 - PDF (P1)

- [ ] T006 [US2] Contagem de páginas do PDF (leitura de `/Type /Page` no arquivo, sem dependência) e marcadores "— página n —"; testes

## Phase 5: User Story 3 - Reprocessar (P3)

- [ ] T007 [US3] `POST /api/v1/web/inbox/{id}/ler-anexo` e botão na Inbox

## Phase 6: Polish

- [ ] T008 [P] `cerebro/README.md` (tabela da PoC: OCR → pronto) e spec 011
- [ ] T009 `dotnet test segundo-cerebro.slnx`
