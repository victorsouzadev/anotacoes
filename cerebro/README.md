# Segundo Cérebro — vault Obsidian na VPS

Ferramenta do hub (notas-vps). Roda como serviço próprio (`cerebro` + `cerebro-webdav` no
`docker-compose.yml` da raiz), atrás do Caddy do hub em `/cerebro/*` e `/dav/*`, e tem tela em `/cerebro`
no app web, com o mesmo login das outras ferramentas.

Um serviço .NET 10 que mantém o vault Obsidian na sua VPS como fonte única da verdade, recebe dados por API,
organiza a Inbox com o Claude e expõe o vault a agentes via MCP. O sync com PC e celular é via WebDAV
(plugin **Remotely Save**), sem assinatura.

```
celular / WhatsApp / navegador ──HTTP──▶ API ──▶ 00-Inbox/*.md ──▶ worker (extrai, transcreve, Claude sugere)
Claude / sistema de voz ───────MCP────▶ /mcp ──▶ busca (SQLite FTS5) · leitura · escrita restrita
Obsidian (PC, celular) ◀──WebDAV──▶ vault em disco ──▶ índice (watcher) · git (commit a cada escrita)
```

## O que a PoC cobre

| Fase do plano | Status |
| --- | --- |
| 0 · Fundação: vault na VPS, sync WebDAV, git, HTTPS | Pronto |
| 1 · Captura: API, API keys, idempotência, upload, webhooks, bookmarklet | Pronto |
| 2 · MCP de leitura: search, read_note, list_notes, get_daily, list_inbox | Pronto |
| 3 · Processamento e escrita: Claude, aprovação pelo frontmatter, create_note, append_daily | Pronto |
| 4 · Busca semântica (embeddings) | Fora: o índice já separa trechos e tem `Candidates()` como ponto de extensão |
| OAuth 2.1 no MCP | Fora: token bearer (ou `?key=`) por enquanto |
| PDF e imagens (OCR) | Fora: o arquivo é salvo e linkado, sem extração |

Além da PoC original, a integração ao hub acrescentou a tela web (Inbox, captura, busca) e a API
`/api/v1/web/*`, que aceita o JWT do login único (mesmo `JWT_SECRET`), só para os e-mails de `CEREBRO_USUARIOS`.

> **Como foi verificado:** compila com os pacotes reais (`ModelContextProtocol.AspNetCore` 1.4.1,
> `Microsoft.Data.Sqlite` 10.0.13, versões fixadas). Passam os testes (`dotnet test`, incluindo os da
> autenticação web) e o `smoke-test.sh` (22 verificações, MCP incluso), e o roteamento pelo Caddy do hub.

## Apps do hub: MCPs e rotina de sincronização

O notas-api expõe um MCP **só de leitura** por app, que enxerga os dados da conta do hub com o e-mail
do dono do Cérebro (o primeiro de `CEREBRO_USUARIOS`):

| MCP | Ferramentas |
| --- | --- |
| `/api/mcp/tarefas` | `tarefas_resumo`, `tarefas_listar` |
| `/api/mcp/financas` | `financas_resumo`, `financas_resumo_mes`, `financas_buscar_transacoes`, `financas_evolucao`, `financas_saude`, `financas_metas`, `financas_recorrentes`, `financas_compromissos` (as mesmas consultas do chat financeiro) |
| `/api/mcp/criativo` | `criativo_resumo`, `criativo_sites`, `criativo_projetos_imagem` |

- **Token:** gerado em **Conectar → Apps do hub**. O Cérebro grava só o SHA-256 e o e-mail em
  `data/cerebro/hub/access/apps-token.json`, montado só leitura no `api` (`Mcp__TokenFile`). Sem o
  arquivo, os MCPs respondem 503. Fora da rede interna, só por HTTPS (o Caddy recusa `/api/mcp` sem TLS).
- **Rotina:** em **Configurações → Apps do hub**, horários (padrão 08:00 e 20:00, no fuso do Cérebro),
  quais apps entram e **Sincronizar agora**. A cada execução o Cérebro chama `<app>_resumo` pela rede
  interna (`http://api:8080/api/mcp`, `Hub__AppsMcpUrl`), regrava `_sistema/apps/<App> (app).md` e anota
  no diário. Se o serviço estava fora no horário, roda quando voltar (só o horário mais recente).
- **Claude:** a mesma tela traz os comandos do Claude Code e as URLs do Claude web para cada MCP.

## Editar pela tela, log e restauração (abas Notas e Histórico)

