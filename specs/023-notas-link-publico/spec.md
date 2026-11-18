# Feature Specification: Link somente leitura de nota

**Feature Branch**: `023-notas-link-publico` (sem branch própria)

**Created**: 2026-11-18

**Status**: Implementado em 2026-11-18

**Input**: Roadmap do README: "Compartilhar nota por link somente-leitura, sem exigir conta".

## Clarifications

### Session 2026-11-18

- Q: O link mostra a versão do momento ou a atual? → A: A atual (o que está salvo no servidor). Quem quiser uma foto fixa exporta PDF.
- Q: Validade? → A: Opcional (7, 30, 90 dias ou sem validade); sempre revogável.
- Q: Quantos links por nota? → A: Vários (um por pessoa, se quiser revogar separado), cada um com um nome.
- Q: Página pública fica no Angular ou no backend? → A: No Angular, rota `/p/nota/:token` sem login, usando o leitor da spec 024; o backend só devolve o JSON.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criar e enviar um link (Priority: P1)

No editor, "Compartilhar" cria um link com nome e validade e copia para a área de transferência.

**Why this priority**: É a função pedida.

**Independent Test**: Criar link, abrir em aba anônima e ver a nota sem login.

**Acceptance Scenarios**:

1. **Given** um link válido, **When** alguém sem conta abre, **Then** vê o título e todas as páginas em modo leitura.
2. **Given** a dona edita a nota, **When** o link é recarregado, **Then** mostra a versão nova (depois da sincronização).

---

### User Story 2 - Revogar e ver os links (Priority: P1)

O diálogo lista os links da nota (nome, criado em, validade) com "Revogar". Revogado ou vencido: a página mostra "Este link não está mais disponível".

**Independent Test**: Revogar e recarregar o link aberto.

**Acceptance Scenarios**:

1. **Given** nota na lixeira ou excluída, **Then** todos os links dela param de funcionar.

### Edge Cases

- Token com 32 bytes aleatórios (URL-safe); impossível de adivinhar.
- Página pública não expõe e-mail, pasta, tags nem id da nota.
- Limite de taxa nos acessos públicos para evitar varredura.
- Nota com mudanças ainda não sincronizadas: o link mostra a última versão no servidor; o diálogo avisa se a nota está "sincronizando".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A dona MUST criar, listar e revogar links por nota, com nome e validade opcional.
- **FR-002**: `GET /api/notes/publico/{token}` MUST funcionar sem login e devolver só título e páginas.
- **FR-003**: Links MUST parar quando revogados, vencidos ou quando a nota vai para a lixeira/é excluída.
- **FR-004**: A rota `/p/nota/:token` MUST abrir sem login e usar o leitor da spec 024.
- **FR-005**: O acesso público MUST ter limite de taxa.

### Key Entities

- **Compartilhamento de nota**: token, nota, dona, nome, validade, revogado em, criado em.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um link revogado para de abrir na próxima requisição.
- **SC-002**: Nenhum dado além de título e páginas aparece na resposta pública.

## Assumptions

- Depende da spec 024 (leitor) e da spec 018 (lixeira, para invalidar links de notas na lixeira). A Dieta já tem um padrão de link público com escopos e revogação; este segue o mesmo desenho.
