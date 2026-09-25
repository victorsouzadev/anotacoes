# Discovery — POC: hospedar vários apps (back + front) numa aplicação só

> Status: **rascunho para decisão**. Nada aqui está implementado. As perguntas
> abertas (seção 3) mudam a recomendação. Responda a elas antes de começar a POC.

## 1. Ponto de partida (como é hoje)

O `notas-vps` já hospeda várias ferramentas, mas como um **monólito modular**:

| Camada | Hoje | Onde |
|---|---|---|
| Entrada | Um Caddy: `/api/*` vai para a API, o resto vai para a SPA | `caddy/Caddyfile*` |
| Front | **Uma** SPA Angular 21, cada ferramenta é uma rota lazy | `frontend/src/app/app.routes.ts` |
| Catálogo | Lista `TOOLS` **fixa no código** do hub | `features/hub/hub.page.ts` |
| Back | **Uma** API .NET, um `Endpoints/*.cs` por ferramenta | `backend/Notas.Api/NotasApp.cs` |
| Dados | **Um** SQLite, um `AppDbContext` com as tabelas de todas as ferramentas | `Data/` |
| Auth | JWT **HS256** com segredo único (`JWT_SECRET`), token no `localStorage` | `Auth/TokenService.cs`, `core/auth.service.ts` |
| Infra | VPS com **1.9 GiB de RAM**, divide espaço com o convite-vps (NPM em 80/443) e o hermes | `DEPLOY.md` |

**Custo atual de uma nova ferramenta:** mexer em 4 lugares (rota, card no hub,
endpoint, DbContext/migration), usar obrigatoriamente Angular + .NET, e fazer
**um deploy de tudo**. Se uma ferramenta quebra o build, as outras também não sobem.

## 2. Hipótese da POC

> "Consigo plugar um app **novo e independente** (front + back próprios, talvez
> em outra stack) na plataforma, com login único, aparecendo no hub, **sem
> alterar nem redeployar** o código da plataforma, só registrando o app."

Para validar isso, a POC precisa responder três coisas:

1. **Composição de front:** como a UI de um app aparece dentro da "casca" (shell)?
2. **Roteamento de back:** como `/apps/<id>/api/*` chega ao backend daquele app?
3. **Identidade:** como o app sabe quem é o usuário sem receber o segredo do JWT?

## 3. Perguntas abertas (preciso das suas respostas)

| # | Pergunta | Por que importa |
|---|---|---|
| Q1 | **Quem escreve os apps?** Só você, ou terceiros/outras pessoas? | Terceiros exigem isolamento forte (iframe, sandbox, sem acesso ao token). Só você permite integração mais "colada". |
| Q2 | **Stack livre ou só Angular + .NET?** | Stack livre descarta plugins .NET carregados em processo e Module Federation "puro". |
| Q3 | **Os apps atuais (Notas, Finanças, Tarefas...) migram**, ou a POC é só para apps novos? | Migrar muda o esforço e o risco. A POC deveria tocar **um** app existente, no máximo. |
| Q4 | **Deploy independente por app** é requisito? | Se não for, o monólito modular organizado resolve e é bem mais barato. |
| Q5 | **Onde roda?** Na mesma VPS de 1.9 GiB? | Cada container .NET custa ~80–150 MB. 5 apps = RAM estourada. |
| Q6 | **Dados:** cada app tem seu banco, ou compartilham? Um app lê dado de outro? | Define se precisamos de uma API entre apps ou só de isolamento. |
| Q7 | **UX:** o app precisa parecer nativo (mesmo tema, header, navegação), ou pode "abrir numa janela"? | Um iframe resolve o segundo caso quase de graça. |
| Q8 | **Multiusuário/permissões:** todo usuário vê todo app, ou tem "instalar app" por usuário? | Define se o catálogo é global ou por usuário. |
| Q9 | Qual é o **objetivo final**: um produto (app store pessoal), aprendizado de arquitetura, ou resolver dor de deploy? | Muda o critério de sucesso. |

