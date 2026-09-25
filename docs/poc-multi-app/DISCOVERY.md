# Discovery — POC "Publicar": enviar arquivos e ganhar uma URL

> Status: **rascunho para decisão**. Nada aqui está implementado.
> As perguntas da seção 3 mudam o escopo, por isso vêm antes de qualquer código.

## 1. A ideia, em uma frase

Uma nova ferramenta no hub, **Publicar**. O usuário arrasta os arquivos de um sistema
(front, e talvez back), clica em **Publicar** e recebe uma URL, por exemplo
`http://meu-app.<host>`, onde o sistema fica no ar. Depois ele pode republicar
(nova versão), ver o status e os logs, voltar para uma versão anterior e remover.

É um "mini Netlify/Vercel/Heroku" dentro do `notas-vps`.

## 2. Ponto de partida e restrições reais

| Item | Hoje | Impacto na POC |
|---|---|---|
| Entrada HTTP | Caddy na porta 8090, **só IP, sem domínio e sem HTTPS**. As portas 80/443 são do NPM (convite-vps) | Não há subdomínio próprio. Ver a seção 5.3 (URL) |
| Máquina | VPS com **1.9 GiB de RAM**, que já sofre OOM no build (`DEPLOY.md`), dividida com o convite-vps e o hermes | Build e execução de apps de usuário precisam de limites rígidos |
| Auth | JWT no `localStorage` do origin `:8090` | **Um site publicado não pode rodar no mesmo origin do hub**. Senão, o JS dele lê o token de quem abrir o link |
| Dados | SQLite único, uploads limitados a 10 MB (`Kestrel:MaxBodyBytes`) | O upload de sites precisa de um limite próprio e de armazenamento fora do banco |
| Infra | `docker compose` com `api` e `caddy` | O deploy de apps de usuário exige a API controlar o Docker, e isso é o ponto mais sensível |

## 3. Perguntas que definem o escopo (preciso das respostas)

| # | Pergunta | Por que muda tudo |
|---|---|---|
| **Q1** | **Quem pode publicar?** Só você, ou qualquer usuário cadastrado? | Qualquer usuário = **código de terceiros rodando na sua VPS**. Exige isolamento, cotas e moderação (phishing, mineração). Só você = dá para ser bem mais simples |
| **Q2** | **O que é "os arquivos"?** (a) site estático pronto (HTML/CSS/JS, `dist/` de Angular ou React); (b) código com backend (Node, .NET, Python…); (c) qualquer coisa com `Dockerfile` | (a) é barato e seguro. (b) e (c) são outra ordem de complexidade: build, container, porta, logs, RAM |
| **Q3** | Se tiver backend, **quais linguagens** entram na POC? | Cada runtime é um template de build. Sugestão: começar só com Node |
| **Q4** | O app publicado **precisa de banco/persistência**? | Se sim: um volume por app (SQLite/arquivo). Postgres por app está fora da POC |
| **Q5** | A URL é **pública** (qualquer um acessa) ou **só para usuários logados**? | Privada exige checar login no gateway (`forward_auth`) |
| **Q6** | Você tem (ou topa ter) um **domínio**? Na POC, aceita um domínio "coringa" gratuito tipo `sslip.io`? | Define o formato da URL (seção 5.3) |
| **Q7** | Como o usuário envia os arquivos: **ZIP**, **pasta arrastada**, ou também **link do GitHub**? | ZIP e pasta cabem na POC. GitHub fica para depois |
| **Q8** | Roda **na mesma VPS**? Quantos apps no ar ao mesmo tempo você imagina? | Com 1.9 GiB, cabem poucos backends simultâneos. Talvez seja preciso desligar o app ocioso |

## 4. Fluxo do usuário (proposto)

```
Hub ─► "Publicar" ─► [Novo site] nome: meu-app  (vira o slug da URL)
                      ├─ arrasta pasta/ZIP  ─► validação no navegador (tamanho, index.html)
                      └─ [Publicar] ─► upload ─► status: Enviado → (Build) → No ar ✅
                                                              └─► Falhou ❌ + logs
                    URL: http://meu-app.<host>   [Copiar] [Abrir]
                    Versões: v3 (atual) · v2 [Restaurar] · v1   [Excluir site]
```

## 5. Arquitetura proposta

### 5.1 Visão geral

