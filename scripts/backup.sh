#!/bin/sh
# Backup do SQLite (seguro com WAL). Agendar via cron na VPS:
#   0 4 * * * /opt/notas-vps/scripts/backup.sh
# Requer: apt install sqlite3
set -e

BASE="${BASE_DIR:-/opt/notas-vps}"
BACKUPS="$BASE/backups"
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

# retenção: 14 dias
find "$BACKUPS" -type f -mtime +14 -delete

echo "Backup ok: $BACKUPS/notas-$DATE.db"
