# Quickstart: 040 painel de plug-ins

## Antes (o dono faz)

1. GitHub, `anotacoes` → Settings → Actions → General: ligar "Allow GitHub Actions to create and approve pull requests".
2. Criar os dois tokens do [contrato](contracts/workflow.md).
3. Pôr no `.env` da VPS `HUB_ADMINISTRADORES`, os dois tokens e as validades.

## Testes automáticos

```powershell
dotnet test backend/Notas.Api.sln
$env:DOTNET_SYSTEM_GLOBALIZATION_INVARIANT = "1"; dotnet test backend/Notas.Api.sln
dotnet test deployer/Notas.Deployer.sln
python -m unittest discover -s scripts/tests -p "test_plugins_lock.py"
cd frontend; npm test -- --watch=false
```

## Cenários

| # | Passo | Esperado |
|---|---|---|
| 1 | abrir `/plugins` como administrador | todos os plug-ins, em até 10 s |
| 2 | abrir com outra conta | sem card; API responde 403 |
| 3 | pôr no ar um plug-in de teste e fazer o merge | banco pronto, PR de uma linha, "no ar" |
| 4 | interromper o preparo em cada etapa e repetir | termina sem mudar senha |
| 5 | comparar o retrato de `pg_authid` e das permissões dos outros papéis, antes e depois | iguais (SC-003) |
| 6 | fechar o PR sem merge | volta a "pronto" |
| 7 | atualizar, voltar e desligar o plug-in de teste | PR de uma linha; dados continuam |
| 8 | dois cliques, ou duas abas | uma operação |
| 9 | tirar o token de disparo | lista continua; botões explicam |
| 10 | pedir as rotas com token de MCP e com o segredo de serviço do agente | 401 |
| 11 | procurar a senha gerada em logs, histórico, PR e respostas | zero ocorrências (SC-004) |

Os cenários 3 a 7 gravam na VPS: só com o "sim" do dono. Os de 4 a 6 rodam também na CI, com Postgres real.
