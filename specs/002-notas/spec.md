# Feature Specification: Notas (canvas manuscrito por página)

> **Onde o código mora (spec 035)**: no plug-in `notas`, repositório [hub-notas](https://github.com/victorsouzadev/hub-notas). Os caminhos do núcleo citados abaixo (`backend/Notas.Api`, `frontend/src/app/features`) são de antes da extração.

**Feature Branch**: `002-notas` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `features/notes`, `features/editor`, `frontend/src/app/data`, `Endpoints/NotesEndpoints.cs`, `Endpoints/FoldersEndpoints.cs` e seções "Notas" e "Modelo de dados" do README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Escrever e desenhar numa nota (Priority: P1)

A pessoa cria uma nota e já começa a digitar (a nota abre em modo documento, com um texto largo em edição). Pode trocar para caneta, borracha, formas, setas, notas adesivas, checklist e colar imagens, tudo num canvas por página.

**Why this priority**: É o núcleo da ferramenta.

**Independent Test**: Criar uma nota, digitar, desenhar um traço, colar uma imagem, fechar e reabrir a nota com tudo no lugar.

**Acceptance Scenarios**:

1. **Given** uma nota nova, **When** ela abre, **Then** o cursor já está piscando num texto em edição e a ferramenta ativa é "Selecionar".
2. **Given** a caneta, **When** a pessoa desenha com caneta sensível a pressão, **Then** o traço sai suavizado e com espessura variável.
3. **Given** uma seta ligada a um elemento, **When** o elemento é movido, **Then** a ponta da seta acompanha.
4. **Given** um texto, **When** a pessoa digita `- `, `1. ` ou `[ ] ` no início da linha, **Then** vira lista com marcador, numerada ou checklist; Enter continua o item e Tab/Shift+Tab indenta até 4 níveis.
5. **Given** um item de checklist, **When** a pessoa clica no quadradinho, **Then** ele marca/desmarca sem abrir a edição.
6. **Given** uma imagem na área de transferência, **When** a pessoa cola (Ctrl+V), **Then** a imagem entra redimensionada e comprimida.
7. **Given** qualquer mudança, **When** a pessoa usa desfazer/refazer, **Then** volta até ~100 passos.

---

### User Story 2 - Usar sem internet e sincronizar depois (Priority: P1)

Tudo é gravado primeiro no navegador (IndexedDB). Sem rede a nota continua editável; quando a conexão volta, as notas "sujas" são enviadas ao servidor e as mudanças de outros dispositivos chegam.

**Why this priority**: Notas são usadas em qualquer lugar; perder o que foi escrito por falta de rede é inaceitável.

**Independent Test**: Desligar a rede, editar uma nota, religar e ver a mudança em outro navegador logado na mesma conta.

**Acceptance Scenarios**:

1. **Given** sem conexão, **When** a pessoa edita, **Then** o indicador mostra "offline" e nada se perde.
2. **Given** a conexão volta, **When** a sincronização roda, **Then** a versão com `updatedAt` mais novo vence e o indicador volta para "salvo".
3. **Given** uma nota excluída num dispositivo, **When** o outro sincroniza, **Then** ela some também lá (tombstone).

---

### User Story 3 - Várias páginas por nota (Priority: P2)

Abas no topo do editor permitem adicionar, trocar e excluir páginas; cada página tem seus próprios elementos, como um caderno.

**Independent Test**: Criar três páginas com conteúdos diferentes e reabrir a nota.

**Acceptance Scenarios**:

1. **Given** uma nota antiga sem páginas (lista plana de elementos), **When** ela é aberta, **Then** é migrada sozinha para uma página, sem perder conteúdo.

---

### User Story 4 - Organizar e encontrar notas (Priority: P2)

Pastas (criar, renomear, excluir, mover notas), busca por título e por conteúdo (texto, adesivos e checklists de todas as páginas), ordenação por edição, criação ou nome, lista com miniaturas, duplicar, renomear e excluir.

**Independent Test**: Buscar uma palavra que só existe num item de checklist da página 2 e achar a nota.

**Acceptance Scenarios**:

1. **Given** uma pasta com notas, **When** a pasta é excluída, **Then** as notas voltam para "sem pasta".

---

### User Story 5 - Ajustar a visualização e exportar (Priority: P3)

Zoom e pan (roda, pinça, atalhos, "ajustar à tela"), papel liso/pautado/quadriculado (preferência local), tema claro/escuro e exportação PNG da página inteira em resolução real, com fundo branco ou transparente.

**Independent Test**: Exportar uma página maior que a tela e conferir que o PNG traz tudo.

### Edge Cases

- Conteúdo de uma nota até 8 MB (coluna `Elements`); imagens são comprimidas no cliente para caber.
- Duas edições offline da mesma nota em dispositivos diferentes: vence a mais recente (last-write-wins), sem mescla.
- Alças de redimensionar têm área de clique maior que o desenho para não errar o alvo no toque.
- Estilo de papel não sincroniza entre dispositivos (decisão consciente).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O editor MUST oferecer selecionar, caneta (com pressão e suavização), borracha (traço inteiro ou área), formas (retângulo, elipse, linha, com preenchimento opcional), setas retas ou curvas com ponta que gruda em elemento, texto formatado, nota adesiva, checklist e imagem colada.
- **FR-002**: O texto MUST suportar negrito, itálico, sublinhado, alinhamento, tamanho de 8 a 200 px, fonte normal ou manuscrita e listas inline por prefixo de linha, sem mudar o formato salvo (o conteúdo continua uma string).
- **FR-003**: O editor MUST permitir seleção múltipla, mover, redimensionar, girar, mudar camada e desfazer/refazer.
- **FR-004**: Uma nota MUST ter uma ou mais páginas, cada uma com sua lista de elementos; notas no formato antigo MUST ser migradas na leitura.
- **FR-005**: As notas MUST ser gravadas localmente primeiro e funcionar offline, com fila de envio ("sujas") e sincronização last-write-wins por `updatedAt`, com tombstone para exclusão.
- **FR-006**: O cabeçalho MUST mostrar o estado: salvo, sincronizando, offline ou erro.
- **FR-007**: O sistema MUST oferecer pastas, busca por título e conteúdo, ordenação, miniaturas, duplicar, renomear e excluir.
- **FR-008**: O sistema MUST exportar a página atual inteira em PNG, com fundo branco ou transparente.
- **FR-009**: O servidor MUST guardar o conteúdo das páginas como um blob JSON opaco, sem interpretar a estrutura dos elementos.

### Key Entities

- **Nota**: título, pasta (opcional), datas de criação/edição, exclusão (tombstone) e páginas.
- **Página**: lista ordenada de elementos.
- **Elemento**: união por `type` — `stroke`, `shape`, `arrow`, `text`, `sticky`, `checklist`, `image` — com posição, tamanho, rotação e estilo.
- **Pasta**: nome, dona de várias notas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma nota nova está pronta para digitar sem nenhum clique extra.
- **SC-002**: Nenhuma edição feita offline se perde depois que a conexão volta.
- **SC-003**: A busca encontra texto de qualquer página, adesivo ou checklist.
- **SC-004**: O PNG exportado tem a página inteira em resolução real, não só a área visível.

## Assumptions

- Uso pessoal: sem colaboração em tempo real nem compartilhamento entre usuários.
- Sem reconhecimento de escrita à mão.
- A lixeira de notas foi acrescentada depois pela spec 018; as demais ideias do Roadmap têm specs próprias (019 a 024).
