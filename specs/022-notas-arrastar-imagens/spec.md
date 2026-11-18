# Feature Specification: Arrastar imagens para o canvas

**Feature Branch**: `022-notas-arrastar-imagens` (sem branch própria)

**Created**: 2026-11-18

**Status**: Draft

**Input**: Roadmap do README: "Arrastar-e-soltar imagens/arquivos direto no canvas (hoje só colar via Ctrl+V)".

## Clarifications

### Session 2026-11-18

- Q: Que arquivos entram? → A: Imagens (PNG, JPG, WebP, GIF estático, HEIC). Outros arquivos mostram aviso "Só imagens podem ser soltas na nota" — não há elemento de anexo no canvas.
- Q: Onde a imagem cai? → A: No ponto onde foi solta; várias imagens saem em cascata a partir dali.
- Q: Há botão para escolher arquivo? → A: Sim, "Inserir imagem" na barra, para celular e tablet, onde arrastar não é prático.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Soltar uma imagem (Priority: P1)

A pessoa arrasta uma foto do computador para o canvas; ao passar por cima, o canvas mostra um destaque; ao soltar, a imagem entra no ponto, redimensionada e comprimida como a colada.

**Why this priority**: É o gesto natural no computador.

**Independent Test**: Arrastar um JPG de 4000 px e ver a imagem no ponto solto, com tamanho reduzido.

**Acceptance Scenarios**:

1. **Given** um PDF arrastado, **Then** aparece o aviso e nada entra.
2. **Given** três imagens soltas juntas, **Then** entram em cascata e ficam selecionadas.

---

### User Story 2 - Inserir por botão (Priority: P2)

"Inserir imagem" abre o seletor de arquivos (com câmera no celular) e insere no centro da tela.

### Edge Cases

- HEIC é convertido com `heic-to` (já no projeto).
- Nota perto de 8 MB: se a imagem passar do limite, aviso "A nota ficaria grande demais" e a imagem não entra.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O canvas MUST aceitar soltar imagens e inseri-las no ponto do mundo correspondente.
- **FR-002**: A inserção MUST reaproveitar `downscaleImageBlob` e o mesmo tamanho máximo da colagem.
- **FR-003**: Arquivos que não são imagem MUST ser recusados com aviso.
- **FR-004**: A barra MUST ter "Inserir imagem" por seletor de arquivo.
- **FR-005**: A inserção MUST respeitar o limite de 8 MB da nota.

### Key Entities

Elemento `image` existente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Soltar uma foto leva a imagem ao canvas em menos de 2 s.

## Assumptions

- Não há elemento de arquivo genérico; anexos ficam fora.
