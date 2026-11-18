# Data Model: Backup monitorado

`data/db/backup-status.json`:

```json
{
  "concluidoEm": "2026-11-18T04:00:12Z",
  "arquivos": [{ "nome": "notas-20261118-0400.db", "bytes": 1234567 }],
  "totalBytes": 1234567
}
```

Derivado na API: `idadeHoras`, `atrasado` (`idadeHoras > 36` ou arquivo ausente/inválido).
