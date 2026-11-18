# Feature Specification: Exportar nota em PDF

**Feature Branch**: `019-notas-exportar-pdf` (sem branch própria)

**Created**: 2026-11-18

**Status**: Implementado em 2026-11-18

**Input**: Roadmap do README: "Exportar em PDF (hoje só PNG)".

## Clarifications

### Session 2026-11-18

- Q: Exporta a página atual ou a nota inteira? → A: As duas opções; o padrão é a nota inteira (uma página do PDF por página da nota).
- Q: Qual tamanho de página? → A: A4, com orientação escolhida sozinha pelo formato do conteúdo e o conteúdo encaixado com margem; opção "tamanho do conteúdo" para quem quer a página exata.
- Q: Texto selecionável no PDF? → A: Não nesta versão; o PDF é imagem (o renderer é Canvas 2D).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Baixar a nota inteira em PDF (Priority: P1)

No menu "Mais ações" do editor, "Exportar PDF" gera um arquivo com todas as páginas da nota, na ordem, em A4.

**Why this priority**: Enviar ou imprimir uma nota de várias páginas hoje exige exportar PNG página por página.

**Independent Test**: Nota com 3 páginas → PDF com 3 páginas, abrindo em qualquer leitor.

**Acceptance Scenarios**:

1. **Given** uma nota de 3 páginas, **When** exporta em PDF, **Then** o arquivo tem 3 páginas na mesma ordem, com o nome da nota.
2. **Given** uma página vazia no meio, **Then** ela sai como página em branco (mantém a numeração).
3. **Given** conteúdo mais largo que alto, **Then** a página sai em paisagem.

---

### User Story 2 - Só a página atual e tamanho do conteúdo (Priority: P2)

O diálogo de exportação oferece "Nota inteira" ou "Página atual" e "A4" ou "Tamanho do conteúdo", com fundo branco sempre (PDF não tem transparência útil para impressão) e estilo de papel opcional.

### Edge Cases

- Nota inteira vazia: aviso, sem arquivo.
- Nota grande (8 MB de imagens): o PDF é gerado no navegador sem travar a aba por mais de alguns segundos; páginas são processadas uma a uma.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O editor MUST exportar PDF da nota inteira ou da página atual.
- **FR-002**: Cada página MUST ser renderizada pelo mesmo `Renderer` do PNG, em resolução de impressão (~200 DPI no A4).
- **FR-003**: O PDF MUST ser gerado no navegador, sem backend e sem dependência nova.
- **FR-004**: O nome do arquivo MUST ser o título da nota saneado.

### Key Entities

Nenhuma nova.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma nota de 10 páginas vira PDF em menos de 10 segundos num computador comum.
- **SC-002**: O PDF abre sem erro no leitor do navegador, no Acrobat e no leitor do Android.

## Assumptions

- O gerador de PDF mínimo do Editor de Imagens (`buildPdf` em `features/imagem/sheet.ts`) é suficiente (imagens JPEG por página).
