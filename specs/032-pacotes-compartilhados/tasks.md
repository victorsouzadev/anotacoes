# Tasks: Pacotes compartilhados dos plug-ins

## Phase 1: Setup

- [ ] T001 Estrutura `pacotes/` (SDK, testes, `grafite-ui`, schema) e jobs na `.github/workflows/ci.yml`
- [ ] T002 `.github/workflows/pacotes.yml` publicando no GitHub Packages quando a versão muda

## Phase 2: Foundational

- [ ] T003 `plugin.schema.json` (contrato 1) e teste contra manifestos válidos e inválidos
- [ ] T004 [P] `@grafite/ui`: extrair tokens, fontes e ícones do `frontend/src/styles.css` e `shared/icon.ts`; o hub passa a importar do pacote

## Phase 3: User Story 1 - Plug-in novo em minutos (P1) 🎯 MVP

- [ ] T005 [US1] SDK `Auth` + `Servico` + `Health` (depende de 030), com testes
- [ ] T006 [US1] SDK `Dados` (depende de 031), com testes
- [ ] T007 [US1] SDK `Mcp`, `Ia`, `Segredos`, com testes
- [ ] T008 [US1] Repositório template `hub-modelo` (criado pelo usuário no GitHub): Dockerfile, `plugin.json`, CI usando `plugin.yml`, teste de tabelas, tela mínima com `<grafite-barra>`

## Phase 4: User Story 2 - Mesmo visual (P1)

- [ ] T009 [US2] `<grafite-barra>` (lista de plug-ins, conta, tema) e `token-plugin.js`, com testes Vitest
- [ ] T010 [US2] Hub usa a mesma barra para ficar idêntico aos plug-ins

## Phase 5: User Story 3 - Contrato com versões (P2)

- [ ] T011 [US3] Deployer aceita contrato N e N-1 e recusa o resto, com testes

## Phase 6: Polish

- [ ] T012 [P] `pacotes/README.md` (como criar um plug-in), skill `aplicar-grafite` cita o `@grafite/ui`
- [ ] T013 CI inteira verde
