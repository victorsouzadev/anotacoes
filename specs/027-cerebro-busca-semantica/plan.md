# Implementation Plan: Busca semântica

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Vetores por trecho num SQLite recriável, indexação incremental em segundo plano, busca híbrida FTS5 + cosseno (RRF) usada pela tela, pelo MCP e por `Candidates()`, com fallback para FTS5.

## Technical Context

C# .NET 10 (`cerebro/`), Microsoft.Data.Sqlite · Storage: SQLite do índice · Testing: xUnit (`HybridSearchTests`: RRF determinístico com vetores falsos, fallback, hash incremental) · Performance: < 300 ms com 20 mil trechos · Constraints: desligado por padrão; índice recriável.

## Constitution Check

I ✅ · II ✅ `.md` continuam a fonte; índice recriável · III N/A · IV ✅ desligado, estimativa de custo, fallback · V ✅ RRF e cosseno puros testados · VI ✅ · VII ✅ · VIII ✅ sem extensão nativa nem serviço novo. Re-check: sem violações.

## Project Structure

```text
cerebro/src/Hub/Index/NoteIndex.cs          # tabela chunk_vectors; Search híbrido; Candidates()
cerebro/src/Hub/Index/Embeddings.cs         # cliente /v1/embeddings, lote, retry
cerebro/src/Hub/Index/HybridRanker.cs       # cosseno + RRF (puro)
cerebro/src/Hub/Index/VectorIndexWorker.cs  # indexação inicial e incremental
cerebro/src/Hub/Mcp/VaultTools.cs           # search(mode)
cerebro/src/Hub/Api/WebEndpoints.cs         # opção, progresso
cerebro/tests/Hub.Tests/HybridSearchTests.cs
frontend/src/app/features/cerebro/          # opção, progresso, estimativa
```

## Complexity Tracking

Sem violações.
