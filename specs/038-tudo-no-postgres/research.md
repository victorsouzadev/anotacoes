# Research: Núcleo e plug-ins no Postgres

## Quem usa o notas.db hoje (VPS, 21/11/2026, só leitura)

Núcleo e sete plug-ins: `cerebro`, `treino`, `criativo`, `dieta`, `tarefas`, `financas`, `notas`. O `anotacao` não monta `data/db`.
São 60 tabelas, incluindo os históricos de migração `__EFMigrationsHistory_<id>`, que não vão para o Postgres.

## Decisão 1: schema por search_path, sem mudar os modelos

- Cada papel (`notas`, `financas`...) é dono do schema de mesmo nome e tem `ALTER ROLE <id> SET search_path = <id>, nucleo`.
- Os modelos do EF continuam sem nome de schema: as tabelas vão para o schema do papel, e a chave estrangeira para `users` resolve em `nucleo.users`.
- O papel do plug-in recebe só `USAGE` no schema `nucleo` e `REFERENCES` em `nucleo.users`. Ler ou gravar `users` é recusado.
- Alternativa descartada: `HasDefaultSchema` em cada modelo. Exige mudar todos os modelos e não isola mais que o papel.

## Decisão 2: esquema gerado pelo modelo, como na spec 037

- As migrações dos plug-ins foram geradas para SQLite (tipos `TEXT`/`INTEGER`) e não servem no Postgres.
- O código de `EsquemaNucleo` passa para o SDK (`Hub.Plugin.Sdk`) como `Esquema.Garantir`, nos dois provedores: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` e `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Núcleo e plug-ins usam o mesmo código. As migrações e o `MigrarComBase` saem dos plug-ins.

## Decisão 3: cópia com ferramenta própria

- `ferramentas/CopiaParaPostgres` (console .NET, neste repositório): para cada tabela do `notas.db`, lê as linhas e grava no schema do dono, no Postgres onde núcleo e plug-ins já criaram o esquema.
- Conversões: datas em texto para `timestamp with time zone` (UTC), `REAL`/`TEXT` para `numeric`, `INTEGER` 0/1 para `boolean`, conforme o tipo da coluna de destino.
- Confere a contagem de linhas de cada tabela e para no primeiro erro, sem deixar o hub apontando para o Postgres.
- Alternativa descartada: `pgloader`. Não conhece os tipos que o EF espera e exige baixar outra imagem.

## Decisão 4: diferenças de comportamento

- `COLLATE NOCASE` e `upper()` do SQLite: no Postgres, `ILIKE` ou `citext` onde a busca depende disso (Notas, Finanças).
- O `DateTime` do Npgsql exige `Kind = Utc`: ligar `Npgsql.EnableLegacyTimestampBehavior` só se algum plug-in gravar hora local; preferir converter para UTC.
- `busy_timeout`/WAL saem; entra o pool de conexões do Npgsql.

## Decisão 5: CI

- Cada workflow ganha um serviço `postgres:17-alpine`. Os testes criam um banco por execução.
