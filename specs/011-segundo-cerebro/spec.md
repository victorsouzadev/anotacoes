# Feature Specification: Segundo Cérebro (vault Obsidian na VPS)

**Feature Branch**: `011-segundo-cerebro` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado (fases 0 a 3 da PoC) — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `cerebro/` (.NET 10), `features/cerebro`, `cerebro/README.md` e seção "Segundo Cérebro" do README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manter o vault na VPS e usar o Obsidian como sempre (Priority: P1)

O vault do Obsidian mora na VPS e é a fonte da verdade; PC e celular sincronizam por WebDAV (`/dav`, plugin Remotely Save). Cada escrita vira commit git; busca, fila e histórico podem ser recriados a partir dos `.md`.

**Why this priority**: Sem isso não há segundo cérebro centralizado.

**Independent Test**: Editar uma nota no celular, sincronizar e ver a mudança no PC e no histórico git.

---

### User Story 2 - Capturar de qualquer lugar (Priority: P1)

Captura pela tela do hub, por `POST /cerebro/api/v1/captures` com API key por fonte (celular, WhatsApp, navegador), por webhooks e bookmarklet. A captura cai em `00-Inbox`.

**Acceptance Scenarios**:

1. **Given** a mesma captura enviada duas vezes com a mesma chave de idempotência, **Then** só uma nota é criada.
2. **Given** um anexo (PDF, imagem), **When** é capturado, **Then** o arquivo é salvo e linkado, sem extração de texto.

---

### User Story 3 - Inbox classificada pelo Claude, com aprovação (Priority: P1)

O worker extrai, transcreve e pede ao Claude título, resumo, tags, pasta e links. Nada sai da Inbox sem aprovação — na tela ou com `approve: true` no frontmatter. O serviço nunca edita notas existentes da pessoa.

**Independent Test**: Capturar um link, ver a sugestão na Inbox, aprovar e encontrar a nota na pasta sugerida.

---

### User Story 4 - Buscar e usar o vault por agentes (MCP) (Priority: P2)

MCP em `/cerebro/mcp` com `search`, `read_note`, `list_notes`, `get_daily`, `list_inbox`, `capture`, `create_note`, `append_daily`, `process_inbox_item`. Busca em SQLite FTS5.

---

### User Story 5 - Rotina dos apps do hub e tokens (Priority: P2)

Em Configurações → Apps do hub, horários (padrão 08:00 e 20:00), quais apps entram e "Sincronizar agora"; a cada execução o Cérebro chama `<app>_resumo` dos MCPs do hub (e o `casa_resumo` externo), regrava `_sistema/apps/<App> (app).md` e anota no diário. Em Conectar, gera os tokens dos MCPs dos apps e do MCP de operação (guarda só o SHA-256).

**Acceptance Scenarios**:

1. **Given** o serviço fora do ar no horário, **When** volta, **Then** roda só o horário mais recente que perdeu.
2. **Given** um token novo gerado, **Then** o anterior para de valer na hora, sem reiniciar serviços.

### Edge Cases

- Acesso só para `CEREBRO_USUARIOS` e só por HTTPS.
- Falha de um app na rotina (ex.: Casa sem token) não impede os outros.
- Busca semântica, OAuth 2.1 no MCP e OCR estão fora (pontos de extensão registrados).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Os arquivos `.md` do vault MUST ser a fonte da verdade; índice, fila e histórico MUST poder ser recriados.
- **FR-002**: Toda escrita do serviço MUST virar commit git.
- **FR-003**: O serviço MUST NOT editar notas existentes da pessoa; só cria na Inbox e move o que foi aprovado.
- **FR-004**: Capturas por API MUST exigir API key por fonte e aceitar idempotência.
- **FR-005**: A tela web MUST aceitar o JWT do login único, só para `CEREBRO_USUARIOS`.
- **FR-006**: Tokens gerados pela tela MUST ser guardados só como hash e revogar o anterior.

### Key Entities

- **Nota**: arquivo `.md` com frontmatter.
- **Captura / item da Inbox**: conteúdo, fonte, anexos, sugestão do Claude, estado de aprovação.
- **Fonte**: nome e API key.
- **Rotina dos apps**: horários, apps incluídos, última execução por app.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma captura feita no celular aparece na Inbox em segundos.
- **SC-002**: Nenhuma nota sai da Inbox sem aprovação explícita.
- **SC-003**: O vault inteiro pode ser reindexado a partir dos `.md` sem perda.

## Assumptions

- Serviço próprio por exigir .NET 10, processo de longa duração (worker) e acesso ao disco do vault.
- Uma pessoa dona do vault (primeiro e-mail de `CEREBRO_USUARIOS`).
