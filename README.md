# notas-vps

Hub pessoal de ferramentas: um app web com tela inicial ("Ferramentas") que dá
acesso a cada ferramenta, login/usuário compartilhados entre todas e um único
backend — mais um app Android nativo que compartilha o mesmo login/backend pra
uma das ferramentas. Novas ferramentas entram como mais uma opção na tela
inicial, sem exigir outro login nem outro deploy.

- **Notas** — notas manuscritas: desenho livre, texto, notas adesivas, checklists,
  formas e setas num canvas por página, com várias páginas por nota, pastas, busca,
  exportação de imagem, sincronização entre dispositivos e uso offline.
- **Finanças** — lançamentos financeiros a partir de texto livre ("gastei 45 no
  mercado hoje"), extraídos por LLM (com fallback heurístico local), com dashboard
  de receitas x despesas, categorias e tendências.
- **Tarefas** — tarefas com subtarefas, categorias, prioridade, recorrência,
  pomodoro e estatísticas. Versão web (`frontend/src/app/features/tasks`) **e**
  app Android nativo ([`mobile/`](mobile/), Kotlin/Compose, local-first) — o app
  funciona 100% offline e, opcionalmente, sincroniza com a mesma conta do hub pra
  ver as mesmas tarefas no navegador. Ver [mobile/README.md](mobile/README.md).

Produção: **http://191.252.177.244:8090** (sem SSL — só IP, ver [DEPLOY.md](DEPLOY.md)).

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Angular 21 (standalone components, signals), um app só com rotas lazy-loaded por ferramenta |
| Editor de notas | Canvas 2D próprio (não SVG/DOM), suavização de traço via `perfect-freehand` |
| Gráficos (Finanças, Tarefas) | Chart.js |
| Armazenamento local (Notas) | IndexedDB via `idb` (local-first, funciona offline) |
| App Android (Tarefas) | Kotlin + Jetpack Compose, Room (SQLite) local-first — ver [mobile/README.md](mobile/README.md) |
| Backend | ASP.NET Core 9 — um processo só, Minimal APIs, endpoints agrupados por ferramenta (`/api/notes`, `/api/folders`, `/api/financas/*`, `/api/tasks/*`) |
| Extração de lançamentos (Finanças) | Anthropic Claude via API, com extrator heurístico local como fallback sem chave configurada |
| Banco | SQLite (EF Core 9), modo WAL — uma tabela por entidade, compartilhando o mesmo arquivo/contexto |
| Autenticação | JWT (access 15min + refresh 30d com rotação/detecção de reuso), senhas com BCrypt — login único vale para todas as ferramentas, web e Android |
| Proxy/servidor estático | Caddy 2 (build do Angular embutido na imagem) |
| Deploy | Docker Compose; GitHub Actions builda e envia pra VPS a cada push em `main` via SSH/SCP (ver [DEPLOY.md](DEPLOY.md)), com script Python (paramiko/SFTP) como alternativa manual |

## Ferramentas

### Notas

### Editor (canvas por página)
- **Abertura em modo documento**: nota nova (ou página nova/vazia) já entra com um
  texto largo posicionado como uma folha, em edição, cursor piscando — sem precisar
  clicar. Ferramenta padrão é "Selecionar", não a caneta.
- **Caneta** com suavização (`perfect-freehand`) e sensibilidade a pressão (Pointer Events), cores e espessuras predefinidas.
- **Borracha** por traço inteiro ou por área.
- **Formas**: retângulo, elipse, linha — com preenchimento opcional.
- **Setas**: retas ou curvas (arrasta um ponto do meio pra curvar), pontas *snapam* na borda do elemento mais próximo e **acompanham automaticamente** se esse elemento for movido.
- **Texto**: negrito, itálico, sublinhado, alinhamento (esquerda/centro/direita), tamanho de fonte ajustável (botões A−/A+, 8–200px), fonte normal ou "manuscrita" (fonte cursiva do SO). A caixa de edição cresce junto com o conteúdo e reflete pixel a pixel o resultado final renderizado.
- **Listas inline no texto**: digitar `- ` cria lista com marcadores, `1. ` cria lista
  numerada (a numeração exibida é sempre recalculada pela posição no bloco) e `[ ] `
  cria checklist — Enter continua o item (ou encerra a lista se o item estiver vazio,
  como no Word), Tab/Shift+Tab indenta/desindenta até 4 níveis (glifo muda por nível:
  `•` `◦` `▪` `‣`), e três botões na barra flutuante de formatação alternam o tipo de
  lista na linha do cursor ou em toda a seleção. Um clique no quadradinho de um item
  de checklist marca/desmarca sem precisar abrir o modo de edição.
- **Notas adesivas**: cor à escolha, tamanho de fonte ajustável (mesmos controles do texto), crescem automaticamente para caber o conteúdo.
- **Checklist**: itens marcáveis, tamanho de fonte ajustável, redimensionável manualmente (a altura não é mais sobrescrita ao digitar), fundo transparente durante a edição, marca de "✓" no item concluído.
- **Imagens**: colar direto da área de transferência (Ctrl+V) — redimensionadas/comprimidas no cliente antes de salvar.
- **Seleção múltipla**, mover, redimensionar (alças de canto com área de clique maior que o desenho, pra não errar o alvo), rotacionar, camadas (frente/trás).
- **Undo/redo** (command pattern), até ~100 passos.
- **Zoom/pan**: roda do mouse, pinça em touch, atalhos de teclado, "ajustar à tela".
- **Estilo de papel**: liso, pautado ou quadriculado (preferência só local, não sincronizada).
- **Tema claro/escuro/automático**.
- **Múltiplas páginas por nota**: abas no topo do editor para trocar, adicionar (`+ Página`) e excluir páginas — cada página tem seu conjunto independente de elementos, como um caderno.
- **Exportar PNG**: renderiza a página atual inteira (não só o que está visível na tela) em resolução real, com opção de fundo branco ou transparente.

### Organização
- **Pastas**: criar, renomear, excluir (notas da pasta excluída voltam para "sem pasta"), mover notas entre pastas.
- **Busca**: por título **e por conteúdo** (texto, notas adesivas e itens de checklist de todas as páginas da nota).
- **Ordenação**: por última edição, data de criação ou nome.
- Lista de notas com miniaturas (thumbnail gerado a partir do canvas), duplicar, renomear, excluir.

### Contas e sincronização
- Registro/login por e-mail e senha, isolamento total de dados por usuário.
- **Local-first**: tudo funciona offline (IndexedDB); sincroniza com o servidor quando há conexão.
- Estratégia de sincronização: last-write-wins por `updatedAt`, tombstones para exclusões, outbox de notas "sujas" (`dirty`) até confirmar envio.
- Indicador de status (salvo / sincronizando / offline / erro) no cabeçalho.

### Finanças

- **Lançamento por texto livre**: campo único onde o usuário descreve o gasto/receita
  como falaria ("gastei 45 reais no mercado hoje", "recebi 3000 de salário dia
  05/07") — o texto é enviado ao backend, que aciona um LLM (Anthropic Claude) para
  extrair descrição, valor, tipo, categoria, data, forma de pagamento e uma nota de
  confiança da extração.
- **Fallback heurístico**: sem `ANTHROPIC_API_KEY` configurada, um extrator local
  baseado em regras/regex assume a extração (com confiança mais baixa), útil para
  rodar em dev sem custo de API.
- **Revisão de baixa confiança**: lançamentos extraídos com confiança abaixo do
  limiar (`Extracao:LimiarConfianca`, padrão 0.6) entram como "pendente de revisão"
  até o usuário confirmar ou corrigir os campos.
- **Dashboard**: cards de saldo do mês, receitas, despesas, maior categoria de gasto
  e variação vs. mês anterior; gráfico de pizza de gastos por categoria e gráfico de
  linha de receitas x despesas ao longo do tempo (Chart.js).
- **Lista de lançamentos**: mais recentes primeiro, com ação rápida de confirmar
  (lançamentos pendentes) ou remover.

### Tarefas

Web (`frontend/src/app/features/tasks`) **e** [app Android nativo](mobile/) — as
duas pontas conversam com o mesmo backend e, quando logadas na mesma conta, com os
mesmos dados.

- **Tarefas**: título, descrição, prazo, prioridade, categoria, subtarefas,
  recorrência (diária/semanal/mensal), concluir, lixeira (restaurar ou excluir
  definitivamente).
- **Categorias**: nome + cor, criação rápida direto do formulário de tarefa.
- **Pomodoro**: timer de foco/pausa (25/5min, pausa longa a cada 4 ciclos),
  vinculável a uma tarefa — incrementa o contador de pomodoros dela.
- **Estatísticas**: totais (concluídas/pendentes/concluídas hoje/pomodoros) e
  gráfico de tarefas por categoria (Chart.js).
- **App Android**: os mesmos conceitos, mais o que só faz sentido num aparelho —
  lembretes por horário e por localização (geofence), sincronização com o
  calendário do sistema, widget de tela inicial e interpretação de texto livre por
  IA (OpenRouter, configurável no app). 100% funcional offline; login é opcional,
  só pra sincronizar com a web (ver [mobile/README.md](mobile/README.md)).
- **Sincronização web ↔ Android**: completa (não incremental) a cada rodada,
  "quem editou por último vence" por `updatedAt`, tarefas reaproveitam a lixeira
  como tombstone de exclusão. Categorias não têm tombstone — excluir uma categoria
  enquanto outro dispositivo está offline faz ela reaparecer nele na sincronização
  seguinte; limitação aceita dado o uso pessoal da ferramenta.

## Modelo de dados (visão geral)

Uma **nota** (`NoteRecord`) tem metadados (`título`, `pasta`, datas) e uma lista de
**páginas** (`NotePage[]`), cada uma com seu próprio array de **elementos**
(`CanvasElement[]`). Um elemento é uma união discriminada por `type`:

`stroke` (traço) · `shape` (retângulo/elipse/linha) · `arrow` (seta, com curva e
"grude" opcional em outro elemento) · `text` · `sticky` · `checklist` · `image`.

No banco, o conteúdo das páginas de uma nota é serializado como uma única string
JSON (coluna `Elements`, até 8MB) — o backend não conhece a estrutura interna, só
guarda e devolve o blob. Notas salvas antes do conceito de "páginas" existir (array
plano de elementos) são migradas automaticamente na leitura, sem precisar de
migração de banco.

O `content` de um elemento `text` continua uma string simples multi-linha — listas
inline não mudam o schema, só usam um prefixo por linha (`- `, `1. `, `[ ] `/`[x] `,
opcionalmente com espaços de indentação antes) que o renderer interpreta na hora de
desenhar. Uma linha sem esse prefixo é texto comum, exatamente como antes.

## Estrutura do projeto

```
notas-vps/
├── backend/Notas.Api/
│   ├── Program.cs                    # bootstrap, JWT, forwarded headers, registro de cada ferramenta
│   ├── Data/AppDbContext.cs          # EF Core: User, RefreshToken, Folder, Note (Notas)
│   ├── Data/FinancasModels.cs        # EF Core: Transacao + enums (Finanças)
│   ├── Data/TasksModels.cs           # EF Core: TaskCategory, TaskItem (Tarefas — web + Android)
│   ├── Endpoints/                    # Auth, Notes, Folders, Financas, Tasks (Minimal APIs, um arquivo por ferramenta)
│   ├── Services/Financas/            # extração de lançamentos (LLM Anthropic + fallback heurístico)
│   ├── Auth/TokenService.cs          # emissão/validação/rotação de JWT (login único, vale pra tudo)
│   └── Dtos/                         # Dtos.cs (Notas) + FinancasDtos.cs + TasksDtos.cs
├── frontend/src/app/
│   ├── core/                         # auth, theme, interceptor/guard — compartilhados por todas as ferramentas
│   ├── shared/                       # ícones e outros componentes usados em mais de uma ferramenta
│   ├── data/                         # models, IndexedDB, repo local-first, sync (Notas)
│   └── features/
│       ├── auth/                     # login, registro (compartilhado)
│       ├── hub/                      # tela inicial "Ferramentas" — para onde o login redireciona
│       ├── notes/                    # lista de notas, pastas, busca
│       ├── editor/
│       │   ├── engine/               # renderer, viewport, hit-test, geometria de
│       │   │                         # seta, layout de sticky/checklist/texto, export
│       │   ├── canvas-host.ts        # pointer events, ferramentas, resize/rotate
│       │   ├── toolbar.ts            # barra de ferramentas em grupos colapsáveis
│       │   ├── text-overlay.ts       # edição de texto/sticky (textarea sobreposto)
│       │   ├── checklist-overlay.ts  # edição de checklist
│       │   └── editor.page.ts        # página do editor, páginas múltiplas, autosave
│       ├── financas/                 # lançamento por texto, dashboard, lista de transações
│       └── tasks/                    # lista, categorias, pomodoro, estatísticas, lixeira
├── mobile/                           # app Android nativo (Kotlin/Compose) da ferramenta Tarefas
│   ├── app/src/main/java/com/organizador/app/
│   │   ├── data/sync/                # sincronização completa com o backend (mesma conta do hub)
│   │   ├── data/remote/AuthApi.kt    # login/registro/refresh contra /api/auth/*
│   │   └── ...                       # resto do app (Room, Compose, reminders, widget etc.)
│   └── README.md
├── caddy/                            # Caddyfile + Dockerfile (build do Angular embutido)
├── scripts/
│   ├── deploy.py                     # empacota e envia via SFTP
│   └── backup.sh                     # backup do SQLite (cron na VPS)
├── docker-compose.yml / .local.yml / .vps.yml
└── DEPLOY.md
```

Para adicionar uma nova ferramenta: uma pasta em `frontend/src/app/features/<ferramenta>/`
com uma rota lazy-loaded em `app.routes.ts`, um card na tela `features/hub/hub.page.ts`,
e no backend um `Endpoints/<Ferramenta>Endpoints.cs` (mapeado em `Program.cs`) com suas
tabelas/DTOs próprios — login, JWT e banco continuam compartilhados.

## API (resumo)

Todas as rotas (exceto auth) exigem `Authorization: Bearer <token>` e filtram por usuário.

| Rota | Descrição |
|---|---|
| `POST /api/auth/register` \| `login` \| `refresh` \| `logout` | Autenticação (compartilhada por todas as ferramentas) |
| `GET /api/notes?since=` | Lista notas (metadados ou mudanças desde uma data) |
| `PUT /api/notes/{id}` | Upsert idempotente (id gerado no cliente) |
| `GET /api/folders` | Lista pastas do usuário |
| `POST /api/folders` | Cria pasta |
| `PUT /api/folders/{id}` | Renomeia pasta |
| `DELETE /api/folders/{id}` | Exclui pasta (notas voltam a "sem pasta") |
| `POST /api/financas/transacoes` | Registra lançamento a partir de texto livre (aciona o LLM) |
| `GET /api/financas/transacoes` | Lista lançamentos (filtros: período, categoria, tipo) |
| `PATCH /api/financas/transacoes/{id}` | Corrige campos de um lançamento |
| `DELETE /api/financas/transacoes/{id}` | Remove lançamento |
| `GET /api/financas/dashboard/resumo` \| `categorias` \| `tendencias` | Totais e agregações para o dashboard |
| `GET /api/tasks/categories` | Lista categorias (usado pela web e pelo sync do Android) |
| `PUT /api/tasks/categories/{id}` | Upsert idempotente (id gerado no cliente) |
| `DELETE /api/tasks/categories/{id}` | Exclui categoria (sem tombstone — ver limitações em "Tarefas" acima) |
| `GET /api/tasks/items` | Lista tarefas, inclusive as na lixeira (tombstone `deletedAt`) |
| `PUT /api/tasks/items/{id}` | Upsert idempotente — mover pra lixeira/restaurar é um upsert com `deletedAt` setado/nulo |
| `DELETE /api/tasks/items/{id}` | Exclui tarefa definitivamente (ação "excluir para sempre" da lixeira) |
| `GET /api/health` | Health check |

## Desenvolvimento local

```bash
# Frontend (localhost:4300 por padrão, proxy pra API em proxy.conf.json)
cd frontend
npm install
npm start

# Backend (localhost:5199 por padrão)
cd backend/Notas.Api
dotnet run

# Ou tudo via Docker Compose
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Checagem de tipos: `npx tsc --noEmit -p tsconfig.app.json` (dentro de `frontend/`).

A ferramenta Finanças funciona sem configuração extra (usa o extrator heurístico
local). Para usar o LLM real, defina `Anthropic:ApiKey` em
`backend/Notas.Api/appsettings.Development.json` ou a variável de ambiente
`Anthropic__ApiKey` antes de rodar o backend.

```bash
# App Android (ver mobile/README.md para detalhes)
cd mobile
echo "sdk.dir=/caminho/do/Android/sdk" > local.properties
./gradlew assembleDebug
```

## Deploy

Ver [DEPLOY.md](DEPLOY.md) — resumo: `python scripts/deploy.py` (envia os arquivos
por SFTP) e depois, na VPS, rebuild dos containers via `docker compose ... build && up -d`.
Sem CI/CD nem rollback automático. O app Android (`mobile/`) não faz parte desse
pipeline — é distribuído como APK separado, não pelo Caddy/VPS.

## Roadmap / sugestões de melhoria

Nada abaixo está implementado — é uma lista de ideias levantadas em conversa, por prioridade.

**Confiabilidade**
- Confirmar que o cron de backup do SQLite está de fato rodando na VPS (único ponto de falha dos dados).
- HTTPS via subdomínio + Nginx Proxy Manager (hoje é IP puro, senha trafega em claro).

**Funcionalidades**
- Compartilhar nota por link somente-leitura, sem exigir conta.
- Arrastar-e-soltar imagens/arquivos direto no canvas (hoje só colar via Ctrl+V).
- Tags, além de pastas (categorização cruzada, não hierárquica).
- Modo apresentação/leitura (esconde a toolbar).
- Lixeira com restaurar — hoje excluir é permanente na prática, embora o campo `deletedAt` já exista internamente como tombstone de sync.
- Exportar em PDF (hoje só PNG).

**Polish**
- Atalho de teclado para trocar de página (Ctrl+PageUp/PageDown).
- Duplicar página (hoje só duplica a nota inteira).
- Reconhecimento de escrita à mão, colaboração em tempo real, compartilhamento entre usuários, login social, recuperação de senha por e-mail, app mobile nativo — fora do escopo original da v1, mantidos aqui só como registro do que foi conscientemente deixado de fora.
