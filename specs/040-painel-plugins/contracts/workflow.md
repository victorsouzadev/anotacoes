# Workflow `plugins-lock.yml`

Gatilho: `workflow_dispatch`, só na `main` (o job confere `github.ref`). Permissões: `contents: write`, `pull-requests: write`, `actions: write` (para chamar a CI).

| Entrada | Regra |
|---|---|
| `operacao` | UUID |
| `id` | `^[a-z][a-z0-9-]{1,30}$` |
| `acao` | `ligar`, `versao` ou `desligar` |
| `versao` | 7 hexadecimais; vazia em `desligar` |
| `versao_antes` | vazia, ou 7 hexadecimais; recusa se o registro já for outro |

1. As entradas chegam por `env`, nunca interpoladas no shell, e são conferidas de novo.
2. `scripts/plugins-lock.py` muda só a linha do id: `ligar` acrescenta ou descomenta, `versao` troca o commit, `desligar` comenta. A imagem é montada do id.
3. Recusa se o `git diff` tiver outro arquivo ou mais de uma linha alterada.
4. Branch `painel/<operacao>`; com branch ou PR existente, não abre outro.
5. Abre o PR (título em pt-BR, sem e-mail nem dado da VPS) e chama a CI na branch.

O workflow não faz merge, não aprova e não usa os segredos da VPS.

## Acesso do hub

| Token | Alcance | Usos |
|---|---|---|
| `PAINEL_GITHUB_LEITURA` | todos os repositórios, Contents e Actions: leitura | `plugin.json`, commits, CI |
| `PAINEL_GITHUB_DISPARO` | só `anotacoes`, Actions: leitura e escrita | um único `dispatches` do `plugins-lock.yml` |

PRs do núcleo são lidos sem token de escrita (repositório público). A classe do GitHub só monta essas URLs; qualquer outra é recusada.
