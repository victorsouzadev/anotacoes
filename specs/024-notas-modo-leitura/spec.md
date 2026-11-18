# Feature Specification: Modo leitura / apresentação

**Feature Branch**: `024-notas-modo-leitura` (sem branch própria)

**Created**: 2026-11-18

**Status**: Implementado em 2026-11-18

**Input**: Roadmap do README: "Modo apresentação/leitura (esconde a toolbar)".

## Clarifications

### Session 2026-11-18

- Q: O modo leitura bloqueia edição? → A: Sim. Só pan, zoom e troca de página; nem marcar item de checklist é permitido.
- Q: Tela cheia? → A: Botão e tecla F entram em tela cheia (Fullscreen API); Esc sai do modo.
- Q: É preferência salva? → A: Não; sai do modo ao fechar a nota.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ler sem distração (Priority: P1)

Botão "Ler" no editor esconde barra, painel de propriedades e controles; cada página é enquadrada inteira; ←/→ (ou toque nas bordas / deslizar) trocam de página; um indicador "2 / 5" aparece por alguns segundos.

**Why this priority**: Rever e mostrar notas sem risco de mexer.

**Independent Test**: Entrar no modo, tentar arrastar um elemento (não move) e trocar de página com →.

**Acceptance Scenarios**:

1. **Given** o modo leitura, **When** a pessoa clica num elemento, **Then** nada é selecionado.
2. **Given** a última página, **When** →, **Then** fica nela.
3. **Given** Esc, **Then** volta ao editor na mesma página.

---

### User Story 2 - Apresentar em tela cheia (Priority: P2)

F ou o botão de tela cheia ocupa a tela; o cursor some depois de 2 s parado.

### Edge Cases

- Pomodoro dentro da nota continua contando, mas não aceita cliques.
- Desfazer/refazer e Delete desligados no modo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O editor MUST ter um modo leitura que esconde os controles de edição e bloqueia qualquer alteração.
- **FR-002**: O modo MUST enquadrar a página inteira e trocar de página por teclado, toque e gesto.
- **FR-003**: O modo MUST oferecer tela cheia.
- **FR-004**: O componente de leitura MUST poder ser usado sem o editor (base do link público, spec 023).

### Key Entities

Nenhuma nova.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nenhuma alteração é gravada enquanto o modo leitura está ativo.

## Assumptions

- Só web.
