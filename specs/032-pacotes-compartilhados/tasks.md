# Tasks: Pacotes compartilhados dos plug-ins

## Phase 1: Setup

- [x] T001 Estrutura `pacotes/` (SDK, testes, `grafite-ui`, schema) e jobs na `.github/workflows/ci.yml`
- [x] T002 `.github/workflows/pacotes.yml` publicando no GitHub Packages quando a versão muda

## Phase 2: Foundational

- [x] T003 `plugin.schema.json` (contrato 1) e teste contra manifestos válidos e inválidos
- [x] T004 [P] `@grafite/ui`: extrair tokens, fontes e ícones do `frontend/src/styles.css` e `shared/icon.ts`; o hub passa a importar do pacote

## Phase 3: User Story 1 - Plug-in novo em minutos (P1) 🎯 MVP

- [x] T005 [US1] SDK `Auth` + `Servico` + `Health` (depende de 030), com testes
- [x] T006 [US1] SDK `Dados` (depende de 031), com testes
- [x] T007 [US1] SDK `Mcp`, `Ia`, `Segredos`, com testes
- [x] T008 [US1] Repositório template `hub-modelo` (criado pelo usuário no GitHub): Dockerfile, `plugin.json`, CI usando `plugin.yml`, teste de tabelas, tela mínima com `<grafite-barra>`

## Phase 4: User Story 2 - Mesmo visual (P1)

- [x] T009 [US2] `<grafite-barra>` (lista de plug-ins, conta, tema) e `token-plugin.js`, com testes Vitest
- [x] T010 [US2] Hub usa a mesma barra para ficar idêntico aos plug-ins

## Phase 5: User Story 3 - Contrato com versões (P2)

- [x] T011 [US3] Deployer aceita contrato N e N-1 e recusa o resto, com testes

## Phase 6: Polish

- [x] T012 [P] `pacotes/README.md` (como criar um plug-in), skill `aplicar-grafite` cita o `@grafite/ui`
- [ ] T013 CI inteira verde
