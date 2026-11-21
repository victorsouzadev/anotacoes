# Feature Specification: Simulador de Bolo 3D

**Feature Branch**: `009-bolo-3d` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

> **Spec 034 (21/11/2026)**: extraída do núcleo para o plug-in **congelado** [hub-criativo](https://github.com/victorsouzadev/hub-criativo), com as mesmas URLs (rotas legadas), as mesmas tabelas e os mesmos testes. Os caminhos de arquivo citados abaixo ficam lá.

**Input**: Levantamento do código existente: `features/cake` (rota `/bolo-3d`) e seção "Simulador de Bolo 3D" do README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Montar um bolo e ver em 3D (Priority: P1)

A pessoa escolhe camadas, formato, sabores, cobertura, granulado, cerejas e velas (que acendem) e gira o bolo em 3D.

**Why this priority**: É a função inteira da ferramenta.

**Independent Test**: Montar um bolo de três camadas com velas acesas e girar a visualização.

**Acceptance Scenarios**:

1. **Given** um bolo montado, **When** a pessoa muda o número de camadas, **Then** a visualização atualiza na hora.

---

### User Story 2 - Posicionar fotos no bolo (Priority: P2)

Fotos entram por botão, arrastar-e-soltar ou Ctrl+V e são posicionadas em cm no topo ou na parede, com um minimapa 2D com régua.

**Independent Test**: Colar uma foto e posicioná-la a 2 cm da borda do topo.

### Edge Cases

- Recarregar a página perde o bolo: nada é persistido (decisão consciente).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O simulador MUST renderizar o bolo em 3D só com CSS (cada camada um prisma de N faces).
- **FR-002**: O simulador MUST aceitar fotos por botão, arrastar-e-soltar e colar, posicionadas em cm.
- **FR-003**: O simulador MUST NOT persistir dados.

### Key Entities

- **Bolo (em memória)**: camadas, formato, sabores, cobertura, decorações, velas e fotos posicionadas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Mudanças aparecem na visualização sem atraso perceptível.

## Assumptions

- É uma brincadeira de sessão única, sem conta nem backend.
