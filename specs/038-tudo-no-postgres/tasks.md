# Tasks: Núcleo e plug-ins no Postgres

## Fase 1: SDK
- [x] T001 `Esquema.Garantir` em `pacotes/Hub.Plugin.Sdk`, para SQLite e Postgres, com os testes de `EsquemaNucleoTests` nos dois
- [x] T002 Escolha do provedor pelo `ConnectionStrings:Db` (`Host=` liga o Npgsql) e publicação de uma versão nova do SDK

## Fase 2: Núcleo
- [ ] T003 Núcleo com Npgsql e `Esquema.Garantir` do SDK; `EsquemaNucleo` sai
- [ ] T004 Testes do backend contra Postgres na CI (serviço `postgres:17-alpine`), também em modo invariante
- [ ] T005 Busca sem diferenciar maiúsculas e minúsculas e datas em UTC revisadas no núcleo

## Fase 3: Plug-ins (um PR por repositório)
- [ ] T006 hub-notas
- [ ] T007 hub-financas
- [ ] T008 hub-tarefas
- [ ] T009 hub-dieta
- [ ] T010 hub-treino
- [ ] T011 hub-criativo
- [ ] T012 hub-cerebro

## Fase 4: Cópia
- [ ] T013 `ferramentas/CopiaParaPostgres` com conversão de tipos e conferência de contagens
- [ ] T014 Ensaio com uma cópia do `notas.db` de produção num Postgres local (a cópia não sai da máquina)

## Fase 5: Backup
- [ ] T015 `pg_dump` do banco `hub` em `scripts/backup.sh` e na cópia externa (036)

## Fase 6: Janela na VPS (precisa de confirmação)
- [ ] T016 Criar o banco `hub`, os schemas e os papéis, e gravar as senhas nos `.env`
- [ ] T017 Parar o hub, copiar, conferir, trocar as conexões e subir; se a conferência falhar, voltar para o SQLite
- [ ] T018 Conferir cada ferramenta e as permissões entre papéis

## Fase 7: Limpeza
- [ ] T019 Tirar o SQLite do código do núcleo, do SDK e dos plug-ins
- [ ] T020 Documentação: README, DEPLOY, constituição, specs 031 e 037
