# Tasks: Banco compartilhado entre núcleo e plug-ins

## Phase 2: Foundational

- [x] T001 `DonosDeTabela.cs` no núcleo (core, Publicar) e regra de prefixos sem sobreposição no deployer, com testes
- [x] T002 [P] `UsarBancoDoHub(id)`, `ReferenciarUsuarios()` e `TabelasDoPlugin.Conferir` em `pacotes/Hub.Plugin.Sdk/Dados/` (032), com testes
- [x] T003 [P] Teste no núcleo: nenhuma migração com `DropTable` de tabela fora de `core`/Publicar

## Phase 3: User Story 1 - Extrair sem migrar dados (P1) 🎯 MVP

- [x] T004 [US1] Gerador de migração de base (`Up` vazio) e conferência modelo × banco antes de registrar, no SDK
- [x] T005 [US1] Receita de extração em `DEPLOY.md`: tirar entidades do `AppDbContext` com migração vazia, base no plug-in, ordem de deploy
- [ ] T006 [US1] Ensaio com o plug-in de exemplo sobre uma cópia do banco de produção

## Phase 4: User Story 3 - Migração ruim não perde dado (P1)

- [x] T007 [US3] Deployer: cópia `sqlite3 .backup` antes de migração nova, retenção de 5
- [x] T008 [US3] Deployer: `sqlite_master` antes/depois; reverter e restaurar se tabela de outro dono mudou; testes

## Phase 5: User Story 2 - Backup único (P1)

- [x] T009 [US2] Conferir `scripts/backup.sh` com plug-ins gravando; documentar que cobre todos

## Phase 6: User Story 4 - Concorrência (P2)

- [x] T010 [US4] `scripts/carga-sqlite.sh` (3 processos) e contador de `SQLITE_BUSY` no log do SDK

## Phase 7: Polish

- [x] T011 [P] `SEGREDO_PLUGIN` no SDK (AES-GCM) e em `.env.example`
- [x] T012 [P] Constituição v2.0.0 já cita a 031; README "Estrutura do projeto"
- [ ] T013 CI inteira verde
