# API do painel (núcleo)

Grupo `/api/painel/plugins`: sessão do hub e administrador. Sem sessão, 401; sem permissão, 403.

| Rota | O que faz |
|---|---|
| `GET /permissao` | `{ administrador }`, para o card no hub. Única rota aberta a toda conta com login |
| `GET /` | lista de PluginNoPainel, recursos e avisos dos tokens |
| `GET /{id}/versoes` | até 10 commits da `main` com CI verde e imagem publicada |
| `POST /{id}/revisar` | corpo `{ acao, versao? }`; não grava nada |
| `POST /{id}/executar` | corpo `{ confirmacao }`; devolve 202 com a operação |
| `GET /operacoes?id=&limite=` | histórico, mais novas primeiro (até 50) |
| `GET /operacoes/{op}` | operação com a situação atual |

## Revisar

Devolve `{ confirmacao, passos[], linhaAntes, linhaDepois, recursos, avisos[], exigeSegundaConfirmacao }`.

- `recursos`: `memoriaLivreMb`, `limiteDoPluginMb`, `conexoesLivres`, `poolsSomados`.
- `congelado` pede segunda confirmação: o `executar` leva `{ confirmacao, confirmaCongelado: true }`.
- 422 com `{ regras[] }` quando o manifesto, o id ou as rotas violam o contrato.
- 409 com `{ operacao | pr }` quando já há operação ou PR aberto do id.
- 503 com `{ falta }` quando o token falta ou venceu.

## Executar

- Confirmação vencida, usada ou de outro autor: 410.
- Registro mudou desde a revisão: 409.
- Nunca recebe imagem, caminho, SQL ou texto livre: só o código.
