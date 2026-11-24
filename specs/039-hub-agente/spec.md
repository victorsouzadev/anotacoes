# Feature Specification: Agente de plug-ins do hub (hub-agente)

**Feature Branch**: na branch da sessão

**Created**: 2026-11-22

**Status**: Draft

**Input**: "Plug-in hub-agente: um plug-in novo na VPS que roda um agente com a skill plugin-hub. Duas funções: (1) criar o esqueleto de um plug-in a partir de uma descrição feita numa tela do hub e abrir um PR para revisão, sem nada ir para a VPS ou para o plugins.lock sozinho; (2) diagnóstico só de leitura de um plug-in com relatório. Login do núcleo, chaves em data/plugins/env. Expõe um MCP com: ler plugins.lock, estado do deployer, health e última falha; disparar o agente e acompanhar; ler e validar plugin.json contra o schema e as regras do deployer."

## Clarifications

### Session 2026-11-22

- Q: O que o agente faz? → A: As duas coisas: cria o esqueleto de um plug-in e diagnostica um plug-in que já existe.
- Q: Onde roda? → A: Num plug-in novo na VPS (`agente`), com container próprio e login do núcleo. As chaves ficam na configuração do plug-in na VPS.
- Q: O que o MCP expõe? → A: Os plug-ins e o estado de cada um, o disparo e o acompanhamento do agente, e a validação de manifestos.
- Q: Que chaves o agente usa? → A: As que já existem no hub: a IA configurada pelo dono em Configurações (a mesma que os outros plug-ins recebem do núcleo), sem chave própria do agente. O hub não guarda token do GitHub; esse é o único segredo novo.
- Q: Gastar o mínimo com IA? → A: Usar a assinatura do Claude do dono (token de longa duração do Claude Code) no lugar da chave de API do hub, para não ter custo extra (decidido em 2026-11-23).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Diagnóstico de um plug-in (Priority: P1)

O dono do hub abre a tela do Agente, ou pede pelo Claude via MCP, escolhe um plug-in com problema e pede um diagnóstico.
O agente junta, só lendo:
- o estado que o deployer registrou e a última falha;
- a resposta do health;
- o fim do log do plug-in;
- as permissões do papel dele no banco.

Depois devolve um relatório curto, com o que está errado, a causa provável e o que fazer. O agente não faz nada sozinho.

**Why this priority**: É a parte que não grava nada em lugar nenhum. Entrega valor no primeiro dia, com risco mínimo, e
testa o caminho todo: login, leitura do estado, agente e relatório.

**Independent Test**: Fazer o health de um plug-in de teste falhar de propósito e pedir o diagnóstico. O relatório aponta
o health e a última falha, e nada muda na VPS.

**Acceptance Scenarios**:

1. **Given** um plug-in no ar e saudável, **When** o dono pede o diagnóstico, **Then** o relatório diz que está tudo bem e mostra a versão, o health e a última falha, se houver.
2. **Given** um plug-in cujo health falha, **When** o dono pede o diagnóstico, **Then** o relatório mostra a falha registrada, as linhas relevantes do fim do log e a causa provável, tirada de uma tabela de sintomas conhecidos.
3. **Given** um diagnóstico em andamento, **When** o dono fecha a tela e volta depois, **Then** ele vê o andamento ou o relatório pronto.
4. **Given** qualquer diagnóstico, **When** ele termina, **Then** nenhum container, arquivo, banco ou permissão foi alterado.

---

### User Story 2 - Esqueleto de um plug-in novo (Priority: P2)

O dono descreve uma ferramenta nova numa tela: o nome, para que serve e se usa IA, MCP ou app Android. O agente pergunta
o que faltar (id, URLs antigas, congelado ou não), mostra o plano e espera o "sim".

Com o plano aprovado, o agente cria o repositório `hub-<id>` a partir do modelo, com:
- o manifesto;
- o login do núcleo;
- o banco no schema do plug-in;
- uma tela no visual do hub;
- os testes.

Depois abre um pull request para revisão. No fim, entrega o link do PR e a lista do que falta para pôr o plug-in no ar
(os passos na VPS e a linha no registro de plug-ins). Esses passos continuam com o dono.

**Why this priority**: É o objetivo maior, mas grava fora da VPS (no GitHub) e depende do diagnóstico e do MCP para ser
conferido. Por isso vem depois.

**Independent Test**: Pedir um plug-in de teste chamado "lembretes". O repositório é criado, a CI dele passa e o PR fica
aberto. O registro de plug-ins do núcleo e a VPS não mudam.

**Acceptance Scenarios**:

