# Research: 039 hub-agente

## R1. Onde roda o laço do agente
- **Decision**: o Claude Agent SDK roda em TypeScript, num processo Node filho do backend .NET. Cada execução tem o seu processo.
- **Rationale**: o SDK já traz as skills, as ferramentas próprias (MCP no mesmo processo), os limites de turnos e de custo (`maxTurns`, `maxBudgetUsd`) e a permissão por ferramenta.
- **Alternatives**:
  - O SDK em Python foi descartado porque traria mais uma linguagem.
  - Um laço próprio em .NET perde as skills.
  - Um container separado seria mais um plug-in e mais um segredo.

## R2. Ferramentas do agente
- **Decision**:
  - Todas as ferramentas internas do SDK (Bash, Read, Write, WebFetch) ficam desligadas.
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

## R4. Chave de IA
- **Decision**:
  - No início de cada execução, o backend pede `/api/core/ia` com o token do dono que disparou. O token fica só na memória, durante a execução.
  - O manifesto declara `usaIa: true`.
  - Provedores aceitos: `anthropic`, direto, e `openrouter`, pelo `ANTHROPIC_BASE_URL` compatível.
  - Com qualquer outro provedor, a tela avisa, como pede o FR-017.
- **Rationale**: atende o FR-016, e nada novo fica guardado.
- **Alternatives**: uma chave própria no `agente.env`, que o dono recusou.

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
- **Decision**:
  - A fila fica na memória e é alimentada pela tabela.
  - Quando o plug-in sobe, as execuções que estavam "rodando" passam a "falhou (reinício)".
  - Uma pergunta ao dono pausa o processo Node: a ferramenta `perguntar` espera a resposta por até 24 h.
