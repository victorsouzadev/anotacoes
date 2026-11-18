# Feature Specification: Lixeira de notas

**Feature Branch**: `018-notas-lixeira` (sem branch própria)

**Created**: 2026-11-18

**Status**: Implementado em 2026-11-18

**Input**: Roadmap do README: "Lixeira com restaurar — hoje excluir é permanente na prática". Hoje `deleteNote` zera as páginas no cliente e o servidor grava `Elements = "[]"`.

## Clarifications

### Session 2026-11-18

- Q: Por quanto tempo a nota fica na lixeira? → A: 30 dias; depois é excluída de vez.
- Q: A lixeira sincroniza entre dispositivos? → A: Sim. Mandar para a lixeira num aparelho manda nos outros; restaurar também.
- Q: Excluir pasta manda as notas para a lixeira? → A: Não; continua como hoje (voltam para "sem pasta").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Excluir sem perder (Priority: P1)

Excluir uma nota manda para a Lixeira, com o conteúdo intacto. Um aviso "Nota movida para a lixeira · Desfazer" aparece por alguns segundos.

**Why this priority**: Exclusão acidental hoje perde tudo (Princípio II).

**Independent Test**: Excluir uma nota com desenho, abrir a Lixeira, restaurar e ver o desenho.

**Acceptance Scenarios**:

1. **Given** uma nota, **When** a pessoa exclui, **Then** ela some da lista, aparece na Lixeira e o conteúdo fica guardado no servidor.
2. **Given** o aviso de desfazer, **When** a pessoa clica em Desfazer, **Then** a nota volta para a lista.
3. **Given** uma nota na lixeira, **When** outro dispositivo sincroniza, **Then** ela vai para a lixeira lá também.

---

### User Story 2 - Restaurar ou excluir para sempre (Priority: P1)

A Lixeira lista as notas com a data da exclusão e quantos dias faltam. Restaurar devolve à pasta original (ou a "sem pasta", se a pasta não existe mais). "Excluir para sempre" pede confirmação e apaga o conteúdo. "Esvaziar lixeira" faz isso com todas.

**Independent Test**: Excluir para sempre e conferir que a nota não volta em nenhuma sincronização.

---

### User Story 3 - Limpeza automática (Priority: P2)

Notas na lixeira há mais de 30 dias são excluídas de vez pelo servidor.

**Independent Test**: Uma nota com `TrashedAt` de 31 dias atrás vira tombstone na próxima limpeza.

### Edge Cases

- Nota na lixeira não aparece na busca nem na lista de pastas.
- Editar uma nota em outro dispositivo offline enquanto ela foi para a lixeira: vale o `updatedAt` mais novo (LWW), como hoje — se a edição for mais nova, a nota volta da lixeira.
- Nota aberta no editor e mandada para a lixeira em outro aparelho: o editor volta para a lista na próxima sincronização.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Excluir MUST marcar `trashedAt` sem apagar o conteúdo.
- **FR-002**: A lista e a busca MUST esconder notas com `trashedAt`.
- **FR-003**: A tela MUST ter uma Lixeira com restaurar, excluir para sempre e esvaziar.
- **FR-004**: Excluir para sempre MUST usar o tombstone atual (`deletedAt`, conteúdo zerado).
- **FR-005**: `trashedAt` MUST sincronizar pelo mesmo upsert LWW das notas.
- **FR-006**: O servidor MUST transformar em tombstone as notas com `trashedAt` há mais de 30 dias.
- **FR-007**: A migração MUST ser aditiva (coluna nova anulável); notas existentes não mudam.

### Key Entities

- **Nota**: ganha `trashedAt` (data em que foi para a lixeira, nulo fora dela).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nenhuma nota é perdida por um clique de excluir.
- **SC-002**: Restaurar devolve a nota idêntica (mesmas páginas e elementos).

## Assumptions

- Só o web usa Notas; não há app Android de Notas para atualizar.
