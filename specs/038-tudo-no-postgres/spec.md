# Feature Specification: Núcleo e plug-ins no Postgres

**Feature Branch**: na branch da sessão
**Created**: 2026-11-21
**Status**: Em uso (janela feita em 2026-11-22; falta a limpeza T019)
**Input**: "Todos podem e devem usar o postgres"

## Clarifications

### Session 2026-11-21

- Q: Quem muda? → A: O núcleo e todos os plug-ins que hoje gravam no `notas.db`. Os bancos dos sites publicados (spec 010) ficam como estão.
- Q: Qual Postgres? → A: O `notas-postgres` que já roda na VPS para os sites (17, com volume em `data/postgres`), sem servidor novo.
- Q: Como fica o isolamento? → Um banco `hub`, com um schema e um papel por plug-in (`notas`, `financas`, `tarefas`, `dieta`...) e o schema `nucleo` para o núcleo. Cada papel só tem acesso ao próprio schema; para a chave estrangeira, recebe só `REFERENCES` em `nucleo.users`.
- Q: Como os dados mudam de lugar? → Janela curta: hub fora do ar, cópia única do `notas.db` para o Postgres, conferência das contagens e volta com tudo apontando para o Postgres. Se a conferência falhar, volta para o SQLite.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tudo continua igual para quem usa (Priority: P1)

Depois da troca, o dono entra no hub e encontra todas as notas, transações, tarefas, refeições e configurações como estavam.

**Why this priority**: os dados são do usuário e não podem se perder.

**Independent Test**: contar as linhas de cada tabela no `notas.db` antes e no Postgres depois, e abrir cada ferramenta.

**Acceptance Scenarios**:

1. **Given** a troca concluída, **When** o dono abre cada ferramenta, **Then** vê os mesmos dados de antes.
2. **Given** a troca concluída, **When** as contagens são comparadas, **Then** cada tabela tem o mesmo número de linhas.

### User Story 2 - Cada plug-in só alcança o que é dele (Priority: P1)

Cada plug-in entra no banco com credencial própria e só consegue ler e gravar as tabelas dele. O núcleo é o único dono de `users`, tokens e configurações.

**Why this priority**: é o ganho de isolamento que o SQLite não dá (spec 031 só tinha convenção conferida).

**Independent Test**: com a credencial de um plug-in, tentar ler uma tabela de outro e ver a recusa.

**Acceptance Scenarios**:

1. **Given** a credencial do plug-in Notas, **When** ele tenta ler uma tabela de Finanças, **Then** o banco recusa.
2. **Given** a credencial de um plug-in, **When** ele tenta alterar `users`, **Then** o banco recusa.

### User Story 3 - Hub novo e CI no Postgres (Priority: P2)

Um hub instalado do zero e a CI de cada repositório sobem contra Postgres, sem arquivo SQLite.

**Why this priority**: sem isso o SQLite continuaria existindo pelos testes.

**Independent Test**: CI de cada repositório roda contra um Postgres de serviço.

**Acceptance Scenarios**:

1. **Given** um Postgres vazio, **When** núcleo e plug-ins sobem, **Then** cada um cria o próprio esquema e o login funciona.

### Edge Cases

- Datas, decimais e textos com acento precisam chegar iguais (SQLite guarda data como texto e decimal como REAL/TEXT).
- Comparações sem diferenciar maiúsculas e minúsculas, que no SQLite dependem de `COLLATE NOCASE` ou `upper()`.
- Busca de texto das Notas, se usar recurso próprio do SQLite.
- Volta atrás: se algo der errado na troca, o `notas.db` original precisa continuar intacto para voltar.
- Plug-ins que não gravam no `notas.db` (Anotação e os que guardam em arquivo) ficam fora.
- Backup (specs 025 e 036) passa a incluir o dump do Postgres do hub.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O núcleo e cada plug-in que hoje usa o `notas.db` DEVEM passar a usar o Postgres, sem SQLite em produção.
- **FR-002**: Cada plug-in DEVE ter credencial própria, com acesso só às tabelas dele.
- **FR-003**: Os dados existentes DEVEM ser copiados sem perda, conferidos tabela a tabela por contagem.
- **FR-004**: O `notas.db` original DEVE ficar guardado e intacto até a troca ser confirmada.
- **FR-005**: O backup diário e a cópia externa DEVEM incluir o banco do hub no Postgres.
- **FR-006**: A CI de cada repositório DEVE rodar os testes contra Postgres.
- **FR-007**: As senhas dos papéis NÃO DEVEM aparecer em repositório, PR ou log.

### Key Entities

- **Banco do hub**: onde ficam as tabelas do núcleo e dos plug-ins.
- **Papel por plug-in**: credencial com acesso só ao que é do plug-in.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero linhas perdidas, conferido em todas as tabelas.
- **SC-002**: Nenhum plug-in consegue ler dado de outro com a própria credencial (testado).
- **SC-003**: O hub fica fora do ar no máximo 15 minutos durante a troca.
- **SC-004**: Nenhum serviço do hub abre o `notas.db` depois da troca.

## Assumptions

- Hoje o `notas.db` tem cerca de 5 MB (mais o WAL), e a VPS tem cerca de 550 MB de memória livre: o mesmo `notas-postgres` aguenta.
- Os bancos de sites publicados continuam como na spec 010.
- Gravar na VPS (papéis, senhas, cópia dos dados) só com confirmação.
