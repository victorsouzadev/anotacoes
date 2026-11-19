# Implementation Plan: Extrair o Segundo Cérebro como primeiro plug-in

**Branch**: sem branch própria | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

## Summary

`git subtree split` de `cerebro/` para `hub-cerebro`, mais as telas Angular do Cérebro. O serviço passa a usar o SDK (auth por JWKS, banco compartilhado, health, MCP, IA do núcleo). Uma migração única copia `captures`/`settings` do `hub.db` para `cerebro_*` no `notas.db` e as tabelas OAuth para `core_oauth_*`. Depois de conferido em produção, `cerebro/` sai do núcleo.

## Technical Context

**Language/Version**: C# .NET 10 (serviço), Angular 21 (telas, agora build próprio servido pelo plug-in)

**Primary Dependencies**: `Hub.Plugin.Sdk`, `@grafite/ui`

**Storage**: `notas.db` (`cerebro_capturas`, `cerebro_configuracoes`), `data/cerebro/hub` (índice e vetores, derivados), `data/cerebro/webdav` (vault)

**Testing**: os 70 testes atuais do `cerebro/` passam a rodar no `hub-cerebro`; novos: migração `hub.db` → banco compartilhado (contagens, `client_id` preservado), conector OAuth antigo válido depois da migração, bookmarklet em `/capturar`

**Constraints**: zero reconexão; índice recriável; `hub.db` antigo guardado 30 dias

## Constitution Check

| Princípio | Situação |
|---|---|
| I (v2.0.0) | ✅ Plug-in com login e banco do núcleo |
| II | ✅ Migração com contagem e cópia do `hub.db`; segredos recifrados |
| III | N/A |
| IV | ✅ IA do núcleo com fallback igual |
| V | ✅ Testes de migração |
| VI | ✅ `@grafite/ui` |
| VII | ✅ |
| VIII | ✅ Usa o contrato, sem peça nova |

## Project Structure

```text
# hub-cerebro (novo repositório)
src/Hub/                    # vindo de cerebro/src/Hub; Program.cs com AdicionarPlugin
src/Hub/Migracao033.cs      # hub.db → notas.db (roda uma vez, idempotente)
tests/Hub.Tests/
web/                        # telas de features/cerebro + /capturar, build Angular próprio
plugin.json
.github/workflows/ci.yml    # usa plugin.yml do núcleo

# núcleo (este repositório)
plugins.lock                # + cerebro
docker-compose.yml          # serviço cerebro sai; cerebro-webdav continua até ir para o plug-in
frontend/src/app/features/cerebro/   # removido (fica autorizar.page.ts no hub)
cerebro/                    # removido no fim
.github/workflows/ci.yml    # job do Cérebro sai
```
