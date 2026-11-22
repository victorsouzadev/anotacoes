# Feature Specification: Banco compartilhado entre núcleo e plug-ins

**Feature Branch**: `031-banco-compartilhado` (sem branch própria)

**Created**: 2026-11-19

**Status**: Implementada (specs 029–035); o arquivo `notas.db` foi substituído pelo banco `hub` no Postgres na spec 038

**Input**: "Quero que todos utilizem o mesmo banco." Divisão em plug-ins (029).

## Clarifications

### Session 2026-11-19

- Q: Qual banco? → A: O `notas.db` (SQLite, WAL) que já está em produção. Ele já tem as tabelas de todas as ferramentas com prefixo (`dieta_`, `tasks_`, `financas_`...) e as chaves estrangeiras para `users`; mantê-lo evita migrar 2.600 transações, notas e históricos. Postgres com um papel por plug-in fica registrado como evolução, se um dia for preciso isolamento de verdade.
- Q: Como vários containers abrem o mesmo arquivo? → A: Todos montam a mesma pasta `data/db` do host. SQLite em WAL funciona entre processos no mesmo kernel e no mesmo sistema de arquivos, que é o caso de containers na mesma VPS. Nunca por rede (NFS, WebDAV).
- Q: Quem é dono de cada tabela? → A: Cada plug-in declara um prefixo no manifesto (`tabelas`) e só cria, altera, lê e grava tabelas com esse prefixo. O núcleo é dono de `users`, `refresh_tokens`, `configuracoes_ia` e `core_*`. Tabelas antigas sem prefixo (`notes`, `folders`, `note_shares`) passam para o dono pelo nome, listadas no manifesto, sem renomear.
- Q: Um plug-in pode ler dados de outro? → A: Não. Precisa de dado de outra ferramenta → pede pela API dela. A única exceção é a chave estrangeira para `users`, que o plug-in referencia sem ler nem gravar.
- Q: Como ficam as migrações? → A: Cada plug-in tem o próprio histórico (`__EFMigrationsHistory_<id>`); o núcleo continua com `__EFMigrationsHistory`. A primeira migração de cada plug-in extraído é uma linha de base que reconhece as tabelas que já existem, sem recriar nada.
- Q: E se a migração de um plug-in estragar o banco? → A: O deployer faz uma cópia do banco imediatamente antes de subir uma versão com migração nova e guarda as 5 últimas.
- Q: O que impede um plug-in de mexer em tabela alheia? → A: Com SQLite, só convenção conferida: um teste do SDK (032) falha se o modelo do plug-in tiver tabela fora do prefixo, e o deployer compara o esquema antes e depois da migração e reverte se uma tabela de outro dono mudou. Um plug-in com falha de segurança grave consegue ler o arquivo inteiro, como já acontece hoje com o `Notas.Api`; por isso as linhas de login levam selo (030) e os segredos ficam cifrados com chave que só o dono tem.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Extrair uma ferramenta sem migrar dados (Priority: P1)

A ferramenta sai do `Notas.Api` para um plug-in e continua vendo os mesmos dados no mesmo arquivo, sem cópia, sem exportação e sem janela de indisponibilidade além do restart.

**Why this priority**: É o motivo de usar um banco só.

**Independent Test**: Extrair a ferramenta de exemplo e conferir que as linhas existentes aparecem na tela do plug-in.

**Acceptance Scenarios**:

1. **Given** as tabelas `dieta_*` com dados, **When** o plug-in Dieta sobe pela primeira vez, **Then** a migração de base é registrada em `__EFMigrationsHistory_dieta` sem alterar nenhuma tabela e os dados aparecem.
2. **Given** o núcleo depois da extração, **When** roda as próprias migrações, **Then** não mexe mais nas tabelas `dieta_*`.

---

### User Story 2 - Um backup cobre tudo (Priority: P1)

O backup diário (025) continua sendo uma cópia consistente do `notas.db` e já leva os dados de todos os plug-ins.

**Acceptance Scenarios**:

1. **Given** três plug-ins gravando, **When** o backup roda, **Then** a cópia é consistente (`sqlite3 .backup`) e restaura todos.

---

### User Story 3 - Migração ruim não perde dado (Priority: P1)

Uma versão de plug-in com migração errada é revertida e o banco volta ao estado de antes.

**Acceptance Scenarios**:

1. **Given** uma versão nova com migração, **When** o deployer sobe, **Then** antes existe `data/db/pre-migracao/<id>-<versao>.db`.
2. **Given** uma migração que altera tabela de outro dono, **Then** o deployer para, restaura a cópia e mantém a versão anterior.

---

### User Story 4 - Gravações simultâneas não dão erro (Priority: P2)

Vários plug-ins gravando ao mesmo tempo (sincronização da Dieta, Tarefas e Notas) não retornam "database is locked" para o usuário.

### Edge Cases

- Dois plug-ins migrando ao mesmo tempo: o deployer aplica um por vez; o `__EFMigrationsLock` do EF serializa também.
- Plug-in com EF de versão diferente do núcleo: cada um lê só o próprio histórico; o formato do arquivo SQLite é o mesmo.
- Apagar tabela de um plug-in removido: nunca automático; só por spec com plano de backup.
- Segredos de plug-in (ex.: credenciais AUVP na Finanças): cifrados com a chave do próprio plug-in, não com a do núcleo.
- `PRAGMA foreign_keys`: continua ligado em todos; apagar usuário no núcleo apaga em cascata as linhas dele em todos os plug-ins.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Núcleo e plug-ins MUST abrir o mesmo `notas.db` em `data/db`, em WAL, com `busy_timeout` de pelo menos 5 s.
- **FR-002**: Cada plug-in MUST declarar o prefixo (e tabelas legadas sem prefixo) no manifesto, e o deployer MUST recusar prefixos sobrepostos.
- **FR-003**: Cada plug-in MUST usar o próprio histórico de migração `__EFMigrationsHistory_<id>`, começando por uma migração de base sem DDL.
- **FR-004**: O modelo de um plug-in MUST mapear `users` só como referência (fora das migrações) e MUST NOT ter tabelas fora do prefixo; o SDK MUST ter teste que verifica isso.
- **FR-005**: O deployer MUST copiar o banco antes de cada migração nova, manter as 5 últimas cópias e reverter se o esquema de outro dono mudar.
- **FR-006**: O backup diário MUST continuar usando `sqlite3 .backup` do arquivo único.
- **FR-007**: Segredos gravados por plug-in MUST ser cifrados com chave do próprio plug-in; a chave do núcleo (derivada do `JWT_SECRET`) MUST ficar só no núcleo.
- **FR-008**: O caminho do banco MUST NOT ficar em volume de rede.

### Key Entities

- **Dono de tabela**: id do plug-in (ou `core`), prefixo, tabelas legadas.
- **Cópia pré-migração**: plug-in, versão, data, arquivo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero linhas copiadas ou convertidas para extrair uma ferramenta.
- **SC-002**: Restaurar o backup de um dia recupera todos os plug-ins de uma vez.
- **SC-003**: Nenhum erro "database is locked" visível ao usuário em uso normal (conferido nos logs por 30 dias depois das extrações).
- **SC-004**: 100% das migrações de plug-in têm cópia anterior.

## Assumptions

- Uso de um usuário principal e poucos convidados; a escrita concorrente é baixa (dezenas por minuto), compatível com o único escritor do SQLite.
- O Postgres atual continua só para os sites publicados (Publicar).
