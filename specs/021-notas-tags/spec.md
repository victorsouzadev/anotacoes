# Feature Specification: Tags nas notas

**Feature Branch**: `021-notas-tags` (sem branch própria)

**Created**: 2026-11-18

**Status**: Draft

**Input**: Roadmap do README: "Tags, além de pastas (categorização cruzada, não hierárquica)".

## Clarifications

### Session 2026-11-18

- Q: Tags são entidades com cor ou texto livre? → A: Texto livre por nota (sem cadastro); a lista de tags é a união das tags das notas. Sem cor nesta versão.
- Q: Filtrar por várias tags é E ou OU? → A: E (a nota precisa ter todas as tags escolhidas), combinado com a pasta ativa e a busca.
- Q: Maiúsculas importam? → A: Não; tags são guardadas em minúsculas e sem espaços nas pontas; até 20 tags por nota, 40 caracteres cada.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Marcar notas com tags (Priority: P1)

No editor (ao lado do título) e no card da lista, a pessoa adiciona e remove tags, com sugestão das tags já usadas.

**Why this priority**: Sem marcar não há o que filtrar.

**Independent Test**: Adicionar "faculdade" e "provas" a uma nota, reabrir e ver as duas.

**Acceptance Scenarios**:

1. **Given** "Faculdade " digitado, **Then** a tag salva é "faculdade".
2. **Given** a tag já existe na nota, **Then** não duplica.

---

### User Story 2 - Filtrar por tag (Priority: P1)

A barra lateral mostra as tags com a contagem de notas; clicar filtra (várias = E). A busca também encontra pelo nome da tag.

**Independent Test**: Duas notas com "provas" em pastas diferentes aparecem juntas ao filtrar "provas" em "Todas as notas".

---

### User Story 3 - Renomear e remover uma tag em todas as notas (Priority: P3)

No menu da tag na barra lateral: Renomear (aplica em todas as notas) e Remover de todas.

### Edge Cases

- Tags sincronizam com LWW da nota: editar tags em dois aparelhos offline faz vencer a versão mais nova da nota inteira.
- Nota na lixeira (spec 018) não conta nas contagens.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cada nota MUST ter uma lista de tags normalizadas (minúsculas, aparadas, únicas, até 20 × 40 caracteres).
- **FR-002**: As tags MUST sincronizar com a nota pelo upsert existente.
- **FR-003**: A lista MUST filtrar por tags (E), combinando com pasta e busca.
- **FR-004**: A busca MUST considerar o nome das tags.
- **FR-005**: A migração MUST ser aditiva (`Tags` com padrão `[]`).

### Key Entities

- **Nota**: ganha `tags: string[]`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Achar todas as notas de um assunto espalhadas em pastas com um clique.

## Assumptions

- Sem tags hierárquicas nem cores.
