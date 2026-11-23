# Implementation Plan: Agente de plug-ins do hub (hub-agente)

**Branch**: na branch da sessão (`skill/plugin-hub`) | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

## Summary

O `agente` é um plug-in novo, no repositório `hub-agente`, criado a partir do `hub-modelo`.

- **Backend:** em .NET 9, usa o `Hub.Plugin.Sdk` para login, banco, MCP e telas.
- **Agente:** roda o Claude Agent SDK, em TypeScript, num processo Node dentro do mesmo container. Roda uma execução por vez.
- **O que o agente usa:** carrega a skill `plugin-hub` e só enxerga as ferramentas que o backend oferece.
- **Leituras da VPS:** vêm de rotas novas do núcleo (`/api/core/agente/*`).
  - Elas só aceitam o segredo de serviço do plug-in `agente`.
  - Repassam ao deployer só pedidos de leitura, de uma lista fechada.
  - O agente não tem `docker.sock` nem shell.
- **IA:** vem de `/api/core/ia`, com o token do dono.
- **Segredo novo:** só o token do GitHub, em `data/plugins/env/agente.env`.

## Technical Context

**Language/Version**:
- C# .NET 9 no backend do plug-in.
- TypeScript em Node 22 no processo do agente.
- Angular 21 na tela.

**Primary Dependencies**:
- `Hub.Plugin.Sdk` 1.6.0 ou mais nova, já com as regras do manifesto.
- `@anthropic-ai/claude-agent-sdk`.
- `@grafite/ui`.
- Octokit (.NET), para falar com o GitHub.

**Storage**: schema `agente` no banco `hub`, com as tabelas `agente_execucoes` e `agente_eventos` e `Maximum Pool Size=3`.

**Testing**:
- xUnit no backend, também com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`.
- Vitest no processo do agente, com um agente falso.
- Testes do núcleo e do deployer para as rotas novas.

**Target Platform**: container Linux na VPS, subido pelo deployer com `--user 0:0 --cap-drop ALL`.

**Project Type**: um plug-in web (backend, tela e MCP), com mudanças pequenas no núcleo, no deployer e no SDK.

**Performance Goals**:
- O diagnóstico termina em até 2 minutos (SC-001).
- A lista de plug-ins pelo MCP responde em menos de 2 s.

**Constraints**:
- Roda uma execução por vez.
- Limites por execução, que podem ser mudados no `agente.env`:
  - diagnóstico: 10 minutos e US$ 1;
  - esqueleto: 30 minutos e US$ 5.
- Nada é gravado na VPS.

**Scale/Scope**: um dono e algumas dezenas de execuções por mês.

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Um hub, um login, um banco | Atende: usa o login do núcleo e um schema próprio, e só o administrador abre a ferramenta. |
| II. Dados do usuário são sagrados | Atende: na VPS ele só lê, nunca faz merge e não apaga nenhuma execução. |
| III. Local-first | Não se aplica: é uma ferramenta de operação, que funciona online. |
| IV. IA com fallback e custo explícito | Atende: cada execução tem limite de custo e o histórico mostra quanto custou. Se a IA não estiver configurada, a tela avisa e nada começa. |
| V. Lógica pura fora do framework | Atende: as regras do manifesto e a lista de ações permitidas são funções puras, com testes. |
| VI. Grafite | Atende: a tela usa `@grafite/ui` e a `<grafite-barra>`. |
| VII. pt-BR | Atende. |
| VIII. Simplicidade | Ponto de atenção: há um processo Node dentro de um plug-in .NET (ver Complexity Tracking). |
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
agente/                    # Node: src/rodar.ts (Agent SDK) e skills/plugin-hub/SKILL.md (cópia fixada)
frontend/                  # tela /agente/
plugin.json, Dockerfile, .github/workflows/ci.yml
```

**Structure Decision**: o backend .NET guarda todo o estado e todos os segredos.
- O processo Node só conversa com o backend, por stdin e stdout, com uma mensagem JSON por linha.
- A chave de IA chega ao Node numa variável de ambiente do processo filho.
- O Node só acessa a rede para chamar a API da Anthropic e o backend local.

## Complexity Tracking

| Violação | Por que é necessária | Alternativa mais simples, recusada porque |
|---|---|---|
| Node no container de um plug-in .NET | O Claude Agent SDK, com skills, ferramentas e o laço do agente, só existe em TypeScript e em Python. | Escrever o laço à mão em .NET, sobre a Messages API, perde as skills e o controle de ferramentas do SDK. Fazer o plug-in todo em Node perde o `Hub.Plugin.Sdk` (login, banco e MCP). |
| Rotas novas no núcleo e no deployer | O agente não pode ter `docker.sock` (FR-003). | Usar o `ops` daria ao agente um shell de root. |
