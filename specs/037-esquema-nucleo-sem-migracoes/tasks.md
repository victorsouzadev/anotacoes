# Tasks: Esquema do núcleo sem migrações

- [x] T001 Criar `EsquemaNucleo.Garantir` em `backend/Notas.Api/Data/EsquemaNucleo.cs`
- [x] T002 Trocar `Migrate()` por `EsquemaNucleo.Garantir` em `backend/Notas.Api/NotasApp.cs`
- [x] T003 Apagar `backend/Notas.Api/Data/Migrations/`
- [x] T004 Testes: banco vazio, subida repetida, coluna nova em tabela existente, tabela de plug-in intocada (`EsquemaNucleoTests.cs`)
- [x] T005 Conferir o esquema gerado contra uma cópia do banco de produção (só leitura na VPS): em 21/11/2026, as 14 tabelas e os 12 índices batem; só muda a ordem de algumas colunas
- [x] T006 Documentação: README, DEPLOY, constituição e SC-004 da 035
- [ ] T007 Abrir o PR com a CI inteira verde
- [ ] T008 (fora deste PR) Plug-ins criam as próprias tabelas também dentro do hub
- [ ] T009 (precisa de confirmação) Deploy com backup antes