1. **Given** uma descrição sem id, **When** o dono envia, **Then** o agente pergunta o id e só segue depois da resposta.
2. **Given** um id que já existe no registro ou no GitHub, ou que cai numa rota reservada, **When** o agente confere o plano, **Then** ele recusa e explica por quê.
3. **Given** o plano aprovado, **When** o agente termina, **Then** existe um PR aberto com o esqueleto e a CI do repositório novo passou, ou o relatório mostra a falha.
4. **Given** o agente terminou, **When** o dono olha o registro de plug-ins e a VPS, **Then** nada mudou: o agente nunca faz merge, nunca altera o registro e nunca grava na VPS.

---

### User Story 3 - O Claude conversa com o agente pelo MCP (Priority: P3)

Num chat com o Claude, o dono pergunta "como estão os plug-ins?" ou pede "valide este plugin.json". Pelo conector do
agente, o Claude:
- lista os plug-ins, com versão, situação, health e última falha;
- valida um manifesto contra as mesmas regras que o deployer usa;
- dispara um diagnóstico ou um esqueleto e acompanha até o fim.

**Why this priority**: Reaproveita tudo das histórias 1 e 2. É a porta de entrada mais cômoda, mas não a única.

**Independent Test**: Conectar o MCP num cliente, listar os plug-ins e validar um manifesto com um erro conhecido, como
uma rota reservada. O erro aparece junto com a regra que falhou.

**Acceptance Scenarios**:

1. **Given** o conector ligado, **When** o Claude pede a lista, **Then** vêm todos os plug-ins do registro, com versão, situação e última falha.
2. **Given** um manifesto com rota reservada ou com o prefixo de tabela de outro plug-in, **When** ele é validado, **Then** a resposta lista cada regra violada.
3. **Given** um esqueleto disparado pelo MCP, **When** o agente precisa de uma resposta (o id, a aprovação do plano), **Then** a pergunta aparece no acompanhamento e a execução espera.

### Edge Cases

- Dois pedidos ao mesmo tempo: o segundo espera na fila, porque roda uma execução por vez, e o dono vê a posição.
- A execução passa do limite de tempo ou de custo: ela para, guarda o que já fez e o relatório diz onde parou.
- O token da assinatura do Claude falta, expirou ou o limite de uso da assinatura acabou, ou o token do GitHub falta ou expirou: a tela diz o que falta, sem mostrar valores, e nada começa.
- Um texto lido num log ou num repositório tenta dar ordens ao agente: esse texto é tratado como dado, nunca como instrução.
- O plug-in pedido no diagnóstico não existe ou está desligado no registro: o relatório diz isso, sem erro.
- O agente tenta uma ação fora da lista permitida, como gravar na VPS, fazer merge ou mexer no registro: a ação é recusada e registrada.
- Quem abre a ferramenta não é o dono do hub: ele não vê a ferramenta nem o MCP.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O agente MUST ser uma ferramenta do hub como as outras: aparece no hub, usa o login do núcleo e só abre para o dono (administrador) do hub.
- **FR-002**: O diagnóstico MUST só ler: o estado e a última falha registrados pelo deployer, o health, o fim do log do plug-in e as permissões do papel dele no banco. Não grava nada na VPS, no banco ou nos containers.
- **FR-003**: O agente MUST NOT ter acesso direto ao controle dos containers nem às chaves do núcleo. O que ele lê da VPS vem de leituras oferecidas pelo núcleo ou pelo serviço de operação, restritas ao necessário.
- **FR-004**: O relatório do diagnóstico MUST trazer a situação (ok, com aviso ou fora do ar), as evidências em trechos curtos, a causa provável e os próximos passos sugeridos, sem nenhum segredo.
- **FR-005**: O esqueleto MUST seguir a skill de plug-ins do hub: manifesto válido, login do núcleo, banco no schema do id, tela no visual do hub, testes e CI.
- **FR-006**: Antes de criar qualquer coisa, o agente MUST mostrar o plano (id, nome, rota, prefixo de tabelas e o que entra) e esperar a aprovação do dono.
- **FR-007**: O agente MUST criar o repositório novo e abrir um pull request. Ele MUST NOT fazer merge, alterar o registro de plug-ins do núcleo, gravar na VPS ou mexer em outro repositório.
- **FR-008**: O resultado do esqueleto MUST terminar com o link do PR, o estado da CI e a lista dos passos manuais que faltam para pôr o plug-in no ar.
- **FR-009**: O agente MUST perguntar ao dono o que não puder decidir sozinho (id, URLs antigas, uso de IA, MCP ou Android, congelado ou não), e a execução espera a resposta.
- **FR-010**: Cada execução MUST ter acompanhamento, com o estado (na fila, rodando, esperando resposta, concluída, falhou ou cancelada), os passos feitos, as perguntas e o resultado. O dono pode cancelar.
- **FR-011**: Cada execução MUST ter limite de tempo e de custo. Ao passar do limite, ela para e registra onde parou.
- **FR-012**: O histórico das execuções MUST ficar guardado (pedido, estado, relatório e link do PR) para o dono consultar depois.
- **FR-013**: O MCP MUST oferecer:
  - a lista dos plug-ins, com versão, situação, health e última falha;
  - a validação de um manifesto contra o schema e as regras do deployer;
  - o disparo de um diagnóstico ou de um esqueleto;
  - o acompanhamento de uma execução, com resposta às perguntas e cancelamento.
