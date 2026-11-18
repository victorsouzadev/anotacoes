# Feature Specification: Busca semântica no Segundo Cérebro

**Feature Branch**: `027-cerebro-busca-semantica` (sem branch própria)

**Created**: 2026-11-18

**Status**: Draft

**Input**: Fase 4 da PoC (spec 011): "Busca semântica (embeddings) — o índice já separa trechos e tem `Candidates()` como ponto de extensão".

## Clarifications

### Session 2026-11-18

- Q: Qual provedor de embeddings? → A: API compatível com OpenAI (`/v1/embeddings`), com a chave da OpenAI que o Cérebro já aceita para transcrição; modelo padrão `text-embedding-3-small`. Sem chave, a busca continua só por palavras.
- Q: Substitui a busca atual? → A: Não. Vira busca híbrida: resultados de palavras (FTS5) e de significado combinados por posição (RRF).
- Q: Liga sozinho? → A: Não; liga em Configurações, com estimativa de custo da indexação inicial.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Achar pelo sentido (Priority: P1)

Buscar "quanto gastei no carro" encontra a nota "Revisão do Gol — R$ 850" mesmo sem as mesmas palavras.

**Why this priority**: É o ganho principal para o Claude e para a pessoa.

**Independent Test**: Buscar um sinônimo que não aparece em nenhuma nota e achar a nota certa entre os 5 primeiros.

**Acceptance Scenarios**:

1. **Given** a busca semântica desligada, **Then** o resultado é igual ao de hoje.
2. **Given** ligada, **When** a pessoa busca, **Then** os resultados combinam palavras e significado.

---

### User Story 2 - Indexar e manter atualizado (Priority: P1)

Ao ligar, o serviço calcula os vetores dos trechos de todo o vault em segundo plano (mostrando progresso); depois, só trechos novos ou alterados (por hash) são recalculados quando o watcher detecta mudança.

---

### User Story 3 - Melhores sugestões de links e classificação (Priority: P2)

`Candidates()` (sugestões de notas relacionadas na Inbox) usa a busca híbrida.

---

### User Story 4 - MCP (Priority: P2)

A ferramenta `search` do MCP usa a busca híbrida quando ligada, com parâmetro opcional `mode` (`auto`, `palavras`, `significado`).

### Edge Cases

- Provedor fora do ar: cai para FTS5, sem erro para quem buscou.
- Trocar o modelo: os vetores são recalculados (o modelo fica gravado com cada vetor).
- Vault pequeno (milhares de trechos): busca por força bruta em memória é suficiente.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O índice MUST guardar um vetor por trecho, com o modelo e o hash do texto.
- **FR-002**: A busca MUST combinar FTS5 e similaridade por cosseno via RRF quando ligada.
- **FR-003**: Sem chave ou com o provedor fora, a busca MUST funcionar só com FTS5.
- **FR-004**: A indexação MUST ser incremental por hash e rodar em segundo plano.
- **FR-005**: A opção MUST nascer desligada e mostrar estimativa de custo.
- **FR-006**: O índice MUST continuar recriável a partir dos `.md` (Princípio da spec 011).

### Key Entities

- **Vetor de trecho**: id do trecho, modelo, hash do texto, vetor.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 20 consultas de teste com sinônimos, a nota certa aparece no top 5 em pelo menos 16.
- **SC-002**: Busca híbrida responde em menos de 300 ms com 20 mil trechos.

## Assumptions

- Base compatível com OpenAI configurável (`Embeddings__BaseUrl`) para usar outro provedor no futuro.
