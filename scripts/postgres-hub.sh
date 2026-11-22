#!/bin/sh
# Spec 038: banco "hub" no notas-postgres, com o schema "nucleo" e um schema e um papel por plug-in.
#   scripts/postgres-hub.sh papeis       # banco, schemas e papéis (antes de qualquer serviço subir no Postgres)
#   scripts/postgres-hub.sh permissoes   # depois que o núcleo criou as tabelas, e de novo depois dos plug-ins
# As senhas vêm do ambiente, uma por papel: PG_SENHA_NUCLEO, PG_SENHA_NOTAS, PG_SENHA_FINANCAS...
# Nenhuma senha é impressa. PSQL troca o cliente (padrão: docker exec no notas-postgres).
set -eu

PLUGINS="${PG_PLUGINS:-notas financas tarefas dieta treino criativo cerebro}"
PSQL="${PSQL:-docker exec -i notas-postgres psql -U postgres -v ON_ERROR_STOP=1 -q}"

senha() {
  var="PG_SENHA_$(echo "$1" | tr '[:lower:]' '[:upper:]')"
  eval "valor=\${$var:-}"
  [ -n "$valor" ] || { echo "Falta $var" >&2; exit 1; }
  # Aspas simples dobradas: a senha vai como literal do SQL.
  printf "%s" "$valor" | sed "s/'/''/g"
}

papel() { # papel <id> <search_path>
  s=$(senha "$1")
  cat <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$1') THEN CREATE ROLE "$1" LOGIN; END IF;
END \$\$;
ALTER ROLE "$1" WITH LOGIN PASSWORD '$s';
CREATE SCHEMA IF NOT EXISTS "$1" AUTHORIZATION "$1";
ALTER ROLE "$1" IN DATABASE hub SET search_path = $2;
GRANT CONNECT ON DATABASE hub TO "$1";
SQL
}

case "${1:-}" in
  papeis)
    if ! echo "SELECT 1 FROM pg_database WHERE datname = 'hub'" | $PSQL -At | grep -q 1; then
      echo "CREATE DATABASE hub" | $PSQL
    fi
    {
      echo "REVOKE ALL ON DATABASE hub FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;"
      # O núcleo lê a chave do AUVP no schema das Finanças para a recifragem (Recifragem.cs).
      papel nucleo "nucleo, financas"
      for p in $PLUGINS; do papel "$p" "$p, nucleo"; done
    } | $PSQL -d hub
    echo "Papéis e schemas prontos: nucleo $PLUGINS"
    ;;
  permissoes)
    {
      for p in $PLUGINS; do
        # O plug-in só aponta para users (chave estrangeira); ler ou gravar continua recusado.
        echo "GRANT USAGE ON SCHEMA nucleo TO \"$p\"; GRANT REFERENCES (\"Id\") ON nucleo.users TO \"$p\";"
      done
      # Só existe depois que as Finanças subiram: rodar de novo nessa hora (tudo aqui pode repetir).
      echo "GRANT USAGE ON SCHEMA financas TO nucleo;"
      echo "DO \$\$ BEGIN IF to_regclass('financas.configuracoes_auvp') IS NOT NULL THEN GRANT SELECT ON financas.configuracoes_auvp TO nucleo; END IF; END \$\$;"
    } | $PSQL -d hub
    echo "Permissões entre papéis prontas."
    ;;
  *)
    echo "Uso: $0 papeis|permissoes" >&2
    exit 2
    ;;
esac
