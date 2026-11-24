# Data Model: 039 hub-agente

As tabelas ficam no schema `agente`, com o prefixo `agente_` e chave estrangeira para `nucleo.users`.

## agente_execucoes
| Campo | Tipo | Regra |
|---|---|---|
| Id | uuid | |
| UsuarioId | texto, FK para users | o administrador que disparou |
| Tipo | `diagnostico` ou `esqueleto` | |
| Alvo | texto | o id do plug-in, no diagnóstico, ou o id pedido, no esqueleto |
| Pedido | texto | a descrição enviada |
| Estado | `fila` → `rodando` ⇄ `esperando` → `concluida`, `falhou` ou `cancelada` | o estado só avança, e um estado final não muda mais |
| Origem | `tela` ou `mcp` | |
| Relatorio | texto (markdown) | sem segredos |
| RepositorioCriado, PrUrl | texto, opcional | só no esqueleto |
| CustoUsd | decimal | o custo somado pelo SDK |
| CriadaEm, IniciadaEm, TerminadaEm | timestamptz | |

## agente_eventos
| Campo | Tipo | Regra |
|---|---|---|
| Id | bigserial | |
| ExecucaoId | FK | |
| Tipo | `passo`, `pergunta`, `resposta`, `recusa` ou `erro` | `recusa` registra uma ação fora da lista (FR-015) |
| Texto | texto | curto e sem segredos |
| Em | timestamptz | |

O histórico fica guardado e o plug-in nunca apaga nada.
