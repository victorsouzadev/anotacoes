# Contrato: leituras do núcleo para o agente

Regras que valem para todas as rotas:
- Todas exigem o segredo de serviço do plug-in `agente` (`PluginDoServico == "agente"`). Com o segredo de outro plug-in, a resposta é 401.
- O `{id}` precisa estar no `plugins.lock`. Se não estiver, a resposta é 404.

| Rota no núcleo | Repassa a | Resposta |
|---|---|---|
| `GET /api/core/agente/plugins` | deployer, `GET /plugins` | id, versão, versão anterior, `noAr`, `ultimaFalha` e `congelado` |
| `GET /api/core/agente/plugins/{id}/health` | deployer, `GET /plugins/{id}/health` (rota nova) | o status HTTP, o tempo de resposta e o corpo, cortado em 2 KB |
| `GET /api/core/agente/plugins/{id}/logs?linhas=N` | deployer, `GET /plugins/{id}/logs` (rota nova, N até 200) | as linhas, já sem segredos |
| `GET /api/core/agente/plugins/{id}/permissoes` | uma consulta fixa no Postgres | o schema, o dono e as permissões do papel `{id}` em `nucleo` |
| `GET /api/core/agente/lock` | o arquivo `plugins.lock` | as linhas |

Não existe nenhuma rota POST. As rotas novas do deployer são GET e só aceitam ids que estão no lock.
