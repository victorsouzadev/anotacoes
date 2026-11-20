# Implementation Plan: Extrair e congelar as ferramentas sem uso

**Branch**: sem branch própria | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

## Summary

Dois plug-ins: `hub-criativo` (`ImagemEndpoints`, `MoldesEndpoints`, `ViihMimosEndpoints`, `Services/Imagens`, `Services/Moldes`, telas `imagem`, `moldes`, `cake`, `precificacao`, e `desktop/`) e `hub-treino` (`TreinoEndpoints`, `TreinoMcpTools`, tela `treino`). Cada um usa o SDK e o banco compartilhado com migração de base; o núcleo remove entidades e código com migração vazia (031). Após o ar conferido, os plug-ins são marcados `congelado`.

## Technical Context

**Language/Version**: C# .NET 9, Angular 21, WPF + WebView2 (app Windows)

**Primary Dependencies**: `Hub.Plugin.Sdk`, `@grafite/ui`

**Storage**: `notas.db` (`imagem_*`, `treino_*`)

**Testing**: os testes atuais dessas ferramentas (frontend `moldes.spec.ts`, `color.spec.ts`..., `EditorImagens.Ia.Tests`, testes de Treino e Imagens do `Notas.Api.Tests`) migram para os repositórios novos; novo: núcleo sem `DropTable` de `imagem_*`/`treino_*`

**Constraints**: rotas legadas; app Windows antigo segue funcionando

## Constitution Check

| Princípio | Situação |
|---|---|
| I (v2.0.0) | ✅ |
| II | ✅ Sem cópia de dados; nada apagado |
| III | ✅ Treino offline no Android não muda |
| IV | ✅ IA do Editor de Imagens via núcleo |
| V | ✅ Testes vão junto |
| VI | ✅ |
| VII | ✅ |
| VIII | ✅ Menos código no núcleo |

## Project Structure

```text
# hub-criativo
src/Criativo.Api/       # Imagem, Moldes, ViihMimos (precificação), Services/Imagens, Services/Moldes
web/                    # imagem, moldes, cake, precificacao + cópia de shared/pdf.ts e shared/heic.ts
desktop/                # vindo de desktop/, hospeda Criativo.Api
plugin.json             # id criativo, rotas legadas /api/imagens, /api/moldes, /api/precificacao, /api/mcp/criativo, /imagens, /moldes, /bolo-3d, /precificacao

# hub-treino
src/Treino.Api/  web/  plugin.json   # rotas legadas /api/treino, /api/mcp/treino, /treino

# núcleo
backend/Notas.Api/...   # remove endpoints, services, MCP tools e entidades (migração vazia)
frontend/src/app/features/{imagem,moldes,cake,precificacao,treino}   # removidos
desktop/  .github/workflows/desktop.yml                              # removidos
```
