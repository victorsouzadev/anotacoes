# Builda o Angular e embute o resultado no Caddy.
# Contexto de build: a RAIZ do repositório (ver docker-compose.yml).
FROM node:22-alpine AS fe
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npx ng build --configuration production

FROM caddy:2-alpine
COPY caddy/Caddyfile.local /etc/caddy/Caddyfile
COPY --from=fe /app/dist/frontend/browser /srv
