# Tasks: Cópia do backup fora da VPS

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

Tarefas marcadas com 🔐 dependem do Victor (conta, senha) ou gravam na VPS: só com confirmação.

## Phase 1: Setup

- [x] T001 🔐 Victor roda `rclone authorize "drive" --drive-scope drive.file` no PC e guarda a senha da cópia no gerenciador de senhas (quickstart, "Preparar")

## Phase 2: Foundational (corrige a causa do incidente)

- [x] T002 Limpeza de `scripts/backup.sh` só para `notas-*`, `site-*` e `pg-*` (`find "$BACKUPS" -maxdepth 1 -type f \( -name 'notas-*' -o -name 'site-*' -o -name 'pg-*' \) -mtime +14 -delete`)
- [x] T003 [P] Teste `scripts/tests/backup.test.sh` (limpeza, estado e configuração): cria arquivos antigos dos padrões e de fora deles numa pasta temporária e confere que só os do script somem
- [x] T004 [P] `deploy.yml`: acrescentar `scripts` ao `tar` e ao `rm -rf`, e depois de extrair `chown root:root scripts/*.sh && chmod 755 scripts/*.sh`; instalar `scripts/logrotate-notas-backup` em `/etc/logrotate.d/notas-backup`
- [x] T005 [P] `scripts/logrotate-notas-backup` (semanal, 8 rotações, `compress`, `missingok`)
- [x] T006 `ci.yml`: job `scripts` com `shellcheck scripts/*.sh` e `sh scripts/tests/backup-limpeza.test.sh`

## Phase 3: User Story 1 - Cópia externa (P1) 🎯 MVP

- [x] T007 [US1] `scripts/backup-comum.sh`: carrega `/root/.config/notas-backup.env` (falha clara se ausente), `flock` em `/run/notas-backup.lock`, função de gravar a parte `copia`/`conferencia` de `data/db/backup-externo.json` por temporário + `mv`
- [x] T008 [US1] `scripts/backup-externo.sh`: `restic backup` com os caminhos e exclusões do data-model, tag `notas-vps`; `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`; grava `copia` com sucesso ou erro sem segredos
- [x] T009 [US1] `scripts/backup.sh` chama `backup-externo.sh` só depois de gravar `backup-status.json` (já garantido pelo `set -e`); falha da cópia externa não desfaz o backup local
- [x] T010 🔐 [US1] Na VPS: `apt install restic rclone`, criar `/root/.config/rclone/rclone.conf` com o token e `/root/.config/notas-backup.env`, `restic init`, rodar uma vez e conferir o instantâneo (quickstart, "Configurar")

## Phase 4: User Story 2 - Estado e conferência (P1)

- [x] T011 [US2] `scripts/backup-conferir.sh`: `restic check --read-data-subset=10%`, restaura o `notas-*.db` mais recente em `mktemp -d`, `PRAGMA integrity_check` = `ok`, apaga a pasta, grava `conferencia`
- [x] T012 [US2] `BackupStatus`: ler `backup-externo.json` (`Sistema__BackupExterno`, padrão `/data/db/backup-externo.json`), calcular `externo` e `conferencia` conforme o contrato; `Linha` com as duas idades
- [x] T013 [P] [US2] Testes em `backend/Notas.Api.Tests/BackupStatusTests.cs`: externo ausente, inválido, recente, atrasado, falha recente com último sucesso em dia; conferência ok, com erro, velha; formato da 025 intacto; a resposta nunca traz campos além do contrato (FR-012)
- [x] T014 [US2] `GET /api/sistema/backup` devolve `externo` e `conferencia` (teste de integração, inclusive 403 para usuário comum)
- [x] T015 [US2] `sistema.service.ts` e faixa do `hub.page.ts`: alerta para qualquer das três partes atrasada
- [x] T016 [US2] Seção "Servidor" em `/configuracoes`: três datas, última falha e comandos de conferência
- [x] T017 [US2] `criativo_resumo` com a linha nova (`CriativoMcpTools.cs`)
- [x] T018 🔐 [US2] Na VPS: cron de domingo 05:00 do `backup-conferir.sh` e uma execução manual

## Phase 5: User Story 3 - Deploy e log (P2)

- [x] T019 🔐 [US3] Depois do primeiro deploy com T004: conferir permissões de `scripts/`, o logrotate instalado e o crontab com `>> /var/log/notas-backup.log 2>&1`

## Phase 6: Polish

- [x] T020 [P] DEPLOY.md: preparar provedor, configurar, cron (as duas linhas), conferir estado, restauração completa (sites e `pg_restore` incluídos), onde está a senha, data do último ensaio
- [x] T021 [P] `Sistema__BackupExterno` no `docker-compose.yml` (o `.env.example` não tem as variáveis `Sistema__`) e README (Roadmap/Confiabilidade)
- [x] T022 `dotnet test` (também com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`), `npx ng test`, `ng build`, CI inteira verde
- [x] T023 🔐 Ensaio de restauração completa numa máquina que não é a VPS, cronometrado (quickstart); registrar no DEPLOY.md

## Dependências

- T002–T006 antes de tudo (o deploy precisa levar os scripts para o resto chegar à VPS).
- T007 → T008 → T009 → T010; T011 depende de T007 e T010.
- T012 → T013/T014 → T015–T017.
- T023 por último; a spec só é dada como concluída depois dele (FR-011).

## Notas da implementação (2026-11-20)

- O estado é gravado com `jq` (já instalado na VPS), em `scripts/backup-comum.sh`, junto com a limpeza, a trava e a configuração; os três scripts carregam esse arquivo.
- O instantâneo leva a pasta `backups/` inteira (não só `notas-*`, `site-*`, `pg-*`): a deduplicação do restic deixa o custo igual e nada de outro dono se perde.
- `.gitattributes` passa a fixar LF nos `.sh`: o `deploy.py` empacota a cópia local do Windows, e um `#!/bin/sh` com CRLF não roda.
- O `rm -rf scripts` do deploy apaga o `scripts/backup.sh.antigo-20261120` deixado na VPS na correção manual.
- Destino trocado para o Google Drive em 2026-11-20 (pedido do Victor, sem conta nova). Os scripts não mudam: o `restic` fala com o Drive pelo `rclone` a partir do `RESTIC_REPOSITORY`.
- 2026-11-20: Drive autorizado (escopo `drive.file`), repositório `9df59296f8` criado, primeira cópia `19e6ccf6` (18 MB) e conferência ok. O `restic init` falhou uma vez com `RATE_LIMIT_EXCEEDED` (cliente OAuth compartilhado do rclone); se repetir, criar um cliente OAuth próprio.
- T023 (2026-11-20): restauração no PC em 2 min; API de pé com o banco e o `.env` restaurados. Ficaram para o próximo ensaio o login pelo navegador, o `pg_restore` dos sites e o Caddy (ver DEPLOY.md).
- O rclone avisa que o cliente OAuth compartilhado do Google Drive será desativado em 2026: criar um cliente próprio (<https://rclone.org/drive/#making-your-own-client-id>) na VPS antes disso.
- T019: os scripts vieram `755 root:root`, mas a pasta `scripts/` ficou com dono `deploy` (o tar preserva o dono do CI); o deploy passou a fazer `chown -R root:root scripts`.