## 4. Opções de arquitetura

### Opção A — Monólito modular com contrato de módulo (evolução do atual)

Formaliza o que já existe: cada ferramenta vira um módulo com um `IAppModule`
(.NET: `RegisterServices`, `MapEndpoints`, `DbContext` próprio) e um
`manifest.ts` no front (rotas + card). O hub lê o catálogo dos manifests em
vez de uma lista fixa.

- ✅ Barato, sem infra nova, sem RAM extra, zero risco de UX.
- ❌ Continua um deploy único e uma stack só. **Não valida a hipótese** da seção 2.

### Opção B — Shell + gateway + apps em containers (recomendada para a POC)

```
                 ┌──────────────── Caddy (gateway) ────────────────┐
navegador ──►    │ /                → shell (SPA Angular: login, hub)│
                 │ /api/*           → plataforma (auth, catálogo)    │
                 │ /apps/<id>/*     → front do app <id>  ┐ forward_auth
                 │ /apps/<id>/api/* → back do app <id>   ┘ → /api/auth/verify
                 └──────────────────────────────────────────────────┘
```

- **Registro:** um `apps.json` (ou tabela `Apps`) com `id`, nome, ícone,
  `frontendUrl`, `backendUpstream`, modo de integração. O hub passa a ler
  `GET /api/apps`.
- **Back:** cada app é um container próprio, em qualquer stack. O Caddy usa
  `forward_auth` para validar o token na plataforma e injetar `X-User-Id` e
  `X-User-Email`. **O app nunca vê o `JWT_SECRET`** e não implementa login.
- **Front**, em 3 níveis de integração (a POC testa pelo menos 2):
  1. **iframe** (`/apps/<id>/`): isolamento total, qualquer stack. O token vai por
     `postMessage` ou cookie. UX de "janela".
  2. **Web Component** (`<app-<id>>` via `@angular/elements`, Lit, etc.): o shell
     carrega um `.js` remoto. Visual mais nativo, isolamento médio (Shadow DOM).
  3. **Native Federation** (`@angular-architects/native-federation`, compatível
     com o builder esbuild do Angular 21): compartilha Angular/RxJS, fica igual a
     uma rota lazy. Só funciona com Angular e as versões precisam andar juntas.
- ✅ Valida a hipótese: deploy e stack independentes, login único.
- ❌ Mais peças (gateway, catálogo, contrato), RAM por container e um novo caminho
  de CORS/cookie/token para acertar.

### Opção C — Plugins carregados em runtime (processo único)

A API carrega DLLs de `plugins/` via `AssemblyLoadContext`, e o shell carrega
bundles JS remotos. "Instalar" um app = copiar a pasta.

- ✅ Um processo só, economiza RAM, parece uma app store.
- ❌ Só .NET no back. Plugin ruim derruba tudo. Versionamento de dependências
  compartilhadas é doloroso. Não há isolamento de segurança. Complexidade alta para uma POC.

### Comparativo

| Critério | A. Modular | B. Shell + gateway | C. Plugins runtime |
|---|---|---|---|
| Deploy independente | ❌ | ✅ | ~ (sem restart, com risco) |
| Stack livre | ❌ | ✅ | ❌ |
| Isolamento de falha | ❌ | ✅ | ❌ |
| RAM na VPS | ✅ | ~ (1 container por app) | ✅ |
| UX nativa | ✅ | ~ (depende do nível 1/2/3) | ✅ |
| Esforço da POC | baixo | **médio** | alto |
| Valida a hipótese | não | **sim** | parcialmente |

## 5. Recomendação e escopo da POC

**Opção B**, mínima, **ao lado** do sistema atual (sem migrar nada de início):

1. **Catálogo:** `GET /api/apps` lê um `apps.json`, e o hub junta os cards fixos com os
   cards do catálogo.
