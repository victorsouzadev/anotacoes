# Data Model: Cópia do backup fora da VPS

Nada muda no banco. Só arquivos no host.

## `data/db/backup-externo.json` (novo)

Gravado por `backup-externo.sh` e `backup-conferir.sh`, sempre lendo o anterior e trocando só a sua parte, por temporário + `mv`, sob `flock`.

```json
{
  "copia": {
    "concluidoEm": "2026-11-21T07:01:12Z",
    "ok": true,
    "instantaneo": "4f1a9c2e",
    "bytesAdicionados": 3145728,
    "bytesTotal": 188743680,
    "falhaEm": null,
    "erro": null
  },
  "conferencia": {
    "concluidoEm": "2026-11-23T08:03:40Z",
    "ok": true,
    "instantaneo": "4f1a9c2e",
    "erro": null
  }
}
```

- `concluidoEm` é sempre o último **sucesso** e só avança quando a execução termina bem. Numa falha, o script mantém `concluidoEm`, grava `ok: false`, `falhaEm` e `erro` (mensagem curta, sem segredos). No sucesso seguinte, `ok` volta a `true` e `falhaEm`/`erro` ficam `null`.
- Arquivo ausente ou inválido: "nunca registrado".
- Regras de alerta: cópia com `concluidoEm` > 36 h; conferência > 8 dias (192 h) ou `ok: false`.

## `/root/.config/notas-backup.env` (novo, fora do repositório, `600`)

```sh
RESTIC_REPOSITORY=s3:https://s3.us-west-004.backblazeb2.com/<bucket>
RESTIC_PASSWORD=<senha guardada também no gerenciador de senhas>
AWS_ACCESS_KEY_ID=<keyID da chave restrita ao bucket>
AWS_SECRET_ACCESS_KEY=<applicationKey>
```

## Instantâneo (restic)

- Caminhos: `/opt/notas-vps/backups`, `/opt/notas-vps/data`, `/opt/notas-vps/.env`.
- Exclusões: `data/db/notas.db*`, `data/sites/*/data/app.db*`, `data/postgres`.
- Tag: `notas-vps`. Retenção: `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`.

## `backup-status.json` (025)

Sem mudança de formato.
