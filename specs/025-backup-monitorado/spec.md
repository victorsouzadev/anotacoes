# Feature Specification: Backup monitorado

**Feature Branch**: `025-backup-monitorado` (sem branch própria)

**Created**: 2026-11-18

**Status**: Implementado em 2026-11-18

**Input**: Roadmap do README (Confiabilidade): "Confirmar que o cron de backup do SQLite está de fato rodando na VPS (único ponto de falha dos dados)".

## Clarifications

### Session 2026-11-18

- Q: Quem vê o estado do backup? → A: Só quem opera o servidor: os e-mails de `PUBLICADORES` (já são os administradores de fato). Sem lista nova.
- Q: Quando é alerta? → A: Último backup bem-sucedido há mais de 36 h, ou nunca registrado.
- Q: Onde aparece? → A: Faixa no topo do hub para os administradores, e uma linha na rotina diária do Segundo Cérebro (via `criativo_resumo`).
- Q: Cópia fora da VPS entra? → A: Não nesta spec; fica registrada como próximo passo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Saber se o backup está rodando (Priority: P1)

Cada execução bem-sucedida do `scripts/backup.sh` grava um registro com data, arquivos e tamanhos. O hub mostra aos administradores uma faixa de alerta quando o backup está atrasado.

**Why this priority**: Hoje ninguém sabe se o cron roda; uma falha só seria percebida ao precisar restaurar.

**Independent Test**: Apagar o registro e abrir o hub como administrador: a faixa "Backup nunca registrado" aparece; rodar o script: some.

**Acceptance Scenarios**:

1. **Given** o último backup há 10 h, **Then** nenhuma faixa.
2. **Given** o último backup há 40 h, **Then** faixa "Último backup há 1 dia e 16 h".
3. **Given** um usuário comum, **Then** nunca vê a faixa nem acessa o endpoint.
4. **Given** o script falha no meio (`set -e`), **Then** o registro não é atualizado e o alerta aparece no prazo.

---

### User Story 2 - Detalhe e Segundo Cérebro (Priority: P2)

Em `/configuracoes`, seção "Servidor" (só administradores): data do último backup, arquivos e tamanhos, e o comando para rodar à mão. O `criativo_resumo` inclui "Backup: ok há 6 h" ou o alerta, e a rotina do Cérebro grava isso no diário.

### Edge Cases

- Registro com JSON inválido: tratado como "nunca registrado".
- Fuso: datas gravadas em UTC, exibidas no fuso do usuário.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `scripts/backup.sh` MUST gravar `data/db/backup-status.json` só no fim de uma execução sem erro.
- **FR-002**: O backend MUST expor `GET /api/sistema/backup` só para `PUBLICADORES`.
- **FR-003**: O hub MUST mostrar alerta aos administradores com mais de 36 h sem backup.
- **FR-004**: O `criativo_resumo` MUST incluir o estado do backup.
- **FR-005**: O DEPLOY.md MUST ensinar a conferir o cron e o estado.

### Key Entities

- **Estado do backup**: concluído em (UTC), lista de arquivos com tamanho, total de bytes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma falha de backup é percebida em até 36 h, sem ninguém entrar na VPS.

## Assumptions

- O volume `data/db` já está montado no `api` em `/data/db`.
