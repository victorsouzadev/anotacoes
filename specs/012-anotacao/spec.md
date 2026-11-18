# Feature Specification: Anotação (revisão das marcações de dados pessoais)

**Feature Branch**: `012-anotacao` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `features/anotacao`, `Endpoints/AnotacaoEndpoints.cs`, `Services/Anotacao` e seção "Anotação" do README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Revisar um relato por vez (Priority: P1)

A tela mostra um relato com as marcações de dados pessoais feitas pelo Claude (pipeline `llm-ner-pipeline`). Clicar numa marcação tira; selecionar um trecho marca (todas as repetições juntas); Enter aprova e passa ao próximo; P pula.

**Why this priority**: É o fluxo base da revisão do mestrado.

**Independent Test**: Tirar uma marcação errada, marcar um nome não detectado e aprovar com Enter; conferir a linha nova no `manual_review.jsonl`.

**Acceptance Scenarios**:

1. **Given** um trecho selecionado que aparece três vezes no relato, **When** a pessoa marca, **Then** as três repetições ficam marcadas.
2. **Given** um relato pulado, **When** a pessoa segue, **Then** ele não é decidido e volta depois.

---

### User Story 2 - Revisar em lote (Priority: P2)

O modo Em lote mostra uma lista de relatos (tamanho de 1 a 100, lembrado no navegador). A pessoa tira marcações erradas, marca trechos novos, usa "Deixar para depois" no que quer ver com calma (volta no modo Um por vez) e aprova o resto de uma vez. Não há atalho de teclado para aprovar o lote.

**Independent Test**: Abrir um lote de 20, deixar 2 para depois, aprovar e ver 18 decisões gravadas.

### Edge Cases

- Sem lote em `data/anotacao` ou e-mail fora de `ANOTACAO_USUARIOS`: a ferramenta aparece como desligada.
- Acesso só por HTTPS (o Caddy recusa `/api/anotacao` em HTTP).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST ler o lote de `documents.jsonl` e `claude_proposals.jsonl` e acrescentar cada decisão ao `manual_review.jsonl`, no formato da revisão em Streamlit.
- **FR-002**: Nenhum relato ou decisão MUST ir para o banco do hub ou para o repositório.
- **FR-003**: Marcar um trecho MUST marcar todas as suas repetições no relato.
- **FR-004**: O acesso MUST ser restrito a `ANOTACAO_USUARIOS` e a HTTPS.

### Key Entities

- **Relato**: id da linha e texto.
- **Proposta**: marcações sugeridas pelo Claude (trecho, posição, tipo de dado pessoal).
- **Decisão**: marcações finais aprovadas ou relato pulado/adiado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Revisar um relato sem correções leva um toque de tecla (Enter).
- **SC-002**: Todas as decisões voltam ao run local com `claude_proposals.py trazer`.

## Assumptions

- Dados sensíveis de pesquisa: ficam só em `data/anotacao` na VPS, montados por `scripts/claude_proposals.py pacote`.
