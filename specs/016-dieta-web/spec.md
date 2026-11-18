# Feature Specification: Tela web da Dieta

**Feature Branch**: `016-dieta-web` (sem branch própria)

**Created**: 2026-11-18

**Status**: Draft

**Input**: Etapa 8 do `docs/dieta/PLANO.md` (lacuna da spec 005): acompanhar e registrar a Dieta pelo navegador, com a mesma conta do app Android.

## Clarifications

### Session 2026-11-18

- Q: A web substitui o app ou complementa? → A: Complementa. O app continua o caminho principal (offline, câmera, código de barras, lembretes); a web é para ver o dia, o histórico e registrar no computador.
- Q: A web funciona offline? → A: Não nesta versão. Grava direto na API, como o web de Tarefas.
- Q: Assistente de IA e reconhecimento por foto entram? → A: O Assistente (chat) entra na P3, reaproveitando `POST /api/dieta/chat`. Reconhecimento por foto fica fora.
- Q: Precisa de backend novo? → A: Não. Todos os dados já estão em `/api/dieta/*`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver o dia (Priority: P1)

A pessoa abre `/dieta` no hub e vê o dia de hoje: kcal e macros contra a meta, água, peso, refeições com os itens e a adesão ao plano. Setas trocam de dia.

**Why this priority**: É o que mais se consulta e hoje só existe no celular.

**Independent Test**: Registrar um almoço no app, abrir `/dieta` no navegador e ver os mesmos totais.

**Acceptance Scenarios**:

1. **Given** registros sincronizados pelo app, **When** a pessoa abre `/dieta`, **Then** vê os totais do dia iguais aos do app.
2. **Given** um dia sem registros, **Then** a tela mostra o dia vazio com a meta, sem erro.
3. **Given** uma conta sem perfil, **Then** a tela convida a preencher o perfil.

---

### User Story 2 - Registrar pela web (Priority: P1)

Buscar alimento (TACO, meus alimentos), escolher a refeição e a quantidade e registrar; editar quantidade e excluir item; repetir uma refeição de outro dia; registrar água e peso.

**Independent Test**: Registrar 150 g de arroz no almoço pela web e ver o item no app depois da sincronização.

**Acceptance Scenarios**:

1. **Given** um item registrado pela web, **When** o app sincroniza, **Then** o item aparece no app (mesmo id, last-write-wins).
2. **Given** um item excluído pela web, **Then** ele some do app na sincronização (tombstone `deletedAt`).

---

### User Story 3 - Histórico, peso e progresso (Priority: P2)

Gráfico de peso com média móvel de 7 dias, kcal por dia nas últimas semanas, heatmap de adesão, nível, XP, sequências, conquistas e desafio da semana, vindos de `/api/dieta/progresso`.

**Independent Test**: Abrir a aba Progresso e conferir nível e sequência com o app.

---

### User Story 4 - Perfil, metas e plano (Priority: P2)

Editar perfil e metas (com a sugestão calculada ao lado) e ver/editar o plano alimentar da semana.

---

### User Story 5 - Compartilhar e exportar (Priority: P3)

Criar link público com escopos e validade, listar, revogar; baixar o CSV de um período.

---

### User Story 6 - Assistente (Priority: P3)

Chat da Dieta no navegador, usando `POST /api/dieta/chat` e a configuração de IA do hub; gravações só depois de confirmar.

### Edge Cases

- Sem rede: a tela avisa e não finge que salvou.
- Data no fuso do usuário (o backend já usa `prog.Hoje()`); a web manda a data local, não UTC.
- Fotos aparecem como miniatura via `/api/dieta/fotos/{id}/arquivo`; enviar foto pela web fica fora.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O hub MUST ter um card "Dieta" e a rota `/dieta`, lazy-loaded.
- **FR-002**: A tela MUST mostrar o dia (totais, metas, água, peso, refeições, adesão) a partir de `GET /api/dieta/dia/{data}`.
- **FR-003**: A web MUST registrar, editar e excluir itens com `PUT /api/dieta/registros/{id}` usando ids gerados no cliente e `updatedAt`.
- **FR-004**: A web MUST registrar água e peso e repetir refeições pelos endpoints existentes.
- **FR-005**: A web MUST mostrar progresso, perfil, metas, plano, compartilhamentos e CSV.
- **FR-006**: A feature MUST NOT exigir mudança no backend.
- **FR-007**: A interface MUST seguir o Grafite (cor de ferramenta só no ícone) e funcionar em largura de celular.

### Key Entities

Reaproveita as entidades da spec 005 (perfil, meta, alimento, registro, peso, água, plano, foto, compartilhamento).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Os totais do dia na web são idênticos aos do app para o mesmo dia.
- **SC-002**: Registrar um item pela web leva menos de 20 segundos.
- **SC-003**: Nenhum registro é duplicado entre web e app.

## Assumptions

- O APK da Dieta continua sendo publicado à parte; o card do hub ganha o link de download dele.
