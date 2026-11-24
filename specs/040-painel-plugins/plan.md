# Implementation Plan: Painel de plug-ins

**Branch**: na branch da sessão (`specs/040-painel-plugins`) | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

## Summary

Uma tela nova no núcleo, `/plugins`, só para administradores.

- **Núcleo**: API `/api/painel/plugins/*`. Junta o estado do deployer, o GitHub e o registro; guarda o histórico das operações.
- **Deployer**: prepara o banco (papel, schema, conexão e permissões), porque é o único que grava em `data/plugins` e já alcança o Postgres. A senha nasce e fica nele.
- **GitHub**: o hub não tem permissão de escrita em código. Ele dispara um workflow do próprio núcleo, que muda a linha do `plugins.lock` e abre o PR. O dono faz o merge.

## Technical Context

**Language/Version**: C# .NET 9 (núcleo e deployer), Angular 21, GitHub Actions.

**Primary Dependencies**: as que já existem. O GitHub é lido com `HttpClient`, sem Octokit no núcleo.

**Storage**: tabela `core_plugins_operacoes` no schema `nucleo`, criada pelo `Esquema.Garantir` (sem migração).

**Testing**: xUnit (também com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`), Postgres real na CI para o preparo do banco, GitHub e Docker falsos, testes do frontend.

**Target Platform**: VPS (Docker Compose), navegador de computador e celular.

**Project Type**: web (backend, frontend e deployer do núcleo).

**Performance Goals**: painel em até 10 s (SC-002), com as leituras em paralelo e limite de 5 s para cada fonte.

**Constraints**: nenhum container novo; nenhum segredo em tela, log, PR ou histórico; VPS com 1,9 GiB.

**Scale/Scope**: um dono, cerca de 10 a 20 plug-ins, poucas operações por mês.

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Um hub, um login, um banco | Atende: tela do núcleo, login do núcleo, mesmo banco. O deploy segue pelo `plugins.lock`. |
| II. Dados do usuário são sagrados | Atende: nada é apagado; o preparo nunca altera senha nem papel existente. |
| III. Local-first | Não se aplica: operação do servidor. |
| IV. IA | Não usa IA, e o agente não alcança as rotas (R7). |
| V. Lógica pura com testes | Atende: edição do registro, situação e avisos são funções puras. |
| VI. Grafite | Atende: tokens, claro e escuro, largura de celular. |
| VII. pt-BR | Atende. |
| VIII. Simplicidade | Atende: sem serviço nem dependência nova. O workflow está em Complexity Tracking. |

**Gate**: aprovado. Revisto depois do desenho, sem mudança.

## Project Structure

### Documentation (this feature)

```text
specs/040-painel-plugins/
├── plan.md, research.md, data-model.md, quickstart.md
└── contracts/
    ├── painel-api.md     # API do núcleo para a tela
    ├── deployer.md       # rotas novas do deployer
    └── workflow.md       # workflow do registro e acesso ao GitHub
```

### Source Code

```text
backend/Notas.Api/Endpoints/PainelPluginsEndpoints.cs
backend/Notas.Api/Services/Painel/        # SituacaoDoPlugin, RecursosLivres, GithubDoPainel, OperacoesDoPainel, PainelOptions
backend/Notas.Api.Tests/Painel*Tests.cs
deployer/Notas.Deployer/PreparoDoBanco.cs # conferir e preparar
deployer/Notas.Deployer/Program.cs        # rotas novas
deployer/Notas.Deployer.Tests/PreparoDoBancoTests.cs
pacotes/Hub.Plugin.Sdk/Manifestos/        # ids reservados (R5)
scripts/plugins-lock.py                   # edita uma linha do registro; testado na CI
.github/workflows/plugins-lock.yml        # workflow_dispatch que abre o PR
.github/workflows/ci.yml                  # ganha workflow_dispatch e o teste do script
frontend/src/app/features/plugins/        # tela e serviço
docker-compose.yml, .env.example, DEPLOY.md, README.md
```

**Structure Decision**: o painel mora no núcleo, não no `hub-agente`: o plug-in que roda a IA não pode ter como disparar as ações (FR-013).

## Complexity Tracking

| Ponto | Por que é necessário | Alternativa mais simples, recusada porque |
|---|---|---|
| Workflow que abre o PR | O token da VPS não consegue escrever código nem fazer merge. | Token com escrita em código abriria o PR direto, mas também faria merge: a `main` não tem proteção. |
| Rotas de escrita no deployer | Só ele grava em `data/plugins`, montada como leitura no núcleo. | Montar a pasta com escrita no núcleo exporia as conexões de todos os plug-ins à API da internet. |
| Dois tokens do GitHub | Leitura dos `hub-*` e disparo do workflow têm alcances diferentes. | Um token só teria Actions com escrita em todos os repositórios. |
