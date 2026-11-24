# Research: 039 hub-agente

## R1. Onde roda o laço do agente
- **Decision**: o Claude Code CLI (`claude -p`) roda como processo filho do backend .NET, um por execução, com a assinatura do dono (`CLAUDE_CODE_OAUTH_TOKEN`).
- **Rationale**: o dono quer gastar o mínimo. O `setup-token` existe para automação pessoal com a assinatura; o CLI traz skills, MCP, `--max-turns` e permissões por ferramenta. O Agent SDK, segundo a documentação, deve usar chave de API em produtos feitos com ele.
- **Alternatives**:
  - Agent SDK com chave de API: custo por uso, que o dono quer evitar.
  - Agent SDK com o token da assinatura: fora do uso previsto.
  - Um laço próprio em .NET perde as skills.
  - Um container separado seria mais um plug-in e mais um segredo.

## R2. Ferramentas do agente
- **Decision**:
  - O CLI roda com `--tools ""`, que tira todas as ferramentas internas (conferido no 2.1.325: `tools: []`), e `--disable-slash-commands`. A lista em `--disallowedTools` e no `.claude/settings.json` fica como segunda barreira; `--allowedTools` só tem `mcp__agente__*`.
  - Como o `Skill` também sai, o texto da skill `plugin-hub` vai em `--append-system-prompt`.
  - O agente só recebe as ferramentas do contrato `ferramentas-agente.md`, que chamam o backend local.
  - No esqueleto, o agente escreve numa pasta temporária da execução. Quem envia o conteúdo ao GitHub é o backend.
- **Rationale**: atende FR-003, FR-007 e FR-015. Quem recusa a ação fora da lista é o backend, não o prompt.
- **Alternatives**: deixar o Bash com uma lista de comandos permitidos foi descartado porque é difícil de garantir.

## R3. Leituras da VPS
- **Decision**: o núcleo ganha as rotas `/api/core/agente/*`.
  - Elas só aceitam o segredo de serviço do plug-in `agente` e só ids que estão no `plugins.lock`.
  - Para estado, logs e health, o núcleo repassa o pedido ao deployer: `GET /plugins`, `/plugins/{id}/logs` (até 200 linhas) e `/plugins/{id}/health`.
  - As permissões saem de uma consulta fixa em `information_schema` e `pg_namespace`.
  - Antes de chegar ao agente, os logs passam por uma limpeza que tira as linhas com `Password=`, `Bearer ` ou `ApiKey`.
- **Rationale**: o deployer já tem o docker e o estado. O núcleo já tem o segredo de serviço e o banco.
- **Alternatives**:
  - O `ops` foi descartado porque dá um shell de root.
  - Dar ao agente um papel de leitura no Postgres criaria mais um segredo.

## R4. Fonte da IA
- **Decision**:
  - Token da assinatura em `data/plugins/env/agente.env` (`Agente__Claude__Token`, `Agente__Claude__Validade`), gerado pelo dono com `claude setup-token` (vale até um ano).
  - O manifesto não declara `usaIa`: o agente não pede `/api/core/ia`.
  - Erro de limite da assinatura no stream-json: a execução vai para `falhou (limite)` com o horário de volta, se o CLI informar.
  - O hub avisa a expiração do token com 7 dias de antecedência, como o do GitHub.
- **Rationale**: FR-016 e FR-017; custo extra zero.
- **Alternatives**: a chave de IA do hub (custo por uso); diagnóstico só com regras (fica para depois, se o limite da assinatura apertar).

## R5. Token do GitHub
- **Decision**:
  - O token é granular e fica em `data/plugins/env/agente.env`, nas variáveis `Agente__GitHub__Token` e `Agente__GitHub__Validade`.
  - O backend usa o Octokit para:
    - criar o repositório a partir do template `hub-modelo`;
    - enviar os commits numa branch `esqueleto`;
    - abrir o PR;
    - ler o estado da CI.
  - Toda chamada passa por `RepositorioPermitido(execucao)`, que só aceita o repositório criado na própria execução.
- **Rationale**: atende o FR-018 e a premissa do token na spec.

## R6. Regras do manifesto
- **Decision**: `Plugins.Validar` sai do deployer e vai para o `Hub.Plugin.Sdk`, com o nome `RegrasDoManifesto`, na versão 1.6.0. O deployer e o agente passam a usar a mesma regra.
- **Rationale**: a história 3 pede as mesmas regras que o deployer usa.

## R7. Fila e retomada

O CLI roda com `HOME` numa pasta da execução, apagada no fim, para não guardar sessão nem histórico entre execuções.
- **Decision**:
  - A fila fica na memória e é alimentada pela tabela.
  - Quando o plug-in sobe, as execuções que estavam "rodando" passam a "falhou (reinício)".
  - Uma pergunta ao dono pausa o processo Node: a ferramenta `perguntar` espera a resposta por até 24 h.
