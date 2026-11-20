#!/bin/sh
# shellcheck disable=SC2034  # as variáveis são usadas pelos scripts que carregam este arquivo

# Funções compartilhadas pelos scripts de backup (specs 025 e 036). Use com ". backup-comum.sh".
# Nada aqui grava fora de $BASE nem imprime segredos.

BASE="${BASE_DIR:-/opt/notas-vps}"
BACKUPS="${BACKUPS_DIR:-$BASE/backups}"
CONFIG="${NOTAS_BACKUP_CONFIG:-/root/.config/notas-backup.env}"
ESTADO_EXTERNO="${NOTAS_BACKUP_ESTADO:-$BASE/data/db/backup-externo.json}"
TRAVA="${NOTAS_BACKUP_TRAVA:-/run/notas-backup.lock}"

# Apaga só os arquivos que o backup.sh cria (notas-*, site-*, pg-*), direto na pasta, com mais de N dias.
# Outras pastas e arquivos em backups/ nunca são tocados (o find antigo apagou backups/estudio-*/ em 2026-11-20).
limpar_backups() {
  find "$1" -maxdepth 1 -type f \( -name 'notas-*' -o -name 'site-*' -o -name 'pg-*' \) -mtime +"$2" -delete
}

# Carrega repositório, senha e chave do bucket. O arquivo fica fora do repositório e do compose (600, root).
carregar_config() {
  if [ ! -r "$CONFIG" ]; then
    echo "configuração ausente: $CONFIG" >&2
    return 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG"
  set +a
  if [ -z "${RESTIC_REPOSITORY:-}" ] || [ -z "${RESTIC_PASSWORD:-}" ]; then
    echo "RESTIC_REPOSITORY e RESTIC_PASSWORD são obrigatórios em $CONFIG" >&2
    return 1
  fi
}

# Uma execução por vez (cron + manual). Espera até 10 min pela outra terminar.
travar() {
  exec 9>"$TRAVA"
  flock -w 600 9
}

agora_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Lê o estado atual; ausente ou inválido vira {}.
_estado_atual() {
  jq -c '. // {}' "$ESTADO_EXTERNO" 2>/dev/null || echo '{}'
}

# Troca o arquivo de estado de forma atômica (temporário + mv).
_gravar_estado() {
  printf '%s\n' "$1" > "$ESTADO_EXTERNO.tmp"
  mv "$ESTADO_EXTERNO.tmp" "$ESTADO_EXTERNO"
}

# Tira da mensagem qualquer segredo carregado da configuração e limita o tamanho (FR-012).
limpar_erro() {
  msg=$(printf '%s' "$1" | tr -d '\r' | tr '\n"' '  ' | cut -c1-300)
  for segredo in "${RESTIC_PASSWORD:-}" "${AWS_SECRET_ACCESS_KEY:-}" "${AWS_ACCESS_KEY_ID:-}"; do
    [ -n "$segredo" ] && msg=$(printf '%s' "$msg" | awk -v s="$segredo" '{ while ((i = index($0, s)) > 0) $0 = substr($0, 1, i - 1) "***" substr($0, i + length(s)); print }')
  done
  printf '%s' "$msg"
}

# gravar_ok <copia|conferencia> <instantaneo> [bytesTotal]
gravar_ok() {
  novo=$(_estado_atual | jq -c --arg parte "$1" --arg em "$(agora_utc)" --arg inst "$2" --argjson bytes "${3:-0}" \
    '.[$parte] = {concluidoEm: $em, ok: true, instantaneo: $inst, bytesTotal: $bytes, falhaEm: null, erro: null}')
  _gravar_estado "$novo"
}

# gravar_falha <copia|conferencia> <mensagem>: mantém o último sucesso (concluidoEm) e registra a falha.
gravar_falha() {
  novo=$(_estado_atual | jq -c --arg parte "$1" --arg em "$(agora_utc)" --arg erro "$(limpar_erro "$2")" \
    '.[$parte] = ((.[$parte] // {}) + {ok: false, falhaEm: $em, erro: $erro})')
  _gravar_estado "$novo"
}
