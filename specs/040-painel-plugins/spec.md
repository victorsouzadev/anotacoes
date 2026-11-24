# Feature Specification: Painel de plug-ins (pôr no ar, atualizar, voltar e desligar)

**Feature Branch**: na branch da sessão

**Created**: 2026-11-24

**Status**: Draft

**Input**: "No agente não tem interface para isso?" (pôr no ar o devocional, o primeiro plug-in criado pelo agente). O dono pediu para ligar o devocional à mão e depois escrever a spec da interface.

## Clarifications

### Session 2026-11-24

- Q: A interface dá mais poder ao agente de IA? → A: Não. Pôr no ar é uma ação da pessoa, em código comum. A regra da 039 continua: a IA nunca grava na VPS, nunca mexe no registro e nunca faz merge.
- Q: Quem faz o merge do registro? → A: O dono, no GitHub. O botão só abre o PR (padrão recomendado, a confirmar com o dono).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver os plug-ins e o que falta em cada um (Priority: P1)

O dono abre o painel e vê cada ferramenta: versão no ar, versão anterior, health, última falha e memória usada. Quando uma
ferramenta nova ainda não está no ar, vê a lista do que falta (imagem, banco, conexão, permissões, registro).

**Why this priority**: Só lê. Responde à pergunta que originou a spec ("já mergeei, mas não está disponível") sem risco.

**Independent Test**: Com uma ferramenta mesclada e sem banco, o painel mostra "imagem publicada" e "falta: banco, registro".

**Acceptance Scenarios**:

1. **Given** plug-ins no ar, **When** o administrador abre o painel, **Then** vê versão, health, última falha e memória de cada um.
2. **Given** um repositório `hub-<id>` do dono com imagem publicada e fora do registro, **When** o painel abre, **Then** ele aparece como "pronto para pôr no ar", com cada etapa feita ou pendente.
3. **Given** uma conta que não é administradora, **When** ela tenta abrir o painel ou os dados dele, **Then** recebe recusa de acesso.

---

### User Story 2 - Pôr no ar uma ferramenta nova (Priority: P2)

O dono clica em "Pôr no ar", vê o que será feito e confirma. O hub prepara o banco da ferramenta (papel, senha, conexão e
permissões) e abre o PR com a linha do registro. Depois do merge, o painel acompanha até a ferramenta responder ou falhar.

**Why this priority**: É o objetivo da spec, mas grava na VPS e no GitHub, e depende da US1 para conferir o resultado.

**Independent Test**: Pôr no ar uma ferramenta de teste só pelo painel, fazendo apenas o merge no GitHub.

**Acceptance Scenarios**:

1. **Given** uma ferramenta pronta, **When** o dono confirma, **Then** o banco, a conexão e as permissões dela existem, as outras ferramentas não mudam e há um PR aberto com uma única linha nova.
2. **Given** um id já preparado em parte, **When** o dono confirma de novo, **Then** só o que falta é feito e nenhuma senha existente muda.
3. **Given** o PR mesclado, **When** o deploy termina, **Then** o painel mostra "no ar" ou a falha registrada, e a falha não derruba outro plug-in.
4. **Given** pouca memória ou poucas conexões livres no banco, **When** o dono abre a confirmação, **Then** vê o aviso com os números antes de decidir.
5. **Given** um manifesto que viola o contrato, **When** o dono pede para pôr no ar, **Then** o hub recusa antes de gravar qualquer coisa e lista as regras violadas.

---

### User Story 3 - Atualizar, voltar e desligar (Priority: P3)

Para uma ferramenta no ar, o dono escolhe uma versão publicada (nova ou anterior) ou desliga. O hub abre o PR com a troca ou
com a linha comentada. Os dados nunca são apagados.

**Why this priority**: Usa o mesmo caminho da US2. Hoje é um PR manual.

**Independent Test**: Trocar a versão de uma ferramenta de teste, voltar e desligar, conferindo que os dados ficaram.

**Acceptance Scenarios**:

1. **Given** uma versão mais nova com CI verde, **When** o dono confirma atualizar, **Then** há um PR que muda só o commit daquela linha.
2. **Given** uma ferramenta congelada, **When** o dono pede para atualizar, **Then** o painel avisa e pede uma segunda confirmação.
3. **Given** uma ferramenta desligada, **When** o dono a liga de novo, **Then** os dados anteriores estão lá.