Na aba **Notas** você cria, edita (Markdown com frontmatter), move, renomeia e exclui notas. Excluir manda
para `_sistema/lixeira` (com **Desfazer**). Se a nota mudar enquanto você edita (sync do Obsidian, Claude),
a tela avisa e deixa escolher entre recarregar ou salvar por cima, em vez de apagar a edição de alguém.

O **histórico git** do vault é o log do Cérebro: cada versão guarda quando, quem mudou (você pela tela, o
Claude pelo MCP, o Obsidian pelo sync ou a Inbox) e quais notas. Na aba **Histórico** dá para filtrar por
origem, abrir as notas e **voltar o Cérebro inteiro** a um momento (notas alteradas ou apagadas depois voltam;
as criadas depois vão para a lixeira). Em cada nota, **Histórico** mostra as versões dela, com prévia e
**Restaurar**. Antes de qualquer restauração o estado atual é salvo, então tudo pode ser desfeito.

O Claude (MCP) também edita: `update_note`, `move_note`, `delete_note`, `note_history` e
`restore_note_version`. As de escrita só rodam com `user_confirmed=true`; as instruções do servidor mandam
perguntar antes, mostrando o que vai mudar, e cada mudança dele aparece no log como "Claude (MCP)".

## Ler o vault pela tela (aba Notas)

A aba **Notas** mostra o que já saiu da Inbox e tudo que você escreve no Obsidian: pastas com contagem,
notas mais recentes primeiro, busca em todo o vault e leitura da nota com Markdown, callouts,
checklists, `[[ligações]]` clicáveis e "notas que apontam para esta". A lateral lista as decisões
recentes da Inbox (aprovadas e rejeitadas). Depois de aprovar, o aviso traz **Ver nota**. É só leitura:
editar continua sendo no Obsidian.

## Gerenciado pela tela (aba Conectar e Configurações)

Tudo que dá acesso ao Cérebro pode ser criado, mostrado, copiado e trocado na tela `/cerebro` do hub,
sem editar o `.env` nem reiniciar nada. Os segredos ficam cifrados (AES-GCM, chave derivada do
`JWT_SECRET`) no `hub.db`.

| Acesso | Onde | Relação com o `.env` |
| --- | --- | --- |
| Token do MCP do Cérebro | Conectar → Claude no seu Segundo Cérebro | Gerar na tela substitui `CEREBRO_MCP_TOKEN` |
| Token do MCP da VPS (`ops`) | Conectar → Claude operando a VPS | Gerar na tela substitui `OPS_MCP_TOKEN` (o `ops` lê só o hash, em `data/cerebro/hub/access/`) |
| Login do WebDAV | Conectar → Obsidian | Gerar na tela substitui `CEREBRO_WEBDAV_USER/PASS`. O Caddy confere o login no Cérebro (`forward_auth`); o rclone não tem senha |
| API keys por fonte | Conectar → Captura de fora | As da tela somam com as `CEREBRO_API_KEY_*`; só as da tela podem ser apagadas pela tela |
| IA da Inbox | Configurações | Provedor (OpenRouter, Anthropic, padrão do servidor ou desligado), modelo e chave. Sem nada salvo, valem `ANTHROPIC_API_KEY` e depois `OPENROUTER_API_KEY` |

Cada acesso traz os comandos prontos para o **Claude Code do PC** (`claude mcp add …`) e a URL para o
**Claude web/app** (Configurações → Conectores → Adicionar conector personalizado). Trocar o `JWT_SECRET`
invalida os segredos salvos pela tela (eles precisam ser gerados de novo).

## Como o Claude decide o que guardar

O servidor MCP manda instruções na conexão (`Mcp/McpInstructions.cs`), e as ferramentas de escrita
(`capture`, `create_note`, `append_daily`) repetem a regra: antes de gravar, o agente avalia se vale
guardar (decisões, ideias, aprendizados, referências, compromissos, o que você pediu para lembrar) e
procura com `search` se já existe. Conversa trivial, segredos e resultados intermediários ficam de fora.
**Na dúvida, ele pergunta antes de gravar** e, depois de gravar, diz o que guardou e onde.

## Estrutura

