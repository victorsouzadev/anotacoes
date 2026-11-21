# Implementation Plan: Esquema do núcleo sem migrações

**Branch**: `nucleo/037-esquema-sem-migracoes` | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md)

## Summary

Apagar `backend/Notas.Api/Data/Migrations` e trocar `db.Database.Migrate()` por `EsquemaNucleo.Garantir(db)`, que gera o esquema pelo próprio modelo do `AppDbContext` (`GenerateCreateScript`), roda cada comando com `IF NOT EXISTS` e acrescenta as colunas que faltarem em tabelas existentes. É o mesmo jeito que os plug-ins já usam (`BancoVazio`), sem nenhum arquivo de esquema escrito à mão.

## Technical Context

**Language/Version**: C# / .NET (o do núcleo)
**Primary Dependencies**: EF Core + SQLite
**Storage**: `notas.db` compartilhado com os plug-ins
**Testing**: xUnit do `Notas.Api.Tests`, também com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`
**Constraints**: não tocar em tabelas que não são do modelo do núcleo; idempotente; transação `BEGIN IMMEDIATE` para dois processos subindo juntos.

## Constitution Check

- Banco compartilhado (029–031): o núcleo só mexe nas tabelas dele. OK.
- Gravar na VPS só com confirmação: o deploy fica fora do PR. OK.

## Project Structure

- `backend/Notas.Api/Data/EsquemaNucleo.cs` (novo)
- `backend/Notas.Api/NotasApp.cs` (troca `Migrate()`)
- `backend/Notas.Api/Data/Migrations/` (removida)
- `backend/Notas.Api.Tests/EsquemaNucleoTests.cs` (novo)
- `README.md`, `DEPLOY.md`, `.specify/memory/constitution.md`, `specs/035-*/tasks.md`

## Decisões

- **Gerar pelo modelo em vez de `schema.sql`**: nenhuma linha de esquema duplicada no repositório; o modelo já é a fonte.
- **Colunas novas**: compara o modelo com `PRAGMA table_info` e faz `ALTER TABLE ... ADD COLUMN`. Remoção ou troca de tipo de coluna não é automática (raro; fica como passo manual no `DEPLOY.md`).
- **`__EFMigrationsHistory`**: fica no banco, sem uso.
