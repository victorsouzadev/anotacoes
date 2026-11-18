# Implementation Plan: Backup monitorado

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

O script de backup grava um JSON de estado; o `Notas.Api` lê e expõe para os administradores; o hub mostra alerta; o MCP criativo inclui a linha no resumo.

## Technical Context

Shell POSIX (`scripts/backup.sh`), C# .NET 9, Angular 21 · Storage: arquivo em `data/db` · Testing: xUnit (`BackupStatusTests`: ausente, inválido, recente, atrasado, acesso negado) · Project Type: ops + web · Constraints: escrita atômica; sem processo novo.

## Constitution Check

I ✅ · II ✅ protege os dados (é o objetivo) · III N/A · IV N/A · V ✅ leitura do estado em serviço puro testado · VI ✅ faixa em `atencao` · VII ✅ · VIII ✅ um arquivo, um endpoint. Re-check: sem violações.

## Project Structure

```text
scripts/backup.sh                                   # grava backup-status.json no fim
backend/Notas.Api/Services/Sistema/BackupStatus.cs  # lê e calcula idade
backend/Notas.Api/Endpoints/SistemaEndpoints.cs     # GET /api/sistema/backup
backend/Notas.Api/Mcp/CriativoMcpTools.cs           # linha no criativo_resumo
backend/Notas.Api.Tests/BackupStatusTests.cs
frontend/src/app/features/hub/hub.page.ts           # faixa de alerta
frontend/src/app/features/configuracoes/            # seção Servidor
DEPLOY.md
```

## Complexity Tracking

Sem violações.
