# Builda o Angular e embute o resultado no Caddy.
# Contexto de build: a RAIZ do repositório (ver docker-compose.yml).
FROM node:22-alpine AS fe
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
# styles.css importa os tokens do @grafite/ui (../../pacotes a partir de /app/src).
COPY pacotes/grafite-ui/*.css /pacotes/grafite-ui/
RUN npx ng build --configuration production

FROM caddy:2-alpine
COPY caddy/Caddyfile.local /etc/caddy/Caddyfile
COPY --from=fe /app/dist/frontend/browser /srv
# @grafite/ui servido aos plug-ins em /grafite/ (spec 032)
COPY pacotes/grafite-ui/grafite.css pacotes/grafite-ui/grafite-tokens.css pacotes/grafite-ui/grafite-barra.js pacotes/grafite-ui/token-plugin.js /srv-grafite/
