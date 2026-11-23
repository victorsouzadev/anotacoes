# Tasks: Agente de plug-ins do hub (hub-agente)

**Input**: os documentos em `specs/039-hub-agente/`: plan, research, data-model, contracts e quickstart.

**Organização**: as tarefas seguem as histórias da spec. Os testes entram porque a constituição (princípio V) e a CI pedem.

**Onde fica cada código**:
- Caminhos que começam com `hub-agente/` são do repositório novo. O modelo usa `src/Plugin/` e `tests/Plugin.Tests/`: onde a tarefa diz `backend/Agente.Api/`, leia `src/Plugin/`.
- Os outros caminhos são do núcleo.

## Phase 1: Setup

- [x] T001 Criar o repositório `hub-agente` a partir do `hub-modelo`. Exige confirmação do dono e grava no GitHub. Ajustar `hub-agente/plugin.json`:
  - `id: agente`, `rota: /agente`, `tabelas.prefixo: agente_`, `mcp`;
  - sem `usaIa`, conforme a pesquisa (research.md R4).
- [x] T002 [P] Instalar o Claude Code CLI com a versão fixada e o Node 22 na imagem, em `hub-agente/Dockerfile`.
- [x] T003 [P] Criar a pasta `hub-agente/agente/` com:
  - `.claude/settings.json`, que proíbe Bash, Read, Write, Edit, WebFetch e WebSearch e só permite `mcp__agente__*`;
  - uma cópia fixada de `.claude/skills/plugin-hub/SKILL.md`.

## Phase 2: Foundational (bloqueia todas as histórias)

- [x] T004 Mover as regras do manifesto:
  - `Plugins.Validar` sai de `deployer/Notas.Deployer/Plugins.cs` e vai para `pacotes/Hub.Plugin.Sdk/Manifestos/RegrasDoManifesto.cs`, que passa a ser a única cópia;
  - o deployer passa a chamar a nova classe;
  - o SDK sobe para a versão 1.6.0 em `pacotes/Hub.Plugin.Sdk/Hub.Plugin.Sdk.csproj`;
  - os testes do deployer precisam continuar passando.
- [x] T005 [P] Criar as rotas de leitura no deployer: `GET /plugins/{id}/logs?linhas` (até 200 linhas) e `GET /plugins/{id}/health`. Elas só aceitam ids que estão no lock. Arquivos: `deployer/Notas.Deployer/Program.cs` e `deployer/Notas.Deployer.Tests/`.
- [x] T006 [P] Criar a função pura `LimpezaDeLog`, que tira as linhas com `Password=`, `Bearer ` ou `ApiKey`. Arquivo: `backend/Notas.Api/Services/Agente/LimpezaDeLog.cs`, com teste em `backend/Notas.Api.Tests/LimpezaDeLogTests.cs`.
- [x] T007 Criar as rotas `/api/core/agente/*` do contrato `contracts/nucleo-agente.md` em `backend/Notas.Api/Endpoints/AgenteNucleoEndpoints.cs`. Elas só aceitam `PluginDoServico == "agente"` e usam a consulta fixa de permissões.
  - Testes em `backend/Notas.Api.Tests/AgenteNucleoTests.cs`:
    - com o segredo do agente: 200;
    - com o segredo de outro plug-in: 401;
    - com um id fora do lock: 404.
  - Depende de T005 e T006.
- [x] T008 [P] Incluir o papel `agente` em `scripts/postgres-hub.sh` e na documentação do `DEPLOY.md`.
- [x] T009 Criar as entidades `Execucao` e `Evento` em `hub-agente/backend/Agente.Api/Dados/`, seguindo o `data-model.md`:
  - `agente_execucoes`: os campos `Execucao.Tipo`, `Execucao.Estado`, `Execucao.Origem` e `Execucao.UsuarioId` (FK);
  - `agente_eventos`: o campo `Evento.Tipo`.

  Ligar `UsarBancoDoHub`, `ReferenciarUsuarios()` e `Esquema.Garantir` (spec 038, sem migrações) em `Program.cs`. Testar `Dados.TabelasForaDoDono`.