2. **Verificação de identidade:** `GET /api/auth/verify` na API atual, que responde 200
   com os cabeçalhos `X-User-Id` e `X-User-Email`, ou 401. O Caddy usa com `forward_auth`.
3. **App de exemplo 1 — "hello-node"** (Node/Express + HTML puro): integração
   **iframe**, com um endpoint `GET /apps/hello-node/api/me` que devolve o usuário
   vindo do header. Prova stack livre e isolamento.
4. **App de exemplo 2 — "hello-ng"** (Angular + Minimal API .NET): integração
   **Web Component** ou **Native Federation**, renderizado dentro do layout do
   shell. Prova a UX nativa.
5. **Compose:** `docker-compose.poc.yml` com os dois apps e o Caddyfile com
   rotas geradas a partir do `apps.json`. No início, escrito à mão.

**Fora da POC:** migrar ferramentas existentes, "loja" com instalação por usuário,
permissões por app, HTTPS, CI por app, banco compartilhado entre apps.

### Critérios de sucesso (mensuráveis)

- [ ] Adicionar um 3º app = subir um container + uma entrada no `apps.json` +
      reload do Caddy. **Nenhuma linha** mudada no shell ou na API.
- [ ] Login uma vez no shell, e os dois apps mostram o e-mail do usuário.
- [ ] Derrubar o container de um app não afeta o hub nem os outros apps. O card
      mostra "indisponível".
- [ ] Um app **não consegue** forjar identidade: uma chamada direta sem token
      ao `/apps/x/api` retorna 401.
- [ ] Custo de RAM medido por app (`docker stats`) e registrado aqui.
- [ ] Nota de UX: iframe vs Web Component/Federation, com prós e contras observados.

### Riscos e pontos de atenção

- **Token no `localStorage`:** com front de terceiros no mesmo origin, qualquer
  app lê o token. Para iframe, usar outro origin ou `sandbox`, ou migrar a sessão para
  cookie `HttpOnly` + `SameSite`. Isso também simplifica o `forward_auth`.
- **HS256 com segredo compartilhado:** nunca distribuir o `JWT_SECRET` aos apps.
  Com `forward_auth`, não é preciso. Se algum app precisar validar sozinho,
  migrar para RS256 + JWKS.
- **RAM da VPS:** medir antes de prometer N apps. Considerar Node ou Go para
  apps leves e `DOTNET_GCHeapHardLimit` nos containers .NET.
- **Build na VPS já sofre OOM** (DEPLOY.md): os apps da POC devem vir com
  imagem pronta (build no CI ou local), sem build na VPS.
- **Refresh de token dentro de iframe/Web Component:** definir quem renova
  (o shell renova e repassa por `postMessage`).

## 6. Plano de execução sugerido (timebox ~1–2 semanas)

| Etapa | Entrega | Pergunta que responde |
|---|---|---|
| 0 | Respostas Q1–Q9 + decisão A/B/C | Vale a pena B? |
| 1 | `/api/auth/verify` + `forward_auth` no Caddy + hello-node (só back) | Identidade no gateway funciona? |
| 2 | Catálogo `/api/apps` + hub dinâmico + hello-node em iframe | Stack livre e isolamento funcionam? |
| 3 | hello-ng como Web Component **ou** Federation | Dá para ter UX nativa? A que custo? |
| 4 | Testes de falha, RAM e segurança (critérios acima) + relatório | Seguir, ajustar ou abandonar? |

## 7. Estrutura de pastas proposta

```
poc/
├── apps.json                 # registro dos apps (fonte do /api/apps e do Caddyfile)
├── hello-node/               # app 1: Node + HTML, integração iframe
│   ├── Dockerfile
│   └── src/
├── hello-ng/                 # app 2: Angular (elements/federation) + .NET Minimal API
│   ├── web/
│   └── api/
├── Caddyfile.poc
└── docker-compose.poc.yml
```
