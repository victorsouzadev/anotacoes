# Discovery — POC "Publicar": enviar arquivos e ganhar uma URL

> Status: **implementado** na branch `claude/poc-multi-app-hosting-bui7kl` e testado de ponta a ponta
> com Docker local (seção 12). Falta validar na VPS (etapa 1 do plano). As diferenças entre o
> desenho abaixo e o que foi feito estão na seção 12.

## 1. A ideia

Uma nova ferramenta no hub, **Publicar**. Eu arrasto os arquivos de um sistema
(front + back em C#), clico em **Publicar** e recebo uma URL pública, por exemplo
`http://meu-app.191-252-177-244.sslip.io:8090`, com o sistema no ar e o banco próprio dele.
Depois posso republicar, voltar para uma versão anterior, ver os logs e excluir.

## 2. Decisões tomadas

| # | Pergunta | Decisão | Consequência no desenho |
|---|---|---|---|
| Q1 | Quem publica? | **Só eu** | Só os e-mails em `PUBLICADORES` (`.env`) publicam. Os limites servem para proteger a VPS de **bugs**, não de um atacante. Não há cotas nem moderação |
| Q2 | O que se envia? | **Back + front** | Um pacote com `api/` (C#) e `web/` (estático), opcional |
| Q3 | Linguagem do back | **C#** (outras depois) | Runtime ASP.NET em container. Ver a seção 4 (sem build na VPS) |
| Q4 | Banco? | **Sim** | **SQLite por app**, em volume persistente que sobrevive a republicações |
| Q5 | Acesso | **Público** | Sem checagem de login no gateway. Cada app cuida da própria auth, se quiser |
| Q6 | URL | **sslip.io** | `http://<slug>.191-252-177-244.sslip.io:8090`. Sem DNS, sem domínio e sem HTTPS por enquanto |

## 3. Restrições da VPS que moldam a solução

- **1.9 GiB de RAM**, compartilhada com o notas, o convite-vps e o hermes. O `DEPLOY.md` já
  registra OOM durante `dotnet publish`. **Compilar C# na VPS está fora de questão.**
- Só IP, porta 8090 (80/443 são do NPM). Por isso a porta aparece na URL.
- O token do hub fica no `localStorage` do origin `IP:8090`. O subdomínio sslip.io é
  **outro origin**, então o JS publicado não alcança esse token.

## 4. Decisão central: enviar o `dotnet publish`, não o código-fonte

| Opção | Como | Veredito |
|---|---|---|
| Enviar o código (`.csproj`) e compilar na VPS | O Deployer roda `dotnet publish` num container SDK | ❌ SDK = ~800 MB de imagem + ~1 GB de RAM no build, e **OOM garantido** na VPS |
| Enviar o código e compilar no GitHub Actions | Push → Actions → imagem | ❌ Foge do "arrastar arquivos e publicar". Fica para uma fase futura |
| **Enviar a saída do `dotnet publish`** | Compilo na minha máquina e envio a pasta pronta. A VPS só **executa** | ✅ **Escolhida**: sem build, deploy em segundos, RAM só para rodar |

O container **não precisa de imagem própria**. Uso a imagem oficial
`mcr.microsoft.com/dotnet/aspnet:<versão>` (Debian, que já traz o ICU; a Alpine não traz,
ver `backend/Dockerfile`) e **monto a pasta publicada** como volume somente leitura.
A versão do runtime (8.0, 9.0, 10.0) sai do `*.runtimeconfig.json` do pacote.

## 5. Formato do pacote (contrato do app)

```
meu-app.zip
├── api/                        # saída de: dotnet publish -c Release -o api
│   ├── MeuApp.dll
│   ├── MeuApp.runtimeconfig.json   ← daqui saem a DLL de entrada e a versão do .NET
│   └── ...
├── web/                        # opcional: HTML/CSS/JS ou o dist/ de Angular/React
│   └── index.html
└── publicar.json               # opcional; se faltar, tudo é detectado
```

```jsonc
// publicar.json (todas as chaves são opcionais)
{
  "entrada": "MeuApp.dll",      // se houver mais de um runtimeconfig
  "health": "/api/health",      // o deploy só fica "No ar" quando isto responde 200
  "memoriaMb": 192
}
```

**O que o app C# precisa respeitar** (vai virar um README de exemplo):

1. Escutar na porta que vem em `ASPNETCORE_URLS` (a plataforma define `http://0.0.0.0:8080`).
2. Ler a conexão de `ConnectionStrings__Default` (a plataforma injeta
   `Data Source=/data/app.db`) e **gravar só em `/data`**. O resto do disco é somente leitura.
3. Aplicar as próprias migrations na subida (`db.Database.Migrate()`), como o notas já faz.
4. Rotas da API com o prefixo `/api` (fixo: é o que deixa o Caddy com uma regra só).

Casos cobertos pela detecção:

| Pacote | Roteamento |
|---|---|
| `api/` + `web/` | `/api/*` vai para o container, o resto é servido pelo Caddy (com fallback para `index.html`) |
| Só `api/` | Tudo vai para o container (o app pode servir o próprio `wwwroot`) |
| Só `web/` (ou ZIP sem pastas, com `index.html`) | Site estático, **sem container** |

## 6. Arquitetura

```
                 ┌──────────────────────── Caddy (:8080 → host :8090) ─────────────────────┐
navegador ──►    │ IP:8090                         → hub (SPA + /api do notas), como hoje │
                 │ <slug>.191-252-177-244.sslip.io → /api/* → reverse_proxy site-<slug>:8080│
                 │                                   resto  → file_server /sites/<slug>/web │
                 └─────────────────────────────────────────────────────────────────────────┘

Hub "Publicar" ──ZIP──► API notas ──► valida, extrai em /data/sites/<slug>/deploys/<id>/
                            │           grava Site/Deployment no SQLite
                            └──HTTP interno (token)──► Deployer ──► Docker
                                                         (único serviço com docker.sock)
```

### 6.1 Disco

```
/opt/notas-vps/data/sites/<slug>/
├── deploys/<deployId>/api/   ← pacote extraído (imutável)
├── deploys/<deployId>/web/
├── current -> deploys/<deployId>   ← troca atômica (rollback = mudar o link)
└── data/                     ← SQLite do app; montado em /data; NUNCA apagado no republicar
```

### 6.2 Caddy: um bloco fixo atende qualquer slug

```caddyfile
*.191-252-177-244.sslip.io:8080 {
    # labels contam da direita: io(0) sslip(1) 191-252-177-244(2) slug(3)
    @api path /api/*
    handle @api {
        reverse_proxy site-{http.request.host.labels.3}:8080
    }
    handle {
        root * /srv-sites/{http.request.host.labels.3}/current/web
        try_files {path} /index.html
        file_server
    }
}
```

O caso "só `api/`" precisa de um matcher a mais (existe `web/`? se não, tudo vai para o
proxy). Será resolvido com `file` matcher. **A etapa 1 existe para validar que o
upstream com placeholder funciona na nossa versão do Caddy**.

### 6.3 Container de cada app (criado pelo Deployer)

```
docker run -d --name site-<slug> --network sites --restart unless-stopped \
  --memory 192m --cpus 0.5 --pids-limit 200 \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --user 1000 \
  -v /opt/notas-vps/data/sites/<slug>/current/api:/app:ro \
  -v /opt/notas-vps/data/sites/<slug>/data:/data \
  -e ASPNETCORE_URLS=http://0.0.0.0:8080 \
  -e ConnectionStrings__Default="Data Source=/data/app.db" \
  -e DOTNET_GCHeapHardLimit=0x8000000 -e DOTNET_gcServer=0 \
  -e <variáveis do usuário> \
  mcr.microsoft.com/dotnet/aspnet:9.0 dotnet /app/MeuApp.dll
```

- Rede `sites` **separada** da rede do notas. O container não enxerga a API nem o banco dele.
  O Caddy participa das duas redes.
- `--restart unless-stopped` mantém os apps de pé depois de um reboot da VPS.
- Limites de GC + `--memory` para caber vários apps. Meta: **~60–100 MB por app ocioso**,
  a ser medida na etapa 5.

### 6.4 Fluxo de publicação

1. Upload do ZIP → validação (zip-slip, links simbólicos, tamanho descompactado,
   presença de `api/` ou `web/`) → extração em `deploys/<id>/`. Status **Enviado**.
2. Se não há `api/`, troca o `current` → **No ar**. Fim (≈ 1 s).
3. Se há `api/`: o API chama o Deployer (`POST /deploy {slug, deployId}`). O Deployer:
   para e remove `site-<slug>`, troca `current`, sobe o novo container e faz polling
   no `health` por até 30 s.
4. Deu 200 → **No ar**. Senão → **Falhou**: guarda o `docker logs`, **volta o `current` para
   a versão anterior** e sobe a versão antiga de novo.

Há alguns segundos de indisponibilidade a cada deploy, o que é aceitável para a POC.
Zero downtime (subir o novo ao lado, depois trocar) fica para uma fase futura.

### 6.5 Banco: SQLite por app

- Arquivo em `data/sites/<slug>/data/app.db`, **compartilhado entre versões**.
- ⚠️ **Rollback volta o código, não o schema.** Se a v3 aplicou uma migration, a v2
  restaurada roda com o schema da v3. Mitigação na POC: o Deployer faz uma **cópia do `app.db`
  antes de cada deploy** (`sqlite3 .backup`) e o rollback oferece "restaurar também o banco".
- O `scripts/backup.sh` passa a incluir `data/sites/*/data/*.db`.
- Postgres compartilhado (um banco por app) fica como alternativa futura. Custa
  ~100 MB de RAM fixos, por isso não entra agora.

### 6.6 Variáveis de ambiente / segredos por app

A tela do site tem uma seção "Variáveis" (chave/valor). Os valores são guardados cifrados com o
`IProtetorDeSegredos` que já existe (`Services/Seguranca`) e injetados como `-e` pelo Deployer.
Mudar uma variável reinicia o container, sem novo upload.

## 7. Modelo de dados e API (no notas)

```
Site        { Id, OwnerUserId, Slug (único), Nome, CurrentDeploymentId, CriadoEm }
Deployment  { Id, SiteId, Versao, Tipo: Estatico|DotNet, RuntimeVersao, Entrada,
              Status: Enviado|Iniciando|NoAr|Falhou|Substituido,
              TamanhoBytes, Log, CriadoEm, TerminadoEm }
SiteVariavel{ Id, SiteId, Chave, ValorCifrado }
```

| Rota (`Endpoints/SitesEndpoints.cs`, exige e-mail em `PUBLICADORES`) | O que faz |
|---|---|
| `GET /api/sites` | Lista sites com URL, status e versão atual |
| `POST /api/sites` `{nome, slug}` | Cria o site (slug `^[a-z0-9-]{3,30}$`, fora da lista de reservados) |
| `POST /api/sites/{id}/deployments` (multipart) | Envia o ZIP e publica. Limite próprio (ex.: 100 MB), fora dos 10 MB globais |
| `GET /api/sites/{id}/deployments` | Histórico, status e log |
| `POST /api/sites/{id}/deployments/{dep}/ativar` | Rollback (com opção de restaurar o banco) |
| `GET /api/sites/{id}/logs?tail=200` | `docker logs` do app no ar (via Deployer) |
| `PUT /api/sites/{id}/variaveis` | Salva as variáveis e reinicia |
| `POST /api/sites/{id}/reiniciar` · `/parar` | Controle do container |
| `DELETE /api/sites/{id}` | Remove container, arquivos e registros (pede confirmação digitando o slug) |

**Deployer**: um serviço novo no compose (`deployer/`, Minimal API .NET, ~100 linhas)
usando `Docker.DotNet`. Ele só escuta na rede interna e aceita apenas o token compartilhado
(`DEPLOYER_TOKEN` no `.env`). É o **único** com `docker.sock`. Mesmo publicando só eu, isso
evita que uma falha na API exposta à internet vire acesso root à VPS.

**Front**: `features/publicar/` com lista de sites, criação, dropzone (ZIP ou pasta
via `webkitdirectory` + compactação no navegador), status por polling, versões, logs,
variáveis e botão copiar URL. Mais um card no hub (visível só para quem está em `PUBLICADORES`).

## 8. Segurança (escopo "só eu")

| Risco | Mitigação |
|---|---|
| JS publicado lê o token do hub | Origin diferente (subdomínio sslip.io) |
| Zip-slip / links simbólicos / caminhos absolutos | Normalizar cada entrada; recusar quem sai do destino |
| Zip bomb | ZIP ≤ 100 MB, descompactado ≤ 300 MB, ≤ 10 000 arquivos |
| API comprometida → controla o Docker | `docker.sock` só no Deployer, com token e apenas na rede interna |
| Bug num app derruba a VPS | `--memory`, `--cpus`, `--pids-limit`, limite de GC. Máximo de **5 apps .NET rodando** |
| App acessa o notas | Rede `sites` isolada, disco somente leitura exceto `/data` |
| Slugs perigosos | Reservados: `www`, `api`, `admin`, `hub`, `notas`, `mail`… |

## 9. Critérios de sucesso da POC

- [ ] Publico um **app Angular + API C# + SQLite** (exemplo CRUD de "recados") e ele fica
      acessível em `http://recados.191-252-177-244.sslip.io:8090` em **< 20 s**.
- [ ] Os dados gravados continuam lá depois de republicar a v2.
- [ ] Uma v3 quebrada (health falha) **não derruba** o site: volta sozinha para a v2, com o log visível.
- [ ] Rollback manual para v1 em um clique.
- [ ] Um site só estático publica em ~1 s, sem container.
- [ ] Um app que tenta alocar 1 GB é morto pelo limite, e o hub segue no ar.
- [ ] Reiniciar a VPS → todos os apps voltam sozinhos.
- [ ] RAM medida por app ocioso e registrada aqui: ____ MB.

## 10. Plano de implementação

| Etapa | Entrega | Valida |
|---|---|---|
| 1 | Caddy com o bloco curinga + pasta `sites/` montada + um estático e um container .NET subidos **à mão** | sslip.io + porta 8090 + upstream dinâmico funcionam na VPS |
| 2 | Modelo `Site`/`Deployment` + upload com extração segura + troca atômica (**só estático**) | Publicação estática ponta a ponta via API, com testes de zip-slip/bomb |
| 3 | Tela "Publicar" no hub (criar, enviar, status, URL, versões) | UX da fase estática completa |
| 4 | Deployer + detecção do `runtimeconfig` + container .NET + health + rollback automático + logs | Back C# no ar |
| 5 | Banco (volume, backup antes do deploy, `backup.sh`) + variáveis cifradas | Persistência e configuração |
| 6 | App de exemplo "recados" + testes dos critérios da seção 9 + medição de RAM | POC aprovada ou não |

## 11. Fora da POC (registro)

HTTPS e domínio próprio, deploy pelo GitHub (build no Actions), outras linguagens (Node,
Python), `Dockerfile` do usuário, zero-downtime, desligar app ocioso,
Postgres gerenciado, vários usuários publicando (exigiria cotas, sandbox mais forte e moderação).

## 12. Resultado da implementação

### Onde está cada peça

| Peça | Arquivos |
|---|---|
| API | `backend/Notas.Api/Endpoints/SitesEndpoints.cs`, `Services/Sites/*` (extrator do ZIP, disco, fila/executor, cliente do Deployer), `Data/SitesModels.cs`, migration `AddSites` |
| Deployer | `deployer/Notas.Deployer` (Minimal API que chama o `docker` CLI com `ArgumentList`, sem shell) |
| Caddy | bloco `http://*.{$SITES_DOMINIO}:8080` em `caddy/Caddyfile.local` |
| Compose | serviço `deployer` (profile `publicar`), rede `notas-sites`, volumes `data/sites` |
| Front | `frontend/src/app/features/publicar/` + card no hub (só para publicadores) |
| Exemplo | `exemplos/publicar/recados` (front + API C# + SQLite, com `empacotar.sh`/`.ps1`) |
| Testes | `SitesTests.cs` (26: extração segura, versões, rollback, banco, variáveis, permissões), `deployer/Notas.Deployer.Tests` (10), `pacote.spec.ts` (front) |

### Diferenças em relação ao desenho

- **Quem publica**: em vez de uma coluna `User.PodePublicar` (sem tela para mudar), é uma lista de
  e-mails em `PUBLICADORES`. Não precisa de migration nem de tela de admin.
- **`rotaApi` removido**: o prefixo é sempre `/api`. Com prefixo por app, o Caddy precisaria de
  configuração dinâmica. Fixo, um bloco estático atende todos os sites.
- **Health sem `publicar.json`**: basta o app responder qualquer coisa que não seja 502/503/504 em
  `/api/` (com front) ou `/` (só API). Com `health` configurado, exige 2xx.
- **Falha no deploy também restaura o banco**: se a versão nova não sobe, o `app.db` volta à cópia
  feita antes dela (ela pode ter rodado migrations), e só depois a versão anterior sobe de novo.
- **Troca do link `current`** usa `rename(2)` direto. O `File.Move` do .NET recusa um link que aponta
  para uma pasta.
- **Sem Deployer configurado** (sem `DEPLOYER_TOKEN`), sites estáticos continuam funcionando.

### Critérios de sucesso (teste local: Docker 29, `aspnet:9.0`, Caddy 2.10)

- [x] App Recados (front + API C# + SQLite) publicado e respondendo pelo Caddy em **1.7 s** (meta: < 20 s).
- [x] Os dados gravados continuaram lá depois de republicar (v2, v4) e depois de voltar para a v1.
- [x] Uma v3 com DLL corrompida falhou no health check. O log do container (`BadImageFormatException`)
      apareceu na versão, o banco voltou e a v2 subiu sozinha. O site não ficou fora do ar.
- [x] Voltar para a v1 em um clique (`/ativar`).
- [x] Site só estático publicado em ~1 s, sem container.
- [x] Um app que tenta alocar 1 GB bate no limite: o .NET respeita o cgroup (192 MB), a requisição
      dá 500, o container para em ~160 MiB e o hub segue no ar.
- [x] Parar deixa o site com "Este app não está no ar agora" (502). Iniciar volta com os dados.
- [x] Variável de ambiente salva, reinicia o container e chega ao app.
- [x] Deployer em container (imagem do `deployer/Dockerfile`) falando com o daemon pelo socket.
- [ ] Reiniciar a VPS e ver os apps voltarem (`--restart unless-stopped`): falta testar na VPS.
- [x] RAM do Recados ocioso: **~21 MiB** (limite 128 MB).
- [x] Tamanho do pacote: com `-r linux-x64` o Recados tem 773 KB. Sem ele, 14,7 MB (bibliotecas
      nativas do SQLite para todas as plataformas).

## 13. Postgres por site

Pedido depois da POC: um Postgres em Docker em que **cada app tem o próprio banco**, com
usuário e senha criados pela plataforma e entregues ao sistema publicado.

| Decisão | Por quê |
|---|---|
| **Um Postgres 17 compartilhado** (`postgres`, profile `publicar`), não um por app | Um por app custaria ~50 MiB cada. Compartilhado, são ~54 MiB no total, com `shared_buffers=32MB`, `max_connections=60` e `mem_limit` de 256 MB |
| **Banco e usuário `site_<slug>`**, senha de 64 hex gerada pela API | O nome é previsível e válido sem aspas. A senha é forte e sem nada que precise de escape |
| Usuário `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`, dono só do próprio banco, `CONNECTION LIMIT 10` | `REVOKE CONNECT ... FROM PUBLIC` no banco dele, no `postgres` e no `template1`: um app não entra no banco de outro |
| Postgres nas redes `default` (a API cria bancos) e `notas-sites` (os apps conectam em `postgres:5432`) | A API continua fora da rede dos apps. Os apps não alcançam a API |
| Senha **cifrada** no SQLite do notas (`IProtetorDeSegredos`) | Mesmo cuidado das variáveis |
| Entregue ao app como `ConnectionStrings__Postgres` + `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` | Serve para EF Core/Npgsql e para qualquer ferramenta libpq. São reservadas: o usuário não sobrescreve pelas variáveis |
| Opcional por site (caixa ao criar o site ou botão "Criar banco"), idempotente | Site estático não precisa de banco |
| "Trocar senha" faz `ALTER ROLE` e reinicia o app com a nova; "Apagar banco" e excluir o site fazem `DROP DATABASE ... WITH (FORCE)` + `DROP ROLE` | Senha vazada se resolve em um clique |
| Porta só em `127.0.0.1:5433` na VPS | Acesso por túnel SSH para DBeaver; nada exposto |
| Backup diário por banco (`pg_dump -Fc`) no `backup.sh` | Mesmo cron do SQLite |

**Limite conhecido:** a restauração de banco no rollback (automática ou "+ banco") cobre só o
SQLite. No Postgres, as migrations precisam ser compatíveis com a versão anterior, ou é preciso
restaurar o dump. Próximo passo possível: `pg_dump` pelo Deployer antes de cada deploy.

**Testes:**
- `PostgresRealTests` rodam contra um Postgres real (no CI, via `services:`): isolamento entre
  sites, sem acesso ao `postgres`, sem superusuário, troca de senha invalida a antiga, remoção limpa tudo.
- Em `SitesTests`: criação, entrega das variáveis, troca de senha com reinício, remoção e exclusão do site.

**Teste de ponta a ponta local:**
- O Recados publicado num site com Postgres gravou em `site_recados`.
- Com a senha do `site_outro`, de dentro da rede dos apps, a conexão ao `site_recados` e ao
  `postgres` deu "User does not have CONNECT privilege".
- A troca de senha manteve o app no ar com os dados.
- Excluir o site `outro` removeu o banco e o usuário.
