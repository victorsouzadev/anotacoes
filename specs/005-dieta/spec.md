# Feature Specification: Dieta

**Feature Branch**: `005-dieta` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado (etapas 1 a 7 do plano) — spec retroativa. A tela web (etapa 8) veio depois, na spec 016.

**Input**: Levantamento do código existente: `mobile/dieta`, `Endpoints/DietaEndpoints.cs`, `Endpoints/DietaIaEndpoints.cs`, `Services/Dieta`, `Mcp/DietaMcpTools.cs`, `docs/dieta/PLANO.md` e `mobile/dieta/README.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar o que comeu (Priority: P1)

No app Android a pessoa registra café, almoço, lanche e jantar buscando alimentos na tabela TACO (embutida no app), por código de barras ou em alimentos e receitas próprias, com porção em gramas ou unidade, e vê os totais do dia contra a meta.

**Why this priority**: O diário é a razão de existir da ferramenta.

**Independent Test**: Em modo avião, registrar um almoço com dois alimentos da TACO e ver os totais de kcal e macros do dia.

**Acceptance Scenarios**:

1. **Given** sem rede e sem login, **When** a pessoa registra refeições, **Then** tudo funciona offline (sem sync, progresso, código de barras e links).
2. **Given** um código de barras lido pelo scanner do Google Play services, **When** o produto existe na Open Food Facts, **Then** ele é guardado como alimento da pessoa e entra no registro.
3. **Given** uma refeição já registrada antes, **When** a pessoa usa "repetir", **Then** os mesmos itens entram de novo.

---

### User Story 2 - Metas, peso e água (Priority: P1)

O perfil (altura, nascimento, sexo, atividade, objetivo) gera a meta de kcal pela Mifflin-St Jeor × atividade com ajuste pelo objetivo; macros e água são editáveis. Meta preenchida à mão vence a sugestão. Peso com média móvel de 7 dias; água por dia.

**Independent Test**: Preencher o perfil e conferir a meta calculada offline igual à do servidor.

---

### User Story 3 - Sincronizar com a conta do hub (Priority: P1)

Logado, o app envia cada registro "sujo" com `PUT /{id}` e busca o que mudou com `?desde=`, a cada hora e logo após cada mudança, com last-write-wins.

**Independent Test**: Registrar no celular, reinstalar o app, entrar e ver o histórico voltar.

---

### User Story 4 - Plano alimentar (Priority: P2)

A pessoa monta o cardápio previsto e acompanha previsto × realizado com % de adesão.

---

### User Story 5 - Fotos de refeição e de progresso (Priority: P2)

Câmera do sistema ou galeria; JPEG até 1600 px enviado por multipart. Fotos corporais com pose (frente/lado/costas) e comparação lado a lado. Privadas por padrão. Sem análise automática da imagem.

---

### User Story 6 - Gamificação (Priority: P2)

XP, níveis, sequências (com um congelamento por semana), conquistas, desafio semanal e heatmap, calculados no servidor a partir dos registros (`GET /api/dieta/progresso`) e guardados em cache para abrir offline. Conquista ou nível novo gera notificação.

**Acceptance Scenarios**:

1. **Given** um registro errado apagado, **When** o progresso é recalculado, **Then** XP e conquistas se ajustam (são derivados, não eventos).

---

### User Story 7 - Compartilhar o progresso (Priority: P3)

Links públicos com escopos (peso, macros, diário, fotos de refeição, fotos corporais, conquistas, CSV), validade e revogação, servidos em `/api/dieta/publico/<token>/`. Modo nutricionista pré-seleciona diário, macros, peso e CSV. Card PNG da semana para redes sociais e exportação CSV.

**Independent Test**: Criar um link só com peso, abrir sem login e ver só o peso; revogar e ver o link parar.

---

### User Story 8 - Assistente e reconhecimento por IA (Priority: P3)

Assistente (chat) que consulta perfil, metas, dias e plano e, depois de a pessoa confirmar, grava metas, monta o plano, registra refeições e cadastra alimentos. "Reconhecer": foto do prato ou texto viram itens com gramas casados com a TACO; foto da tabela nutricional preenche o cadastro do alimento por 100 g. Usa a configuração de IA do hub (foto exige OpenRouter).

**Acceptance Scenarios**:

1. **Given** o assistente propõe uma mudança, **When** a pessoa não confirma, **Then** nada é gravado.

---

### User Story 9 - Lembretes e Segundo Cérebro (Priority: P3)

Lembretes às 13:30 e 20:30 só se almoço/jantar não foi registrado (desligável). O MCP `/api/mcp/dieta` expõe resumo, dia, período, busca de alimento e registros rápidos de refeição, peso e água; a rotina do Segundo Cérebro grava o resumo no vault.

### Edge Cases

- Link público vencido ou revogado: não mostra nada.
- Fotos ficam como BLOB no SQLite do hub.
- A meta calculada no app e no servidor precisam dar o mesmo número (mesma conta em `Calculos.kt` e no backend).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O app MUST funcionar offline e sem login para diário, metas, peso, água e plano.
- **FR-002**: A base TACO MUST ser a mesma no app e no servidor (`taco.csv`).
- **FR-003**: O sistema MUST calcular a meta de kcal pela Mifflin-St Jeor × atividade, ajustada pelo objetivo, com meta manual prevalecendo.
- **FR-004**: A sincronização MUST ser por registro, incremental (`?desde=`), last-write-wins.
- **FR-005**: XP, níveis, sequências, conquistas e desafios MUST ser derivados dos registros no servidor.
- **FR-006**: Links públicos MUST ter escopos explícitos, validade e revogação, e não exigir login para leitura.
- **FR-007**: Gravações feitas pelo assistente de IA MUST exigir confirmação da pessoa.
- **FR-008**: O sistema MUST expor o MCP `/api/mcp/dieta`, só de leitura exceto os registros rápidos.

### Key Entities

- **Perfil e meta**: dados corporais, atividade, objetivo; kcal, macros e água com vigência.
- **Alimento**: TACO, Open Food Facts ou manual; valores por porção base; código de barras.
- **Receita**: itens com gramas e rendimento.
- **Registro**: data, refeição, alimento ou receita, quantidade, foto opcional.
- **Peso, água, foto**: registros diários.
- **Plano alimentar**: cardápio previsto.
- **Compartilhamento**: token, escopos, validade, revogado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Registrar uma refeição comum leva menos de 30 segundos.
- **SC-002**: O app abre e registra sem rede em qualquer situação.
- **SC-003**: Um link compartilhado nunca mostra um escopo que não foi escolhido.

## Assumptions

- O app é distribuído como APK (`Dieta.apk`, workflow por tag `dieta-v*`).
- A tela web da Dieta (etapa 8 do plano) é a spec 016.