- [x] T010 Criar a máquina de estados pura da execução, conforme `Execucao.Estado` no `data-model.md`: o estado só avança e um estado final não muda mais. Arquivos: `hub-agente/backend/Agente.Api/Execucoes/MaquinaDeEstados.cs` e os testes correspondentes.
- [x] T011 Criar a configuração (`Agente__Claude__Token`, `Agente__Claude__Validade`, `Agente__GitHub__Token`, `Agente__GitHub__Validade` e os limites) e o endpoint `GET /agente/api/configuracao`, sem valores e com o aviso de 7 dias. Arquivo: `hub-agente/backend/Agente.Api/Configuracao/`.
- [x] T012 Criar a fila de uma execução por vez, que retoma no reinício (pesquisa R7), e o `RodadorClaude`:
  - inicia `claude -p --output-format stream-json --max-turns`, com `HOME` temporária, o token numa variável de ambiente e um tempo limite;
  - lê os eventos e o erro de limite de uso.

  Arquivos: `hub-agente/backend/Agente.Api/Fila/` e `hub-agente/backend/Agente.Api/Rodador/`. Testar com um CLI falso que devolve um stream-json gravado.
- [x] T013 Criar o MCP local `agente`, servido em localhost com um segredo por execução:
  - fica só com as ferramentas permitidas para o tipo da execução;
  - qualquer outra chamada vira um evento `recusa`;
  - o que vem de fora chega marcado como dado externo (FR-014).

  Arquivo: `hub-agente/backend/Agente.Api/Ferramentas/`, conforme o contrato `contracts/ferramentas-agente.md`.

**Checkpoint**: as leituras do núcleo funcionam, e a fila roda o CLI falso de ponta a ponta.

## Phase 3: User Story 1, diagnóstico (P1) 🎯 MVP

**Teste independente**: com um plug-in de teste com o health falhando, o relatório aponta a falha e o `estado.json` fica igual.

- [x] T014 [US1] Criar as ferramentas `ler_estado`, `ler_health`, `ler_logs`, `ler_permissoes`, `ler_lock`, `validar_manifesto`, `perguntar` e `relatar`, que chamam `/api/core/agente/*`. Arquivo: `hub-agente/backend/Agente.Api/Ferramentas/Leitura.cs`.
- [x] T015 [US1] Escrever o prompt do diagnóstico em `hub-agente/agente/prompts/diagnostico.md`. O relatório traz a situação, as evidências, a causa e os próximos passos (FR-004), e a tabela de sintomas vem da skill.
- [x] T016 [US1] Criar a API de execuções do contrato `contracts/agente-api.md`, com `POST`, `GET`, `resposta` e `cancelar`, só para administradores. Responde 409 quando falta um token. Arquivo: `hub-agente/backend/Agente.Api/Endpoints/ExecucoesEndpoints.cs`, com testes.
- [x] T017 [US1] Criar a tela `/agente/`:
  - lista dos plug-ins, botão "Diagnosticar" e acompanhamento ao vivo (estado, posição na fila, eventos e perguntas);
  - relatório em markdown e histórico;
  - aviso de configuração.

  Usar o Grafite e a `<grafite-barra atual="agente">`. Pasta: `hub-agente/frontend/`.
- [x] T018 [US1] Teste de ponta a ponta com o CLI falso: um diagnóstico completo e o histórico gravado. Testar também que um texto num log pedindo para "apagar" não vira chamada de ferramenta, porque essa ação não existe na lista. Arquivo: `hub-agente/backend/Agente.Api.Tests/DiagnosticoTests.cs`.

**Checkpoint**: a US1 pode ir para o ar, com o deploy confirmado pelo dono (ver Polish).

## Phase 4: User Story 2, esqueleto (P2)

