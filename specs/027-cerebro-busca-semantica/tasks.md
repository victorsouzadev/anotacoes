# Tasks: Busca semântica

## Phase 2: Foundational

- [x] T001 `HybridRanker` (cosseno, RRF k=60) em `cerebro/src/Hub/Index/HybridRanker.cs` com testes em `cerebro/tests/Hub.Tests/HybridSearchTests.cs`
- [x] T002 Cliente `Embeddings` (`/v1/embeddings`, lotes de 100, retry) em `cerebro/src/Hub/Index/Embeddings.cs`, base e modelo configuráveis
- [x] T003 Tabela `chunk_vectors` e leitura/gravação em `cerebro/src/Hub/Index/NoteIndex.cs`
- [x] T004 Opção (padrão desligada) e estimativa de custo nos endpoints web

## Phase 3: User Story 2 - Indexar (P1)

- [x] T005 [US2] `VectorIndexWorker` (inicial + incremental por hash, a partir do `IndexWatcher`), progresso exposto
- [x] T006 [P] [US2] Teste: trecho sem mudança não é reenviado

## Phase 4: User Story 1 - Buscar (P1) 🎯 MVP

- [x] T007 [US1] `NoteIndex.Search` híbrido com fallback para FTS5
- [x] T008 [US1] Tela de busca e opção/progresso em `frontend/src/app/features/cerebro/`

## Phase 5: User Story 3 - Candidates (P2)

- [x] T009 [US3] `Candidates()` usando a busca híbrida

## Phase 6: User Story 4 - MCP (P2)

- [x] T010 [US4] Parâmetro `mode` em `search` de `cerebro/src/Hub/Mcp/VaultTools.cs` e nas `McpInstructions`

## Phase 7: Polish

- [x] T011 [P] `cerebro/README.md` (fase 4 pronta) e spec 011
- [x] T012 `dotnet test segundo-cerebro.slnx`; medir latência com 20 mil trechos sintéticos
