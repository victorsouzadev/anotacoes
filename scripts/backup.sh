#!/bin/sh
# Backup do SQLite (seguro com WAL). Agendar via cron na VPS:
#   0 4 * * * /opt/notas-vps/scripts/backup.sh >> /var/log/notas-backup.log 2>&1
# Requer: apt install sqlite3 (e restic + jq para a cópia fora da VPS, spec 036)
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=SCRIPTDIR/backup-comum.sh
. "$DIR/backup-comum.sh"
DATE=$(date +%Y%m%d-%H%M)

mkdir -p "$BACKUPS"
sqlite3 "$BASE/data/db/notas.db" ".backup '$BACKUPS/notas-$DATE.db'"

# Bancos dos apps publicados pela ferramenta "Publicar" (um SQLite por site).
for db in "$BASE"/data/sites/*/data/app.db; do
  [ -f "$db" ] || continue
  slug=$(basename "$(dirname "$(dirname "$db")")")
  sqlite3 "$db" ".backup '$BACKUPS/site-$slug-$DATE.db'"
done

# Bancos Postgres dos sites (um por site, site_<slug>), se o serviço estiver de pé.
if docker ps --format '{{.Names}}' | grep -qx notas-postgres; then
  for banco in $(docker exec notas-postgres psql -U postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'site\_%'"); do
    docker exec notas-postgres pg_dump -U postgres -Fc "$banco" > "$BACKUPS/pg-$banco-$DATE.dump"
  done
fi

# retenção: 14 dias, só dos arquivos que este script cria
limpar_backups "$BACKUPS" 14

# Estado para o hub (/api/sistema/backup): só chega aqui se nada acima falhou (set -e).
# Lista os arquivos desta execução; escreve num temporário e troca, para nunca ficar pela metade.
STATUS="$BASE/data/db/backup-status.json"
TOTAL=0
ITENS=""
for f in "$BACKUPS"/*-"$DATE".*; do
  [ -f "$f" ] || continue
  bytes=$(wc -c < "$f" | tr -d ' ')
  TOTAL=$((TOTAL + bytes))
  [ -n "$ITENS" ] && ITENS="$ITENS,"
  ITENS="$ITENS{\"nome\":\"$(basename "$f")\",\"bytes\":$bytes}"
done
printf '{"concluidoEm":"%s","arquivos":[%s],"totalBytes":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ITENS" "$TOTAL" > "$STATUS.tmp"
mv "$STATUS.tmp" "$STATUS"

echo "Backup ok: $BACKUPS/notas-$DATE.db"

# Cópia fora da VPS (spec 036). Uma falha aqui fica registrada em backup-externo.json e no log,
# mas não desfaz o backup local, que já está gravado.
if [ -x "$DIR/backup-externo.sh" ]; then
  "$DIR/backup-externo.sh" || echo "Aviso: a cópia externa falhou; o backup local continua valendo." >&2
fi
