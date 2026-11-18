# Feature Specification: Tela web do Treino

**Feature Branch**: `017-treino-web` (sem branch própria)

**Created**: 2026-11-18

**Status**: Implementado em 2026-11-18

**Input**: Lacuna da spec 006: os treinos chegam do app Treino Corrida, mas só dá para vê-los pelo MCP.

## Clarifications

### Session 2026-11-18

- Q: A web edita treinos? → A: Não. Só leitura; o app é a fonte (evita conflito com o app offline-first de outro repositório).
- Q: Precisa de backend novo? → A: Não. `GET /api/treino/atividades` e `GET /api/treino/plano` bastam; agregações são feitas no cliente.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver o andamento e os últimos treinos (Priority: P1)

A pessoa abre `/treino` e vê o programa atual (semana X de Y, sessões feitas, próxima sessão), o último treino e a lista dos recentes com data, tipo, distância, tempo, ritmo, esforço e FC.

**Why this priority**: É o que o MCP já resume; falta uma tela para a própria pessoa.

**Independent Test**: Registrar um treino no app, sincronizar e ver na web.

**Acceptance Scenarios**:

1. **Given** nenhum treino, **Then** a tela explica que os dados vêm do app Treino Corrida.
2. **Given** uma atividade com `deletedAt`, **Then** ela não aparece.

---

### User Story 2 - Totais e evolução (Priority: P2)

Totais de 7, 30 e 90 dias (treinos, km, tempo), gráfico de km por semana e de ritmo médio.

**Independent Test**: Conferir os totais de 30 dias com `treino_resumo` do MCP.

### Edge Cases

- Atividade sem distância (sessão de caminhada/corrida intervalada): ritmo mostrado como "—".
- Datas em UTC na API; a tela mostra no fuso local.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O hub MUST ter card "Treino" e rota `/treino` lazy-loaded.
- **FR-002**: A tela MUST mostrar plano, último treino, lista e totais de 7/30/90 dias.
- **FR-003**: A tela MUST ser somente leitura.
- **FR-004**: Os cálculos de ritmo e totais MUST ser funções puras testadas e bater com o `TreinoMcpTools`.

### Key Entities

Atividade e Plano da spec 006.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Os totais de 30 dias da web e do MCP são iguais.
- **SC-002**: A tela abre em menos de 1 s com um ano de treinos.

## Assumptions

- O app Treino Corrida continua em outro repositório, sem mudanças.
