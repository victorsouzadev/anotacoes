# Feature Specification: Treino (recepção do app Treino Corrida)

**Feature Branch**: `006-treino` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

> **Spec 034 (21/11/2026)**: extraída do núcleo para o plug-in **congelado** [hub-treino](https://github.com/victorsouzadev/hub-treino), com as mesmas URLs (rotas legadas), as mesmas tabelas e os mesmos testes. Os caminhos de arquivo citados abaixo ficam lá.

**Input**: Levantamento do código existente: `Endpoints/TreinoEndpoints.cs`, `Mcp/TreinoMcpTools.cs`. O app Android fica em outro repositório (`treino-corrida`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Guardar os treinos do celular na conta do hub (Priority: P1)

O app Treino Corrida (offline-first, conta do hub opcional) envia cada atividade para `/api/treino/atividades/{id}` e busca o que mudou com `?desde=`.

**Why this priority**: Sem isso os treinos ficam presos no aparelho.

**Independent Test**: Enviar a mesma atividade duas vezes com `updatedAt` diferentes e ver que só a mais nova fica.

**Acceptance Scenarios**:

1. **Given** uma atividade nova, **When** o app faz PUT, **Then** ela é criada para o usuário logado.
2. **Given** uma atividade já gravada com `updatedAt` igual ou mais novo, **When** chega um PUT mais antigo, **Then** o servidor devolve a versão atual sem alterar.
3. **Given** um id já usado por outro usuário, **When** chega o PUT, **Then** o servidor responde conflito.
4. **Given** uma atividade apagada no app, **When** sincroniza, **Then** fica com `deletedAt` (tombstone).

---

### User Story 2 - Guardar o andamento do programa (Priority: P2)

O app grava o plano atual (programa, semana/semanas, sessões feitas/total, próxima sessão) em `/api/treino/plano`, um por usuário.

---

### User Story 3 - Consultar os treinos por um LLM (Priority: P2)

O MCP `/api/mcp/treino` oferece `treino_resumo` (andamento, último treino, recentes, totais por período) e `treino_atividades` (período até 366 dias, com data, tipo, distância, tempo, ritmo, esforço e FC). Só leitura. O Segundo Cérebro usa o resumo na rotina diária.

### Edge Cases

- Validação: tipo `sessao` ou `livre`; duração até 24 h; distância até 500 km; esforço 1–10; FC 20–250; título até 200, meta até 200 e nota até 2000 caracteres; id até 64 caracteres.
- Datas sempre gravadas em UTC; o MCP formata no fuso e em pt-BR.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST aceitar atividades por id do cliente com last-write-wins por `updatedAt`.
- **FR-002**: O sistema MUST recusar atividades e planos fora dos limites de validação, com erro em português.
- **FR-003**: O sistema MUST guardar um plano por usuário.
- **FR-004**: O sistema MUST expor o MCP somente leitura `/api/mcp/treino`.

### Key Entities

- **Atividade**: id do cliente, início, tipo, título, duração, distância, maior corrida contínua, esforço, dor, meta, FC média e máxima, nota, `updatedAt`, `deletedAt`.
- **Plano**: programa, semana, semanas total, sessões feitas e total, próxima sessão, `updatedAt`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nenhum treino é duplicado por reenvio.
- **SC-002**: O resumo do MCP reflete o último treino enviado na sincronização seguinte.

## Assumptions

- A interface principal é o app Android; a tela web somente leitura veio depois, na spec 017.
- O contrato segue o mesmo padrão da Dieta (`GET ?desde=`, `PUT /{id}`).
