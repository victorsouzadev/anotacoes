# Data Model: Núcleo do hub e contrato de plug-ins

## `plugins.lock` (arquivo no repositório do núcleo)

```yaml
# id: imagem@versão  (versão = commit do repositório do plug-in)
cerebro:  ghcr.io/victorsouzadev/hub-cerebro@3f2a9c1
dieta:    ghcr.io/victorsouzadev/hub-dieta@a81d004
treino:   ghcr.io/victorsouzadev/hub-treino@77c01be   # congelado
```

Linha comentada = plug-in desligado (container parado, dados mantidos).

## Tabela `core_plugins_estado` (no `notas.db`, dono: núcleo)

| Campo | Tipo | Observação |
|---|---|---|
| `Id` | texto, PK | id do manifesto |
| `Versao` | texto | commit em execução |
| `VersaoAnterior` | texto, nulo | para a volta automática |
| `Manifesto` | texto (JSON) | último manifesto válido |
| `NoAr` | bool | último health |
| `UltimoHealth` | data | |
| `UltimaFalha` | texto, nulo | motivo do último deploy recusado ou revertido |

Ferramentas que ainda são módulos do núcleo não entram na tabela; vêm de `ModulosDoNucleo` (código).
