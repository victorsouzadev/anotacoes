# Feature Specification: Pacotes compartilhados dos plug-ins

**Feature Branch**: `032-pacotes-compartilhados` (sem branch própria)

**Created**: 2026-11-19

**Status**: Planejado

**Input**: Divisão em plug-ins (029). Cada plug-in precisa do mesmo login (030), das mesmas regras de banco (031), do health, do MCP e da mesma cara (Grafite) sem copiar código entre repositórios.

## Clarifications

### Session 2026-11-19

- Q: Quais pacotes? → A: Três: `Hub.Plugin.Sdk` (NuGet, backend), `@grafite/ui` (npm, frontend) e `plugin.schema.json` (formato do manifesto, publicado junto com o SDK).
- Q: Onde ficam? → A: No repositório do núcleo, em `pacotes/`, publicados no GitHub Packages da mesma conta. Um repositório a menos para manter, e o núcleo testa os pacotes junto com o que os consome.
- Q: E o Android? → A: Fora desta spec. Os apps continuam com o tema próprio (skill `aplicar-grafite`) e falando com as mesmas URLs (029, rotas legadas).
- Q: Versão? → A: SemVer. Mudança que quebra o contrato sobe o MAJOR e o número de `contrato` do manifesto; o núcleo aceita o contrato atual e o anterior.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criar um plug-in novo em minutos (Priority: P1)

A pessoa (ou o Claude) cria um repositório `hub-<id>` a partir do modelo, ajusta o `plugin.json` e tem login, health, banco, MCP e tela no Grafite funcionando, sem copiar código do núcleo.

**Why this priority**: Sem isso cada extração reescreve a mesma infraestrutura.

**Independent Test**: Criar o `hub-exemplo` (029) só com o modelo e os pacotes.

**Acceptance Scenarios**:

1. **Given** o modelo `hub-modelo`, **When** se troca o `id` e se roda a CI, **Then** testes, build da imagem e validação do manifesto passam.
2. **Given** o plug-in rodando, **Then** `/<id>/` mostra a barra do hub, aceita o login do hub e o health responde com a versão.

---

### User Story 2 - Mesmo visual em todo lugar (Priority: P1)

Telas de plug-ins usam os mesmos tokens, fontes, ícones e a mesma barra do hub (voltar ao hub, trocar de ferramenta, conta, tema claro/escuro).

**Acceptance Scenarios**:

1. **Given** um plug-in com `@grafite/ui`, **When** a pessoa troca o tema no hub, **Then** o plug-in segue o mesmo tema.
2. **Given** a barra do hub, **Then** ela lista os plug-ins de `/api/plugins` e abre qualquer um.

---

### User Story 3 - Atualizar o contrato sem quebrar plug-ins antigos (Priority: P2)

Uma versão nova do SDK que muda o contrato convive com plug-ins congelados no contrato anterior.

**Acceptance Scenarios**:

1. **Given** o núcleo no contrato 2 e o Treino congelado no contrato 1, **Then** o Treino continua no ar.
2. **Given** um plug-in no contrato 0 (duas versões atrás), **Then** o deploy recusa e explica.

### Edge Cases

- Plug-in congelado nunca atualiza o SDK: o núcleo mantém compatibilidade com o contrato anterior por pelo menos 12 meses.
- `@grafite/ui` em Angular de outra versão: o pacote entrega CSS e web components, sem depender da versão do Angular do plug-in.
- GitHub Packages fora do ar: a CI do plug-in usa o cache; o deploy não depende do registro de pacotes, só do GHCR.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `Hub.Plugin.Sdk` MUST oferecer: validação de token por JWKS e audiência (030), token de serviço para `/api/core/*`, health com versão, `UsarBancoDoHub`/`ReferenciarUsuarios`/`TabelasDoPlugin` (031), autenticação de MCP (OAuth e token estático) e acesso às chaves de IA do núcleo (`usaIa`).
- **FR-002**: `@grafite/ui` MUST oferecer: tokens CSS claro/escuro, fontes, ícones, o web component `<grafite-barra>` e o cliente de token por plug-in.
- **FR-003**: `plugin.schema.json` MUST descrever o manifesto da 029 e ser usado pelo deployer e por um teste do SDK.
- **FR-004**: Os pacotes MUST ser publicados pela CI do núcleo, com SemVer, a partir de `pacotes/`.
- **FR-005**: MUST existir um repositório modelo `hub-modelo` com CI reutilizável (029), Dockerfile, `plugin.json`, teste de tabelas e tela mínima.
- **FR-006**: O núcleo MUST aceitar o contrato atual e o anterior.

### Key Entities

- **Pacote**: nome, versão, contrato que implementa.
- **Modelo de plug-in**: estrutura mínima de repositório.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um plug-in novo do modelo até o card no hub em menos de 30 minutos.
- **SC-002**: Zero arquivos de autenticação, banco ou tema copiados do núcleo para um plug-in.
- **SC-003**: Plug-ins congelados continuam no ar depois de uma versão nova do contrato.

## Assumptions

- Repositórios e pacotes na mesma conta do GitHub (`victorsouzadev`), com o `GITHUB_TOKEN` da CI lendo os pacotes.
- O modelo `hub-modelo` é criado pelo usuário no GitHub como repositório template.
