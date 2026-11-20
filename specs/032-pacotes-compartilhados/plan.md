# Implementation Plan: Pacotes compartilhados dos plug-ins

**Branch**: sem branch própria | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

## Summary

Cria `pacotes/` no núcleo com três pacotes publicados pela CI: o SDK .NET (auth por JWKS, banco, health, MCP, IA), o `@grafite/ui` (tokens, fontes, ícones, `<grafite-barra>`, cliente de token) e o `plugin.schema.json`. O núcleo passa a consumir o `@grafite/ui` também, para não haver dois temas. Um repositório modelo (`hub-modelo`) junta tudo.

## Technical Context

**Language/Version**: C# (.NET 9, `net9.0;net10.0`), TypeScript (web components sem framework), JSON Schema 2020-12

**Primary Dependencies**: `Microsoft.AspNetCore.Authentication.JwtBearer`, `ModelContextProtocol.AspNetCore` (já usados); nenhuma nova no frontend

**Storage**: N/A

**Testing**: xUnit no SDK (JWKS com chave rotacionada, audiência legada, tabelas do plug-in, health), Vitest no `@grafite/ui` (barra lista plug-ins, troca de tema, renovação de token), teste do schema contra os manifestos de exemplo

**Target Platform**: plug-ins .NET + qualquer frontend

**Constraints**: `@grafite/ui` sem depender de Angular; SDK com alvo duplo (.NET 9 e 10) porque o Cérebro está em .NET 10

## Constitution Check

| Princípio | Situação |
|---|---|
| I (v2.0.0) | ✅ Login e banco iguais em todos via SDK |
| II | ✅ Segredos de plug-in (AES-GCM) e guarda de tabelas no SDK |
| III | N/A |
| IV | ✅ IA via núcleo, com o mesmo fallback |
| V | ✅ Pacotes testados no núcleo |
| VI | ✅ Grafite vira pacote único |
| VII | ✅ |
| VIII | ⚠️ Três pacotes publicados — justificado (abaixo) |

## Project Structure

```text
pacotes/Hub.Plugin.Sdk/          # Auth/, Dados/, Health/, Mcp/, Ia/, Segredos/
pacotes/Hub.Plugin.Sdk.Tests/
pacotes/grafite-ui/              # tokens.css, fontes.css, icones.ts, grafite-barra.ts, token-plugin.ts
pacotes/plugin.schema.json
.github/workflows/pacotes.yml    # publica no GitHub Packages quando a versão muda
.github/workflows/plugin.yml     # CI reutilizável dos plug-ins (029)
frontend/src/styles.css          # passa a importar @grafite/ui/tokens.css
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Pacotes publicados | Repositórios separados não podem referenciar código do núcleo por caminho | Copiar arquivos para cada plug-in: o login e o tema divergiriam no primeiro ajuste; submódulo git: atrito em toda clonagem e na CI |
