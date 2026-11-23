# Implementation Plan: Agente de plug-ins do hub (hub-agente)

**Branch**: na branch da sessão (`skill/plugin-hub`) | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

## Summary

O `agente` é um plug-in novo, no repositório `hub-agente`, criado a partir do `hub-modelo`.

- **Backend:** em .NET 9, usa o `Hub.Plugin.Sdk` para login, banco, MCP e telas.
- **Agente:** roda o Claude Code em modo automático (`claude -p`), num processo dentro do mesmo container, com a assinatura do dono. Roda uma execução por vez.
- **O que o agente usa:** carrega a skill `plugin-hub` e só enxerga as ferramentas que o backend oferece, por um MCP local.
- **Leituras da VPS:** vêm de rotas novas do núcleo (`/api/core/agente/*`).
  - Elas só aceitam o segredo de serviço do plug-in `agente`.
  - Repassam ao deployer só pedidos de leitura, de uma lista fechada.
  - O agente não tem `docker.sock` nem shell.
- **IA:** vem da assinatura do Claude do dono (`CLAUDE_CODE_OAUTH_TOKEN`, gerado com `claude setup-token`), sem custo extra.
- **Segredos novos:** o token do GitHub e o token da assinatura, os dois em `data/plugins/env/agente.env`.

## Technical Context

**Language/Version**:
- C# .NET 9 no backend do plug-in.
- Claude Code CLI (Node 22) no processo do agente, versão fixada na imagem.
- Angular 21 na tela.

**Primary Dependencies**:
- `Hub.Plugin.Sdk` 1.6.0 ou mais nova, já com as regras do manifesto.
- `@anthropic-ai/claude-code` (CLI), com `--output-format stream-json`.
- `@grafite/ui`.
- Octokit (.NET), para falar com o GitHub.

**Storage**: schema `agente` no banco `hub`, com as tabelas `agente_execucoes` e `agente_eventos` e `Maximum Pool Size=3`.

**Testing**:
- xUnit no backend, também com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`.
- No backend, um CLI falso que devolve um stream-json gravado.
- Testes do núcleo e do deployer para as rotas novas.

**Target Platform**: container Linux na VPS, subido pelo deployer com `--user 0:0 --cap-drop ALL`.

**Project Type**: um plug-in web (backend, tela e MCP), com mudanças pequenas no núcleo, no deployer e no SDK.

**Performance Goals**:
- O diagnóstico termina em até 2 minutos (SC-001).
- A lista de plug-ins pelo MCP responde em menos de 2 s.

**Constraints**:
- Roda uma execução por vez.
- Limites por execução, que podem ser mudados no `agente.env`:
  - diagnóstico: 10 minutos e 20 turnos;
  - esqueleto: 30 minutos e 80 turnos.
- O uso divide o limite da assinatura com o dono; se acabar, a execução para e o relatório diz quando volta.
- Nada é gravado na VPS.

**Scale/Scope**: um dono e algumas dezenas de execuções por mês.

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Um hub, um login, um banco | Atende: usa o login do núcleo e um schema próprio, e só o administrador abre a ferramenta. |
| II. Dados do usuário são sagrados | Atende: na VPS ele só lê, nunca faz merge e não apaga nenhuma execução. |
| III. Local-first | Não se aplica: é uma ferramenta de operação, que funciona online. |
| IV. IA com fallback e custo explícito | Atende: custo extra zero (assinatura); cada execução tem limite de tempo e turnos. Sem o token, a tela avisa e nada começa. |
| V. Lógica pura fora do framework | Atende: as regras do manifesto e a lista de ações permitidas são funções puras, com testes. |
| VI. Grafite | Atende: a tela usa `@grafite/ui` e a `<grafite-barra>`. |
| VII. pt-BR | Atende. |
| VIII. Simplicidade | Ponto de atenção: há o Claude Code (Node) dentro de um plug-in .NET (ver Complexity Tracking). |
| Restrições técnicas | O Node não está na tabela da constituição. Ele é um processo auxiliar, não o backend (ver Complexity Tracking). |

**Gate**: aprovado, com a justificativa do Complexity Tracking. Revi o gate depois do desenho e nada mudou.

## Project Structure

### Documentation (this feature)

```text
specs/039-hub-agente/
├── plan.md, research.md, data-model.md, quickstart.md
└── contracts/
    ├── nucleo-agente.md       # /api/core/agente/* e as rotas novas do deployer
    ├── agente-api.md          # API e MCP do plug-in
    └── ferramentas-agente.md  # o que o agente pode chamar
```

### Source Code

```text
# núcleo (este repositório)
pacotes/Hub.Plugin.Sdk/Manifestos/RegrasDoManifesto.cs  # sai de deployer/Plugins.cs e passa a ser compartilhada
deployer/Notas.Deployer/Program.cs                       # GET /plugins/{id}/logs e GET /plugins/{id}/health
backend/Notas.Api/Endpoints/AgenteNucleoEndpoints.cs     # /api/core/agente/*
scripts/postgres-hub.sh                                  # papel agente
plugins.lock                                             # linha do agente, num PR separado, com o dono

# hub-agente (repositório novo)
backend/Agente.Api/        # Program.cs, Execucoes/, Fila/, Ferramentas/, Mcp/, Github/
backend/Agente.Api.Tests/
agente/                    # .claude/settings.json (permissões), .claude/skills/plugin-hub/SKILL.md (cópia fixada), mcp.json
frontend/                  # tela /agente/
plugin.json, Dockerfile, .github/workflows/ci.yml
```

**Structure Decision**: o backend .NET guarda todo o estado e todos os segredos.
- O backend inicia `claude -p` com `--output-format stream-json`, `--max-turns`, `--allowedTools` só com as ferramentas `mcp__agente__*` e `--disallowedTools` com Bash, Read, Write, Edit, WebFetch e WebSearch.
- O token da assinatura chega ao processo filho numa variável de ambiente; o backend nunca o registra.
- O MCP local `agente` é servido pelo backend em `localhost`, com um segredo por execução.
- Perguntas ao dono: o agente chama `perguntar`, que fica esperando a resposta na tela ou no MCP.

## Complexity Tracking

| Violação | Por que é necessária | Alternativa mais simples, recusada porque |
|---|---|---|
| Claude Code CLI no container de um plug-in .NET | É o jeito aceito de usar a assinatura do dono numa automação pessoal (`claude setup-token`), com skills e MCP. | O Agent SDK com a assinatura não é o uso previsto (o SDK pede chave de API); a chave de API custa por uso. |
| Rotas novas no núcleo e no deployer | O agente não pode ter `docker.sock` (FR-003). | Usar o `ops` daria ao agente um shell de root. |
