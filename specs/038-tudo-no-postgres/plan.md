# Implementation Plan: Núcleo e plug-ins no Postgres

**Branch**: na branch da sessão | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md)

## Summary

Núcleo e os sete plug-ins que usam o `notas.db` passam para o banco `hub` no `notas-postgres`: schema `nucleo` para o núcleo e um schema e um papel por plug-in. O esquema é gerado pelo modelo (código da spec 037 movido para o SDK). Os dados vão numa janela curta, com uma ferramenta de cópia que confere as contagens. Detalhes em [research.md](research.md).

## Technical Context

**Language/Version**: C# / .NET 9
**Primary Dependencies**: EF Core com `Npgsql.EntityFrameworkCore.PostgreSQL`
**Storage**: `notas-postgres` (Postgres 17), banco `hub`
**Testing**: xUnit contra Postgres de serviço na CI, também em modo invariante
**Constraints**: janela de no máximo 15 minutos; `notas.db` intacto para voltar; senhas só no `.env` e em `data/plugins/env/<id>.env`.

## Constitution Check

- Dados sagrados: cópia conferida e volta garantida. OK.
- Gravar na VPS só com confirmação: papéis, senhas e a janela são passos confirmados. OK.
- Isolamento (031): passa de convenção conferida para permissão do banco. Melhora.

## Ordem

1. SDK: `Esquema.Garantir` nos dois provedores e conexão Postgres pelo `ConnectionStrings:Db`.
2. Núcleo: Npgsql, `EsquemaNucleo` usa o SDK, testes contra Postgres.
3. Plug-ins (um PR cada): Npgsql, sai `Migrations` e `MigrarComBase`, testes contra Postgres. Continuam aceitando SQLite até a janela.
4. Ferramenta de cópia e ensaio com uma cópia do `notas.db` num Postgres local.
5. Backup: `pg_dump` do banco `hub` no backup diário e na cópia externa.
6. Janela na VPS, com confirmação: papéis, troca das conexões, cópia, conferência, volta.
7. Depois de confirmada, o SQLite sai do código.
