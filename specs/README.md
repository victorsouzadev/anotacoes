# Specs

Especificações no formato do [Spec Kit](https://github.com/github/spec-kit). As de 001 a 014
são **retroativas**: descrevem o que já existe no código em novembro de 2026, para servir
de base às mudanças futuras. Não têm `plan.md` nem `tasks.md` porque já foram implementadas.

Feature nova começa com `/speckit-specify` e ganha o próximo número (029 em diante). Mudança
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

## Specs novas (015 a 028)

Cobrem as lacunas do levantamento e todo o Roadmap do README. Cada uma passou por
specify → clarify (respondido com o padrão recomendado, registrado em "Clarifications") →
plan → tasks → analyze. Status: **Draft**, nada implementado.

| # | Feature | Origem | Backend? | Artefatos |
|---|---|---|---|---|
| 015 | [Recorrência de tarefas na web](015-tarefas-recorrencia-web/spec.md) | lacuna da 004 | não | spec, plan, research, quickstart, tasks |
| 016 | [Tela web da Dieta](016-dieta-web/spec.md) | etapa 8 do plano da Dieta | não | + contracts |
| 017 | [Tela web do Treino](017-treino-web/spec.md) | lacuna da 006 | não | spec, plan, research, quickstart, tasks |
| 018 | [Lixeira de notas](018-notas-lixeira/spec.md) | Roadmap | sim (coluna + worker) | + data-model, contracts |
| 019 | [Exportar nota em PDF](019-notas-exportar-pdf/spec.md) | Roadmap | não | spec, plan, research, quickstart, tasks |
| 020 | [Duplicar e navegar entre páginas](020-notas-paginas/spec.md) | Roadmap | não | spec, plan, research, quickstart, tasks |
| 021 | [Tags nas notas](021-notas-tags/spec.md) | Roadmap | sim (coluna) | + data-model, contracts |
| 022 | [Arrastar imagens para o canvas](022-notas-arrastar-imagens/spec.md) | Roadmap | não | spec, plan, research, quickstart, tasks |
| 023 | [Link somente leitura de nota](023-notas-link-publico/spec.md) | Roadmap | sim (tabela + rotas) | + data-model, contracts |
| 024 | [Modo leitura / apresentação](024-notas-modo-leitura/spec.md) | Roadmap | não | spec, plan, research, quickstart, tasks |
| 025 | [Backup monitorado](025-backup-monitorado/spec.md) | Roadmap (confiabilidade) | sim (endpoint) | + data-model, contracts |
| 026 | [Texto de PDFs e imagens no Cérebro](026-cerebro-texto-anexos/spec.md) | fora da PoC da 011 | sim (cerebro) | spec, plan, research, quickstart, tasks |
| 027 | [Busca semântica no Cérebro](027-cerebro-busca-semantica/spec.md) | fase 4 da 011 | sim (cerebro) | spec, plan, research, quickstart, tasks |
| 028 | [OAuth 2.1 no MCP do Cérebro](028-cerebro-mcp-oauth/spec.md) | fora da PoC da 011 | sim (cerebro + Caddy) | + data-model, contracts |

Todas têm `checklists/requirements.md`.

### Ordem recomendada de implementação

1. **025** backup monitorado — protege os dados antes de mexer em schema.
2. **015** recorrência na web — corrige uma divergência real, pequena.
3. **018** lixeira de notas — pré-requisito da 023.
4. **024** modo leitura — pré-requisito da 023.
5. **023** link somente leitura.
6. **019**, **020**, **022** — melhorias do editor, independentes.
7. **021** tags.
8. **016** e **017** — telas web de Dieta e Treino.
9. **026**, **027**, **028** — Segundo Cérebro (custo de IA desligado por padrão em 026 e 027).

### Dependências entre specs

- 023 depende de 024 (leitor) e de 018 (`TrashedAt`).
- 021 e 023 consideram notas na lixeira (018) fora das contagens e dos links.
- 019 e 022 movem helpers do Editor de Imagens para `shared/` (`pdf.ts`, `heic.ts`), reexportando no lugar antigo.

### Resultado do analyze

- Toda história de usuário tem tarefa; nenhuma spec ficou com `[NEEDS CLARIFICATION]`.
- Corrigido: 026 prometia HEIC no requisito e a pesquisa decidiu não suportar (requisito ajustado); 023 não declarava a dependência da 018 (declarado).
- Corrigido: a página de consentimento da 028 não pode ficar sob `/cerebro`, porque o Caddy manda todo `/cerebro/*` para o serviço; ficou em `/autorizar`.
- Única exceção à constituição: 028 implementa um servidor OAuth próprio (Princípio VIII), justificada na tabela "Complexity Tracking" do plano.
- Fora de todas as specs, de propósito: cópia de backup fora da VPS, OAuth nos MCPs dos apps e no `/ops`, tombstone de categorias de tarefas (limitação aceita na 004).

## Lacunas encontradas no levantamento

- ~~**Tarefas**: a próxima ocorrência de tarefa recorrente só era gerada no Android~~ — resolvido pela 015.
- ~~**Dieta**: não havia tela web~~ — resolvido pela 016.
- ~~**Treino**: não havia tela web~~ — resolvido pela 017.
- **Segundo Cérebro**: busca semântica, OAuth 2.1 no MCP e OCR de anexos ficaram fora da PoC.