### Edge Cases

- O id já existe no registro, é reservado ou difere do `id` do manifesto: recusar antes de gravar.
- A imagem não existe, ou a CI da `main` falhou: não oferecer "Pôr no ar".
- O preparo do banco falha no meio: dizer qual etapa falhou; repetir só completa o que falta.
- O PR é fechado sem merge: o painel volta a "pronto"; o banco preparado fica, sem uso.
- Já há um PR aberto para o mesmo id: mostrar o link em vez de abrir outro.
- O token do GitHub falta ou venceu: a lista das ferramentas do registro continua; os botões explicam o que falta.
- Dois cliques, ou duas abas: só uma operação por id.
- A ferramenta precisa de configuração própria: o painel avisa, mas nunca lê nem recebe o segredo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O painel MUST listar os plug-ins do registro com versão, versão anterior, health, última falha, congelado e memória.
- **FR-002**: O painel MUST mostrar, para repositórios `hub-<id>` do dono fora do registro, as etapas feitas e pendentes.
- **FR-003**: Só administradores MUST acessar o painel e os dados dele.
- **FR-004**: Toda ação que grava MUST mostrar antes o que fará e exigir confirmação explícita.
- **FR-005**: O preparo do banco MUST ser repetível e tocar só no papel e no schema do id pedido; nunca redefinir a senha de outro papel nem a do núcleo.
- **FR-006**: A senha MUST ser gerada na VPS e nunca aparecer na tela, em log, em PR ou no histórico.
- **FR-007**: As permissões MUST ser dadas antes de ligar a ferramenta e ficar limitadas à referência aos usuários do núcleo.
- **FR-008**: O PR MUST mudar só a linha do id no registro, e o hub MUST NOT fazer merge.
- **FR-009**: O manifesto, o id e as rotas MUST ser conferidos com as mesmas regras do deployer antes de qualquer gravação.
- **FR-010**: A confirmação MUST mostrar a memória livre da VPS, o limite do plug-in e as conexões livres do banco, com aviso quando passar do limite definido.
- **FR-011**: Desligar ou voltar MUST NOT apagar tabelas, arquivos nem conexões.
- **FR-012**: O histórico MUST registrar quem fez, quando, qual id, a ação e o resultado, sem segredos.
- **FR-013**: O agente de IA MUST NOT poder disparar nenhuma ação desta spec, nem pelo MCP.
- **FR-014**: O acesso ao GitHub usado para o registro MUST servir só para abrir PR no arquivo do registro do núcleo; o hub MUST recusar qualquer outro arquivo ou repositório.

### Key Entities

- **Plug-in no painel**: id, situação (no ar, com falha, desligado, pronto), versões, health, memória e etapas pendentes.
- **Operação**: id, ação (pôr no ar, atualizar, voltar, desligar), autor, horários, etapas, resultado e link do PR.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma ferramenta nova vai do PR mesclado ao ar sem nenhum comando na VPS, com no máximo dois cliques no painel e um merge no GitHub.
- **SC-002**: Em até 10 s, o painel responde por que uma ferramenta mesclada não está disponível.
- **SC-003**: Em 100% das operações, as senhas e as permissões das outras ferramentas continuam iguais.
- **SC-004**: Nenhum segredo aparece em tela, log, PR ou histórico, conferido por teste automático.
- **SC-005**: Uma operação interrompida em qualquer etapa pode ser repetida até o fim sem intervenção manual.

## Assumptions

- O merge no GitHub segue sendo a trava final, porque dispara o deploy.
- O painel mora no hub ou junto do Agente; o plano decide, com a regra de menor privilégio.
- O núcleo já tem hoje acesso de administrador ao Postgres (ferramenta Publicar). O plano avalia usá-lo, em vez de dar esse acesso a outra peça.
- O token do GitHub do agente alcança todos os repositórios; o plano avalia um token separado, só do núcleo.
- Fora do escopo: criar a configuração própria das ferramentas, apagar ferramenta e dados, deploy do próprio núcleo e app Android.
- A VPS está com a memória no limite (cerca de 300 MB disponíveis e swap cheio em 2026-11-24, logo depois de um deploy): a spec avisa, mas não resolve.