```
                      ┌──────────────── Caddy ─────────────────────────────────────┐
navegador ──────────► │ host = IP/hub          → SPA + /api (como hoje)            │
                      │ host = <slug>.<sites>  → estático? file_server /sites/<slug>│
                      │                          backend?  reverse_proxy site-<slug>│
                      └────────────────────────────────────────────────────────────┘
 Hub (Angular) ── POST /api/sites/{id}/deployments (ZIP) ──► API (.NET)
                                                              │ grava em /data/sites/<slug>/<deployId>/
                                                              │ registra Deployment (status, logs)
                                                              └─► fila ──► Deployer (worker isolado,
                                                                           único com acesso ao Docker)
                                                                           build + run do container
```

### 5.2 Dois modos de publicação, em fases

**Fase 1: site estático (entra na POC).**
- Upload do ZIP, extraído em `/data/sites/<slug>/<deployId>/`.
- Troca **atômica** do link `current`, apontando para o novo deploy. Isso dá rollback de graça.
- O Caddy serve direto, sem container, sem build e sem RAM extra. Tem fallback para
  `index.html` (SPA).
- Com **um único bloco fixo no Caddyfile**, qualquer slug funciona sem recarregar o Caddy:
  ```caddyfile
  # <slug>.191-252-177-244.sslip.io  → labels.3 = slug
  *.191-252-177-244.sslip.io:8080 {
      root * /srv-sites/{http.request.host.labels.3}/current
      try_files {path} /index.html
      file_server
  }
  ```

**Fase 2: app com backend (POC estendida, só Node no início).**
- Convenção: o app escuta em `PORT` e tem `package.json` com `start`. **Sem
  Dockerfile do usuário**. O Deployer gera um Dockerfile a partir de um template fixo.
- O container `site-<slug>` roda numa rede Docker `sites` **separada** da rede
  do `api`. O Caddy entra nessa rede e usa upstream dinâmico:
  `reverse_proxy site-{http.request.host.labels.3}:3000`.
- Limites por container: `--memory=128m --cpus=0.25 --pids-limit=100 --read-only
  --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges --user 1000`.
- Opcional: volume `/data` por app (resposta de Q4). Desligar o app após N minutos
  sem acesso fica para depois da POC.

**Fase 3 (fora da POC):** outros runtimes (.NET, Python), `Dockerfile` do usuário,
deploy via GitHub, domínio customizado com HTTPS.

### 5.3 Formato da URL

| Opção | Exemplo | Prós | Contras |
|---|---|---|---|
| **Subdomínio com sslip.io** (recomendado na POC) | `http://meu-app.191-252-177-244.sslip.io:8090` | Grátis, sem configurar DNS. **Origin separado** do hub (protege o token). Apps usam caminhos absolutos normalmente | URL feia. Sem HTTPS enquanto estiver na porta 8090 |
| Subdomínio de domínio próprio | `https://meu-app.apps.seudominio.com` | Bonita. HTTPS com certificado wildcard ou `on_demand_tls` do Caddy | Precisa de domínio + DNS wildcard + mexer no NPM (80/443) |
| Caminho | `http://IP:8090/s/meu-app/` | Zero infra | **Mesmo origin do hub**: o JS publicado lê o token do `localStorage`. Apps quebram com caminhos absolutos (`/main.js`). **Descartado** |
| Porta por app | `http://IP:9001` | Origin separado | Precisa abrir uma porta por app no firewall. Não escala |

### 5.4 Modelo de dados (novo, no SQLite atual)

```
Site        { Id, OwnerUserId, Slug (único), Nome, Tipo: Estatico|Node, CurrentDeploymentId,
              CriadoEm, Publico: bool }
Deployment  { Id, SiteId, Versao, Status: Enviado|Construindo|NoAr|Falhou|Substituido,
              TamanhoBytes, Log (texto), CriadoEm, TerminadoEm }
```

### 5.5 API (nova, `Endpoints/SitesEndpoints.cs`)

| Rota | O que faz |
|---|---|
| `GET /api/sites` | Lista os sites do usuário, com URL e status |
| `POST /api/sites` `{ nome, slug }` | Cria o site e valida o slug (`^[a-z0-9-]{3,30}$`, lista de reservados) |
| `POST /api/sites/{id}/deployments` (multipart ZIP) | Envia uma versão e dispara a publicação |
| `GET /api/sites/{id}/deployments` | Histórico, status e log |
| `POST /api/sites/{id}/deployments/{depId}/ativar` | Rollback |
| `DELETE /api/sites/{id}` | Remove arquivos, container e registro |

