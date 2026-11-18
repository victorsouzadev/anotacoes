# Feature Specification: Precificação (papelaria personalizada)

**Feature Branch**: `013-precificacao` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `features/precificacao` (`calc.ts`, `models.ts`, `precificacao-storage.service.ts`, página) e `Endpoints/ViihMimosEndpoints.cs`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Calcular o preço de um produto (Priority: P1)

A pessoa preenche a ficha do produto (categoria, quantidade produzida e vendida, perda) com matéria-prima e insumos (preço pago ÷ quantidade comprada × quantidade usada), mão de obra (minutos por atividade × valor da hora), hora-máquina (depreciação + manutenção por hora × tempo), embalagem, energia, custos fixos rateados, outros custos, taxas de venda, impostos, margem, desconto, personalização e urgência. O resultado mostra custo total, preço mínimo, preço sugerido, preço unitário final, lucro e margem líquida real.

**Why this priority**: É a função da ferramenta.

**Independent Test**: Montar uma caixa milk com dois materiais, 30 min de trabalho e uma máquina, e conferir o preço sugerido com a conta à mão.

**Acceptance Scenarios**:

1. **Given** taxas + impostos + margem ≥ 100%, **When** a pessoa calcula, **Then** a tela avisa que a composição é impossível em vez de mostrar um preço.
2. **Given** um desconto máximo, **When** o preço é anunciado, **Then** ele é o necessário ÷ (1 − desconto), para o desconto não corroer a margem.
3. **Given** um pedido urgente, **When** marcado, **Then** a taxa de urgência é somada.

---

### User Story 2 - Configurações reutilizáveis (Priority: P1)

Hora de trabalho (remuneração mensal desejada ÷ horas por dia × dias por mês), margem, perda e desconto padrão, taxa de urgência, taxas de venda padrão, impostos, equipamentos, custos fixos mensais, produção mensal estimada, energia (conta × % produção ÷ horas produtivas, ou custo direto) e faixas de desconto por quantidade.

---

### User Story 3 - Simular, comparar e guardar (Priority: P2)

Simulação de margens, venda por quantidade (faixas), composição do custo e histórico de cálculos (até 300 entradas).

---

### User Story 4 - Fichas e orçamentos no painel da Viih Mimos (Priority: P2)

Para os e-mails liberados, fichas, configuração, histórico e orçamentos são lidos e gravados no banco do painel da Viih Mimos pelo hub (`/api/precificacao/*` repassa para `/api/precos/*` do painel com a chave). Na primeira vez ligado, se o painel está vazio, o que estava no navegador é levado para lá uma vez só. O preço exportado para o catálogo usa a mesma conta do painel. Orçamentos numerados com cliente, validade, condições e itens, com a identidade visual Viih Mimos, prontos para imprimir ou enviar.

**Independent Test**: Com a ligação ativa, salvar uma ficha e vê-la no painel da Viih Mimos.

**Acceptance Scenarios**:

1. **Given** a ligação desligada ou e-mail fora da lista, **When** a tela abre, **Then** avisa em vez de mostrar lista vazia, e a calculadora segue no navegador.
2. **Given** o painel responde 401 (chave errada), **Then** a pessoa não é deslogada do hub.

### Edge Cases

- Quantidade comprada zero ou vida útil zero: custo do item ou depreciação dá 0, sem dividir por zero.
- O navegador fica como cópia local mesmo depois da migração para o painel.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Os cálculos MUST ser funções puras sem Angular, testadas (`calc.spec.ts`, `factory.spec.ts`).
- **FR-002**: O sistema MUST calcular custo total, preço mínimo (sem margem), preço sugerido, preço com desconto, lucro e margem real.
- **FR-003**: O sistema MUST recusar composições percentuais impossíveis.
- **FR-004**: Configurações gerais MUST ser reaproveitadas em qualquer ficha nova.
- **FR-005**: Com a ligação ativa, fichas, configuração, histórico e orçamentos MUST ficar no banco do painel da Viih Mimos, só para os e-mails liberados.
- **FR-006**: A migração do navegador para o painel MUST acontecer uma vez só e não duplicar.

### Key Entities

- **Ficha de produto**: categoria, quantidades, perda, materiais, insumos, atividades, usos de máquina, embalagem, custos, taxas, personalização.
- **Configuração**: hora de trabalho, padrões, taxas, impostos, equipamentos, custos fixos, energia, faixas de quantidade.
- **Equipamento**: preço, valor residual, vida útil em horas, manutenção por hora, consumo.
- **Histórico**: produto e resultados numa data.
- **Orçamento**: número, data, validade, cliente, condições, observações e itens.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O preço sugerido bate com a conta feita à mão para qualquer ficha de teste.
- **SC-002**: Um orçamento fica pronto para enviar ao cliente em menos de 2 minutos.

## Assumptions

- Feita para a papelaria Viih Mimos; as categorias padrão (topo de bolo, caixas, convite, tag…) refletem isso.
- O painel da Viih Mimos é outro sistema; o hub só repassa as chamadas.
