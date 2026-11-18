# Feature Specification: Hub, contas e configurações de IA

**Feature Branch**: `001-hub-contas` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `features/hub`, `features/auth`, `features/configuracoes`, `Endpoints/AuthEndpoints.cs`, `Endpoints/ConfiguracaoIaEndpoints.cs`, `Endpoints/DesktopAuthEndpoints.cs`, `Auth/TokenService.cs`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criar conta e entrar uma vez para todas as ferramentas (Priority: P1)

A pessoa cria uma conta com e-mail e senha, entra e cai na tela "Ferramentas". Daí abre qualquer ferramenta sem novo login, no navegador e nos apps Android.

**Why this priority**: Sem conta nenhuma ferramenta guarda dados no servidor; o login único é o que faz o hub ser um produto só.

**Independent Test**: Registrar, entrar, abrir Notas e Finanças e ver que nenhuma pede login; fechar o navegador e voltar no dia seguinte ainda logado.

**Acceptance Scenarios**:

1. **Given** um e-mail ainda não cadastrado, **When** a pessoa se registra com senha válida, **Then** a conta é criada e ela entra direto no hub.
2. **Given** uma conta existente, **When** a pessoa entra com e-mail e senha corretos, **Then** recebe uma sessão que vale para todas as ferramentas web e para os apps Android.
3. **Given** uma sessão ativa, **When** o token de acesso vence (15 min), **Then** ele é renovado sozinho com o token de atualização, sem a pessoa perceber.
4. **Given** um token de atualização já usado, **When** alguém tenta reutilizá-lo, **Then** a sessão é invalidada (detecção de reuso).
5. **Given** a pessoa clica em sair, **Then** o token de atualização é revogado.

---

### User Story 2 - Ver e abrir as ferramentas disponíveis (Priority: P1)

A tela inicial mostra um cartão por ferramenta, com ícone, nome, descrição e, quando houver, link para baixar o app Android ou a versão Windows. Ferramentas restritas (Publicar, Segundo Cérebro, Anotação) só aparecem para quem tem acesso; a Precificação aparece para todos, mas só grava no painel da Viih Mimos para os e-mails liberados.

**Why this priority**: É a porta de entrada de tudo.

**Independent Test**: Entrar com uma conta comum e ver só as ferramentas abertas; entrar com uma conta listada em `PUBLICADORES` e ver também o cartão Publicar.

**Acceptance Scenarios**:

1. **Given** uma conta fora das listas de acesso, **When** abre o hub, **Then** vê Notas, Finanças, Tarefas, Editor de Imagens, Moldes, Simulador de Bolo 3D e Precificação.
2. **Given** uma conta em `CEREBRO_USUARIOS`, com o serviço no ar e o hub aberto por HTTPS, **When** abre o hub, **Then** vê também o Segundo Cérebro.
3. **Given** o card Tarefas, **When** a pessoa clica em "Baixar app Android (.apk)", **Then** baixa o APK gerado no último deploy.

---

### User Story 3 - Configurar o provedor de IA (Priority: P2)

Em `/configuracoes` a pessoa escolhe o provedor (OpenRouter, Anthropic ou heurístico local), o modelo e cadastra a própria chave; pode testar a configuração e remover a chave. Também cadastra a chave da Replicate (ampliação e remoção de fundo).

**Why this priority**: Finanças, Dieta, Moldes e Editor de Imagens usam essa configuração, mas todos funcionam (de forma reduzida) sem ela.

**Independent Test**: Cadastrar uma chave, clicar em Testar e ver sucesso; remover a chave e ver o lançamento de Finanças cair para o extrator heurístico.

**Acceptance Scenarios**:

1. **Given** nenhuma chave do usuário, **When** uma ferramenta usa IA, **Then** vale a chave padrão do servidor (`.env`), ou o fallback local se não houver nenhuma.
2. **Given** uma chave cadastrada, **When** a tela é recarregada, **Then** a chave não é mostrada de volta (só a indicação de que existe).
3. **Given** uma configuração inválida, **When** a pessoa clica em Testar, **Then** vê o erro do provedor em português.

