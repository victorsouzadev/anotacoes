<!--
Relatório de sincronização
- Versão: 1.0.0 → 2.0.0 (MAJOR: Princípio I redefinido)
- Princípio I: "Um hub, um login, um backend" → "Um hub, um login, um banco". Ferramentas podem
  ser plug-ins em repositório próprio, desde que sigam o contrato da spec 029, usem o login do
  núcleo (spec 030) e o banco compartilhado (spec 031).
- Restrições técnicas: linhas "Plug-ins", "Banco" e "Deploy" atualizadas; "MCP" ganha a rota do plug-in.
- Templates: sem mudança ✅
- Pendências: nenhuma; desde a spec 035 só o que é do núcleo mora no Notas.Api (linha "Núcleo" da tabela).
- Histórico: 1.0.0 (2026-11-18) primeira ratificação.
-->

# Constituição do notas-vps

Hub pessoal de ferramentas (Notas, Finanças, Tarefas, Dieta, Treino, Editor de Imagens,
Moldes, Publicar, Segundo Cérebro, Anotação, Precificação...) com um único login, um único
banco e apps nativos que compartilham a mesma conta. As ferramentas podem morar no núcleo ou
em repositórios de plug-in. Esta constituição vale para toda
spec, plano e lista de tarefas gerada pelo Spec Kit neste repositório.

## Princípios

### I. Um hub, um login, um banco
Toda ferramenta é uma opção do hub, nunca outro produto. Ela pode viver em dois lugares:
- **Módulo no núcleo**: pasta em `frontend/src/app/features/<ferramenta>/` e
  `Endpoints/<Ferramenta>Endpoints.cs` no `Notas.Api`, como sempre foi.
- **Plug-in**: repositório próprio (`hub-<id>`), com container próprio, seguindo o contrato
  da spec 029 (`plugin.json`, health, rotas em `/<id>/`) e o SDK da spec 032.

Nos dois casos:
- O login é o do núcleo: só o núcleo emite tokens; o plug-in só valida (spec 030).
- O banco é um só, o `notas.db` compartilhado; cada ferramenta é dona apenas das suas tabelas
  e não lê nem grava as de outra (spec 031).
- O deploy passa pelo deployer do núcleo; proibido outro domínio, outro login ou deploy por fora.
- Serviço que não é ferramenta (`deployer/`, `ops/`) continua exigindo justificativa no plano.

### II. Dados do usuário são sagrados
- Nunca perder dado: mudanças de schema são compatíveis com o que já está gravado
  (migração na leitura ou migração EF explícita); nada de apagar coluna ou tabela sem plano
  de migração e backup.
- Toda consulta é filtrada pelo usuário dono; nenhum endpoint devolve dado de outra conta.
- Segredos (chaves de API, tokens) ficam cifrados no banco (`Services/Seguranca`) ou em
  `.env`; nunca no código, em log, em commit ou em resposta da API.

### III. Local-first e offline onde o uso pede
Ferramentas usadas no celular ou em movimento (Notas, Tarefas, Dieta, Treino) funcionam
sem rede e sincronizam depois. A sincronização usa tombstones (`deletedAt`) e é idempotente.
A conta do hub é opcional nos apps Android: sem login, o app continua 100% funcional.

### IV. IA com fallback e custo explícito
- Recurso de IA nunca é o único caminho quando existe alternativa local (ex.: extrator
  heurístico de lançamentos). Sem chave configurada, a tela continua utilizável.
- Provedor, modelo e chave são configuráveis por usuário em `/configuracoes`; o `.env` é só
  o padrão do servidor.
- Recurso cobrado por uso (ex.: ampliação na Replicate) nasce desligado e a interface deixa
  o custo claro antes de executar.
- Resposta de IA é conferida antes de virar dado (validação de valores, aprovação na tela).

### V. Lógica pura fora do framework, com testes
- Regra de negócio, geometria, parsing e cálculos ficam em módulos sem Angular/Compose/ASP.NET
  (ex.: `geometria.ts`, `svg-template.ts`, `decalque.ts`, `Services/*`) e têm teste unitário.
- Todo bug corrigido ganha um teste que reproduz o problema.
- Mudança de contrato de API ganha teste de integração em `Notas.Api.Tests` (ou na suíte do
  serviço afetado).
