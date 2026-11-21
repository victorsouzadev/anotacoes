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
   # adicionar (a saída vai para o log; sem isso o cron descarta os erros):
   0 4 * * * /opt/notas-vps/scripts/backup.sh >> /var/log/notas-backup.log 2>&1
   ```

   O deploy leva `scripts/` com `755 root:root` e instala a rotação do log em
   `/etc/logrotate.d/notas-backup`. A limpeza dos 14 dias só apaga `notas-*`, `site-*` e `pg-*` direto em
   `backups/`; outras pastas e arquivos ali não são tocados.

   Cada execução sem erro grava `data/db/backup-status.json`. O hub lê esse arquivo
   (`GET /api/sistema/backup`) e mostra uma faixa de alerta para os e-mails de `PUBLICADORES`
   quando o último backup tem mais de 36 h; a seção **Servidor** em `/configuracoes` traz os
   detalhes, e o resumo do MCP criativo leva a mesma linha para o diário do Segundo Cérebro.
   Para conferir na VPS: `crontab -l` e `cat /opt/notas-vps/data/db/backup-status.json`.

7. Cópia do backup fora da VPS (spec 036). Sem ela, perder a VPS é perder os dados **e** as cópias.

   **Preparar (uma vez, no seu PC):**
   - Instalar o `rclone` (`winget install Rclone.Rclone`) e rodar
     `rclone authorize "drive" --drive-scope drive.file`. Aprovar com a conta Google e copiar o token.
     O escopo `drive.file` só deixa o `rclone` ver os arquivos que ele mesmo criou.
   - Gerar uma senha longa para a cópia. **Guardar a senha no gerenciador de senhas**: sem ela a cópia
     não abre, e ela não pode existir só na VPS.

   **Configurar na VPS:**
   ```bash
   apt install -y restic rclone jq
   install -d -m 700 /root/.config /root/.config/rclone
   rclone config create gdrive drive scope=drive.file token="<token colado>" --config /root/.config/rclone/rclone.conf
   chmod 600 /root/.config/rclone/rclone.conf
   install -m 600 /dev/null /root/.config/notas-backup.env
   # preencher:
   #   RESTIC_REPOSITORY=rclone:gdrive:notas-vps-backup
   #   RESTIC_PASSWORD=<senha da cópia>
   #   RCLONE_CONFIG=/root/.config/rclone/rclone.conf
   set -a; . /root/.config/notas-backup.env; set +a
   restic init
   crontab -e
   # adicionar a conferência semanal:
   0 5 * * 0 /opt/notas-vps/scripts/backup-conferir.sh >> /var/log/notas-backup.log 2>&1
   /opt/notas-vps/scripts/backup.sh >> /var/log/notas-backup.log 2>&1
   /opt/notas-vps/scripts/backup-conferir.sh >> /var/log/notas-backup.log 2>&1
   cat /opt/notas-vps/data/db/backup-externo.json
   ```

   O `backup.sh` chama o `backup-externo.sh` no fim de cada backup local sem erro. A cópia leva as cópias
   consistentes de `backups/`, todo `data/` (menos os arquivos vivos do SQLite e o `data/postgres`) e o
   `.env`, cifrados na VPS e enviados para a pasta `notas-vps-backup` do Google Drive, com retenção de 7 diárias, 4 semanais e 6 mensais. A conferência de domingo lê
   10% dos dados remotos e restaura o `notas.db` mais recente para rodar `PRAGMA integrity_check`. O estado
   fica em `data/db/backup-externo.json`; o hub avisa com 36 h sem cópia externa ou 8 dias sem conferência.

   **Restaurar tudo numa máquina nova** (ensaiar a cada 6 meses; anote a data abaixo):
   ```bash
   rclone config create gdrive drive scope=drive.file   # autoriza no navegador
   export RESTIC_REPOSITORY=rclone:gdrive:notas-vps-backup RESTIC_PASSWORD=...
   restic snapshots --tag notas-vps
   restic restore latest --target /tmp/restauro
   git clone https://github.com/victorsouzadev/anotacoes /opt/notas-vps && cd /opt/notas-vps
   cp /tmp/restauro/opt/notas-vps/.env .
   cp -a /tmp/restauro/opt/notas-vps/data .
   cp "$(ls /tmp/restauro/opt/notas-vps/backups/notas-*.db | tail -1)" data/db/notas.db
   # bancos SQLite dos sites: copiar o site-<slug>-*.db mais recente para data/sites/<slug>/data/app.db
   # Postgres dos sites: subir o notas-postgres e, para cada pg-site_<slug>-*.dump mais recente,
   #   docker exec -i notas-postgres createdb -U postgres site_<slug>
   #   docker exec -i notas-postgres pg_restore -U postgres -d site_<slug> < arquivo.dump
   docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
   ```
   Entrar com a conta de sempre e conferir notas, tarefas e finanças do dia anterior. O `.env` restaurado
   traz as chaves do núcleo, então os logins e os tokens continuam valendo.

   Último ensaio de restauração: **2026-11-20**, no PC do Victor (Windows + Docker), cópia `19e6ccf6`.
   Do zero (restic instalado, Drive autorizado) até os arquivos no disco: **2 min** (4342 arquivos, 113 MiB,
   10 s de download). O `notas-*.db` restaurado tinha o mesmo SHA-256 do da VPS e `integrity_check` ok, e a
   API subiu com ele e o `.env` restaurado (`/api/health` ok, migrações sem erro), sem rede para não chamar
   serviços externos. Ficaram de fora o login pelo navegador, o `pg_restore` dos sites e o Caddy: ensaiar
   no próximo. Próximo ensaio: até 2027-05.

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
curl -H "authorization: Bearer <token>" http://127.0.0.1:8090/api/financas/capacidades
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
O Caddy do hub publica `/cerebro/*` e `/dav/*`, **só por HTTPS**: pelo IP:8090 eles respondem 403.
Detalhes de uso em [cerebro/README.md](cerebro/README.md).

### Ligar pela primeira vez

1. DNS: registro A de um subdomínio (ex.: `cerebro.seudominio.com.br`) para `191.252.177.244`.
2. NPM: Proxy Host desse subdomínio → `notas-caddy` porta `8080`, "Websockets support" ligado,
   certificado Let's Encrypt com "Force SSL". O container já está na rede `proxy`. O IP:8090 continua
   funcionando para as outras ferramentas.
3. `.env` em `/opt/notas-vps`: `COMPOSE_PROFILES=publicar,cerebro` (ou só `cerebro`), `CEREBRO_USUARIOS`
   com o seu e-mail do hub e os segredos `CEREBRO_*` (`openssl rand -hex 32`). Ver `.env.example`.
4. Faça push na `main` (ou rode o deploy). Ele cria `data/cerebro/` com o dono `CEREBRO_PUID:CEREBRO_PGID`
   (padrão 1000) e builda o serviço.
5. Abra o hub pelo subdomínio HTTPS: o card "Segundo Cérebro" aparece para os e-mails liberados.
   O Caddy também manda `/.well-known/oauth-*` para o Cérebro (só por HTTPS): é por onde o Claude web
   descobre o OAuth do MCP (spec 028) e conecta em `https://<subdomínio>/cerebro/mcp` sem token na URL.
6. Configure o Remotely Save em cada aparelho (endereço `https://<subdomínio>/dav`). Faça o primeiro
   sync a partir do aparelho que já tem as notas, depois de um backup.

### Operação

- Saúde: `curl http://127.0.0.1:8090/cerebro/health` na VPS (única rota liberada sem HTTPS).
- Logs: `docker compose -f docker-compose.yml -f docker-compose.vps.yml logs -f cerebro`.
- Histórico do vault: `git --git-dir data/cerebro/hub/vault.git --work-tree data/cerebro/webdav/Cerebro log --oneline`.
- Memória: os dois containers têm teto de 256 MB e 128 MB.
- O índice e a fila (`data/cerebro/hub`) podem ser apagados com o serviço parado: são recriados a partir do vault.

## MCPs dos apps do hub (Finanças; Criativo, Treino, Dieta e Tarefas nos plug-ins)

O `api` serve `/api/mcp/financas` (`/api/mcp/criativo` e `/api/mcp/treino` são dos plug-ins desde a
spec 034 e `/api/mcp/dieta` e `/api/mcp/tarefas` desde a 035, nas mesmas URLs e com o mesmo token) (só leitura; no plug-in Dieta, também os
registros rápidos de refeição, peso e água), autenticados pelo
token gerado na tela do Segundo Cérebro (`data/cerebro/hub/access/apps-token.json`, montado só leitura em
`/access`). O Cérebro usa esses MCPs na rotina de sincronização. Detalhes em
[cerebro/README.md](cerebro/README.md#apps-do-hub-mcps-e-rotina-de-sincronização).

## App Android das Tarefas

Desde a spec 035 o app Organizador mora no repositório [hub-tarefas](https://github.com/victorsouzadev/hub-tarefas)
(`mobile/app`, Gradle próprio), que o compila e testa na CI. Ele continua falando com `/api/tasks` (rota legada do plug-in).

## App Android da Dieta

Desde a spec 035 o app mora no repositório [hub-dieta](https://github.com/victorsouzadev/hub-dieta) (`mobile/dieta`, Gradle
próprio). O workflow **Android (Dieta)** de lá (tag `dieta-v1.2.3` ou execução manual) gera o APK e grava em
`/opt/notas-vps/downloads/android`, servido pelo Caddy em
`https://cerebro.vsitefy.com.br/downloads/android/Dieta.apk` (mesmos segredos `VPS_*` do workflow do
Windows, cadastrados no hub-dieta). As tabelas `dieta_*` continuam no `notas.db`, agora do plug-in, que carrega a TACO
na subida.

## MCP de operação da VPS (ops)

Dá a um agente shell de root no host, logs e restart de qualquer container e leitura e escrita de
arquivos. Quem tem o `OPS_MCP_TOKEN` controla a VPS inteira. Fica atrás do profile `ops`, em
`https://<subdomínio>/ops/mcp`, só por HTTPS. Como ligar, conectar, auditar e trocar o token:
[ops/README.md](ops/README.md).

## Núcleo e plug-ins (specs 029 a 032)

**Login (030).** O núcleo assina os tokens com ES256. As chaves ficam em `data/core/chaves/` (`<kid>.pem`, `jwks.json`,
`selo.key`), geradas no primeiro boot, montadas só no `api` e levadas pela cópia externa (036). Nunca vão para o git.
- Tokens HS256 antigos (assinados com o `JWT_SECRET`) valem até 15 min depois do boot (`Core__AceitarHs256Ate` muda isso).
  Quem estiver logado continua: o refresh devolve um token ES256.
- `users`, `refresh_tokens`, `core_oauth_tokens` e `core_mcp_tokens` têm a coluna `Selo` (HMAC com `selo.key`). Linha gravada
  por fora do núcleo não loga. As linhas que já existiam são seladas uma vez, no primeiro boot (arquivo `selado-em`).
- Perder `data/core/chaves` derruba todos os logins (cada um entra de novo) e invalida os selos: restaure da cópia externa.
- `JWT_SECRET` continua no `.env`: cifra as chaves de IA guardadas no banco (`ProtetorDeSegredos`).

**Plug-ins (029).** `plugins.lock` na raiz, uma linha por plug-in (`id: imagem@commit`); linha comentada desliga. O deploy
copia o arquivo para `data/plugins/plugins.lock`; o deployer confere a cada 30 s e, para cada mudança:
1. baixa a imagem (imagem privada do GHCR: `docker login ghcr.io` na VPS uma vez, como root, com um token classic só `read:packages`; o `docker-compose.yml` monta o `/root/.docker/config.json` no deployer, só leitura. O arquivo precisa existir antes de subir o deployer, senão o Docker cria uma pasta no lugar);
2. lê `/app/plugin.json` e confere as regras (rotas reservadas, prefixo de tabela, sobreposição com outros plug-ins);
3. copia o `notas.db` para `data/plugins/copias/` (guarda 5) e retrata o esquema;
4. sobe `plugin-<id>` na rede do hub com `data/db` montado e as variáveis `HUB_*` (nunca `JWT_SECRET` nem `data/core`);
5. espera o health por 60 s e compara o esquema: se falhar ou se mudou tabela de outro dono, restaura a cópia e volta a
   versão anterior. O motivo aparece em `data/plugins/estado.json` e em `GET /api/plugins` (`ultimaFalha`);
6. grava `data/plugins/caddy/<id>.caddy` (rota do plug-in e `rotasLegadas`, sem reescrever o caminho) e recarrega o Caddy.

```bash
cat /opt/notas-vps/data/plugins/estado.json     # versão, anterior, no ar, última falha
docker logs notas-vps-deployer-1 --tail 50      # o que o deployer fez
curl -s -X POST -H "Authorization: Bearer $DEPLOYER_TOKEN" http://deployer:8080/plugins/sincronizar  # de dentro da rede do compose
```

Remover a linha do lock (ou comentar) para o container e apaga o trecho do Caddy; as tabelas e os dados ficam.

**Banco compartilhado (031).** Cada plug-in usa o mesmo `notas.db`, só nas tabelas do seu prefixo, com histórico
`__EFMigrationsHistory_<id>`. O `scripts/backup.sh` copia o arquivo inteiro, então já cobre todos os plug-ins.

**Receita de extração (031, usada nas 033 a 035).**
1. No plug-in: copiar as entidades com os mesmos nomes de tabela e colunas; a primeira migração tem `Up` vazio (as
   tabelas já existem) e o teste `Dados.TabelasForaDoDono` dá vazio com as tabelas antigas em `tabelas.legadas`.
2. No núcleo: tirar as entidades do `AppDbContext`. Desde a spec 037 o núcleo não tem migrações: as tabelas que saem do
   modelo ficam no banco, sem uso pelo núcleo. Rotas antigas vão para `rotasLegadas`.
3. Ordem: deploy do núcleo sem a ferramenta só depois do plug-in no ar com a mesma versão de esquema.

**OAuth do núcleo (030).** Os endpoints (`/api/core/oauth/*`, `/.well-known/oauth-protected-resource/<id>/mcp`) já existem,
mas o Caddy ainda manda `/.well-known/oauth-*` e `/cerebro/oauth/*` para o Cérebro: a virada, com a importação dos clientes
do `hub.db`, é na extração do Cérebro (033).

**Cérebro como plug-in (033).** O código mora no [hub-cerebro](https://github.com/victorsouzadev/hub-cerebro); a CI publica
`ghcr.io/victorsouzadev/hub-cerebro:<commit>` (privada) a cada push na `main`. O plug-in serve a API, o MCP e as telas em
`/cerebro/` e `/cerebro/capturar`; `/capturar` (PWA já instalada), `/sw-cerebro.js` e `/cerebro-app/*` vêm por `rotasLegadas`.
Na primeira subida, a `Migracao033` copia capturas e configurações do `hub.db` para as tabelas `cerebro_*` e entrega o OAuth
ao núcleo (`/api/core/oauth/importar`); o `hub.db` fica intacto e ganha o marcador `hub.db.migrado-033`. A IA vem do núcleo
(`/api/core/ia`, lida quando o usuário abre a tela); sem chave lá, vale a que o Cérebro já tinha. Sem `index.db`, o índice
é reconstruído em segundo plano e a busca avisa "indexando" (`/cerebro/health` mostra `indexando`).

Configuração própria de um plug-in (tokens, listas de usuários) vai em `data/plugins/env/<id>.env` (dono root, modo 600,
fora do git): o deployer passa o arquivo com `--env-file` quando ele existe. As `HUB_*` do núcleo vêm por `-e` e vencem o arquivo.
O plug-in roda como `0:0` sem capacidades, então só escreve no que é do root: as pastas de `dados` precisam ter dono root.

Troca (033, T009 e T010), sempre com confirmação:
1. Ensaio com uma cópia da produção (`data/db/notas.db` e `data/cerebro/`) numa pasta à parte, rodando a imagem nova
   como o deployer roda (`--user 0:0 --cap-drop ALL`). Feito em 20/11/2026 com `c71ba6f`: health, tela, `/capturar`, MCP e busca ok.
2. Na VPS: parar `cerebro`, mover `data/cerebro/webdav` para `data/plugins/dados/cerebro/vault` e `data/cerebro/hub` para
   `data/plugins/dados/cerebro/hub`, `chown -R 0:0` nas duas, e gravar `data/plugins/env/cerebro.env` com as `Hub__*` do
   serviço antigo (com `Hub__VaultPath=/data/vault/Cerebro` e `Hub__DataPath=/data/hub`).
3. PR com a linha `cerebro: ghcr.io/victorsouzadev/hub-cerebro@<commit>` no `plugins.lock`, sem o serviço `cerebro` no
   `docker-compose.yml`, e o `cerebro-webdav` montando a pasta nova com `user: "0:0"` e `cap_drop: [ALL]` (assim o que
   ele grava é do root e o plug-in consegue editar).
4. Depois do deploy: `cat data/plugins/estado.json`, `curl http://127.0.0.1:8090/cerebro/health` e o smoke test
   (`cerebro/scripts/smoke-test.sh`). Voltar é comentar a linha do lock e repor o serviço no compose.

**Plug-ins congelados (034).** O Editor de Imagens, os Moldes, o Bolo 3D e a Precificação são o plug-in `criativo`
([hub-criativo](https://github.com/victorsouzadev/hub-criativo)); o Treino é o `treino` ([hub-treino](https://github.com/victorsouzadev/hub-treino)).
Os dois têm `"congelado": true` no manifesto: ficam na versão do `plugins.lock`, sem CI a cada mudança do núcleo
(Configurações → Servidor mostra "congelado"). Usam as tabelas `imagem_*` e `treino_*` que já estavam no `notas.db`
(migração `Base`, conferida com o banco na primeira subida), e as URLs antigas por `rotasLegadas`: `/api/imagens`,
`/api/moldes`, `/api/precificacao`, `/api/treino` e os MCPs `/api/mcp/criativo` e `/api/mcp/treino`. As telas ficam em
`/criativo/...` e `/treino/`; `/imagens`, `/moldes`, `/bolo-3d` e `/precificacao` redirecionam.
- O núcleo entrega a esses dois plug-ins, na lista de revogações, o token "MCPs dos apps" de Conexões e o do arquivo
  antigo do Cérebro (SDK 1.2.0 aceita token que não é JWT e `?key=`). Sites e a linha do backup do `criativo_resumo`
  vêm de `/api/core/criativo/resumo` (segredo de serviço, só o plug-in criativo).
- A IA e a chave própria de ampliação vêm do `/api/core/ia`. As chaves do servidor e o painel da Viih Mimos vão em
  `data/plugins/env/criativo.env` (root, 600): `Upscale__ApiKey`, `ViihMimos__Url`, `ViihMimos__Chave`, `ViihMimos__Usuarios`
  (os mesmos valores do `.env` do núcleo).
- A rotina dos apps do Cérebro chama `http://api:8080/api/mcp/<app>` pela rede interna, sem o Caddy: para `treino` e
  `criativo` ela passa a usar `http://plugin-<id>:8080/api/mcp/<id>` (hub-cerebro).
- O app Windows mora no `desktop/` do hub-criativo e continua hospedando o `NotasApp` inteiro, compilado do núcleo no
  commit fixo `NUCLEO_REF` do `desktop.yml` dele (o último com o código do Editor).

Ordem da troca, sempre com confirmação:
1. PR do SDK 1.2.0 e do núcleo (token dos apps, `/api/core/criativo/resumo`, chave de ampliação, campo `congelado`).
   Na main, o workflow Pacotes publica a Release `sdk-v1.2.0`.
2. PRs do hub-treino e do hub-criativo: a CI baixa o SDK 1.2.0, testa e publica as imagens.
3. Na VPS: `data/plugins/env/criativo.env` com as chaves acima.
4. PR com as linhas `treino: ghcr.io/victorsouzadev/hub-treino@<commit>` e `criativo: ghcr.io/victorsouzadev/hub-criativo@<commit>`
   no `plugins.lock`. Conferir `estado.json`, os cards, `/criativo/imagens`, `/criativo/moldes`, `/criativo/bolo-3d`,
   `/criativo/precificacao`, `/treino/` e os MCPs nas URLs antigas.
5. Só então o PR que tira o código do núcleo (migração `ExtracaoCongelados`, de `Up` vazio: as tabelas ficam).
Voltar antes do passo 5 é comentar as linhas do lock: o núcleo ainda tem as rotas.

**Ferramentas ativas como plug-ins (035).** Dieta, Tarefas, Anotação, Finanças e Notas são os plug-ins `dieta`, `tarefas`,
`anotacao`, `financas` e `notas` (repositórios `hub-<id>`), com CI própria a cada push. Cada um usa as tabelas que já
estavam no `notas.db` (migração `Base`), e as URLs antigas (`/api/notes`, `/api/folders`, `/notes`, `/p/nota`, `/api/tasks`,
`/tasks`, `/api/financas`, `/api/mcp/<ferramenta>`...) chegam por `rotasLegadas`. As tabelas e os dados ficaram no
banco; o núcleo não tem mais migrações (spec 037).
- Configuração própria de cada um em `data/plugins/env/<id>.env` (root, 600), como nas 033 e 034.
- Voltar uma ferramenta para o núcleo é reverter o PR que a removeu e comentar a linha do lock, nessa ordem de deploy.
- Conferir depois de cada troca: `cat data/plugins/estado.json`, `GET /<id>/health`, a tela em `/<id>/` e
  `select MigrationId from __EFMigrationsHistory_<id>` (só leitura).

**Esquema do núcleo sem migrações (037).** O núcleo não tem pasta `Migrations`: ao subir, `EsquemaNucleo.Garantir`
gera o esquema pelo modelo do `AppDbContext`, cria com `IF NOT EXISTS` as tabelas e os índices que faltam e acrescenta as
colunas novas do modelo. Não apaga nada, e o `__EFMigrationsHistory` antigo fica no banco sem uso.
- Coluna nova: só mudar a entidade. Coluna NOT NULL sem padrão entra com `''`, `0` ou `X''` nas linhas que já existem.
- Remover, renomear ou trocar o tipo de uma coluna não é automático: backup, SQL à mão no banco (com confirmação) e só
  depois o deploy do código.
- Os plug-ins guardam as próprias migrações nos repositórios deles (`__EFMigrationsHistory_<id>`).

## Migração futura para subdomínio + SSL via NPM

1. Criar registro DNS A de um subdomínio (ex.: `notas.vsitefy.com.br`) para `191.252.177.244`.
2. Remover a publicação de porta `8090:8080` do `docker-compose.vps.yml` (o container já está na rede `proxy`).
3. Criar um Proxy Host no NPM apontando para `notas-caddy:8080` e solicitar certificado Let's Encrypt.
4. `ufw delete allow 8090/tcp`.

## Instalador do Editor de Imagens pra Windows

Não faz parte do deploy da main: desde a spec 034 é o workflow **Desktop (Windows)** do
[hub-criativo](https://github.com/victorsouzadev/hub-criativo) (Actions › Run workflow), que precisa dos segredos
`VPS_HOST`, `VPS_USER` e `VPS_SSH_KEY` cadastrados naquele repositório. Ele grava o `Setup.exe` e o pacote de atualização em
`/opt/notas-vps/downloads/windows`, que o Caddy serve em `/downloads/windows/`
(volume `./downloads` no `docker-compose.yml`). O site mostra o botão "Baixar
para Windows" assim que existe um `versao.json` lá. Usa os mesmos segredos
`VPS_HOST`, `VPS_USER` e `VPS_SSH_KEY` do deploy. Detalhes no `desktop/README.md` do hub-criativo.