---

### User Story 4 - Tema claro, escuro ou automático (Priority: P3)

Um botão no topo do hub alterna entre claro, escuro e automático (segue o sistema), e vale para todas as ferramentas.

**Independent Test**: Alternar o tema e abrir outra ferramenta com o mesmo tema.

**Acceptance Scenarios**:

1. **Given** o tema automático, **When** o sistema operacional muda para escuro, **Then** o hub muda junto.

---

### User Story 5 - Entrar sem login no programa Windows (Priority: P3)

No Editor de Imagens para Windows não há tela de login: a janela entra sozinha como usuário local (`POST /api/auth/local`) com uma chave aleatória gerada a cada abertura.

**Independent Test**: Abrir o programa sem internet e usar o editor sem digitar senha.

### Edge Cases

- E-mail inválido, senha com menos de 8 caracteres ou e-mail já cadastrado: o registro recusa com mensagem própria para cada caso.
- Senha errada: mensagem genérica de credenciais inválidas.
- Token de atualização vencido (30 dias): volta para a tela de login sem perder dados locais das ferramentas offline.
- O backend sobe em modo globalization-invariant: nada da tela de configurações depende de cultura do servidor.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir registro e login por e-mail e senha (mínimo de 8 caracteres), com e-mail normalizado em minúsculas e senha guardada só como hash BCrypt.
- **FR-002**: O sistema MUST emitir token de acesso de 15 minutos e token de atualização de 30 dias, com rotação a cada uso e revogação ao detectar reuso.
- **FR-003**: Todo dado de toda ferramenta MUST ser isolado por usuário; nenhuma rota devolve dado de outra conta.
- **FR-004**: A tela inicial MUST listar as ferramentas como cartões e esconder as que dependem de lista de acesso (`PUBLICADORES`, `CEREBRO_USUARIOS`, `ANOTACAO_USUARIOS`; a Anotação também só aparece com um lote configurado no servidor) para quem não está nelas.
- **FR-005**: Os mesmos tokens MUST valer para os apps Android (Tarefas, Dieta, Treino Corrida) e para os MCPs que usam a conta do hub.
- **FR-006**: A configuração de IA MUST ser por usuário (provedor, modelo, chave de LLM, chave da Replicate), com as chaves cifradas no banco e nunca devolvidas pela API.
- **FR-007**: Sem chave do usuário, o sistema MUST usar o padrão do servidor; sem nenhuma chave, MUST usar o fallback local onde ele existe.
- **FR-008**: A tela de configurações MUST oferecer "Testar" para validar provedor, modelo e chave antes de usar.
- **FR-009**: O tema (claro/escuro/automático) MUST valer para todas as ferramentas e seguir a identidade Grafite.
- **FR-010**: No modo desktop, o sistema MUST autenticar o usuário local sem senha, só aceitando a chave da janela e só em 127.0.0.1.

### Key Entities

- **Usuário**: e-mail, hash da senha, data de criação. Dono de todos os dados das ferramentas.
- **Token de atualização**: pertence a um usuário, tem validade, marca de uso e de revogação.
- **Configuração de IA**: por usuário — provedor, modelo, chave de LLM cifrada, chave da Replicate cifrada.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa nova cria a conta e abre a primeira ferramenta em menos de 1 minuto.
- **SC-002**: Quem usa o hub todo dia não precisa digitar a senha de novo por até 30 dias.
- **SC-003**: Nenhuma chave de API aparece em resposta da API, em log ou no navegador depois de salva.
- **SC-004**: Uma ferramenta nova entra no hub sem criar outro login ou outro deploy.

## Assumptions

- Uso pessoal e de poucas pessoas; o cadastro é aberto, por isso ferramentas sensíveis usam listas de e-mails no `.env`.
- Não há recuperação de senha por e-mail nem login social (deixados de fora conscientemente).
- O deploy é único (Docker Compose na VPS) e o frontend é um app Angular só, com rotas lazy por ferramenta.
