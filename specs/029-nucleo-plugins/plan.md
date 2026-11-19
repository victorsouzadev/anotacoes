# Implementation Plan: Núcleo do hub e contrato de plug-ins

**Branch**: sem branch própria | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

## Summary

O núcleo ganha um registro de plug-ins (`plugins.lock` + manifestos), a rota `/api/plugins`, cards do hub montados por ela, geração do trecho do Caddy por plug-in e um deployer que sobe/atualiza/volta cada plug-in individualmente. Nada é extraído ainda: as ferramentas atuais entram no registro como "módulos do núcleo", para a tela do hub já funcionar do jeito novo.

## Technical Context

**Language/Version**: C# ASP.NET Core 9 (`Notas.Api`), .NET (`deployer/`), Angular 21

**Primary Dependencies**: nenhuma nova; validação de JSON Schema com `JsonSchema.Net` só no deployer (ver research)

**Storage**: `notas.db` (tabela `core_plugins_estado`); `plugins.lock` versionado no repositório

**Testing**: xUnit (`Notas.Api.Tests`: `/api/plugins`, módulos do núcleo; `Notas.Deployer.Tests`: validação de manifesto, duplicados, rotas reservadas, volta de versão), Vitest (hub monta cards da API e mostra indisponível)

**Target Platform**: VPS com Docker Compose

**Constraints**: hub não espera health (cache de 30 s); rotas antigas preservadas; nenhum dado apagado ao remover plug-in

**Scale/Scope**: até ~15 plug-ins, um usuário principal

## Constitution Check

| Princípio | Situação |
|---|---|
| I (v2.0.0) | ✅ É a feature que implementa o princípio emendado: um login, um banco, deploy pelo núcleo |
| II | ✅ Remover plug-in não apaga dados; backup inclui `dados` dos manifestos |
| III | N/A |
| IV | N/A |
| V | ✅ Validação de manifesto e geração de rotas em funções puras com teste |
| VI | ✅ Cards e estado "indisponível" no Grafite |
| VII | ✅ |
| VIII | ⚠️ Registro e deploy por plug-in são uma camada nova — justificada (abaixo) |

Re-check pós-design: sem novas violações.

## Project Structure

```text
plugins.lock                                     # id, imagem, versão, ativo (YAML simples)
backend/Notas.Api/Services/Plugins/              # Registro, ModulosDoNucleo, HealthCache
backend/Notas.Api/Endpoints/PluginsEndpoints.cs  # GET /api/plugins
deployer/src/.../Plugins/                        # LerLock, ValidarManifesto, GerarCaddy, Aplicar, Voltar
caddy/plugins.d/<id>.caddy                       # gerado; importado pelo Caddyfile
frontend/src/app/features/hub/hub.page.ts        # cards a partir de /api/plugins
frontend/src/app/core/plugins.service.ts
frontend/src/app/features/configuracoes/         # Servidor: lista de plug-ins e versões
docker-compose.yml / DEPLOY.md / README.md
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Registro de plug-ins e deploy individual | É o pedido: repositórios separados conectados ao hub | Manter tudo no compose do núcleo com `image:` fixo por ferramenta exigiria commit no núcleo para cada card, rota e backup |
| Arquivos do Caddy gerados | Rotas de cada plug-in (e aliases legados) mudam sem editar o Caddyfile à mão | Caddyfile manual por plug-in: fácil esquecer um alias e quebrar o app Android |
