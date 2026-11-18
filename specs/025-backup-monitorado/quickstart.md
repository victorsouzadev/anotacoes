# Quickstart: Backup monitorado

1. `dotnet test` — `BackupStatusTests`.
2. Local: `BASE_DIR=$(pwd) sh scripts/backup.sh` (com `data/db/notas.db` presente) → `data/db/backup-status.json` criado.
3. Entrar como e-mail de `PUBLICADORES`: sem faixa. Editar `concluidoEm` para 2 dias atrás: faixa aparece.
4. Entrar com conta comum: sem faixa; `GET /api/sistema/backup` → 403.
5. Na VPS: `crontab -l` mostra a linha do backup (DEPLOY.md) e `cat /opt/notas-vps/data/db/backup-status.json` mostra a data de hoje.
