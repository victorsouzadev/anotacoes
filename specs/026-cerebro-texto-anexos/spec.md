# Feature Specification: Texto de PDFs e imagens no Segundo Cérebro

**Feature Branch**: `026-cerebro-texto-anexos` (sem branch própria)

**Created**: 2026-11-18

**Status**: Draft

**Input**: Fora da PoC (spec 011 e `cerebro/README.md`): "PDF e imagens (OCR) — o arquivo é salvo e linkado, sem extração".

## Clarifications

### Session 2026-11-18

- Q: Com que ferramenta extrair? → A: Com o mesmo provedor de IA da Inbox (Anthropic ou OpenRouter com modelo que leia imagem/PDF), sem OCR local.
- Q: Liga sozinho? → A: Não. Nasce desligado (custo por uso, Princípio IV); liga em Configurações → "Ler texto de PDFs e imagens", com o aviso de custo.
- Q: Limites? → A: Até 10 MB por arquivo e 20 páginas de PDF; acima disso, a nota registra o motivo e segue sem texto.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Foto de documento vira texto pesquisável (Priority: P1)

A pessoa captura uma foto de um quadro, recibo ou página; o worker extrai o texto, acrescenta `## Texto extraído` na nota e a classificação do Claude passa a considerar esse texto.

**Why this priority**: Fotos e PDFs hoje são invisíveis para busca, classificação e MCP.

**Independent Test**: Capturar a foto de um cartão de visita e achar o nome da pessoa pela busca.

**Acceptance Scenarios**:

1. **Given** a opção ligada e IA configurada, **When** chega uma imagem, **Then** a nota ganha `## Texto extraído` antes da classificação.
2. **Given** a opção desligada, **Then** nada muda e o frontmatter recebe `hub_note` explicando como ligar.
3. **Given** uma imagem sem texto (paisagem), **Then** a seção traz uma descrição curta da imagem em vez de texto.

---

### User Story 2 - PDF vira texto (Priority: P1)

PDF de até 20 páginas tem o texto extraído na mesma seção, com marcadores de página.

---

### User Story 3 - Reprocessar (Priority: P3)

Na Inbox, "Ler texto de novo" refaz a extração de um item (ex.: depois de ligar a opção).

### Edge Cases

- Nota que já tem `## Texto extraído` não é processada de novo (idempotente, como a transcrição).
- Falha do provedor: o item segue o tratamento de falha atual do worker (re-tentativas e `Error`).
- HEIC: não suportado nesta versão; a nota recebe `hub_note` "formato não suportado" (o PWA de captura já envia JPEG).
- Provedor sem suporte a PDF: `hub_note` com o motivo; imagens continuam funcionando.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O worker MUST extrair texto de imagens (PNG, JPG, WebP, GIF) e PDFs anexados quando a opção estiver ligada.
- **FR-002**: O texto MUST entrar na nota como `## Texto extraído` antes da classificação.
- **FR-003**: A opção MUST nascer desligada e mostrar o aviso de custo.
- **FR-004**: Limites de 10 MB e 20 páginas MUST ser respeitados com mensagem clara.
- **FR-005**: O serviço MUST NOT alterar o arquivo original.

### Key Entities

- **Configuração de leitura de anexos**: ligada/desligada (na tabela `settings`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Texto de uma foto legível aparece na busca em até 1 minuto após a captura.

## Assumptions

- Usa o `EffectiveAi` já configurado; não há chave nova.
