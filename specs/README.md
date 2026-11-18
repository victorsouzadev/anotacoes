# Specs

Especificações no formato do [Spec Kit](https://github.com/github/spec-kit). As de 001 a 014
são **retroativas**: descrevem o que já existe no código em novembro de 2026, para servir
de base às mudanças futuras. Não têm `plan.md` nem `tasks.md` porque já foram implementadas.

Feature nova começa com `/speckit-specify` e ganha o próximo número (015 em diante). Mudança
grande numa ferramenta que já existe pode ser uma spec nova que cita a retroativa dela.

| # | Ferramenta | Spec |
|---|---|---|
| 001 | Hub, contas e configurações de IA | [spec](001-hub-contas/spec.md) |
| 002 | Notas | [spec](002-notas/spec.md) |
| 003 | Finanças | [spec](003-financas/spec.md) |
| 004 | Tarefas (web, Android e MCP) | [spec](004-tarefas/spec.md) |
| 005 | Dieta | [spec](005-dieta/spec.md) |
| 006 | Treino | [spec](006-treino/spec.md) |
| 007 | Editor de Imagens (web e Windows) | [spec](007-editor-imagens/spec.md) |
| 008 | Moldes | [spec](008-moldes/spec.md) |
| 009 | Simulador de Bolo 3D | [spec](009-bolo-3d/spec.md) |
| 010 | Publicar | [spec](010-publicar/spec.md) |
| 011 | Segundo Cérebro | [spec](011-segundo-cerebro/spec.md) |
| 012 | Anotação | [spec](012-anotacao/spec.md) |
| 013 | Precificação | [spec](013-precificacao/spec.md) |
| 014 | MCPs dos apps e operação da VPS | [spec](014-mcps-e-operacao/spec.md) |

## Lacunas encontradas no levantamento

- **Tarefas**: a próxima ocorrência de tarefa recorrente só é gerada no Android; a web guarda
  a regra, mas não gera (spec 004, Edge Cases).
- **Dieta**: não há tela web (etapa 8 do `docs/dieta/PLANO.md`).
- **Treino**: não há tela web; os dados só chegam pelo app Treino Corrida.
- **Segundo Cérebro**: busca semântica, OAuth 2.1 no MCP e OCR de anexos ficaram fora da PoC.
