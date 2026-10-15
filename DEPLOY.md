# Deploy — notas-vps

Endereço: **https://cerebro.vsitefy.com.br**, com HTTPS do nginx-proxy-manager (NPM), que é dono das portas 80/443 do
host. O NPM encaminha para `notas-caddy:8080` pela rede `proxy`; o Caddy do hub não publica porta
no host (o acesso direto `http://191.252.177.244:8090` foi fechado, ver "Endereço público").

## Primeira vez

1. Gerar segredo e criar `.env` de produção na VPS:
   ```bash
   ssh root@191.252.177.244
   mkdir -p /opt/notas-vps
   echo "JWT_SECRET=$(openssl rand -hex 32)" > /opt/notas-vps/.env
   chmod 600 /opt/notas-vps/.env
   ```
   **A chave também pode ser cadastrada pela própria interface** (`/configuracoes`),
   por usuário — o que dispensa mexer no `.env` a cada troca de chave ou modelo. O
   valor abaixo vale como padrão do servidor, para quem não cadastrou a sua.

   Para a ferramenta Finanças usar um LLM de verdade em vez do extrator heurístico
   local, adicionar a chave da OpenRouter (openrouter.ai) ao `.env`:
   ```bash
   echo "OPENROUTER_API_KEY=sk-or-v1-..." >> /opt/notas-vps/.env
   ```
   Sem nenhuma chave o lançamento por texto continua funcionando pelo extrator
   heurístico, mas **importar foto de cupom, PDF de extrato ou planilha exige a
   chave** — é o LLM que lê o documento.

   Alternativas (opcionais), no mesmo `.env`:
   ```bash
   echo "ANTHROPIC_API_KEY=sk-ant-..." >> /opt/notas-vps/.env   # chama a Anthropic direto; não lê arquivos
   echo "LLM_PROVIDER=openrouter" >> /opt/notas-vps/.env         # força um provedor: openrouter | anthropic | heuristico
   ```

   Para o Editor de Imagens ampliar foto pequena por IA (super-resolução), a
   chave da Replicate (replicate.com). **O caminho normal é cadastrá-la em
   `/configuracoes`**, por usuário, como a de LLM — o `.env` abaixo só vale como
   padrão do servidor para quem não cadastrou a sua. **É cobrado por imagem
   ampliada**, então o recurso nasce desligado: sem chave nenhuma, o botão não
   aparece no editor.
   ```bash
   echo "REPLICATE_API_TOKEN=r8_..." >> /opt/notas-vps/.env
   echo "UPSCALE_MODEL=nightmareai/real-esrgan" >> /opt/notas-vps/.env  # opcional: troca o modelo
   ```
   Em qualquer um dos dois caminhos a chave fica só no servidor (cifrada, quando
   é a do usuário): a foto sobe pelo backend, que fala com o serviço, e o
   navegador nunca vê o token.

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

4. Endereço público: Proxy Host no NPM (ver "Endereço público" no fim). Nenhuma porta própria
   precisa ser aberta no firewall.

5. Verificar:
   ```bash
   docker ps --filter name=notas
   docker exec notas-caddy wget -qO- http://api:8080/api/health
   curl https://cerebro.vsitefy.com.br/api/health
   ```
   E no navegador: `https://cerebro.vsitefy.com.br` — registrar usuário, criar nota, desenhar.

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

### Alterar chaves ou variáveis sem novo deploy

O jeito mais simples de trocar chave ou modelo é pela tela `/configuracoes` da
própria aplicação — a chave fica cifrada no banco, por usuário, e tem um botão de
testar conexão antes de salvar.

Para mexer no padrão do servidor, o `.env` fica **só na VPS** e não é enviado pelo
deploy, então mudar uma chave não exige um novo push:

```bash
ssh root@191.252.177.244
cd /opt/notas-vps
echo "OPENROUTER_API_KEY=sk-or-v1-..." >> .env
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d
```

Conferir qual provedor ficou ativo (é preciso estar autenticado):

```bash
curl -H "authorization: Bearer <token>" https://cerebro.vsitefy.com.br/api/financas/capacidades
# {"provedor":"openrouter","suportaAnexos":true,...}
```

## Deploy automático (CI/CD via GitHub Actions)

