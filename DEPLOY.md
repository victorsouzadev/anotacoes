# Deploy — notas-vps

Exposição: **só IP, sem SSL**, na porta **8090** do host (`http://191.252.177.244:8090`).
A porta 80/443 do host já pertence ao nginx-proxy-manager (NPM), usado pelo convite-vps.

## Primeira vez

1. Gerar segredo e criar `.env` de produção na VPS:
   ```bash
   ssh root@191.252.177.244
   mkdir -p /opt/notas-vps
   echo "JWT_SECRET=$(openssl rand -hex 32)" > /opt/notas-vps/.env
   chmod 600 /opt/notas-vps/.env
   ```

2. Enviar os arquivos do projeto (do Windows):
   ```powershell
   cd notas-vps
   python scripts/deploy.py
   ```

3. Build e subida (mitigar OOM em 1.9 GiB de RAM — build sequencial, parar o hermes):
   ```bash
   ssh root@191.252.177.244
   cd /opt/notas-vps
   docker stop hermes
   docker compose -f docker-compose.yml -f docker-compose.vps.yml build api
   docker compose -f docker-compose.yml -f docker-compose.vps.yml build caddy
   docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d
   docker start hermes
   ```
   Se o build travar/OOM: build localmente com `docker save | gzip`, enviar a imagem via SFTP e `docker load` na VPS.

4. Abrir a porta no firewall:
   ```bash
   ufw allow 8090/tcp
   ```

5. Verificar:
   ```bash
   docker ps --filter name=notas
   docker exec notas-caddy wget -qO- http://api:8080/api/health
   curl http://127.0.0.1:8090/api/health
   ```
   E no navegador: `http://191.252.177.244:8090` — registrar usuário, criar nota, desenhar.

6. Backup do SQLite (requer `sqlite3` no host):
   ```bash
   apt install -y sqlite3   # se ainda não instalado
   crontab -e
   # adicionar:
   0 4 * * * /opt/notas-vps/scripts/backup.sh
   ```

## Atualizações seguintes

```powershell
python scripts/deploy.py
```
```bash
ssh root@191.252.177.244
cd /opt/notas-vps
docker stop hermes
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api
docker compose -f docker-compose.yml -f docker-compose.vps.yml build caddy
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d
docker start hermes
```

Sem rollback automático — se precisar reverter, reenviar a versão anterior do código e repetir o build.

## Migração futura para subdomínio + SSL via NPM

1. Criar registro DNS A de um subdomínio (ex.: `notas.vsitefy.com.br`) para `191.252.177.244`.
2. Remover a publicação de porta `8090:8080` do `docker-compose.vps.yml` (o container já está na rede `proxy`).
3. Criar um Proxy Host no NPM apontando para `notas-caddy:8080` e solicitar certificado Let's Encrypt.
4. `ufw delete allow 8090/tcp`.