Front: `features/publicar/` com lista de sites, dropzone (`<input webkitdirectory>` +
compactação no navegador ou ZIP direto), status por polling e log.

## 6. Segurança (o ponto mais crítico)

Publicar arquivos de usuário é, no fundo, **hospedar conteúdo e código de terceiros**.

| Risco | Mitigação na POC |
|---|---|
| Site publicado rouba o token do hub | Origin **diferente** (subdomínio), nunca caminho no mesmo host |
| Zip-slip (`../../etc/passwd` dentro do ZIP) | Normalizar cada entrada e recusar caminhos fora do destino, links simbólicos e caminhos absolutos |
| Zip bomb | Limite do ZIP (ex.: 50 MB), **limite descompactado** (ex.: 200 MB) e limite de arquivos (ex.: 5 000) |
| API com acesso ao Docker = root no host se for comprometida | **Não** montar `docker.sock` na API. Um **Deployer** separado lê a fila e só executa templates fixos |
| Backend do usuário acessa a API ou o banco do notas | Rede Docker `sites` separada. O container não enxerga `api` |
| Um app consome a VPS inteira | `--memory`, `--cpus`, `--pids-limit`, limite de apps por usuário e de apps rodando ao mesmo tempo |
| Abuso (phishing, malware, mineração) | Na POC, **só usuários autorizados publicam** (flag no `User`). Remoção manual |
| Slug sequestra nomes (`api`, `www`, `admin`) | Lista de slugs reservados |

## 7. Construir ou usar pronto?

Existem PaaS self-hosted que já fazem "enviar e ganhar URL": **Coolify**, **CapRover**, **Dokku**.

- **Usar um deles:** menos código, mais maduro. Mas cada um consome RAM própria (o Coolify
  sozinho quer mais de 2 GB, não cabe), traz outra interface e disputa as portas 80/443 com o NPM.
- **Construir (recomendado para a POC):** a fase 1 (estático) é pouco código e cabe
  na stack atual. A fase 2 é onde construir fica caro. Se a POC provar valor e o
  backend for essencial, reavaliar o **Dokku** (leve) como motor por trás da
  mesma interface.

## 8. Escopo da POC e critérios de sucesso

**Dentro:** fase 1 completa (estático) + fase 2 só com Node, só para usuários autorizados,
URL via sslip.io, versões e rollback.
**Fora:** HTTPS, domínio customizado, GitHub, outros runtimes, desligar app ocioso,
cobrança/cotas por plano, banco gerenciado.

- [ ] Enviar o `dist/` de um app Angular/React → URL no ar em **menos de 10 s**, com as rotas da SPA funcionando.
- [ ] Republicar troca a versão sem downtime. Rollback para v1 em um clique.
- [ ] Um ZIP com `../` ou maior que o limite é recusado com mensagem clara.
- [ ] O JS do site publicado **não** consegue ler o token do hub (origin diferente, verificado no devtools).
- [ ] App Node (`express` + `PORT`) publicado responde na URL. O log do build aparece na tela.
- [ ] Um app Node que tenta alocar 1 GB é morto pelo limite, e o hub continua no ar.
- [ ] RAM medida: estático ≈ 0, Node ≈ ? MB por app (registrar aqui).

## 9. Plano sugerido

| Etapa | Entrega | Responde |
|---|---|---|
| 0 | Respostas Q1–Q8 | Escopo fechado |
| 1 | Bloco curinga no Caddy + pasta montada + um site copiado à mão | O roteamento por subdomínio sslip.io funciona na VPS/porta 8090? |
| 2 | `Site`/`Deployment` + endpoint de upload com extração segura + troca atômica | Publicação estática ponta a ponta via API |
| 3 | Tela "Publicar" no hub (dropzone, status, URL, versões) | UX completa da fase 1 |
| 4 | Deployer + template Node + rede `sites` + limites | Backend de usuário isolado |
| 5 | Testes de segurança e RAM (seção 8) + relatório | Seguir, ajustar ou migrar para Dokku |