Todo push em `main` dispara `.github/workflows/deploy.yml`: builda backend e
frontend, empacota, envia por SCP e sobe os containers na VPS — sem precisar
rodar `python scripts/deploy.py` manualmente. Isso é **separado** do fluxo manual
acima (que usa senha via paramiko) — o CI autentica por **chave SSH**, através de
três secrets do repositório no GitHub (`Settings → Secrets and variables →
Actions`):

| Secret | Valor |
|---|---|
| `VPS_HOST` | `191.252.177.244` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | chave privada SSH (formato OpenSSH, com `-----BEGIN OPENSSH PRIVATE KEY-----`), inteira |

### Configurar pela primeira vez

1. Gerar uma chave dedicada ao deploy (sem passphrase — o Actions não tem como
   digitar uma), no PowerShell:
   ```powershell
   ssh-keygen -t ed25519 -C "github-actions-deploy" -f "$HOME\.ssh\notas_vps_deploy" -N '""'
   ```
2. Adicionar a **pública** ao `authorized_keys` do usuário usado no deploy (`root`) na VPS:
   ```powershell
   type $HOME\.ssh\notas_vps_deploy.pub | ssh root@191.252.177.244 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
   ```
3. Testar antes de confiar no CI:
   ```powershell
   ssh -i $HOME\.ssh\notas_vps_deploy root@191.252.177.244 "echo ok"
   ```
   Se voltar `ok` sem pedir senha, a chave está certa.
4. Colar o conteúdo da chave **privada** (`type $HOME\.ssh\notas_vps_deploy`) no
   secret `VPS_SSH_KEY`, e conferir `VPS_HOST`/`VPS_USER` conforme a tabela acima.
5. Reenviar/re-disparar o workflow (`Actions` → run mais recente →
   "Re-run all jobs", ou um novo push em `main`).

### Se der erro de autenticação

```
ssh: handshake failed: ssh: unable to authenticate, attempted methods [none publickey], no supported methods remain
```
A conexão chegou no host normalmente — o problema é só a chave. As duas causas
mais prováveis: `VPS_SSH_KEY` nunca foi configurado (ou tem um valor
errado/incompleto colado), ou a chave pública correspondente nunca foi
adicionada ao `authorized_keys` da VPS. Refaça os passos 1–4 acima.

## Ferramenta "Publicar" (sites em <slug>.191-252-177-244.sslip.io:8090)

