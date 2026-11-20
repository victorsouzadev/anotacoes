# Feature Specification: Extrair o Segundo Cérebro como primeiro plug-in

**Feature Branch**: `033-extrair-cerebro` (sem branch própria)

**Created**: 2026-11-19

**Status**: Planejado

**Input**: Ordem da divisão em plug-ins: o Cérebro sai primeiro porque já é um serviço à parte (`cerebro/`, .NET 10, container próprio, rotas `/cerebro/*` no Caddy). Ele valida o contrato (029–032) com pouco risco. Retroativa: [011](../011-segundo-cerebro/spec.md); evoluções: 026, 027, 028.

## Clarifications

### Session 2026-11-19

- Q: O que vai para o repositório `hub-cerebro`? → A: `cerebro/` inteiro (serviço, testes, WebDAV), as telas `frontend/src/app/features/cerebro/` (menos `/autorizar`, que fica no núcleo — 030) e a página `/capturar`.
- Q: O `hub.db` do Cérebro? → A: As tabelas de dados (`captures`, `settings`) vão para o banco compartilhado como `cerebro_capturas` e `cerebro_configuracoes` (031). As tabelas OAuth vão para o núcleo (`core_oauth_*`, 030), mantendo os `client_id`, para conectores já aprovados seguirem válidos.
- Q: E o índice de busca e os vetores (`notes`, `links`, `trechos`, `vectors.db`)? → A: Ficam fora do banco compartilhado, em `data/cerebro/hub`, porque são derivados do vault e podem ser recriados a qualquer momento (o compose já diz isso). Dado de verdade vai para o banco; cache não.
- Q: A chave de IA do Cérebro? → A: Passa a vir da configuração de IA do núcleo (`usaIa`). Na migração, se o usuário não tem chave no núcleo, a do Cérebro é copiada (recifrada) para lá; a opção de IA do Cérebro continua (ligar leitura de anexos, busca semântica).
- Q: Os tokens estáticos (MCP do Cérebro, MCP dos apps, `/ops`) gerados hoje na tela do Cérebro? → A: A geração vai para Configurações → Conexões no núcleo (030). O arquivo `data/cerebro/hub/access` deixa de existir depois que todos leem do núcleo.
- Q: O vault e o WebDAV? → A: Não mudam: continuam em `data/cerebro/webdav`, declarados em `dados` do manifesto.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nada muda para quem usa (Priority: P1)

Depois da extração, o Cérebro abre do card do hub, a busca, a captura, a Inbox, o Obsidian via WebDAV e os conectores do Claude funcionam como antes, com os mesmos dados.

**Why this priority**: É o Cérebro que tem uso diário (47 notas alteradas em 30 dias).

**Independent Test**: Comparar, antes e depois, `search` pelo MCP, a lista da Inbox e uma sincronização do Obsidian.

**Acceptance Scenarios**:

1. **Given** o conector do Claude já aprovado, **When** o Cérebro novo sobe, **Then** o conector continua funcionando sem nova aprovação.
2. **Given** capturas pendentes na Inbox, **Then** continuam lá, com as mesmas datas.
3. **Given** o bookmarklet antigo (`/capturar`), **Then** continua capturando.

---

### User Story 2 - Deploy do Cérebro pelo repositório dele (Priority: P1)

Um commit no `hub-cerebro` publica a imagem e, pelo `plugins.lock`, atualiza só o Cérebro.

---

### User Story 3 - Tokens em um só lugar (Priority: P2)

A pessoa gera e revoga os tokens de MCP (Cérebro, apps e `/ops`) em Configurações → Conexões do hub.

### Edge Cases

- Índice derivado ausente no primeiro boot: o Cérebro reindexa o vault em background e a busca responde "indexando" até terminar.
- Migração do `hub.db` rodando com o Cérebro antigo ainda no ar: o deployer para o antigo antes de copiar.
- Conflito de id entre `captures` e uma tabela já existente: não há (prefixo `cerebro_` livre); o deployer confere.
- Voltar para a versão antiga: o `hub.db` antigo fica guardado em `data/cerebro/hub/hub.db.pre-033` por 30 dias.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O Cérebro MUST virar o plug-in `cerebro` (repositório `hub-cerebro`) usando o SDK (032) e o manifesto (029), com rota `/cerebro/*` e rota legada `/capturar`; `/cerebro/oauth/*` continua indo para o núcleo (rota mais específica no Caddy, 030). O WebDAV (`/dav/*`) continua no serviço `cerebro-webdav`, sem mudança.
- **FR-002**: `captures` e `settings` MUST ser migrados para `cerebro_capturas` e `cerebro_configuracoes` no banco compartilhado, sem perda e com contagem conferida.
- **FR-003**: As tabelas OAuth MUST ser migradas para o núcleo com os mesmos `client_id` e famílias de refresh.
- **FR-004**: Índice e vetores MUST continuar locais ao plug-in e recriáveis.
- **FR-005**: O Cérebro MUST usar as chaves de IA do núcleo, com cópia única da chave atual quando o núcleo não tiver uma.
- **FR-006**: A geração de tokens estáticos MUST sair da tela do Cérebro.
- **FR-007**: `cerebro/` e `features/cerebro/` MUST sair deste repositório só depois que a versão do plug-in estiver no ar e conferida.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero reconexões de conectores do Claude e do Obsidian.
- **SC-002**: Contagem de capturas e configurações idêntica antes e depois.
- **SC-003**: O repositório do núcleo perde `cerebro/` inteiro (cerca de 8 mil linhas) e o job do Cérebro na CI.

## Assumptions

- Depende de 029, 030, 031 e 032 implementadas.
- O usuário cria o repositório `hub-cerebro` no GitHub; o histórico de `cerebro/` vai junto (`git subtree split`).
