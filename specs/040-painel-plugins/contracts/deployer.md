# Rotas novas do deployer

Mesmo token de hoje, rede interna. `id` conferido pelas regras do manifesto e pelos reservados (R5).

| Rota | O que faz |
|---|---|
| `GET /plugins/{id}/preparo` | só lê: `{ papel, schema, donoDoSchema, conexao, permissoes, conecta }`; `conecta` é nulo se faltar algo |
| `POST /plugins/{id}/preparo` | executa o R3; uma chamada por vez; devolve `{ etapas[] }` |
| `GET /imagens/{id}/{versao}` | `{ publicada }`; a imagem é sempre `ghcr.io/victorsouzadev/hub-<id>` |
| `GET /recursos` | memória do host, memória por plug-in e conexões do Postgres |

- `POST /preparo` sem corpo: não aceita senha, nome de papel nem conexão de fora.
- Respostas e logs nunca trazem a conexão, a senha ou o SQL.
- Etapa que falha devolve 200 com `estado: "falhou"` e o motivo limpo; 409 quando há papel sem arquivo, ou plug-in ativo sem arquivo.
- O teste de conexão do preparo é feito pelo próprio deployer, por TCP (Npgsql), com a conexão do arquivo e só se o usuário dela for o id.
- Imagem que o registro nega ("denied") devolve 502: o painel mostra "não deu para conferir".
- Dono da imagem (`victorsouzadev`) vem da configuração do deployer, não do pedido.
