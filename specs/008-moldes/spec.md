# Feature Specification: Moldes (gerador de moldes planificados)

**Feature Branch**: `008-moldes` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `features/moldes`, `Services/Moldes/AnalisadorDeEmbalagem.cs`, `Endpoints/MoldesEndpoints.cs` e seção "Moldes" do README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Gerar um molde por medidas (Priority: P1)

A pessoa escolhe o tipo (caixa milk, caixa de bombom, sacolinha, pirâmide, cone, topo de bolo, topper com foto), digita as medidas em cm e vê a folha pronta, com linhas de corte e dobra, aba de cola e espessura do papel.

**Why this priority**: É o uso principal; roda todo no navegador, sem backend.

**Independent Test**: Gerar uma caixa milk 6×6×10 cm, exportar o DXF, abrir no Silhouette Studio Basic e ver as camadas CORTE e DOBRA.

**Acceptance Scenarios**:

1. **Given** medidas digitadas, **When** a pessoa volta outro dia, **Then** as medidas estão lembradas (localStorage).
2. **Given** a caixa de bombom, **When** é gerada, **Then** a tampa sai maior que o fundo por duas espessuras de papel + 1 mm, com janela opcional.
3. **Given** uma pirâmide de 3 a 8 lados, **When** é gerada, **Then** a planificação gira sozinha no ângulo que ocupa menos folha.
4. **Given** um cone muito aberto, **When** não cabe, **Then** sai em duas metades.
5. **Given** caixa milk ou sacolinha grandes, **When** a pessoa escolhe "duas metades", **Then** cabem em A4.

---

### User Story 2 - Escolher como sai a dobra e a folha (Priority: P1)

Dobras como linha azul separada (Vinco/Perfurar no Studio), tracejado já cortado (funciona no Studio Basic) ou omitidas. Folha A4/Carta/A3/base 30×30/30×60 com margem, orientação automática, cópias e espaço entre peças. Exporta SVG em mm, DXF R12 (camadas CORTE/DOBRA/PAGINA) e ZIP com todas as folhas.

---

### User Story 3 - Topo de bolo e topper com foto (Priority: P2)

Topo com nome em qualquer fonte do catálogo do Editor de Imagens, barra ligando as letras, borda, 0–3 palitos e camada do texto como peça separada. Topper com foto em círculo, oval, coração, retângulo, estrela ou contorno de PNG, com PNG de impressão 300 DPI do mesmo tamanho da folha de corte.

---

### User Story 4 - Molde a partir de imagem (Priority: P2)

- Caixa no formato de um desenho (PNG sem fundo): frente, verso e lateral com abas que acompanha a curva, dividida em pedaços se for comprida.
- Molde decalcado de foto/scan: cantos do papel achados (ou arrastados), homografia, escala pelo tamanho do papel, contorno vira corte, vãos pequenos viram furo, linhas internas (inclusive tracejadas) viram dobra; revisão com um clique por linha (corte/dobra/ignorar) e escala ajustável.
- Reconhecer embalagem por foto (IA): o provedor configurado devolve tipo e medidas estimadas; uma medida real informada dá a escala e prevalece.

**Independent Test**: Fotografar um molde de caixa em A4, revisar as linhas e exportar o DXF com corte e dobra corretos.

### Edge Cases

- Sem chave de IA com leitura de imagem, o reconhecimento por foto fica indisponível; o resto da ferramenta funciona.
- Valores devolvidos pela IA são conferidos antes de preencher o gerador.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O gerador MUST rodar no navegador sem backend, exceto o reconhecimento por IA.
- **FR-002**: Cada tipo de molde MUST ser um gerador declarativo (`TipoMolde`) registrado no catálogo; a tela monta o formulário a partir dos campos.
- **FR-003**: O sistema MUST considerar a espessura do papel nas dimensões dos painéis.
- **FR-004**: O sistema MUST exportar SVG em mm, DXF R12 com camadas CORTE/DOBRA/PAGINA e ZIP com todas as folhas.
- **FR-005**: O decalque MUST endireitar a foto por homografia e escalar pelo tamanho do papel.
- **FR-006**: Geometria e visão computacional MUST ficar fora do Angular e ter testes (`moldes.spec.ts`, `decalque.spec.ts`).

### Key Entities

- **Tipo de molde**: campos declarativos, gerador de peças.
- **Peça**: caminhos de corte, dobra e furo.
- **Folha**: tamanho, margem, orientação, cópias e espaçamento.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um molde montado com as medidas digitadas fecha sem folga visível (tampa sobre fundo, abas casando).
- **SC-002**: O DXF abre no Silhouette Studio Basic sem conversão.

## Assumptions

- A máquina-alvo principal é a Silhouette.
- Medidas em cm na tela, arquivos em mm.
