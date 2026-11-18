# Feature Specification: Tarefas (web, Android e MCP)

**Feature Branch**: `004-tarefas` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `features/tasks`, `Endpoints/TasksEndpoints.cs`, `mobile/app`, `mcp/`, `Mcp/TarefasMcpTools.cs`, guia em `features/tasks/help` e seção "Tarefas" do README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criar e concluir tarefas (Priority: P1)

A pessoa cria tarefas com título, descrição, prazo, prioridade, categoria, subtarefas e recorrência (diária, semanal, mensal) e as conclui. A lista agrupa pela primeira categoria ("Sem categoria" por último), esconde concluídas por grupo e mostra prazo, prioridade, progresso de subtarefas e pomodoros.

**Why this priority**: É a função básica.

**Independent Test**: Criar uma tarefa semanal com duas subtarefas, concluir e ver a próxima ocorrência.

**Acceptance Scenarios**:

1. **Given** uma tarefa recorrente no app Android, **When** é concluída (ou pulada), **Then** a próxima ocorrência é gerada. Na web a regra é guardada e editada, mas concluir não gera a próxima — ver Edge Cases.
2. **Given** o formulário de tarefa, **When** a pessoa digita uma categoria nova, **Then** ela é criada ali mesmo (nome + cor).
3. **Given** a busca e os filtros (Todas/Hoje/Atrasadas/Sem prazo, categoria, ordenação por prazo/prioridade/criação), **When** a pessoa filtra, **Then** a lista atualiza em tempo real.

---

### User Story 2 - Usar no Android, offline, e ver o mesmo na web (Priority: P1)

O app Android funciona 100% offline (Room). O login é opcional; logado na mesma conta do hub, sincroniza com a web.

**Why this priority**: A maior parte do uso é no celular.

**Independent Test**: Criar uma tarefa no celular em modo avião, religar a rede e ver a tarefa na web.

**Acceptance Scenarios**:

1. **Given** dois dispositivos editaram a mesma tarefa, **When** sincronizam, **Then** vence a edição com `updatedAt` mais novo.
2. **Given** uma tarefa movida para a lixeira, **When** o outro dispositivo sincroniza, **Then** ela vai para a lixeira lá também (a lixeira é o tombstone).
3. **Given** o card Tarefas no hub, **When** a pessoa clica em baixar, **Then** recebe o APK gerado no último deploy.

---

### User Story 3 - Projetos com quadros (Priority: P2)

A pessoa cria projetos, cada um com seu quadro. Nenhuma tarefa entra sozinha: adiciona as existentes ou cria dentro do projeto. Modo Raias com colunas próprias (criar, renomear, apagar devolvendo tarefas para "Sem raia", reordenar) ou modo Por status (A fazer / Concluída). Arrastar move entre colunas e reordena; uma tarefa pode estar em vários projetos, com raia própria em cada um.

**Independent Test**: Criar um projeto com três raias, arrastar uma tarefa entre elas e reabrir.

---

### User Story 4 - Pomodoro e tempo focado (Priority: P2)

Timer de foco/pausa (25/5, pausa longa a cada 4 ciclos), vinculável a uma tarefa, que incrementa o contador de pomodoros dela; tela de foco por atividade.

**Independent Test**: Completar um ciclo vinculado e ver o contador da tarefa subir.

---

### User Story 5 - Detalhes, ações em massa e organização (Priority: P3)

Painel de visualização com detalhes, subtarefas, comentários e anexos (imagem com miniatura, outros como link; até 5 MB). Seleção múltipla para concluir, reabrir, trocar categoria ou mover para a lixeira, com "Desfazer" por alguns segundos. Calendário mensal pelo prazo. Lixeira com restaurar e excluir para sempre. Estatísticas (concluídas, pendentes, concluídas hoje, pomodoros, gráfico por categoria). Guia de ajuda em `/tasks/ajuda`.

**Independent Test**: Selecionar três tarefas, mover para a lixeira, desfazer e ver as três de volta.

---

### User Story 6 - Recursos só do Android (Priority: P3)

Lembretes por horário e por localização (geofence), sincronização com o calendário do sistema, widget de tela inicial e interpretação de texto livre por IA (OpenRouter, configurável no app).

---

### User Story 7 - Usar tarefas a partir de um LLM (Priority: P3)

Um servidor MCP separado (`mcp/`, Node/TS) expõe `add_task`, `list_tasks`, `complete_task` e `list_categories` contra a mesma API, com login e token só em memória. O backend também expõe `/api/mcp/tarefas` (somente leitura) para o Segundo Cérebro.

### Edge Cases

- Categorias não têm tombstone: excluir uma categoria com outro dispositivo offline faz ela reaparecer nele (limitação aceita).
- Sincronização completa, não incremental, a cada rodada.
- Anexo acima de 5 MB é recusado.
- **Divergência conhecida**: a geração da próxima ocorrência de tarefa recorrente existe só no Android (`TaskRepository.createNextOccurrence`); a web não gera. Candidata a spec própria se a web precisar disso.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir CRUD de tarefas com título, descrição, prazo, prioridade, categorias, subtarefas, recorrência, comentários e anexos.
- **FR-002**: O sistema MUST oferecer views Lista, Projetos (raias próprias ou por status) e Calendário.
- **FR-003**: Exclusão MUST passar pela lixeira, com restaurar e excluir definitivamente.
- **FR-004**: O app Android MUST funcionar sem login e sem rede, e sincronizar com a conta do hub quando logado, last-write-wins por `updatedAt`.
- **FR-005**: O sistema MUST ter pomodoro vinculável a tarefa e estatísticas.
- **FR-006**: Ações em massa MUST oferecer desfazer por alguns segundos.
- **FR-007**: O CI MUST gerar o APK a cada deploy e publicá-lo em `/downloads/organizador.apk`.
- **FR-008**: O MCP de tarefas MUST usar a mesma autenticação e o mesmo contrato da API web/Android.

### Key Entities

- **Tarefa**: título, descrição, prazo, prioridade, categorias, subtarefas, recorrência, concluída, pomodoros, lixeira (`deletedAt`), `updatedAt`.
- **Categoria**: nome e cor.
- **Projeto**: nome, raias e posição de cada tarefa (raia e ordem) no projeto.
- **Comentário e anexo**: pertencem a uma tarefa.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Criar uma tarefa leva menos de 10 segundos.
- **SC-002**: Uma tarefa criada offline no celular aparece na web na primeira sincronização com rede.
- **SC-003**: Nenhuma tarefa é perdida por exclusão acidental (lixeira e desfazer).

## Assumptions

- Uso pessoal, uma conta por pessoa; sem compartilhamento de tarefas.
- O app Android é distribuído como APK fora de loja.
