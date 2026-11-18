# Feature Specification: Duplicar e navegar entre páginas

**Feature Branch**: `020-notas-paginas` (sem branch própria)

**Created**: 2026-11-18

**Status**: Implementado em 2026-11-18

**Input**: Roadmap do README (Polish): "Atalho de teclado para trocar de página (Ctrl+PageUp/PageDown)" e "Duplicar página (hoje só duplica a nota inteira)".

## Clarifications

### Session 2026-11-18

- Q: Onde fica "Duplicar página"? → A: Num menu de contexto da aba (botão direito ou toque longo), junto com Renomear e Excluir; a cópia entra logo depois da original.
- Q: Dá para reordenar páginas? → A: Sim, arrastando a aba — entra aqui porque usa o mesmo menu/abas e é pequeno.
- Q: Ctrl+Shift+N para página nova? → A: Não: o Chrome reserva esse atalho (janela anônima) e a página nunca o recebe. Ficou Alt+N (decidido na implementação).
- Q: Excluir página continua sem desfazer? → A: Não; ganha "Desfazer" no aviso, como a lixeira de notas.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trocar de página pelo teclado (Priority: P1)

Ctrl+PageDown vai para a próxima página e Ctrl+PageUp para a anterior (Alt+→/← como alternativa); Alt+N cria página nova.

**Why this priority**: É o atalho mais pedido para notas longas.

**Independent Test**: Com 3 páginas, Ctrl+PageDown duas vezes chega na terceira.

**Acceptance Scenarios**:

1. **Given** a última página, **When** Ctrl+PageDown, **Then** nada acontece (não dá a volta).
2. **Given** um texto em edição, **When** Ctrl+PageDown, **Then** o texto é confirmado antes de trocar.

---

### User Story 2 - Duplicar página (Priority: P1)

"Duplicar página" no menu da aba cria a cópia logo depois, com título "<título> (cópia)" e elementos com ids novos.

**Independent Test**: Duplicar, editar a cópia e ver que a original não mudou.

---

### User Story 3 - Reordenar e desfazer exclusão (Priority: P2)

Arrastar uma aba muda a ordem; excluir página mostra "Página excluída · Desfazer" por alguns segundos em vez do `confirm()`.

### Edge Cases

- Duplicar setas ligadas: `fromId`/`toId` são remapeados para os ids novos da mesma página.
- Atalhos não disparam com foco em input/textarea fora do canvas.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O editor MUST trocar de página com Ctrl+PageUp/PageDown (e Alt+←/→) e criar com Alt+N.
- **FR-002**: O editor MUST duplicar uma página com ids novos e referências de seta remapeadas.
- **FR-003**: O editor MUST reordenar páginas arrastando as abas.
- **FR-004**: Excluir página MUST oferecer desfazer.
- **FR-005**: A duplicação MUST ser função pura testada.

### Key Entities

- **Página** (existente): ordem dentro de `pages`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Navegar por uma nota de 20 páginas sem tirar a mão do teclado.
- **SC-002**: Nenhuma seta da cópia aponta para elemento da página original.

## Assumptions

- No celular o menu da aba abre com toque longo.
