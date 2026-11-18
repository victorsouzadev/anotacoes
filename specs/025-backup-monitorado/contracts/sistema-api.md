# Contrato: estado do backup

`GET /api/sistema/backup` (JWT; só e-mails em `PUBLICADORES`, senão 403)

```json
{ "registrado": true, "concluidoEm": "2026-11-18T04:00:12Z", "idadeHoras": 6.2, "atrasado": false,
  "arquivos": [{ "nome": "...", "bytes": 0 }], "totalBytes": 0 }
```

`GET /api/sites/permissao` (existente) já diz se o usuário é publicador; o hub usa isso para decidir se pede o estado.