```
src/Hub/
  Core/       FrontMatter (YAML do Obsidian), NoteDocument, VaultLayout (pastas e regras), HubOptions
  Vault/      VaultStore (escrita atômica e restrita), GitSnapshotter, DailyNote
  Data/       HubDb (capturas e fila, SQLite)
  Index/      NoteIndex (FTS5 + links), IndexWatcher (FileSystemWatcher + varredura)
  Pipeline/   IngestService, ProcessingWorker, ClaudeClassifier, LinkExtractor, Transcriber, ApprovalService
  Api/        Endpoints REST, ApiKeyAuth, WebEndpoints (tela do hub, JWT)
  Mcp/        VaultTools (ferramentas MCP)
tests/Hub.Tests/   frontmatter, caminhos, busca, extração, autenticação da tela web
scripts/smoke-test.sh   teste ponta a ponta contra o hub rodando
examples/          atalhos do celular, WhatsApp, bookmarklet
```

## Rodar local

```bash
dotnet build
dotnet test
cd src/Hub && dotnet run          # http://localhost:5080, vault em .local/vault
# em outro terminal:
BASE=http://localhost:5080 API_KEY=dev-celular MCP_TOKEN=dev-mcp ./scripts/smoke-test.sh
```

Requisitos locais: .NET 10 SDK e `git` no PATH. Abra `.local/vault` no Obsidian para ver as notas chegando.

## Deploy na VPS (junto com o hub)

O deploy é o mesmo do hub (`.github/workflows/deploy.yml`); o serviço só sobe com o profile `cerebro`.

1. **HTTPS (obrigatório).** No nginx-proxy-manager, crie um Proxy Host para um subdomínio (ex.:
   `cerebro.seudominio.com.br`) apontando para `notas-caddy` porta `8080`, com Let's Encrypt e
   "Websockets support" ligado. Pelo IP:8090, sem TLS, o Caddy recusa `/cerebro/*` e `/dav/*` (403):
   a senha do WebDAV, o token do MCP e as notas não podem passar em texto puro. O hub inteiro também
   passa a responder nesse subdomínio, e é por ele que o card "Segundo Cérebro" aparece.
2. **`.env`** (na VPS, em `/opt/notas-vps`): some `cerebro` ao `COMPOSE_PROFILES` e preencha as variáveis
   `CEREBRO_*` (ver `.env.example` da raiz). `CEREBRO_USUARIOS` é o seu e-mail do hub. A classificação usa o
   `ANTHROPIC_API_KEY` que o hub já tem.
3. **Push na `main`.** O deploy cria `data/cerebro/` com o dono certo, builda e sobe os dois containers.
4. Teste: `BASE=https://SUBDOMINIO/cerebro API_KEY=... MCP_TOKEN=... ./scripts/smoke-test.sh`

## Conectar o Obsidian (Remotely Save)

Em cada aparelho: *Configurações → Plugins da comunidade → Remotely Save* e escolha **WebDAV**.

| Campo | Valor |
| --- | --- |
| Server address | `https://SUBDOMINIO/dav` |
| Username / Password | `CEREBRO_WEBDAV_USER` / `CEREBRO_WEBDAV_PASS` |
| Auth type | basic |
| Remote base directory | o mesmo `CEREBRO_VAULT` do `.env` (padrão `Cerebro`) |
| Encryption password | **deixe vazio** (o hub precisa ler os arquivos) |
| Auto sync | a cada 1–5 min + "sync on save"/ao abrir |

Faça o primeiro sync a partir do aparelho que já tem as notas. Faça backup do vault antes.
A sincronização automática só roda com o Obsidian aberto; isso é limite de qualquer plugin.

## Conectar agentes ao MCP

**Claude Code**
```bash
claude mcp add --transport http cerebro https://SUBDOMINIO/cerebro/mcp --header "Authorization: Bearer $CEREBRO_MCP_TOKEN"
```

**Claude (app/web), conector personalizado:** use a URL `https://SUBDOMINIO/cerebro/mcp?key=CEREBRO_MCP_TOKEN`.
O token fica na URL, então trate a URL como senha; o próximo passo é trocar por OAuth 2.1.

**Sistema de voz ou scripts:** qualquer cliente MCP Streamable HTTP com `Authorization: Bearer`.

| Tool | Faz | Escreve |
| --- | --- | --- |
| `search` | Busca full-text (sem acento, por prefixo) | Não |
| `read_note` | Nota inteira ou uma seção, com backlinks | Não |
| `list_notes` | Lista por pasta e data | Não |
| `get_daily` | Nota do dia | Não |
| `list_inbox` | Itens da Inbox com sugestões | Não |
| `capture` | Manda algo para a Inbox | Inbox |
| `create_note` | Cria nota em `_sistema/ai` (nunca sobrescreve) | `_sistema/ai` |
| `append_daily` | Anexa linha ao diário | `01-Diario` |
| `process_inbox_item` | Aprova (move) ou rejeita (arquiva) | Move da Inbox |

