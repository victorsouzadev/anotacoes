# Feature Specification: Núcleo do hub e contrato de plug-ins

**Feature Branch**: `029-nucleo-plugins` (sem branch própria)

**Created**: 2026-11-19

**Status**: Planejado

**Input**: "Quero dividir essa aplicação, ela está grande, quero vários repositórios e esse vai ser da parte principal, em que vou conseguir conectar os demais como se fosse plug-ins." Em seguida: "Quero que todos utilizem o mesmo banco."

## Clarifications

### Session 2026-11-19

- Q: O que fica no núcleo (este repositório)? → A: Login, contas e OAuth (030), tela do hub, configuração de IA, registro de plug-ins, deployer, backup, ops, Caddy, Publicar (com o Postgres dos sites) e os pacotes compartilhados (032).
- Q: Como o plug-in se apresenta ao hub? → A: Por um manifesto `plugin.json` servido pelo próprio plug-in e fixado, com versão de imagem, no `plugins.lock` do núcleo.
- Q: O frontend do plug-in é carregado dentro do Angular do hub? → A: Não. Cada plug-in serve a própria tela em `/<id>/`; o hub só mostra o card e a barra comum (web component do `@grafite/ui`). Module Federation foi rejeitado porque prende todos à mesma versão do Angular.
- Q: E o banco? → A: Um só, o `notas.db` atual, compartilhado por todos (detalhado na 031).
- Q: As URLs antigas (`/api/dieta`, `/api/mcp/tarefas`, `/dieta`) continuam? → A: Sim. Apps Android instalados e conectores do Claude não podem quebrar; o Caddy mantém as rotas antigas apontando para o plug-in novo.
- Q: Plug-in fora do ar derruba o hub? → A: Não. O card aparece como "indisponível" e o resto segue.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ligar um plug-in sem mexer no código do hub (Priority: P1)

A pessoa adiciona uma linha no `plugins.lock` do núcleo (id, imagem, versão). No deploy, o plug-in sobe, o card dele aparece no hub com nome e ícone do manifesto, e as rotas `/<id>/` passam a responder.

**Why this priority**: É o que define "plug-in". Sem isso, separar repositórios só espalha o monólito.

**Independent Test**: Publicar um plug-in de exemplo (`hub-exemplo`, só health e uma página) e ver o card e a página no hub.

**Acceptance Scenarios**:

1. **Given** um plug-in novo no `plugins.lock`, **When** o deploy termina, **Then** o card aparece no hub e `/<id>/` abre a tela do plug-in.
2. **Given** um manifesto inválido (campo obrigatório faltando, `contrato` maior que o suportado), **When** o deploy roda, **Then** o plug-in não sobe e o deploy diz o motivo; os outros continuam.
3. **Given** um plug-in removido do `plugins.lock`, **When** o deploy roda, **Then** o container para, o card some e os dados no banco ficam intactos.

---

### User Story 2 - Ver a saúde de cada plug-in (Priority: P1)

O hub consulta o health de cada plug-in e mostra no card e em Configurações → Servidor: no ar, fora do ar, versão.

**Independent Test**: Parar o container de um plug-in e ver o card como indisponível em até 1 minuto.

**Acceptance Scenarios**:

1. **Given** um plug-in parado, **Then** o card fica "indisponível" e não abre; os demais funcionam.
2. **Given** um plug-in no ar, **Then** Configurações → Servidor mostra a versão (commit) dele.

---

### User Story 3 - Deploy de um plug-in a partir do repositório dele (Priority: P2)

Um push na `main` do plug-in testa, publica a imagem e abre um PR no núcleo trocando a versão no `plugins.lock`. No merge, o deployer atualiza só aquele plug-in e volta para a versão anterior se o health falhar.

**Independent Test**: Publicar uma versão com health quebrado e ver o deployer voltar para a anterior.

**Acceptance Scenarios**:

1. **Given** uma versão nova no `plugins.lock`, **When** o deploy roda, **Then** só o container daquele plug-in é recriado.
2. **Given** a versão nova sem health em 60 s, **Then** o deployer volta para a anterior e registra a falha.

---

### User Story 4 - URLs antigas continuam funcionando (Priority: P1)

Apps Android, links salvos e conectores do Claude que usam `/api/<ferramenta>` ou `/api/mcp/<ferramenta>` seguem funcionando depois que a ferramenta vira plug-in.

**Acceptance Scenarios**:

1. **Given** a Dieta já extraída, **When** o app Android chama `/api/dieta/...`, **Then** a resposta é a mesma de antes.
2. **Given** um conector do Claude em `/api/mcp/tarefas`, **Then** continua funcionando sem reconfigurar.

### Edge Cases

- Dois plug-ins declarando o mesmo `id` ou a mesma rota: o deploy recusa o segundo.
- Plug-in pedindo rota reservada do núcleo (`/api/auth`, `/autorizar`, `/.well-known`, `/ops`): recusado.
- Health lento: o hub não espera; usa o último estado conhecido (cache de 30 s).
- Versão no `plugins.lock` que não existe no GHCR: o deploy falha antes de parar a versão em uso.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O núcleo MUST ler a lista de plug-ins do `plugins.lock` (id, imagem, versão) e validar o `plugin.json` de cada imagem contra `plugin.schema.json` (spec 032).
- **FR-002**: O núcleo MUST expor `GET /api/plugins` com id, nome, ícone, rota, estado e versão, para a tela do hub.
- **FR-003**: O hub MUST montar os cards a partir de `/api/plugins`, sem lista fixa no código; as ferramentas que ainda são módulos do núcleo aparecem na mesma lista.
- **FR-004**: As rotas do Caddy para plug-ins MUST ser geradas a partir dos manifestos, incluindo os aliases das URLs antigas declarados em `rotasLegadas`.
- **FR-005**: O deployer MUST subir, atualizar e parar só o plug-in alterado, com volta automática à versão anterior se o health falhar.
- **FR-006**: Remover um plug-in MUST NOT apagar dados.
- **FR-007**: O núcleo MUST recusar `id` ou rota duplicados e rotas reservadas.
- **FR-008**: O backup (spec 025) MUST continuar cobrindo o banco compartilhado e passar a incluir as pastas declaradas em `dados` de cada manifesto.

### Key Entities

- **Manifesto (`plugin.json`)**: id, nome, ícone, versão do contrato, rota, porta, health, MCP, rotas legadas, usa IA, pastas de dados, tabelas (prefixo), app Android.
- **Entrada do `plugins.lock`**: id, imagem, versão (commit), ativo.
- **Estado do plug-in**: id, no ar/fora, versão em execução, último health.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ligar um plug-in novo exige mudar só o `plugins.lock`, sem tocar no código do núcleo.
- **SC-002**: Um plug-in fora do ar não muda o tempo de carga do hub (cards em menos de 1 s).
- **SC-003**: Zero chamadas quebradas dos apps Android e conectores depois de cada extração (conferido nos logs do proxy: nenhum 404 novo em `/api/*`).
- **SC-004**: Deploy de um plug-in recria um container só.

## Assumptions

- Todos os plug-ins rodam na mesma VPS, no mesmo Docker, e montam o mesmo `data/db` (031).
- Os repositórios `hub-<id>` são criados pelo usuário no GitHub; as imagens vão para o GHCR da mesma conta.
- Depende de 030 (login) e 032 (SDK e schema). A 031 define as regras do banco.