- **FR-014**: A validação de manifesto MUST usar as mesmas regras que o deployer usa ao subir um plug-in, e listar cada regra violada.
- **FR-015**: Todo conteúdo lido (logs, repositórios, manifestos) MUST ser tratado como dado. Nenhuma instrução vinda dele muda o que o agente pode fazer.
- **FR-016**: A IA do agente MUST vir da assinatura do Claude do dono, por um token de longa duração gerado por ele, e não de chave de API paga por uso. O agente não usa a chave de IA do hub.
- **FR-017**: Se o token da assinatura faltar, expirar ou o limite de uso acabar, a tela MUST dizer isso (e, no limite, quando volta), e nada começa ou a execução para guardando onde parou.
- **FR-018**: O token do GitHub e o token da assinatura MUST ficar só na configuração do plug-in na VPS. Nenhuma chave aparece no git, na tela, no relatório ou no log.

### Key Entities

- **Execução**: um pedido ao agente. Tem o tipo (diagnóstico ou esqueleto), quem pediu, o alvo (um plug-in ou uma descrição), o estado, os passos, as perguntas e respostas, o resultado (relatório ou link do PR), e o custo e o tempo gastos.
- **Relatório de diagnóstico**: a situação de um plug-in num momento, com as evidências, a causa provável e os próximos passos.
- **Plano de esqueleto**: o id, o nome, a rota, o prefixo de tabelas e os recursos (IA, MCP, Android, rotas antigas) aprovados pelo dono.
- **Resultado da validação**: o manifesto conferido e a lista de regras violadas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Num ensaio com falhas provocadas, um diagnóstico termina em até 3 minutos e acerta a causa em pelo menos 4 dos 6 sintomas conhecidos da skill.
- **SC-002**: Em 100% dos diagnósticos, nada muda na VPS, conferido comparando o estado antes e depois.
- **SC-003**: No ensaio com um plug-in de teste, um esqueleto aprovado vira um PR com a CI verde em até 20 minutos, sem retoque manual.
- **SC-004**: Em 100% das execuções, o registro de plug-ins do núcleo e a VPS continuam iguais, e o agente não faz nenhum merge.
- **SC-005**: Nenhuma chave aparece em tela, relatório, log ou PR: uma busca pelos valores dá zero resultados.
- **SC-006**: A validação de manifesto dá o mesmo veredito do deployer em todos os casos dos testes do deployer.

## Assumptions

- Só o dono do hub usa o agente. Uso por outras pessoas fica fora desta spec.
- O agente segue a skill `plugin-hub` deste repositório, na versão que vai junto com a imagem do plug-in.
- A IA não tem custo extra: sai do limite da assinatura do dono, dividido com o uso dele. O token da assinatura é gerado pelo dono com `claude setup-token`, vale até um ano e fica em `data/plugins/env/agente.env`. O limite por execução (tempo e turnos) é definido no plano.
- O token do GitHub é novo e mínimo (decidido em 2026-11-23). É um token de acesso granular, com validade de no máximo 90 dias, que só permite criar repositórios a partir do `hub-modelo`, gravar conteúdo e workflows, e abrir PRs. Ele não permite apagar repositórios nem mexer em configuração, segredos ou membros. Quem gera o token e grava em `data/plugins/env/agente.env` é o dono. Como o GitHub só deixa criar repositório com um token que vale para a conta toda, o próprio agente se limita: só grava no repositório que acabou de criar, e recusa e registra qualquer tentativa em outro (FR-007).
- A expiração do token aparece no hub com 7 dias de antecedência, junto com o caminho para trocar.
- As leituras da VPS (estado, logs, permissões) passam pelo serviço de operação (`ops`) ou pelo núcleo. O agente nunca recebe o controle do Docker, que continua só com o deployer.
- Uma execução por vez é suficiente.
- Pôr o plug-in novo no ar (papel no banco, registro de plug-ins) continua manual e com confirmação, como na skill.
