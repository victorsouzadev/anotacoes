# Feature Specification: Extrair e congelar as ferramentas sem uso

**Feature Branch**: `034-extrair-congelados` (sem branch própria)

**Created**: 2026-11-19

**Status**: Planejado

**Input**: Levantamento de uso de 25/10 a 18/11/2026: Editor de Imagens sem acesso desde 28/09, Treino sem nenhum dado, Precificação em 2 dias, Moldes e Bolo 3D sem medição (rodam só no navegador). Retroativas: [006](../006-treino/spec.md), [007](../007-editor-imagens/spec.md), [008](../008-moldes/spec.md), [009](../009-bolo-3d/spec.md), [013](../013-precificacao/spec.md); evoluções 017, 019, 022 (helpers movidos para `shared/`).

## Clarifications

### Session 2026-11-19

- Q: Quantos repositórios? → A: Dois. `hub-criativo` junta Editor de Imagens (com o app Windows), Moldes, Bolo 3D e Precificação (com o `ViihMimosEndpoints`), porque compartilham código (PDF, HEIC, folhas, geometria) e público. `hub-treino` fica sozinho, porque tem app/MCP próprio e pode voltar a ser usado com a tela web nova (017).
- Q: O que é "congelado"? → A: Continua no ar e funcionando, na versão fixada no `plugins.lock`. Sem novas features, sem CI obrigatória a cada mudança do núcleo, sem atualização de dependências. Bug que perca dado ainda é corrigido.
- Q: E o app Windows do Editor de Imagens? → A: Vai para o `hub-criativo` e passa a hospedar o app do plug-in criativo, não mais o `NotasApp` inteiro. O instalador sai do workflow `desktop.yml` do núcleo.
- Q: Os helpers que outras ferramentas usam (`shared/pdf.ts`, `shared/heic.ts`)? → A: Ficam no núcleo (as Notas usam — 019, 022) e o `hub-criativo` leva uma cópia. Como o criativo está congelado, a duplicação não diverge.
- Q: O Estúdio? → A: Já foi removido do código (migração `RemoveEstudio`); as chamadas a `/api/estudio` nos logs são de clientes antigos e continuam recebendo 404.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - As ferramentas continuam abrindo (Priority: P1)

Os cards de Imagens, Moldes, Bolo 3D, Precificação e Treino continuam no hub e abrem as mesmas telas, com os projetos de imagem existentes.

**Independent Test**: Abrir um projeto de imagem salvo, gerar um molde em PDF, abrir o Bolo 3D, consultar uma ficha de precificação e abrir o Treino.

**Acceptance Scenarios**:

1. **Given** os 3 projetos em `imagem_projetos`, **When** o plug-in criativo sobe, **Then** eles abrem iguais.
2. **Given** a Precificação, **Then** continua lendo e gravando no painel Viih Mimos, só para os e-mails permitidos.
3. **Given** o app Windows atualizado, **Then** abre e salva projetos como antes.

---

### User Story 2 - O núcleo fica menor (Priority: P1)

Depois da extração, o núcleo não tem mais o código dessas ferramentas, e mudanças no núcleo não exigem rodar os testes delas.

**Acceptance Scenarios**:

1. **Given** a extração concluída, **Then** `features/imagem`, `moldes`, `cake`, `precificacao`, `treino`, os endpoints e `desktop/` saem do núcleo.
2. **Given** um PR no núcleo, **Then** a CI não compila nem testa o criativo e o Treino.

---

### User Story 3 - Descongelar quando quiser (Priority: P3)

Voltar a evoluir uma ferramenta congelada é só retomar o repositório dela e atualizar o SDK.

### Edge Cases

- Link salvo para `/imagens`, `/moldes`, `/bolo-3d`, `/precificacao`, `/treino`: continua abrindo (rotas legadas).
- MCP `criativo` e `treino` (`/api/mcp/criativo`, `/api/mcp/treino`): continuam nas URLs antigas.
- Contrato do núcleo avança duas versões: o plug-in congelado precisa de uma atualização mínima ou é desligado (032); o hub avisa no card.
- App Windows antigo (que hospeda o `NotasApp` inteiro) continua funcionando sozinho, porque não depende do servidor.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Imagens, Moldes, Bolo 3D e Precificação MUST virar o plug-in `criativo` e o Treino o plug-in `treino`, usando o SDK, o banco compartilhado (`imagem_*`, `treino_*`) e rotas legadas.
- **FR-002**: Os dados existentes MUST aparecer sem cópia (031).
- **FR-003**: O app Windows MUST passar a hospedar o app do plug-in criativo.
- **FR-004**: O código dessas ferramentas MUST sair do núcleo depois de conferido no ar.
- **FR-005**: Plug-ins congelados MUST ficar fixos no `plugins.lock` e marcados como `congelado` no manifesto.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O núcleo perde as pastas e endpoints listados em US2 e os jobs `desktop` e `EditorImagens` da CI.
- **SC-002**: Zero projetos de imagem, planos de treino ou fichas de precificação perdidos.
- **SC-003**: Tempo da CI do núcleo cai (medido antes e depois).

## Assumptions

- Depende de 029–032 e da 033 (o fluxo foi validado com o Cérebro).
- O usuário cria `hub-criativo` e `hub-treino` no GitHub.
