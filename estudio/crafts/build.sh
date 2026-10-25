#!/usr/bin/env bash
# Compila um craft app do ArtCraft para o Estúdio: o build web (WebAssembly) que o hub abre em
# /crafts/<id>/ e, com --cli, a linha de comando (MCP sem janela) do sistema onde roda (Linux na VPS,
# Windows para o instalador). Com --so-cli,
# só a linha de comando (o workflow a compila num container Alpine, para rodar no crafts-mcp).
#
#   estudio/crafts/build.sh <id> <pasta-de-saída> [--cli | --so-cli]
#
# Precisa de: git, jq, Rust estável com o alvo wasm32-unknown-unknown, trunk (apps "trunk"),
# wasm-bindgen-cli na versão do Cargo.lock (apps "xtask"; o script instala), gzip e brotli.
# É o que o workflow "Craft apps" roda; dá para rodar igual numa máquina com Rust.
set -euo pipefail

aqui="$(cd "$(dirname "$0")" && pwd)"
id="${1:?informe o app (ex.: gridcraft)}"
saida="$(mkdir -p "${2:?informe a pasta de saída}" && cd "$2" && pwd)"
cli="${3:-}"

app="$(jq -c --arg id "$id" '.apps[] | select(.id == $id)' "$aqui/crafts.json")"
[ -n "$app" ] || { echo "App desconhecido: $id" >&2; exit 1; }
repo="$(jq -r .repo <<<"$app")"
commit="$(jq -r .commit <<<"$app")"
modo="$(jq -r .build <<<"$app")"
versao="$(jq -r .versao <<<"$app")"

fonte="${CRAFTS_FONTES:-$saida/../fontes}/$id"
if [ ! -d "$fonte/.git" ]; then
  git clone --filter=blob:none "https://github.com/$repo.git" "$fonte"
fi
git -C "$fonte" fetch --quiet origin "$commit" || true
git -C "$fonte" checkout --quiet --force "$commit"
git -C "$fonte" clean -fdq

# Ajustes nossos no código do app, se algum dia forem necessários.
if compgen -G "$aqui/patches/$id/*.patch" > /dev/null; then
  for p in "$aqui/patches/$id/"*.patch; do
    echo "Aplicando $(basename "$p")"
    git -C "$fonte" apply --whitespace=nowarn "$p"
  done
fi

if [ "$cli" != "--so-cli" ]; then
web="$saida/web"
rm -rf "$web" && mkdir -p "$web"
case "$modo" in
  trunk)
    (cd "$fonte/apps/$id-web" && trunk build --release --dist "$web" --public-url ./)
    ;;
  xtask)
    bindgen="$(awk '/^name = "wasm-bindgen"$/{getline; gsub(/version = |"/,""); print; exit}' "$fonte/Cargo.lock")"
    if ! wasm-bindgen --version 2>/dev/null | grep -q " $bindgen\$"; then
      cargo install wasm-bindgen-cli --version "$bindgen" --locked
    fi
    (cd "$fonte" && cargo xtask web)
    dist="$(find "${CARGO_TARGET_DIR:-$fonte/target}" -path '*web*' -name index.html -newer "$fonte/Cargo.toml" -printf '%h\n' | head -1)"
    [ -n "$dist" ] || { echo "Não achei o dist do xtask web" >&2; exit 1; }
    cp -r "$dist/." "$web/"
    ;;
  *) echo "Modo de build desconhecido: $modo" >&2; exit 1 ;;
esac
[ -f "$web/index.html" ] || { echo "O build de $id não gerou index.html" >&2; exit 1; }

# Apps sem a ponte nativa ganham a ponte em JavaScript (ponte-hub.js), no começo do <head> para
# valer antes do WebAssembly subir.
if [ "$(jq -r .ponte <<<"$app")" = "js" ]; then
  cp "$aqui/ponte-hub.js" "$web/ponte-hub.js"
  tag="<script src=\"ponte-hub.js\" data-app=\"$id\" data-versao=\"$versao\"></script>"
  perl -0pi -e "s{<head([^>]*)>}{<head\$1>\n  $tag}i" "$web/index.html"
  grep -q 'ponte-hub.js' "$web/index.html" || { echo "Não consegui pôr a ponte no index.html" >&2; exit 1; }
fi

# Pré-compressão: o Caddy serve o .br/.gz do lado (file_server precompressed) sem comprimir na hora.
find "$web" -type f \( -name '*.wasm' -o -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.svg' -o -name '*.ttf' -o -name '*.otf' \) -size +1k \
  -exec gzip -9 -k -f {} \; -exec brotli -q 11 -k -f {} \;

jq -n --arg id "$id" --arg versao "$versao" --arg commit "$commit" --arg em "$(date -u +%FT%TZ)" \
  '{id: $id, versao: $versao, commit: $commit, compiladoEm: $em}' > "$web/craft.json"
echo "Web: $(du -sh "$web" | cut -f1) em $web"
fi

if [ "$cli" = "--cli" ] || [ "$cli" = "--so-cli" ]; then
  (cd "$fonte" && cargo build --release --locked -p "$id-cli")
  mkdir -p "$saida/cli"
  # No Windows (runner do GitHub, Git Bash) o binário sai com .exe.
  exe="$id-cli"
  [ -f "${CARGO_TARGET_DIR:-$fonte/target}/release/$exe.exe" ] && exe="$exe.exe"
  cp "${CARGO_TARGET_DIR:-$fonte/target}/release/$exe" "$saida/cli/"
  echo "CLI: $saida/cli/$exe"
fi
