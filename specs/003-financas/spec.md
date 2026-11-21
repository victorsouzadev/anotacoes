# Feature Specification: Finanças

> **Onde o código mora (spec 035)**: no plug-in `financas`, repositório [hub-financas](https://github.com/victorsouzadev/hub-financas). Os caminhos do núcleo citados abaixo (`backend/Notas.Api`, `frontend/src/app/features`) são de antes da extração.

**Feature Branch**: `003-financas` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `features/financas`, `Endpoints/Financas*.cs`, `Endpoints/OrcamentoEndpoints.cs`, `Endpoints/MetaEndpoints.cs`, `Endpoints/PlanejamentoEndpoints.cs`, `Endpoints/AuvpEndpoints.cs`, `Endpoints/ChatFinanceiroEndpoints.cs`, `Services/Financas`, `Mcp/FinancasMcpTools.cs` e seção "Finanças" do README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lançar gasto ou receita por texto livre (Priority: P1)

A pessoa escreve como falaria ("gastei 45 no mercado hoje", "recebi 3000 de salário dia 05/07") e o sistema extrai descrição, valor, tipo, categoria, data, forma de pagamento e uma nota de confiança. Abaixo do limiar de confiança (padrão 0,6) o lançamento fica "pendente de revisão".

**Why this priority**: É o jeito mais rápido de registrar e o que deu origem à ferramenta.

**Independent Test**: Sem chave de IA, digitar "gastei 45 no mercado hoje" e ver o lançamento criado pelo extrator heurístico, com confiança baixa e pendente de revisão.

**Acceptance Scenarios**:

1. **Given** uma chave de LLM configurada, **When** a pessoa envia o texto, **Then** o lançamento é criado com os campos extraídos pelo modelo.
2. **Given** nenhuma chave, **When** a pessoa envia o texto, **Then** o extrator local por regras assume, com confiança menor.
3. **Given** um lançamento pendente, **When** a pessoa confirma ou corrige, **Then** ele deixa de ser pendente.

---

### User Story 2 - Importar de arquivo (Priority: P2)

Foto de cupom, PDF de extrato ou planilha de fatura viram lançamentos lidos pelo LLM.

**Independent Test**: Enviar o PDF de uma fatura e revisar os lançamentos propostos.

**Acceptance Scenarios**:

1. **Given** nenhuma chave de LLM, **When** a pessoa tenta importar arquivo, **Then** a tela explica que a leitura de documentos exige a chave.

---

### User Story 3 - Importar do open banking pela AUVP (Priority: P1)

Com `AUVP_BASE_URL` no servidor, a pessoa cadastra a própria chave da AUVP (cifrada) e sincroniza. As transações chegam sem duplicar, as categorias vêm das tags da AUVP ou do open banking, e a sincronização se repete sozinha a cada `AUVP_INTERVALO_HORAS` (padrão 6).

**Why this priority**: É a fonte principal de dados reais; sem ela o resto depende de digitação.

**Independent Test**: Sincronizar duas vezes seguidas e conferir que nenhum lançamento duplicou e que o total do mês bate com o painel da AUVP.

**Acceptance Scenarios**:

1. **Given** a primeira sincronização, **When** ela termina, **Then** todas as transações estão no hub; nas seguintes, só os últimos 45 dias são relidos.
2. **Given** uma transação ignorada na AUVP ou transferência entre contas próprias, **When** ela chega, **Then** aparece riscada e fora dos totais, gráficos e orçamento.
3. **Given** um lançamento importado que a pessoa corrigiu, **When** a sincronização roda de novo, **Then** a correção não é sobrescrita.
4. **Given** um lançamento importado que a pessoa apagou, **When** a sincronização roda, **Then** ele não volta.
5. **Given** o Cloudflare da AUVP barrando o IP do servidor, **When** a sincronização falha, **Then** a tela mostra "bloqueou a conexão deste servidor"; com `AUVP_PROXY`, só as chamadas à AUVP saem por outro IP.
6. **Given** um lançamento vindo da AUVP, **When** a pessoa muda categoria, tags, orçamento AUVP, descrição, observações ou "fora dos totais", **Then** a mudança também é gravada na AUVP; se a AUVP recusar, fica salva localmente e a tela mostra o motivo. Valor, tipo e data não vão para a AUVP.

---

### User Story 4 - Ver o painel do mês (Priority: P1)

Primeira aba: saldo do mês, receitas, despesas, maior categoria, gasto médio por dia com projeção até o fim do mês, variação contra o mês anterior, 5 maiores despesas, gastos por conta/cartão, pizza por categoria e linha de receitas × despesas.

**Independent Test**: Com lançamentos de dois meses, abrir o painel e conferir saldo, variação e gráficos.

**Acceptance Scenarios**:

1. **Given** uma compra no cartão, **When** o painel soma o mês, **Then** ela conta no mês da fatura (competência); lançamentos digitados contam no mês da própria data.
2. **Given** pendências na fila de categorização, **When** o painel abre, **Then** mostra um aviso.

---

### User Story 5 - Lista, categorização e regras aprendidas (Priority: P2)

A lista tem busca, filtros por tag e conta, seleção múltipla para mudar categoria, orçamento, tag ou "fora dos totais", e mostra parcela, conta, tags e orçamento AUVP. Corrigir a categoria de uma loja ensina uma regra para os próximos lançamentos e oferece aplicar aos parecidos. A aba Categorizar agrupa o que está sem categoria confirmada por loja (PIX pelo destinatário) com sugestão, e um clique resolve o grupo inteiro.

**Independent Test**: Categorizar um grupo de "Padaria X" e ver o próximo lançamento dessa loja já entrar certo.

**Acceptance Scenarios**:

1. **Given** uma transação nova da AUVP, **When** ela chega, **Then** entra na fila de Categorizar mesmo que já tenha categoria sugerida, até a pessoa confirmar ou trocar.
2. **Given** um pagamento de fatura, **When** aparece na fila, **Then** a sugestão é tirá-lo dos totais.

---

### User Story 6 - Orçamento mensal e metas de reserva (Priority: P2)

A pessoa define um valor mensal e distribui entre categorias, acompanha planejado × realizado, histórico e alertas de estouro; cria metas de reserva e acompanha o progresso. A aba Orçamento mostra também o método AUVP como está lá.

**Independent Test**: Criar um orçamento com teto em "Alimentação", lançar acima e ver o alerta.

---

### User Story 7 - Planejamento (Priority: P3)

Saúde financeira (taxa de poupança, reserva de emergência, pague-se primeiro, base zero, independência financeira pela regra dos 4%), divisão da renda (50/30/20, AUVP, 6 Potes), fluxo de caixa previsto 30/60/90 dias com aviso do primeiro dia negativo, dívidas (bola de neve × avalanche), gastos anuais divididos por 12, envelopes e fechamento do mês (Kakeibo). Cada seção tem "Como funciona". Investimento e pagamento de fatura não contam como consumo.

**Independent Test**: Cadastrar duas dívidas e comparar prazo e juros nos dois métodos.

---

### User Story 8 - Perguntar sobre as finanças (Priority: P3)

Na aba Chat a pessoa pergunta em português ("quanto gastei com iFood nos últimos 3 meses?"). O modelo não recebe os dados de antemão: pede consultas somente leitura (resumo do mês, busca, evolução, saúde, metas, dívidas, recorrentes, parcelas) e o backend executa sobre os dados do usuário. A conversa fica só no navegador.

**Independent Test**: Perguntar o total de uma categoria num período e conferir com a lista filtrada.

**Acceptance Scenarios**:

1. **Given** o provedor heurístico, **When** a pessoa abre o chat, **Then** a tela pede para configurar uma chave.

---

### User Story 9 - Análises e exportação (Priority: P3)

Contas e cartões ao vivo (saldo, fatura aberta, limite livre), gastos por tag, recorrentes dos últimos 6 meses, parcelas comprometidas nos próximos 12 meses e exportação em CSV. A primeira visita abre um tutorial guiado; o "?" reabre.

### Edge Cases

- Servidor em modo globalization-invariant: formatação pt-BR não pode depender de cultura instalada (bug histórico que derrubou o painel com 500).
- Fuso: "hoje" e o mês corrente são calculados no fuso do usuário, não do servidor.
- Reembolso ou transferência não reconhecida pelo banco: a pessoa tira do total pelo botão de olho.
- Chat e extração por IA são limitados pela política de taxa `financas-ia`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST criar lançamentos a partir de texto livre via LLM, com fallback heurístico local sem chave.
- **FR-002**: Lançamentos com confiança abaixo de `Extracao:LimiarConfianca` MUST ficar pendentes de revisão.
- **FR-003**: O sistema MUST importar foto, PDF e planilha via LLM quando houver chave.
- **FR-004**: O sistema MUST sincronizar com a AUVP sem duplicar, preservando correções locais e exclusões, e repetir a sincronização no intervalo configurado.
- **FR-005**: Lançamentos marcados como fora dos totais MUST aparecer na lista e ficar fora de saldo, gráficos, orçamento e planejamento.
- **FR-006**: Os totais MUST somar por competência (mês da fatura para cartão).
- **FR-007**: Mudanças de classificação em lançamentos da AUVP MUST ser enviadas de volta à AUVP, sem bloquear a gravação local.
- **FR-008**: Corrigir a categoria MUST criar uma regra por loja aplicada aos próximos lançamentos de qualquer origem.
- **FR-009**: O sistema MUST oferecer orçamento mensal por categoria, metas de reserva, planejamento, análises, chat por ferramentas somente leitura e exportação CSV.
- **FR-010**: A chave da AUVP MUST ser guardada cifrada, por usuário.
- **FR-011**: As mesmas consultas do chat MUST estar disponíveis no MCP `/api/mcp/financas`.

### Key Entities

- **Transação**: descrição, valor, tipo (receita/despesa), categoria, data, mês de competência, conta, forma de pagamento, parcela, tags, confiança, pendente, fora dos totais, origem (digitado/arquivo/AUVP) e id externo.
- **Regra de categoria**: loja/padrão → categoria, por usuário.
- **Orçamento e item de orçamento**: valor mensal e distribuição por categoria.
- **Meta de reserva**: valor alvo e progresso.
- **Dívida, gasto anual, fechamento do mês**: dados do planejamento.
- **Credencial AUVP**: chave cifrada e estado da última sincronização.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um gasto digitado vira lançamento em menos de 5 segundos.
- **SC-002**: Os totais do mês batem com o painel da AUVP para quem sincroniza.
- **SC-003**: Sincronizações repetidas não geram nenhum lançamento duplicado.
- **SC-004**: Depois de categorizar uma loja uma vez, os próximos lançamentos dela chegam certos.

## Assumptions

- A AUVP é o único agregador de open banking suportado.
- O chat não guarda histórico no servidor.
- Uso pessoal: sem contas compartilhadas entre usuários.
