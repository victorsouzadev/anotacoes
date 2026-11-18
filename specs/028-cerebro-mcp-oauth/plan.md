# Implementation Plan: OAuth 2.1 no MCP do Segundo Cérebro

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Servidor de autorização mínimo dentro do `cerebro/` (registro dinâmico, authorize com PKCE, token com rotação, revogação), consentimento numa página Angular do hub com o login único, e o middleware do `/mcp` aceitando token OAuth além do estático.

## Technical Context

C# .NET 10 (`cerebro/`), Angular 21 · Storage: `HubDb` (SQLite) · Testing: xUnit (`OAuthTests`: PKCE válido/inválido, código reutilizado, redirect divergente, rotação e reuso, revogação, e-mail fora da lista, token estático ainda vale) · Constraints: HTTPS; só `CEREBRO_USUARIOS`; `/ops` fora · Caddy: rotas `/.well-known/oauth-*` para o `cerebro`.

## Constitution Check

| Princípio | Situação |
|---|---|
| I | ✅ Usa o login único para consentir |
| II | ✅ Tokens em hash, revogação imediata, menos token em URL |
| III | N/A |
| IV | N/A |
| V | ✅ Testes de integração do fluxo |
| VI | ✅ Página de consentimento no Grafite |
| VII | ✅ |
| VIII | ⚠️ Implementação própria de OAuth — justificada (abaixo) |

Re-check pós-design: só o item VIII, justificado.

## Project Structure

```text
cerebro/src/Hub/Api/OAuthEndpoints.cs      # register, authorize, consent, token, revoke, well-known
cerebro/src/Hub/Api/OAuthStore.cs          # tabelas e hashes
cerebro/src/Hub/Program.cs                 # middleware do /mcp aceita OAuth
cerebro/src/Hub/Data/HubDb.cs              # tabelas oauth_*
cerebro/tests/Hub.Tests/OAuthTests.cs
caddy/Caddyfile*                           # /.well-known/oauth-* → cerebro
frontend/src/app/features/cerebro/autorizar.page.ts   # consentimento
frontend/src/app/features/cerebro/                    # lista de apps autorizados em Conectar
cerebro/README.md, DEPLOY.md
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Servidor OAuth próprio | O Claude web só conecta MCP remoto sem token na URL via OAuth | OpenIddict traz configuração e superfície bem maiores para um único fluxo; manter o `?key=` deixa o segredo em URL |
