# Quickstart: Cópia do backup fora da VPS

## Preparar (Victor, uma vez)

1. Criar conta no Backblaze B2 (ou outro S3), um bucket privado `notas-vps-backup` e, no lifecycle, "Keep prior versions for 30 days".
2. Criar uma chave de aplicação restrita a esse bucket.
3. Gerar uma senha longa para a cópia e guardá-la no gerenciador de senhas junto com a chave do bucket.

## Configurar na VPS (com confirmação)

```bash
apt install -y restic
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
2. Trocar `AWS_SECRET_ACCESS_KEY` por um valor errado, rodar `backup.sh`: o log mostra o erro, `backup-externo.json` fica com `ok: false`, e depois de 36 h aparece a faixa. Desfazer.
3. Deploy pela Actions: `ls -la /opt/notas-vps/scripts` mostra `-rwxr-xr-x root root`.
4. Pôr um arquivo qualquer com data antiga em `backups/outra-coisa/`: a limpeza não o apaga.

## Ensaio de restauração completa (máquina que não é a VPS)

```bash
export RESTIC_REPOSITORY=... RESTIC_PASSWORD=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
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
