# Tasks: Núcleo e plug-ins no Postgres

## Fase 1: SDK
- [x] T001 `Esquema.Garantir` em `pacotes/Hub.Plugin.Sdk`, para SQLite e Postgres, com os testes de `EsquemaNucleoTests` nos dois
- [x] T002 Escolha do provedor pelo `ConnectionStrings:Db` (`Host=` liga o Npgsql) e publicação de uma versão nova do SDK

## Fase 2: Núcleo
- [x] T003 Núcleo com Npgsql e `Esquema.Garantir` do SDK; `EsquemaNucleo` sai
- [x] T004 Testes do backend contra Postgres na CI (serviço `postgres:17-alpine`), também em modo invariante. A `SitesTests` (Publicar) tem fábrica própria e segue no SQLite; vai para o Postgres na T019
- [x] T005 Busca sem diferenciar maiúsculas e minúsculas e datas em UTC revisadas no núcleo: e-mail com colação ICU `ci` no Postgres; selos de `refresh_tokens` e `core_oauth_tokens` aceitam a data em microssegundos; SQL cru da recifragem com colunas entre aspas

## Fase 3: Plug-ins (um PR por repositório)
- [x] T006 hub-notas (SDK 1.5.1 e `Esquema.Garantir`)
- [x] T007 hub-financas (SDK 1.5.1 e `Esquema.Garantir`)
- [x] T008 hub-tarefas (SDK 1.5.1 e `Esquema.Garantir`)
- [x] T009 hub-dieta (SDK 1.5.1 e `Esquema.Garantir`)
- [x] T010 hub-treino (SDK 1.5.1 e `Esquema.Garantir`)
- [x] T011 hub-criativo (SDK 1.5.1 e `Esquema.Garantir`)
- [x] T012 hub-cerebro (o `HubDb` aceita `HUB_BANCO` no formato Postgres; a migração 033 só roda no SQLite)

## Fase 4: Cópia
- [x] T013 `ferramentas/CopiaParaPostgres` com conversão de tipos e conferência de contagens. Papéis e permissões em `scripts/postgres-hub.sh`
- [x] T014 Ensaio com uma cópia do `notas.db` de produção (backup de 22/11) num Postgres local; a cópia foi apagada no fim. Núcleo e plug-ins criaram os schemas, a cópia conferiu 52 tabelas em cerca de 1 s, e somas e contagens de 415 colunas bateram com o SQLite (só `core_plugins_estado` mudou, reescrita pelo núcleo do ensaio). As permissões entre papéis recusaram o que deviam

## Fase 5: Backup
- [x] T015 `pg_dump` do banco `hub` em `scripts/backup.sh` e na cópia externa (036, que já leva a pasta de backups inteira)

## Fase 6: Janela na VPS (precisa de confirmação)
- [ ] T016 Criar o banco `hub`, os schemas e os papéis, e gravar as senhas nos `.env`. O papel do núcleo precisa de `SELECT` em `financas.configuracoes_auvp` e de `financas` no `search_path` (recifragem)
- [ ] T017 Parar o hub, copiar, conferir, trocar as conexões e subir; se a conferência falhar, voltar para o SQLite
- [ ] T018 Conferir cada ferramenta e as permissões entre papéis

## Fase 7: Limpeza
- [ ] T019 Tirar o SQLite do código do núcleo, do SDK e dos plug-ins
- [ ] T020 Documentação: README, DEPLOY, constituição, specs 031 e 037
