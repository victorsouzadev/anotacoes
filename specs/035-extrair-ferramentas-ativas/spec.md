# Feature Specification: Extrair as ferramentas em uso

**Feature Branch**: `035-extrair-ferramentas-ativas` (sem branch própria)

**Created**: 2026-11-19

**Status**: Planejado

**Input**: Última etapa da divisão em plug-ins: Dieta, Tarefas, Anotação, Finanças e Notas, uma por vez, na ordem do levantamento de uso. Retroativas: [002](../002-notas/spec.md), [003](../003-financas/spec.md), [004](../004-tarefas/spec.md), [005](../005-dieta/spec.md), [012](../012-anotacao/spec.md); evoluções 015, 016, 018–024.

## Clarifications

### Session 2026-11-19

- Q: Em que ordem? → A: Dieta, Tarefas, Anotação, Finanças, Notas. Dieta e Tarefas são as mais usadas e têm app Android, então saem primeiro, quando o fluxo já foi validado pelo Cérebro (033) e pelas congeladas (034). As Notas saem por último porque têm a sincronização mais delicada (offline-first, achados da 021).
- Q: Uma spec para as cinco? → A: Sim, com uma história por ferramenta. A receita é a mesma (031, `DEPLOY.md`); o que muda está nos casos-limite de cada uma. Cada história é entregue e conferida sozinha.
- Q: Os apps Android? → A: `mobile/dieta` vai para o `hub-dieta` e `mobile/app` (Tarefas) para o `hub-tarefas`, cada um com o próprio Gradle. Os APKs instalados continuam falando com `/api/dieta` e `/api/tasks` pelas rotas legadas; a próxima versão de cada app passa a usar `/dieta/api` e `/tarefas/api`.
- Q: O relógio compartilhado (`FinancasClock`, usado por Dieta e Tarefas)? → A: Vira `RelogioDoHub` no SDK (032); cada plug-in usa o seu.
- Q: Os helpers `shared/pdf.ts` e `shared/heic.ts`? → A: Vão com as Notas, que são as últimas a usá-los no núcleo.
- Q: O que sobra no núcleo no fim? → A: Login, contas, configurações, IA, registro de plug-ins, Publicar, deployer, backup, ops, Caddy e os pacotes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dieta como plug-in (Priority: P1)

Refeições, água, peso, plano, fotos e compartilhamentos continuam iguais na web, no app Android e no MCP. O link público de compartilhamento (`/api/dieta/publico/{token}`) continua abrindo.

**Independent Test**: Registrar uma refeição no app Android já instalado e vê-la na web e pelo MCP.

**Acceptance Scenarios**:

1. **Given** o APK atual instalado, **When** a Dieta vira plug-in, **Then** login, sincronização e fotos seguem funcionando.
2. **Given** a análise de refeição por IA, **Then** usa a chave do núcleo; sem chave, a tela continua manual.

---

### User Story 2 - Tarefas como plug-in (Priority: P1)

Tarefas, projetos, kanban, comentários, anexos, recorrência (015) e o MCP de tarefas continuam iguais, inclusive no app Android e nos projetos compartilhados com outras contas.

**Acceptance Scenarios**:

1. **Given** um projeto compartilhado, **Then** os dois usuários continuam vendo as mesmas tarefas.
2. **Given** o conector do Claude em `/api/mcp/tarefas`, **Then** segue funcionando.

---

### User Story 3 - Anotação como plug-in (Priority: P2)

A ferramenta de relatos do mestrado continua lendo e gravando os arquivos de `data/anotacao`.

**Acceptance Scenarios**:

1. **Given** os lotes em `data/anotacao`, **Then** aparecem iguais e o backup passa a incluí-los pela pasta declarada em `dados`.

---

### User Story 4 - Finanças como plug-in (Priority: P2)

Transações, orçamentos, metas, planejamento, chat financeiro, integração AUVP e o MCP de finanças continuam iguais.

**Acceptance Scenarios**:

1. **Given** as credenciais AUVP gravadas, **When** a Finanças vira plug-in, **Then** a integração continua funcionando sem pedir a credencial de novo (recifrada uma vez com a chave do plug-in).
2. **Given** as 2.613 transações, **Then** os totais do painel são idênticos antes e depois.

---

### User Story 5 - Notas como plug-in (Priority: P3)

Editor, pastas, sincronização offline, lixeira (018), PDF (019), páginas (020), tags (021), imagens (022), link público (023) e modo leitura (024) continuam iguais.

**Acceptance Scenarios**:

1. **Given** edições feitas offline antes do deploy, **When** a rede volta depois da extração, **Then** sincronizam sem perda.
2. **Given** um link público `/p/nota/<token>`, **Then** continua abrindo.

### Edge Cases

- Usuário apagado no núcleo: as linhas dele somem em cascata em todos os plug-ins (FK para `users`, 031).
- App Android ainda na versão antiga 6 meses depois: a rota legada continua; a aceitação de `aud=notas-vps` (030) só é desligada quando a versão nova estiver instalada.
- Fila de sincronização de Notas no IndexedDB com URL antiga: o service worker e o cliente aceitam a rota legada até a próxima versão.
- Finanças com AUVP fora do ar no dia da extração: a recifragem é local e não depende da AUVP.
- Notas: o worker da lixeira (30 dias) passa para o plug-in; nunca rodam dois ao mesmo tempo (o núcleo desliga o dele na mesma versão).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cada ferramenta MUST virar plug-in (`dieta`, `tarefas`, `anotacao`, `financas`, `notas`) com o SDK, o banco compartilhado e migração de base, sem cópia de dados.
- **FR-002**: Toda URL usada hoje (API, MCP, telas, links públicos, APKs) MUST continuar funcionando pelas rotas legadas.
- **FR-003**: Cada extração MUST ser entregue e conferida sozinha, com o quickstart dela, antes da próxima começar.
- **FR-004**: Segredos de plug-in (AUVP) MUST ser recifrados com a chave do plug-in, uma vez, sem pedir ao usuário.
- **FR-005**: Workers em background (lixeira de notas) MUST rodar em um lugar só.
- **FR-006**: Ao final, o núcleo MUST conter só o que está listado em Clarifications.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero dados perdidos, conferido por contagens e totais antes e depois de cada extração.
- **SC-002**: Zero 404 novos em `/api/*` nos logs do proxy na semana seguinte a cada extração (029 T014).
- **SC-003**: Nenhum usuário precisa reinstalar app, refazer login ou reconectar o Claude.
- **SC-004**: O `Notas.Api` termina com menos de 20% das linhas de hoje (cerca de 67 mil, com migrações).

## Assumptions

- Depende de 029–032 e de 033 e 034 concluídas.
- O usuário cria `hub-dieta`, `hub-tarefas`, `hub-anotacao`, `hub-financas` e `hub-notas` no GitHub.