A ferramenta envia um ZIP (front estático e/ou API C# já publicada) e coloca o site
no ar em `http://<slug>.191-252-177-244.sslip.io:8090`. O desenho está em
[docs/poc-multi-app/DISCOVERY.md](docs/poc-multi-app/DISCOVERY.md) e o app de
exemplo em [exemplos/publicar/recados](exemplos/publicar/recados/README.md).

> **Pendente com o fechamento da porta 8090.** Os sites chegam ao bloco curinga do Caddy
> (`http://*.{$SITES_DOMINIO}:8080`) pela porta 8090 do host. Sem ela, ficam fora do ar até ganharem
> outro endereço, por exemplo um curinga no NPM (`*.sites.vsitefy.com.br` → `notas-caddy:8080`) com
> `SITES_DOMINIO=sites.vsitefy.com.br` e `SITES_PORTA` vazio. `SITES_PORTA` não roteia nada: só entra
> na URL que a tela mostra.

As peças:
- **API**: guarda as versões em `data/sites/<slug>/`. Só publicam os e-mails em `PUBLICADORES`.
- **deployer**: o único container com `/var/run/docker.sock`. Cria e remove os containers `site-<slug>`.
- **Caddy**: atende `*.191-252-177-244.sslip.io`, manda `/api` para o container e serve o front do disco.
- **Rede `notas-sites`**: os apps ficam isolados nela. O Caddy entra, a API e o deployer não.

### Ligar pela primeira vez

```bash
ssh root@191.252.177.244
cd /opt/notas-vps
echo "PUBLICADORES=seu-email@exemplo.com" >> .env
echo "DEPLOYER_TOKEN=$(openssl rand -hex 32)" >> .env
echo "COMPOSE_PROFILES=publicar" >> .env
echo "POSTGRES_SENHA=$(openssl rand -hex 32)" >> .env   # Postgres dos sites (opcional)
mkdir -p data/sites
# baixa a imagem do runtime antes, para o primeiro deploy não esperar o download
docker pull mcr.microsoft.com/dotnet/aspnet:9.0
docker compose -f docker-compose.yml -f docker-compose.vps.yml build deployer
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d
```

O `COMPOSE_PROFILES=publicar` faz o `up -d` (e o deploy automático) subir o deployer e o
Postgres. Sem ele, a ferramenta ainda publica sites **só estáticos**. O Postgres **exige**
`POSTGRES_SENHA`: sem ela, o container não inicializa e a opção de banco some da tela.

### Postgres dos sites

Um Postgres 17 compartilhado (`notas-postgres`, dados em `data/postgres/`, limite de
256 MB, ~54 MiB ocioso). Para cada site com banco, a API cria um banco e um usuário
`site_<slug>` com senha aleatória. Esse usuário é dono só do próprio banco: não conecta
nos bancos dos outros sites nem no `postgres`, e não é superusuário. O app recebe
`ConnectionStrings__Postgres` e `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`.
Trocar a senha pela tela reinicia o app com a nova.

- **Abrir num cliente** (DBeaver etc.): a porta fica só no loopback da VPS.
  ```bash
  ssh -L 5433:127.0.0.1:5433 root@191.252.177.244
  # conecte em localhost:5433 com o usuário/senha que a tela mostra (ou "postgres" + POSTGRES_SENHA)
  ```
- **psql rápido**: `docker exec -it notas-postgres psql -U postgres -d site_<slug>`
- **Backup**: o `scripts/backup.sh` faz `pg_dump` de cada `site_*` todo dia em `backups/pg-*.dump`.
  Restaurar: `docker exec -i notas-postgres pg_restore -U postgres -d site_<slug> --clean < arquivo.dump`.
- **Antes de cada deploy** de um app com Postgres, o deployer faz `pg_dump` (via `docker exec` no
  `notas-postgres`) e a API guarda o dump em `data/sites/<slug>/backups/<versão>.pgdump`. Se o dump
  falha, o deploy é cancelado sem tocar na versão no ar. Se a versão nova não sobe, o banco é
  recriado vazio e recebe o `pg_restore` desse dump (some até tabela criada por migration pela
  metade) antes da versão anterior voltar. O mesmo vale para **voltar versão + banco** na tela.
  Guarda os dumps das últimas 5 versões.

A porta continua a 8090: o sslip.io resolve `<qualquer-coisa>.191-252-177-244.sslip.io`
para o IP da VPS, e o Caddy separa os sites pelo nome. Não há DNS para configurar.

### Operação

```bash
docker ps --filter label=notas.site                         # apps rodando
docker stats --no-stream $(docker ps -q --filter label=notas.site)
docker logs --tail 100 site-<slug>                           # o mesmo que "Logs do app" na tela
```

- **Limites**: cada app tem 192 MB por padrão (`memoriaMb` no `publicar.json`, até 512) e meia CPU,
  com no máximo 5 apps .NET rodando ao mesmo tempo (`Sites__MaxAppsRodando`). No teste, o Recados
  ocioso ficou em ~21 MiB.
- **Banco**: `data/sites/<slug>/data/app.db`. O `scripts/backup.sh` já copia todos os bancos. Antes de
  cada versão entrar no ar, a API também guarda uma cópia em `data/sites/<slug>/backups/`.
- **Reboot**: os containers usam `--restart unless-stopped` e voltam sozinhos.
- **Parar tudo** de emergência: `docker rm -f $(docker ps -q --filter label=notas.site)`. Os sites
  voltam pelo botão "Iniciar" na tela.

## Ferramenta "Segundo Cérebro" (vault do Obsidian)

Serviços `cerebro` (API, MCP, worker) e `cerebro-webdav` (rclone), atrás do profile `cerebro`.
O Caddy do hub publica `/cerebro/*` e `/dav/*`, **só por HTTPS** (sem o X-Forwarded-Proto do NPM, 403).
Detalhes de uso em [cerebro/README.md](cerebro/README.md).

### Ligar pela primeira vez

1. DNS: registro A de um subdomínio (ex.: `cerebro.seudominio.com.br`) para `191.252.177.244`.
2. NPM: Proxy Host desse subdomínio → `notas-caddy` porta `8080`, "Websockets support" ligado,
   certificado Let's Encrypt com "Force SSL". O container já está na rede `proxy`. (Hoje o hub inteiro
   usa `cerebro.vsitefy.com.br`; ver "Endereço público".)
