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

# retenção: 14 dias
find "$BACKUPS" -type f -mtime +14 -delete

echo "Backup ok: $BACKUPS/notas-$DATE.db"