- [ ] T019 [US2] Criar o `GithubDoAgente` com o Octokit, em `hub-agente/backend/Agente.Api/Github/`. Ele cria o repositório a partir do template `hub-modelo`, faz push na branch `esqueleto`, abre o PR e lê a CI. Toda chamada passa por `RepositorioPermitido(execucao)`, conforme `Execucao.RepositorioCriado` no `data-model.md`. Testar a recusa com um repositório que não é o da execução.
- [ ] T020 [US2] Criar as ferramentas `propor_plano` (pausa até a aprovação), `ler_arquivo_modelo`, `escrever_arquivo` (só na pasta temporária e só depois do plano aprovado), `criar_repositorio_e_pr` (uma vez só) e `estado_da_ci`. Arquivo: `hub-agente/backend/Agente.Api/Ferramentas/Esqueleto.cs`.
- [ ] T021 [US2] Conferir o plano antes da aprovação: o id não pode estar no lock, nem já existir no GitHub, nem cair numa rota reservada (usar `RegrasDoManifesto`). Arquivo: `hub-agente/backend/Agente.Api/Esqueleto/ConferenciaDoPlano.cs`, com testes.
- [ ] T022 [US2] Escrever o prompt do esqueleto em `hub-agente/agente/prompts/esqueleto.md`. Ele segue o caminho 1 da skill, faz as perguntas do FR-009 e termina com o link do PR, o estado da CI e os passos manuais (FR-008).
- [ ] T023 [US2] Na tela, criar o formulário "Nova ferramenta", o plano para aprovar e as respostas às perguntas. Pasta: `hub-agente/frontend/`.
- [ ] T024 [US2] Teste com o CLI falso e o GitHub simulado: o PR é aberto, o merge nunca é chamado e não há escrita fora do repositório criado. Arquivo: `hub-agente/backend/Agente.Api.Tests/EsqueletoTests.cs`.

## Phase 5: User Story 3, MCP (P3)

- [ ] T025 [US3] Criar o MCP `/agente/mcp`, com `plugins_listar`, `plugin_estado`, `manifesto_validar`, `agente_disparar`, `agente_acompanhar`, `agente_responder` e `agente_cancelar`. Ligar `ExigirMcpDoPlugin()` e permitir só administradores. Arquivo: `hub-agente/backend/Agente.Api/Mcp/`.
- [ ] T026 [US3] Testes do MCP: um manifesto com rota reservada lista a regra violada, e uma pergunta pendente aparece em `agente_acompanhar`. Arquivo: `hub-agente/backend/Agente.Api.Tests/McpTests.cs`.

## Phase 6: Polish

- [ ] T027 [P] Garantir que nenhum segredo aparece em logs, relatórios e eventos (SC-005), com testes que procuram os valores dos tokens falsos.
- [ ] T028 [P] Atualizar a documentação:
  - `DEPLOY.md`: o agente, o `agente.env` com os dois tokens e como gerar cada um;
  - `specs/README.md`: a seção 039;
  - `README.md`.
- [ ] T029 CI do `hub-agente`: backend (também com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`) e frontend. A CI do núcleo também tem de passar inteira.
- [ ] T030 Pôr no ar, sempre com a confirmação do dono a cada passo:
  - `PG_PLUGINS`, a senha e `postgres-hub.sh papeis`;
  - o arquivo `data/plugins/banco/agente`;
  - o `agente.env`, gravado pelo dono;
  - a linha no `plugins.lock`, num PR;
  - `postgres-hub.sh permissoes`;
  - os passos do quickstart.

## Dependências

- O Setup (T001 a T003) vem antes da Foundational.
- A Foundational (T004 a T013) bloqueia todas as histórias.
- O T007 depende do T005 e do T006, e o T013 depende do T012.
- A US1 vem antes da US2, que reaproveita a fila, as ferramentas e a tela. A US3 depende só da US1, porque disparar um esqueleto pelo MCP exige a US2 pronta.
- O T030 vem por último.

## Paralelos

- **Foundational:** T005, T006 e T008 podem rodar juntas, enquanto a T004 anda.
- **US2:** T019 e T021 podem rodar juntas.
- **Polish:** T027 e T028 podem rodar juntas.

## Estratégia

O MVP é a US1, o diagnóstico: ela vai para o ar sozinha, com o token da assinatura. O token do GitHub só é necessário a partir da US2.
