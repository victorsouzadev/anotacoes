# Feature Specification: OAuth 2.1 no MCP do Segundo Cérebro

**Feature Branch**: `028-cerebro-mcp-oauth` (sem branch própria)

**Created**: 2026-11-18

**Status**: Implementado em 2026-11-18. Spec 030 (2026-11-20): o servidor OAuth passa ao núcleo (`/api/core/oauth/*`, recurso `<hub>/<plug-in>/mcp`, acesso JWT ES256 de 15 min com `aud=<plug-in>`); revogação chega ao plug-in em até 60 s (`/api/core/revogados`), não mais na próxima chamada. A virada das rotas deste servidor é na 033.

**Input**: Fora da PoC (spec 011): "OAuth 2.1 no MCP — token bearer (ou `?key=`) por enquanto". Hoje o Claude web recebe o token dentro da URL do conector.

> **Onde o código mora (spec 033):** o Cérebro virou o plug-in [hub-cerebro](https://github.com/victorsouzadev/hub-cerebro) (API, MCP, worker e as telas em `web/`). Até a troca em produção (033, T010) a VPS ainda roda a cópia em `cerebro/` e `frontend/src/app/features/cerebro/` deste repositório; mudanças novas vão no hub-cerebro.

## Clarifications

### Session 2026-11-18

- Q: Quais MCPs entram? → A: Só o `/cerebro/mcp` nesta spec. Os MCPs dos apps podem seguir depois; o MCP de operação (`/ops`) fica de fora de propósito (controle de root não deve ser liberado por um clique de consentimento).
- Q: O token atual continua valendo? → A: Sim. Bearer e `?key=` seguem funcionando para o Claude Code e scripts.
- Q: Quem pode autorizar? → A: Só os e-mails de `CEREBRO_USUARIOS`, logados no hub.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conectar o Claude web sem colar token (Priority: P1)

A pessoa adiciona `https://<domínio>/cerebro/mcp` como conector no Claude; o Claude descobre o servidor de autorização, abre a página do hub, a pessoa (já logada) vê "Permitir que o Claude acesse seu Segundo Cérebro?" e aprova. O conector passa a funcionar.

**Why this priority**: Token na URL vaza em histórico e logs; o fluxo padrão do MCP é OAuth.

**Independent Test**: Adicionar o conector no Claude web e chamar `search`.

**Acceptance Scenarios**:

1. **Given** uma chamada ao `/cerebro/mcp` sem credencial, **Then** a resposta é 401 com `WWW-Authenticate` apontando o metadata do recurso.
2. **Given** a página de consentimento, **When** a pessoa recusa, **Then** o cliente recebe `access_denied`.
3. **Given** um e-mail fora de `CEREBRO_USUARIOS`, **Then** a página mostra que a conta não tem acesso.

---

### User Story 2 - Ver e revogar conexões (Priority: P1)

Em Conectar, a lista "Aplicativos autorizados" mostra cliente, data e último uso, com Revogar (invalida tokens de acesso e de atualização na hora).

---

### User Story 3 - Renovação silenciosa (Priority: P2)

Tokens de acesso de 1 h e de atualização de 30 dias com rotação; o Claude renova sem pedir consentimento de novo.

### Edge Cases

- PKCE obrigatório (S256); `plain` recusado.
- `redirect_uri` precisa bater exatamente com a registrada.
- Código de autorização vale 60 s e uma vez só.
- Registro dinâmico de cliente aceito, com limite de taxa e expiração de clientes nunca usados em 24 h.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O serviço MUST publicar `/.well-known/oauth-protected-resource` e `/.well-known/oauth-authorization-server` conforme a especificação de autorização do MCP.
- **FR-002**: O serviço MUST oferecer registro dinâmico, autorização com PKCE S256 e troca/renovação de token.
- **FR-003**: O consentimento MUST acontecer numa página do hub, com o login único, só para `CEREBRO_USUARIOS`.
- **FR-004**: Tokens MUST ser guardados só como hash; revogação MUST valer na hora.
- **FR-005**: O acesso por token estático (bearer/`?key=`) MUST continuar funcionando.
- **FR-006**: O `/ops` MUST NOT aceitar OAuth.

### Key Entities

- **Cliente OAuth**: id, nome, redirect URIs, criado em, último uso.
- **Código de autorização**: hash, cliente, desafio PKCE, redirect, expira em, usado.
- **Token**: hash, tipo (acesso/atualização), cliente, expira em, revogado em, família de rotação.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Conectar o Claude web leva menos de 1 minuto e nenhum token copiado.
- **SC-002**: Uma conexão revogada para de funcionar na próxima chamada.

## Assumptions

- HTTPS obrigatório (já é exigência do Cérebro).
