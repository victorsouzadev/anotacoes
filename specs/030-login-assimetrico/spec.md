# Feature Specification: Login com chave assimétrica e OAuth no núcleo

**Feature Branch**: `030-login-assimetrico` (sem branch própria)

**Created**: 2026-11-19

**Status**: Planejado

**Input**: Pré-requisito da divisão em plug-ins (029). Hoje o `JWT_SECRET` é o mesmo no `Notas.Api` e no `cerebro`: quem tem o segredo valida **e emite** token de qualquer usuário. Com vários plug-ins, um comprometido forjaria login de todos.

## Clarifications

### Session 2026-11-19

- Q: Quem emite token? → A: Só o núcleo, com chave privada ES256. Plug-ins validam com a chave pública publicada em `/.well-known/jwks.json`.
- Q: Um token vale para todos os plug-ins? → A: Não. O token do hub continua com `aud=notas-vps` (o de hoje, para não mudar nada nos apps); para falar com um plug-in, a tela troca por um token de vida curta com `aud=<id>`. Um plug-in que vaze tokens só vaza os dele.
- Q: E os apps Android e conectores já instalados? → A: Continuam funcionando. Durante a transição o plug-in também aceita o token do hub (`aud=notas-vps`), controlado por configuração; a aceitação é desligada quando os apps forem atualizados para pedir token por plug-in.
- Q: O servidor OAuth da 028 fica no Cérebro? → A: Não, vem para o núcleo e passa a servir o MCP de qualquer plug-in (o recurso é `/<id>/mcp`). O `/ops` continua fora.
- Q: Os tokens estáticos dos MCPs dos apps (gerados hoje na tela do Cérebro, em arquivo)? → A: Passam para o núcleo, numa tela em Configurações → Conexões, guardados só como hash no banco compartilhado.
- Q: Rotação da chave? → A: O JWKS publica a chave atual e a anterior; trocar a chave não derruba ninguém.
- Q: Se o banco é compartilhado (031), um plug-in não pode inserir um refresh token ou trocar a senha de alguém direto na tabela? → A: Pode gravar, mas não adianta: as linhas de autenticação (`users.PasswordHash`, `refresh_tokens`, `core_oauth_tokens`, `core_mcp_tokens`) levam um selo HMAC feito com uma chave que só o núcleo tem. Linha sem selo válido é ignorada.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entrar uma vez e usar todos os plug-ins (Priority: P1)

A pessoa entra no hub e abre a Dieta, o Cérebro ou Tarefas sem novo login, como hoje.

**Independent Test**: Entrar no hub e abrir um plug-in em outra aba sem pedir senha.

**Acceptance Scenarios**:

1. **Given** a pessoa logada, **When** abre `/dieta/`, **Then** a tela carrega sem pedir senha.
2. **Given** um token com `aud=dieta`, **When** é usado no Cérebro, **Then** a resposta é 401.

---

### User Story 2 - Plug-in não consegue forjar login (Priority: P1)

Nenhum plug-in recebe material para emitir token. Mesmo com acesso total a um container de plug-in, não dá para entrar como outro usuário em outro plug-in.

**Acceptance Scenarios**:

1. **Given** o container de um plug-in, **Then** não existe `JWT_SECRET` nem chave privada nele.
2. **Given** um token assinado com qualquer chave fora do JWKS do núcleo, **Then** todo plug-in recusa.
3. **Given** uma linha inserida em `refresh_tokens` ou uma senha trocada em `users` direto no banco, **When** alguém tenta renovar ou entrar com ela, **Then** o núcleo recusa (selo inválido).

---

### User Story 3 - Conectar o Claude a qualquer plug-in por OAuth (Priority: P2)

O conector `https://<domínio>/<id>/mcp` descobre o servidor de autorização do núcleo, a pessoa aprova em `/autorizar` e o token recebido vale só para aquele plug-in. A lista "Aplicativos autorizados" vai para Configurações → Conexões e mostra o plug-in de cada conexão.

**Acceptance Scenarios**:

1. **Given** o conector do Cérebro aprovado, **Then** o token não funciona no MCP da Dieta.
2. **Given** conexões já aprovadas antes da mudança (028), **Then** continuam funcionando ou pedem uma nova aprovação uma única vez, com aviso.

---

### User Story 4 - Apps instalados não quebram (Priority: P1)

O app Android da Dieta e de Tarefas, com a versão atual instalada, continua entrando e sincronizando depois da troca da chave.

### Edge Cases

- Token emitido em HS256 ainda válido no momento do deploy: o núcleo aceita HS256 por até 15 min (vida do token de acesso); depois só ES256.
- JWKS fora do ar: o plug-in usa a chave em cache (até 24 h) e tenta de novo.
- Relógio do container adiantado: tolerância de 30 s, como hoje.
- Troca de token para um plug-in desligado: 404 claro.
- Conector do Claude aprovado antes da mudança guarda os endpoints antigos (`/cerebro/oauth/token`): o núcleo continua atendendo `/cerebro/oauth/*` como rota legada, então a renovação não quebra.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O núcleo MUST assinar tokens com ES256 e publicar a(s) chave(s) pública(s) em `/.well-known/jwks.json`.
- **FR-002**: O núcleo MUST oferecer a troca de token do hub por token de plug-in (`aud=<id>`, vida de 15 min), só para plug-ins registrados (029).
- **FR-003**: Plug-ins MUST validar só por JWKS e MUST NOT receber segredo de assinatura.
- **FR-004**: Durante a transição, plug-ins MUST aceitar `aud=notas-vps` quando `AceitarAudienciaLegada=true`.
- **FR-005**: O servidor OAuth (028) MUST ser movido para o núcleo, com recurso por plug-in, mantendo PKCE S256, rotação e revogação, e continuar atendendo os endpoints antigos `/cerebro/oauth/*`; `/ops` MUST NOT aceitar OAuth.
- **FR-006**: Tokens estáticos de MCP MUST ficar no núcleo, por plug-in, só como hash, com tela para gerar e revogar.
- **FR-007**: As linhas de autenticação MUST levar selo HMAC com chave só do núcleo; o núcleo MUST ignorar linha com selo ausente ou inválido.
- **FR-008**: A chave privada e a chave dos selos MUST ficar fora do banco e do git (arquivo em `data/core/chaves/`, só no container do núcleo, incluído no backup cifrado).

### Key Entities

- **Chave de assinatura**: id (`kid`), pública, privada (arquivo), criada em, aposentada em.
- **Token de plug-in**: `sub`, `email`, `aud=<id>`, `exp`; não é guardado.
- **Token estático de MCP**: plug-in, hash, criado em, último uso, revogado em.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nenhum container de plug-in contém material que permita emitir token (conferido no deploy).
- **SC-002**: Zero novos logins pedidos aos apps Android e ao hub web na virada.
- **SC-003**: Um token de um plug-in é recusado por 100% dos outros (teste automatizado).
- **SC-004**: Nenhuma escrita direta no banco permite entrar como outro usuário (teste automatizado).

## Assumptions

- Depende de 029 (registro de plug-ins) e 031 (tabelas do núcleo no banco compartilhado).
- O `JWT_SECRET` continua existindo só no núcleo até o fim da transição, para validar tokens HS256 pendentes.
- Limite conhecido: as telas de todos os plug-ins rodam no mesmo domínio, então o JavaScript de um plug-in consegue ler o token do hub no `localStorage`. A separação por audiência protege contra um backend de plug-in comprometido, não contra código de tela malicioso. Um subdomínio por plug-in resolveria, e fica fora desta spec (um domínio só, Princípio I).