3. `.env` em `/opt/notas-vps`: `COMPOSE_PROFILES=publicar,cerebro` (ou só `cerebro`), `CEREBRO_USUARIOS`
   com o seu e-mail do hub e os segredos `CEREBRO_*` (`openssl rand -hex 32`). Ver `.env.example`.
4. Faça push na `main` (ou rode o deploy). Ele cria `data/cerebro/` com o dono `CEREBRO_PUID:CEREBRO_PGID`
   (padrão 1000) e builda o serviço.
5. Abra o hub pelo subdomínio HTTPS: o card "Segundo Cérebro" aparece para os e-mails liberados.
6. Configure o Remotely Save em cada aparelho (endereço `https://<subdomínio>/dav`). Faça o primeiro
   sync a partir do aparelho que já tem as notas, depois de um backup.

### Operação

- Saúde: `curl https://cerebro.vsitefy.com.br/cerebro/health`, ou na VPS sem passar pelo NPM:
  `docker exec notas-caddy wget -qO- http://cerebro:8080/health`.
- Logs: `docker compose -f docker-compose.yml -f docker-compose.vps.yml logs -f cerebro`.
- Histórico do vault: `git --git-dir data/cerebro/hub/vault.git --work-tree data/cerebro/webdav/Cerebro log --oneline`.
- Memória: os dois containers têm teto de 256 MB e 128 MB.
- O índice e a fila (`data/cerebro/hub`) podem ser apagados com o serviço parado: são recriados a partir do vault.

## MCP de operação da VPS (ops)

Dá a um agente shell de root no host, logs e restart de qualquer container e leitura e escrita de
arquivos. Quem tem o `OPS_MCP_TOKEN` controla a VPS inteira. Fica atrás do profile `ops`, em
`https://<subdomínio>/ops/mcp`, só por HTTPS. Como ligar, conectar, auditar e trocar o token:
[ops/README.md](ops/README.md).

## Endereço público (subdomínio + NPM) — feito

O hub responde em **https://cerebro.vsitefy.com.br**:

- DNS (Hostinger, zona `vsitefy.com.br`): registro A `cerebro` → `191.252.177.244`.
- NPM (painel em `:81`): Proxy Host `cerebro.vsitefy.com.br` → `notas-caddy:8080`, Websockets,
  Let's Encrypt com Force SSL e, em Advanced, `client_max_body_size 100m; proxy_read_timeout 300s;
  proxy_request_buffering off;` (uploads do WebDAV e capturas).
- `docker-compose.vps.yml` não publica mais `8090:8080`. Depois do primeiro deploy sem a porta, feche
  também no firewall: `ufw delete allow 8090/tcp`.
- Health check do deploy, URL de atualização do Editor de Imagens, servidor padrão do app Android e
  `HUB_API_URL` padrão do MCP de Tarefas apontam para o domínio.

Cuidados ao fechar a porta:
- **Login e dados do navegador são por endereço.** Quem usava `http://IP:8090` precisa entrar de novo em
  `https://cerebro.vsitefy.com.br`. As Notas guardam rascunhos offline no navegador (IndexedDB) por endereço: antes de fechar,
  abra o endereço antigo e espere sincronizar.
- **Editor de Imagens (Windows):** a versão instalada procura atualizações em `http://IP:8090`. Publique
  uma versão nova (workflow Desktop) e deixe os PCs atualizarem **antes** de fechar a porta; senão eles
  param de receber atualizações e precisam reinstalar pelo site.
- **App Android:** quem salvou o IP em Configurações precisa trocar para o domínio.
- **Publicar:** os sites (`<slug>.191-252-177-244.sslip.io:8090`) também passam por esta porta. Sem ela
  ficam fora do ar até ganharem outro endereço (ver a seção do Publicar).

## Instalador do Editor de Imagens pra Windows

Não faz parte do deploy da main: é o workflow **Desktop (Windows)** (Actions ›
Run workflow). Ele grava o `Setup.exe` e o pacote de atualização em
`/opt/notas-vps/downloads/windows`, que o Caddy serve em `/downloads/windows/`
(volume `./downloads` no `docker-compose.yml`). O site mostra o botão "Baixar
para Windows" assim que existe um `versao.json` lá. Usa os mesmos segredos
`VPS_HOST`, `VPS_USER` e `VPS_SSH_KEY` do deploy. Detalhes em `desktop/README.md`.
