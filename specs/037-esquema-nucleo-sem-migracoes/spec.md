# Feature Specification: Esquema do núcleo sem migrações

**Feature Branch**: `nucleo/037-esquema-sem-migracoes`
**Created**: 2026-11-21
**Status**: Concluída; desde a spec 038 o esquema vem do `Esquema.Garantir` do SDK, no Postgres
**Input**: "Quero só o núcleo no repositório principal, o resto fica em seu repositório próprio" e "Não quero o código das migrações no repositório".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Repositório principal só com o núcleo (Priority: P1)

O dono do projeto abre o repositório principal e só encontra o código do núcleo: login, contas, hub, Configurações (IA), Publicar e o registro de plug-ins. Não aparece nenhum histórico de esquema das ferramentas que viraram plug-ins.

**Why this priority**: é o pedido direto e o que faz o SC-004 da spec 035 fechar.

**Independent Test**: contar as linhas do backend do núcleo e procurar nomes de tabelas dos plug-ins.

**Acceptance Scenarios**:

1. **Given** o repositório atualizado, **When** alguém procura a pasta de migrações do núcleo, **Then** ela não existe.
2. **Given** o repositório atualizado, **When** alguém procura tabelas de Notas, Finanças, Tarefas, Dieta ou Anotação no esquema do núcleo, **Then** não encontra nenhuma.

### User Story 2 - Produção continua igual (Priority: P1)

Depois do deploy, quem usa o hub entra, vê as ferramentas e os dados de sempre, sem perder nada.

**Why this priority**: o banco é compartilhado e os dados são do usuário.

**Independent Test**: subir o núcleo novo sobre uma cópia do banco de produção e comparar tabelas e contagens de linhas antes e depois.

**Acceptance Scenarios**:

1. **Given** o banco de produção, **When** o núcleo novo sobe, **Then** nenhuma tabela é apagada ou recriada e as contagens não mudam.
2. **Given** o núcleo novo no ar, **When** cada plug-in sobe, **Then** ele continua achando as suas tabelas.

### User Story 3 - Instalação nova funciona (Priority: P2)

Num banco vazio (testes, máquina nova), o núcleo cria as tabelas dele e cada plug-in cria as suas.

**Why this priority**: sem isso a CI e uma reinstalação quebram.

**Independent Test**: subir o núcleo num banco vazio e rodar os testes do backend.

**Acceptance Scenarios**:

1. **Given** um banco vazio, **When** o núcleo sobe, **Then** todas as tabelas do núcleo existem e o login funciona.
2. **Given** o núcleo subido duas vezes seguidas, **When** a segunda subida termina, **Then** nada mudou e não houve erro.

### Edge Cases

- Banco com a tabela de histórico de migrações antiga: fica onde está, sem uso, sem apagar.
- Uma tabela do núcleo ganhou coluna nova no futuro: o esquema precisa acrescentar a coluna em bancos existentes sem recriar a tabela.
- Plug-in que ainda não cria as próprias tabelas: precisa ser identificado antes do deploy (o hub-anotacao guarda em arquivos e deve ser conferido).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O repositório principal NÃO DEVE conter migrações geradas de esquema.
- **FR-002**: O núcleo DEVE criar, ao subir, só as tabelas que ele mesmo usa, e não fazer nada nas que já existem.
- **FR-003**: Subir o núcleo DEVE ser idempotente: repetir não muda dados nem estrutura.
- **FR-004**: O núcleo NÃO DEVE apagar, renomear ou alterar tabelas dos plug-ins nem a tabela de histórico antiga.
- **FR-005**: Cada plug-in DEVE continuar criando as próprias tabelas no seu repositório.
- **FR-006**: O esquema criado num banco vazio DEVE ser equivalente ao que o núcleo usa hoje para as suas tabelas (mesmas colunas, tipos, índices e chaves).
- **FR-007**: A documentação (README, DEPLOY, constituição) DEVE explicar como mudar o esquema do núcleo dali em diante.

### Key Entities

- **Esquema do núcleo**: a lista de tabelas, índices e chaves das entidades do núcleo (usuários, sessões, OAuth, tokens MCP, Configurações de IA, segredos, sites e publicações, estado dos plug-ins).
- **Tabelas dos plug-ins**: pertencem a cada repositório `hub-<id>` e ficam fora do núcleo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O backend do núcleo fica com no máximo 10% das linhas de antes da spec 035, contando tudo (fecha o SC-004 da 035).
- **SC-002**: Zero tabelas perdidas e zero linhas perdidas na produção, comparando antes e depois do deploy.
- **SC-003**: Todos os testes da CI passam, inclusive no modo de globalização invariante.
- **SC-004**: Num banco vazio, o núcleo sobe e o login funciona na primeira tentativa.

## Assumptions

- Os plug-ins `hub-notas`, `hub-financas`, `hub-tarefas` e `hub-dieta` já criam as próprias tabelas ao subir, mas só num banco sem a tabela `users` (CI e desenvolvimento). Dentro do hub eles contam com as tabelas que as migrações antigas do núcleo criaram. Na produção isso não muda nada, porque as tabelas já existem; para um hub instalado do zero, cada plug-in precisa passar a criar as suas também dentro do hub (FR-005), num PR no repositório dele, fora deste.
- A tabela de histórico de migrações antiga pode ficar no banco sem uso; apagá-la fica fora do escopo.
- O deploy em produção exige backup antes e confirmação do dono para gravar na VPS.