Conteúdo de origem externa volta embrulhado em `<conteudo_externo>` com aviso, para o agente não seguir
instruções escondidas em e-mails ou páginas.

## Fluxo da Inbox

1. Uma captura vira `00-Inbox/2026-10-13 2110 celular - titulo.md` com `status: inbox`.
2. O worker baixa a página (link) ou transcreve (áudio) e, com a IA ligada (aba Configurações: OpenRouter ou
   Anthropic), pede ao modelo título,
   resumo, tags, `suggested_folder` e `suggested_links` (só notas que existem). Fica `status: processed`.
3. Você revisa na tela **Segundo Cérebro** do hub (escolhe a pasta e aprova ou rejeita) ou no Obsidian, marcando **`approve: true`** (ou `approve: reject`). Pode trocar `suggested_folder`
   antes. O hub detecta a mudança, renomeia pelo título, adiciona "## Relacionadas" e move a nota.
4. Também dá para aprovar por `POST /api/v1/captures/{id}/approve` ou pela tool `process_inbox_item`.

Itens que chegaram com a IA desligada podem ser classificados depois pelo botão **Classificar** na Inbox
(a extração já feita é reaproveitada).

Falhas são tentadas 3 vezes; depois a nota fica com `status: error` e `hub_error` explicando. Nada some.

## API

Pelo hub, todas as rotas abaixo ficam sob `https://SUBDOMINIO/cerebro` (o Caddy tira o prefixo).

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/api/v1/captures` | `{source?, external_id?, content?, url?, title?, tags?, occurred_at?}` |
| POST | `/api/v1/captures/file` | multipart: `file`, `source?`, `external_id?`, `content?`, `title?`, `tags?` |
| GET | `/api/v1/captures/{id}` | Status do processamento |
| POST | `/api/v1/captures/{id}/approve` | `{folder?}` |
| POST | `/api/v1/captures/{id}/reject` | — |
| POST | `/api/v1/daily` | `{text, date?, source?}` |
| POST | `/api/v1/webhooks/{fonte}` | JSON bruto de qualquer serviço |
| GET | `/api/v1/quick?key=&url=&title=&text=` | Bookmarklet |
| GET | `/health` | Contadores, último commit, recursos ligados |

Autenticação: `X-Api-Key` (ou `Authorization: Bearer`) com uma das chaves `Hub__ApiKeys__<fonte>`.
O nome da chave vira a origem padrão. Rate limit: 60 req/min por chave.

Tela do hub (`Authorization: Bearer <JWT do login>`; só `CEREBRO_USUARIOS`, senão 403):
`GET /api/v1/web/me`, `GET /api/v1/web/inbox`, `POST /api/v1/web/captures` `{content?, url?, tags?}`,
`POST /api/v1/web/inbox/approve` `{path, folder?}`, `POST /api/v1/web/inbox/reject` `{path}`,
`GET /api/v1/web/search?q=`.

## Segurança e backup

- Só o Caddy do hub fica exposto; `/cerebro` e `/dav` exigem HTTPS (vindo do nginx-proxy-manager); CORS do WebDAV liberado apenas para as origens do Obsidian. A tela web só aceita o JWT do hub para os e-mails de `CEREBRO_USUARIOS`.
- O hub valida todo caminho (nada fora do vault, nada em pastas ocultas como `.obsidian`). Sozinho, só
  escreve em Inbox, `_sistema`, diário e no destino de uma aprovação; o resto só quando você edita pela
  tela, ou quando o Claude edita depois de você confirmar.
- Escrita atômica (arquivo temporário + rename); `.hub-tmp-*` são ignorados pelo índice e pelo git.
- Downloads de links bloqueiam IPs internos (SSRF), inclusive em redirects.
- Histórico git em `data/cerebro/hub/vault.git`, fora do vault:
  ```bash
  git --git-dir data/cerebro/hub/vault.git --work-tree "data/cerebro/webdav/Cerebro" log --oneline
  git --git-dir data/cerebro/hub/vault.git --work-tree "data/cerebro/webdav/Cerebro" checkout <sha> -- "caminho/da nota.md"
  ```
- Backup externo (recomendado): `restic` diário de `data/cerebro/` para um bucket. Ainda não incluso.

## Próximos passos

1. OAuth 2.1 no `/mcp` (conector do Claude sem token na URL).
2. Busca semântica: embeddings por trecho + `sqlite-vec`, busca híbrida.
3. Resumo semanal da Inbox e arquivamento de itens parados há 30 dias.
4. Extração de PDF e OCR de imagens.
5. Calendário escrevendo a agenda no diário.
