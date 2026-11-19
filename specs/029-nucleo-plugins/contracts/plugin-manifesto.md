# Contrato: manifesto do plug-in e registro

## `plugin.json` (contrato 1)

```json
{
  "id": "dieta",
  "nome": "Dieta",
  "icone": "apple",
  "descricao": "Refeições, água e peso",
  "contrato": 1,
  "rota": "/dieta",
  "porta": 8080,
  "health": "/dieta/api/health",
  "mcp": "/dieta/mcp",
  "rotasLegadas": ["/api/dieta", "/api/mcp/dieta"],
  "tabelas": { "prefixo": "dieta_", "legadas": [] },
  "usaIa": true,
  "dados": [],
  "android": "/dieta/downloads/dieta.apk"
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `id` | sim | `^[a-z][a-z0-9-]{1,30}$`, único |
| `nome`, `icone` | sim | ícone do conjunto de `@grafite/ui` |
| `contrato` | sim | inteiro; o núcleo recusa versão maior que a que conhece |
| `rota` | sim | `/<id>`; não pode ser reservada |
| `porta` | sim | porta interna do container |
| `health` | sim | `GET` → `200 { "status": "ok", "versao": "<commit>" }` |
| `mcp` | não | rota do MCP do plug-in |
| `rotasLegadas` | não | prefixos antigos, encaminhados sem reescrever o caminho |
| `tabelas` | sim | `prefixo` único no banco compartilhado e `legadas` (tabelas antigas sem prefixo, ex.: `notes`) — regras na 031 |
| `usaIa` | não | se `true`, o plug-in recebe acesso a `/api/core/ia` (030) |
| `dados` | não | pastas extras para o backup (arquivos fora do banco) |
| `android` | não | link do APK mostrado no card |

Rotas reservadas do núcleo: `/`, `/api/auth`, `/api/core`, `/api/plugins`, `/api/sistema`, `/autorizar`, `/.well-known`, `/ops`, `/sites`.

## `GET /api/plugins` (JWT do hub)

```json
[
  { "id": "dieta", "nome": "Dieta", "icone": "apple", "rota": "/dieta",
    "origem": "plugin", "estado": "no-ar", "versao": "a81d004", "android": "/dieta/downloads/dieta.apk" },
  { "id": "financas", "nome": "Finanças", "icone": "wallet", "rota": "/financas",
    "origem": "nucleo", "estado": "no-ar", "versao": "0463ebd" }
]
```

`estado`: `no-ar` | `indisponivel` | `atualizando`.