- O CI (`.github/workflows/ci.yml`) precisa passar inteiro, inclusive o backend em modo
  `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`.

### VI. Identidade visual Grafite
Toda interface (web, Android, desktop) usa os tokens da identidade Grafite (skill
`aplicar-grafite`): cores papel/folha/grafite/nanquim, fontes Newsreader/Figtree/IBM Plex
Mono, um único acento. Cor de ferramenta só em ícone/marcador. Toda tela funciona em tema
claro e escuro e em largura de celular.

### VII. Português do Brasil
Interface, mensagens de erro, documentação, specs, planos, tarefas e mensagens de commit são
em pt-BR. Nomes de domínio no código seguem o vocabulário do usuário (`Transacao`,
`Orcamento`, `Molde`, `Anotacao`). Formatos brasileiros (moeda, data, vírgula decimal) sem
depender da cultura do servidor.

### VIII. Simplicidade
Comece pelo menor recurso que resolve o caso real. Sem dependência nova, camada, serviço ou
abstração sem necessidade demonstrada no plano. SQLite compartilhado até que haja motivo
medido para outra coisa. Complexidade extra é registrada na tabela "Complexity Tracking" do
plano com o motivo e a alternativa mais simples rejeitada.

## Restrições técnicas

| Camada | Padrão |
|---|---|
| Frontend | Angular 21, standalone components, signals, rotas lazy por ferramenta |
| Backend | ASP.NET Core 9 (núcleo) ou .NET 9+ (plug-ins), Minimal APIs, EF Core + SQLite (WAL) |
| Banco | Um `notas.db` compartilhado; cada ferramenta com prefixo de tabela e histórico de migração próprios (spec 031) |
| Núcleo | Login, contas, hub, Configurações (IA), Publicar e o registro de plug-ins; as demais ferramentas são plug-ins desde as specs 033 a 035 |
| Plug-ins | Repositório `hub-<id>`, imagem no GHCR, `plugin.json`, `Hub.Plugin.Sdk` e `@grafite/ui` (specs 029 e 032) |
| Serviços à parte | .NET 10 (`cerebro/`, `ops/`), `deployer/` é o único com `docker.sock` |
| Android | Kotlin + Jetpack Compose, Room, local-first |
| Desktop | WPF + WebView2 hospedando o mesmo `NotasApp` |
| MCP | Cada ferramenta pode expor MCP em `/api/mcp/<ferramenta>` (núcleo) ou `/<id>/mcp` (plug-in), com o mesmo login |
| Deploy | Docker Compose na VPS, via GitHub Actions; plug-ins entram pela versão fixada em `plugins.lock` do núcleo (ver `DEPLOY.md`) |

Trocar uma tecnologia desta tabela exige emenda a esta constituição.

## Fluxo de desenvolvimento

1. Feature nova ou mudança relevante: `/speckit-specify` → (opcional `/speckit-clarify`) →
   `/speckit-plan` → `/speckit-tasks` → (opcional `/speckit-analyze`) → `/speckit-implement`.
   Correções pequenas e ajustes de texto não precisam de spec.
2. Specs ficam em `specs/NNN-nome-da-feature/` e são versionadas junto com o código. O
   Spec Kit não cria branch: a branch é a da sessão de trabalho.
3. O plano passa pelo "Constitution Check" antes da pesquisa e de novo depois do design.
4. README (seção da ferramenta e "Estrutura do projeto") e `DEPLOY.md` são atualizados no
   mesmo PR quando a feature muda o que eles descrevem; variável nova entra em `.env.example`.
5. Mensagem de commit: `<Ferramenta>: <o que mudou>` em pt-BR.

## Governança

Esta constituição prevalece sobre outras práticas do repositório. Emendas são feitas com
`/speckit-constitution`, registradas no relatório de sincronização no topo deste arquivo e
versionadas em SemVer: MAJOR para remover ou redefinir princípio, MINOR para princípio ou
seção nova, PATCH para redação. Todo plano e revisão de PR verifica conformidade; violação
só é aceita quando justificada na tabela "Complexity Tracking" do plano.

**Version**: 2.0.0 | **Ratified**: 2026-11-18 | **Last Amended**: 2026-11-19
