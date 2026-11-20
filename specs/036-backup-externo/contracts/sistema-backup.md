# Contrato: `GET /api/sistema/backup`

Só para os e-mails de `PUBLICADORES` (403 para os demais), como na 025. Os campos da 025 ficam iguais; entram `externo` e `conferencia`.

```json
{
  "registrado": true,
  "concluidoEm": "2026-11-21T07:00:58Z",
  "idadeHoras": 6.2,
  "atrasado": false,
  "arquivos": [{ "nome": "notas-20261121-0400.db", "bytes": 4587520 }],
  "totalBytes": 4611039,
  "externo": {
    "registrado": true,
    "concluidoEm": "2026-11-21T07:01:12Z",
    "idadeHoras": 6.2,
    "atrasado": false,
    "ultimaFalha": null,
    "bytesTotal": 188743680
  },
  "conferencia": {
    "registrado": true,
    "concluidoEm": "2026-11-16T08:03:40Z",
    "idadeHoras": 125.0,
    "atrasado": false,
    "ok": true
  }
}
```

- `externo.atrasado`: nunca registrado ou último sucesso há mais de 36 h.
- `externo.ultimaFalha`: `{ "em": "...", "erro": "..." }` quando a execução mais recente falhou; nunca contém segredo.
- `conferencia.atrasado`: nunca registrada, `ok: false` ou mais de 192 h.
- Clientes antigos que leem só os campos da 025 continuam funcionando.

## `criativo_resumo` (linha "Servidor")

- Tudo em dia: `Backup: ok, local há 6 h, cópia externa há 6 h, restauração conferida há 5 dias.`
- Algum atraso: `Backup: ⚠️ cópia externa atrasada, a última terminou há 1 dia e 16 h.` (uma linha por problema).
