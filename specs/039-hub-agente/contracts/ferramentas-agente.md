# Contrato: ferramentas que o agente pode chamar

As ferramentas internas do Claude Code ficam proibidas; as daqui chegam como `mcp__agente__<nome>`. Cada chamada vira um evento, e uma chamada fora desta lista vira um evento `recusa`.

| Ferramenta | Tipo | Em que execução |
|---|---|---|
| `ler_estado`, `ler_health`, `ler_logs`, `ler_permissoes` e `ler_lock` | leitura | as duas |
| `validar_manifesto` | leitura | as duas |
| `perguntar(texto)` | pausa a execução | as duas |
| `relatar(markdown)` | encerra a execução | as duas |
| `propor_plano(plano)` | pausa até o plano ser aprovado | esqueleto |
| `escrever_arquivo(caminho, conteudo)` e `ler_arquivo_modelo(caminho)` | usam a pasta temporária da execução | esqueleto, só depois do plano aprovado |
| `criar_repositorio_e_pr()` | GitHub, só no `hub-<id aprovado>` | esqueleto, uma vez só |
| `estado_da_ci()` | lê o repositório criado | esqueleto |

O que volta dos logs, dos arquivos e da CI chega ao agente marcado como dado externo (FR-014).
