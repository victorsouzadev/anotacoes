# Data Model: 040 painel de plug-ins

## OperacaoDoPainel (`core_plugins_operacoes`, dono: núcleo)

| Campo | Tipo | Regra |
|---|---|---|
| Id | texto | UUID; vira o nome da branch `painel/<Id>` |
| PluginId | texto | padrão do `RegrasDoManifesto` e fora dos reservados |
| Acao | texto | `por-no-ar`, `atualizar`, `voltar`, `desligar`, `religar` |
| Imagem | texto | sempre `ghcr.io/victorsouzadev/hub-<PluginId>` |
| Versao | texto, nulo | 7 hexadecimais; nula só em `desligar` |
| VersaoAntes | texto, nulo | versão no registro na hora da revisão |
| AutorId | chave do usuário | usuário do núcleo; nunca vai ao GitHub |
| Estado | texto | ver transições |
| Etapas | texto (JSON) | nome, situação, horário e motivo limpo |
| PrNumero | inteiro, nulo | preenchido quando o PR é achado pela branch |
| CriadaEm, AtualizadaEm, ConcluidaEm | data UTC | `ConcluidaEm` nula = aberta |

Índice único parcial em `PluginId` onde `ConcluidaEm` é nula (uma operação aberta por id). Nenhum campo guarda senha, conexão ou token.

### Transições

```text
preparando → pedindo-pr → pr-aberto → aguardando-deploy → concluida
     │            │           │               └→ falhou (falha registrada pelo deployer)
     └→ falhou    └→ falhou   └→ cancelada (PR fechado sem merge)
```

- `preparando` só existe em `por-no-ar` e `religar`; nas outras a operação começa em `pedindo-pr`.
- Pedido repetido de uma operação que `falhou` cria outra, que refaz só o que falta.
- `pedindo-pr` sem PR depois de 5 minutos vira `falhou`. Uma nova tentativa procura antes um PR aberto do mesmo id.
- `preparando` parada por 5 minutos (o núcleo reiniciou no meio) vira `falhou`, para poder repetir.
- `aguardando-deploy` sem resposta por 30 minutos vira `falhou`, com o motivo "o deploy não chegou ao deployer".

## PluginNoPainel (calculado, não gravado)

`id`, `nome`, `situacao`, `versao`, `versaoAnterior`, `health`, `ultimaFalha`, `congelado`, `memoriaMb`, `limiteMb`, `etapas[]`, `operacaoAberta`.

Situações: `no-ar`, `com-falha`, `desligado`, `pronto`, `incompleto`.

## Etapa

`nome` (`ci`, `manifesto`, `imagem`, `papel`, `schema`, `conexao`, `permissoes`, `registro`, `no-ar`), `estado` (`feita`, `pendente`, `falhou`, `nao-conferida`), `detalhe` sem segredo.

## ConfirmacaoDoPainel (em memória, 5 minutos)

`codigo`, `autorId`, `pluginId`, `acao`, `versao`, `versaoAntes`. Uso único; some se o registro mudar.
