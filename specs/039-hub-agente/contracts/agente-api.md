# Contrato: API e MCP do plug-in agente

Todas as rotas ficam sob `/agente/api` e usam o login do núcleo. Só o administrador entra; os outros recebem 403.

| Rota | O que faz |
|---|---|
| `POST /execucoes` `{tipo, alvo, pedido}` | Põe a execução na fila. Responde 409 se faltar a IA ou o token, dizendo qual dos dois falta. |
| `GET /execucoes` e `GET /execucoes/{id}` | Mostram o histórico e o acompanhamento: o estado, a posição na fila e os eventos. |
| `POST /execucoes/{id}/resposta` `{texto}` | Responde à pergunta pendente, inclusive com "aprovo o plano". |
| `POST /execucoes/{id}/cancelar` | Cancela a execução. |
| `POST /manifestos/validar` `{json}` | Devolve a lista das regras violadas. |
| `GET /plugins` | Devolve a lista de plug-ins que vem do núcleo. |
| `GET /configuracao` | Diz se a IA e o token estão prontos, sem mostrar nenhum valor. A IA pode estar `ok`, `falta` ou `provedor-nao-aceito`. O GitHub pode estar `ok`, `falta` ou `vence-em-N-dias`. |

O MCP fica em `/agente/mcp` e traz os mesmos dados das rotas acima, nestas ferramentas:
- `plugins_listar`
- `plugin_estado`
- `manifesto_validar`
- `agente_disparar`
- `agente_acompanhar`
- `agente_responder`
- `agente_cancelar`
