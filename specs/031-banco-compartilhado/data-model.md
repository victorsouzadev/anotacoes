# Data Model: Banco compartilhado entre núcleo e plug-ins

## Donos das tabelas do `notas.db` (estado em 2026-11-19)

| Dono | Prefixo / tabelas | Histórico de migração |
|---|---|---|
| núcleo | `users`, `refresh_tokens`, `configuracoes_ia`, `core_*` | `__EFMigrationsHistory` |
| núcleo (Publicar) | `sites`, `sites_*` | `__EFMigrationsHistory` |
| cerebro | `cerebro_*` (vindas do `hub.db` — 033) | `__EFMigrationsHistory_cerebro` |
| dieta | `dieta_*` | `__EFMigrationsHistory_dieta` |
| tarefas | `tasks_*` | `__EFMigrationsHistory_tarefas` |
| anotacao | nenhuma hoje (arquivos em `data/anotacao`, declarados em `dados`); prefixo reservado `anotacao_` | `__EFMigrationsHistory_anotacao` |
| financas | `financas_*`, `configuracoes_auvp` | `__EFMigrationsHistory_financas` |
| notas | `notes`, `folders`, `note_shares` | `__EFMigrationsHistory_notas` |
| criativo | `imagem_*` (Moldes, Bolo 3D e Precificação não têm tabela hoje; a Precificação grava no banco do painel Viih Mimos); prefixos reservados `moldes_`, `precificacao_` | `__EFMigrationsHistory_criativo` |
| treino | `treino_*` | `__EFMigrationsHistory_treino` |

A tabela de donos é calculada pelo deployer a partir dos manifestos (029) e de `DonosDeTabela.cs` (núcleo); não é gravada no banco.

## Cópias pré-migração

`data/db/pre-migracao/<id>-<versao>-<aaaammddhhmm>.db`, feitas com `sqlite3 .backup`, as 5 mais recentes no total.
