# Implementation Plan: Extrair as ferramentas em uso

**Branch**: sem branch própria | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

## Summary

Aplica a receita de extração (031, `DEPLOY.md`) cinco vezes, em sequência: mover endpoints, services, MCP tools, telas, testes e (quando houver) o app Android para o repositório do plug-in; migração de base no plug-in; migração vazia no núcleo; rotas legadas no manifesto; ensaio com cópia de produção; deploy; conferência; remoção do código no núcleo.

## Technical Context

**Language/Version**: C# .NET 9, Angular 21, Kotlin/Compose (apps Android)

**Primary Dependencies**: `Hub.Plugin.Sdk`, `@grafite/ui`

**Storage**: `notas.db` (`dieta_*`, `tasks_*`, `financas_*` + `configuracoes_auvp`, `notes`/`folders`/`note_shares`), `data/anotacao`

**Testing**: os testes de cada ferramenta (cerca de 480 do backend e 580 do frontend, distribuídos) vão junto; novos por extração: contagens e totais antes/depois, rotas legadas respondendo igual, APK atual sincronizando (Notas: e2e de sincronização offline com o Playwright, levados para a CI do `hub-notas`)

**Constraints**: uma ferramenta por vez; nenhuma reinstalação ou reconexão

## Constitution Check

| Princípio | Situação |
|---|---|
| I (v2.0.0) | ✅ |
| II | ✅ Contagens e totais conferidos; segredos recifrados; nada apagado |
| III | ✅ Apps e Notas offline-first preservados; rotas legadas para filas antigas |
| IV | ✅ IA via núcleo com fallback |
| V | ✅ Testes vão junto; e2e de Notas entra na CI |
| VI | ✅ |
| VII | ✅ |
| VIII | ✅ |

## Project Structure

```text
# hub-dieta      src/Dieta.Api (DietaEndpoints, DietaIaEndpoints, Services/Dieta, DietaMcpTools)  web/  android/ (de mobile/dieta)
# hub-tarefas    src/Tarefas.Api (TasksEndpoints, TarefasMcpTools)                                 web/  android/ (de mobile/app)
# hub-anotacao   src/Anotacao.Api (AnotacaoEndpoints, Services/Anotacao)                           web/
# hub-financas   src/Financas.Api (Financas*, Orcamento, Meta, Planejamento, ChatFinanceiro, Auvp, FinancasMcpTools)  web/
# hub-notas      src/Notas.Plugin (NotesEndpoints, NotesShareEndpoints, FoldersEndpoints, Services/Lixeira)  web/ (notes, editor, shared/pdf.ts, shared/heic.ts)

# núcleo, a cada extração
backend/Notas.Api/{Endpoints,Services,Mcp,Data}   # remove a ferramenta (migração vazia)
frontend/src/app/features/<ferramenta>            # removido
mobile/<app>  .github/workflows/android-dieta.yml # removidos quando o app sai
```
