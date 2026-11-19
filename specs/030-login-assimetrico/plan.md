# Implementation Plan: Login com chave assimétrica e OAuth no núcleo

**Branch**: sem branch própria | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

## Summary

`TokenService` passa a assinar com ES256 (chave em arquivo, `kid` no cabeçalho), publica JWKS e ganha a troca de token por plug-in. O `OAuthStore`/`OAuthEndpoints` do `cerebro/` é portado para o `Notas.Api` com recurso por plug-in; os tokens estáticos de MCP saem do arquivo do Cérebro para uma tabela do núcleo. O SDK (032) traz a validação por JWKS para os plug-ins.

## Technical Context

**Language/Version**: C# ASP.NET Core 9 (`Notas.Api`), .NET 10 (`cerebro/` até a extração), Angular 21

**Primary Dependencies**: `System.Security.Cryptography` (ECDsa P-256), `Microsoft.IdentityModel.Tokens` (já em uso); nenhuma nova

**Storage**: chave privada em `data/core/chaves/<kid>.pem` (permissão 600); tabelas `core_oauth_*` e `core_mcp_tokens` no `notas.db`

**Testing**: xUnit — assinatura/validação ES256, JWKS com duas chaves, HS256 aceito só na janela, troca por plug-in desligado, `aud` cruzado recusado, OAuth portado (os testes de `cerebro/tests/Hub.Tests/OAuthTests.cs` migram junto), token estático por plug-in

**Constraints**: zero novo login; `/ops` sem OAuth; apps Android sem atualização obrigatória

## Constitution Check

| Princípio | Situação |
|---|---|
| I (v2.0.0) | ✅ Só o núcleo emite login |
| II | ✅ Plug-in sem segredo de assinatura; tokens em hash; chave privada fora do banco e do git |
| III | ✅ Apps offline continuam; renovação igual |
| IV | N/A |
| V | ✅ Testes de contrato de auth |
| VI | ✅ Tela de Conexões no Grafite |
| VII | ✅ |
| VIII | ✅ Sem biblioteca nova; o servidor OAuth já existe, só muda de lugar |

## Project Structure

```text
backend/Notas.Api/Auth/TokenService.cs          # ES256, kid, janela HS256
backend/Notas.Api/Auth/ChavesDeAssinatura.cs    # carregar/gerar/rotacionar chave
backend/Notas.Api/Endpoints/AuthEndpoints.cs    # /.well-known/jwks.json, POST /api/auth/token-plugin
backend/Notas.Api/Endpoints/OAuthEndpoints.cs   # portado do cerebro, recurso por plug-in
backend/Notas.Api/Services/Auth/OAuthStore.cs   # portado; tabelas core_oauth_*
backend/Notas.Api/Endpoints/McpTokensEndpoints.cs
frontend/src/app/features/configuracoes/conexoes/  # tokens MCP e aplicativos autorizados
frontend/src/app/features/cerebro/autorizar.page.ts → features/hub/autorizar.page.ts
caddy/Caddyfile*                                 # /.well-known/oauth-* → núcleo
```
