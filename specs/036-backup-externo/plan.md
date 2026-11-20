# Implementation Plan: Cópia do backup fora da VPS

**Branch**: sem branch própria | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

## Summary

No fim de uma execução sem erro do `scripts/backup.sh`, um script novo envia com `restic` um instantâneo cifrado e deduplicado para um bucket S3 compatível de outro provedor, aplica a retenção e grava `data/db/backup-externo.json`. Um segundo script confere a cópia toda semana restaurando o `notas.db`. O `Notas.Api` lê o arquivo novo ao lado do da 025 e o hub alerta. O deploy passa a levar `scripts/`, e a limpeza local deixa de apagar o que não é do script.

## Technical Context

**Language/Version**: Shell POSIX (`sh`), C# .NET 9 (`Notas.Api`), Angular 21
**Primary Dependencies**: `restic` (apt, no host da VPS), `sqlite3` (já instalado), `flock` (util-linux)
**Storage**: bucket S3 compatível (externo); `data/db/backup-externo.json` (estado)
**Testing**: xUnit (`BackupStatusTests` ganha casos do externo e da conferência); teste de shell `scripts/tests/backup-limpeza.test.sh` (limpeza só apaga os padrões do script) e `shellcheck` no CI
**Target Platform**: host da VPS (cron do root), fora de containers
**Project Type**: ops + web
**Performance Goals**: cópia diária < 2 min com os dados atuais
**Constraints**: nenhum temporário grande em disco (77% usado); nenhum segredo em repositório, log, estado ou API; nada novo em containers
**Scale/Scope**: ~180 MB hoje; crescimento com os plug-ins (029–035) no mesmo `notas.db`

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Um hub, um login, um banco | ✅ Nenhum serviço novo; cobre o banco único e os dados de plug-ins em `data/` sem mudança por plug-in. |
| II. Dados do usuário são sagrados | ✅ É o objetivo. Segredos em `/root/.config/notas-backup.env` (600), cifragem na origem, `.env` só dentro do instantâneo cifrado. |
| III. Local-first | N/A |
| IV. IA | N/A |
| V. Lógica pura com testes | ✅ Leitura do estado em `BackupStatus` (puro, testado); teste de shell da limpeza; bug do incidente vira teste (limpeza e permissão no deploy). |
| VI. Grafite | ✅ Faixa reaproveita o estilo `atencao` da 025. |
| VII. pt-BR | ✅ |
| VIII. Simplicidade | ⚠️ Dependência nova no host (`restic`). Justificada abaixo. |

Re-check após o design: sem novas violações.

## Project Structure

```text
scripts/backup.sh                          # limpeza só dos padrões do script; chama backup-externo.sh no fim
scripts/backup-externo.sh                  # novo: restic backup + forget/prune + estado
scripts/backup-conferir.sh                 # novo: check + restore do notas.db + integrity_check + estado
scripts/backup-comum.sh                    # novo: carrega /root/.config/notas-backup.env, flock, grava estado atômico
scripts/logrotate-notas-backup             # novo: regra instalada em /etc/logrotate.d/
scripts/tests/backup-limpeza.test.sh       # novo
.github/workflows/deploy.yml               # empacota scripts/, chmod/chown, instala logrotate
.github/workflows/ci.yml                   # shellcheck + teste da limpeza
backend/Notas.Api/Services/Sistema/BackupStatus.cs   # lê backup-externo.json; estado combinado
backend/Notas.Api/Endpoints/SistemaEndpoints.cs      # GET /api/sistema/backup devolve as partes novas
backend/Notas.Api/Mcp/CriativoMcpTools.cs            # linha com as duas idades
backend/Notas.Api.Tests/BackupStatusTests.cs
frontend/src/app/core/sistema.service.ts
frontend/src/app/features/hub/hub.page.ts            # faixa considera externo e conferência
frontend/src/app/features/configuracoes/             # seção Servidor mostra as três datas
DEPLOY.md                                  # configurar provedor, senha, cron; restauração completa
.env.example                               # Sistema__BackupExterno (caminho do estado)
README.md                                  # Roadmap/Confiabilidade
```

## Complexity Tracking

| Violação | Por que é preciso | Alternativa mais simples rejeitada |
|---|---|---|
| `restic` instalado no host | Cifrar, deduplicar, reter e conferir uma cópia remota com segurança | `rclone` + `gpg` em shell: duas ferramentas, 180 MB/dia sem deduplicação, retenção e conferência escritas à mão (mais código, mais chance de erro silencioso, que foi a causa do incidente) |
