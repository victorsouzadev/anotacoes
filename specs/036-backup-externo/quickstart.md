# Quickstart: Cópia do backup fora da VPS

## Preparar (Victor, uma vez, no próprio PC)

1. Instalar o `rclone` no PC (`winget install Rclone.Rclone`).
2. Rodar `rclone authorize "drive" --drive-scope drive.file`, aprovar no navegador com a conta Google e copiar o token que aparece.
3. Gerar uma senha longa para a cópia e guardá-la no gerenciador de senhas.

## Configurar na VPS (com confirmação)

```bash
apt install -y restic rclone jq
install -d -m 700 /root/.config/rclone
rclone config create gdrive drive scope=drive.file token="<token colado>" --config /root/.config/rclone/rclone.conf
chmod 600 /root/.config/rclone/rclone.conf
install -m 600 /dev/null /root/.config/notas-backup.env   # preencher como em data-model.md
set -a; . /root/.config/notas-backup.env; set +a
restic init
crontab -e
# 0 4 * * * /opt/notas-vps/scripts/backup.sh >> /var/log/notas-backup.log 2>&1
# 0 5 * * 0 /opt/notas-vps/scripts/backup-conferir.sh >> /var/log/notas-backup.log 2>&1
/opt/notas-vps/scripts/backup.sh && /opt/notas-vps/scripts/backup-conferir.sh
cat /opt/notas-vps/data/db/backup-externo.json
```

## Validar

1. Hub como administrador: sem faixa; `/configuracoes` → Servidor mostra local, externo e conferência.
2. Trocar o `RESTIC_REPOSITORY` por um remoto inexistente (`rclone:nada:x`), rodar `backup.sh`: o log mostra o erro, `backup-externo.json` fica com `ok: false`, e depois de 36 h aparece a faixa. Desfazer.
3. Deploy pela Actions: `ls -la /opt/notas-vps/scripts` mostra `-rwxr-xr-x root root`.
4. Pôr um arquivo qualquer com data antiga em `backups/outra-coisa/`: a limpeza não o apaga.

## Ensaio de restauração completa (máquina que não é a VPS)

```bash
rclone config create gdrive drive scope=drive.file   # autoriza no navegador
export RESTIC_REPOSITORY=rclone:gdrive:notas-vps-backup RESTIC_PASSWORD=...
restic snapshots --tag notas-vps
restic restore latest --target /tmp/restauro
git clone https://github.com/victorsouzadev/anotacoes /tmp/hub && cd /tmp/hub
cp /tmp/restauro/opt/notas-vps/.env .
cp -r /tmp/restauro/opt/notas-vps/data .
cp "$(ls /tmp/restauro/opt/notas-vps/backups/notas-*.db | tail -1)" data/db/notas.db
# bancos dos sites e pg_restore: ver DEPLOY.md
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

Entrar com a conta de sempre e conferir notas, tarefas e finanças do dia anterior. Cronometrar (SC-002: < 1 h) e registrar a data do ensaio no DEPLOY.md.
