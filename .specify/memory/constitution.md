<!--
Relatório de sincronização
- Versão: (template) → 1.0.0 (primeira ratificação)
- Princípios criados: I a VIII (todos novos)
- Seções criadas: Restrições técnicas, Fluxo de desenvolvimento, Governança
- Templates: plan-template.md usa "Constitution Check" genérico, que lê este arquivo ✅;
  spec-template.md e tasks-template.md não precisam de mudança ✅
- Pendências: nenhuma
-->

# Constituição do notas-vps

Hub pessoal de ferramentas (Notas, Finanças, Tarefas, Dieta, Treino, Editor de Imagens,
Moldes, Publicar, Segundo Cérebro, Anotação, Precificação...) com um único login, um único
backend e apps nativos que compartilham a mesma conta. Esta constituição vale para toda
spec, plano e lista de tarefas gerada pelo Spec Kit neste repositório.

## Princípios

### I. Um hub, um login, um backend
Toda ferramenta nova entra como mais uma opção do hub, nunca como outro produto:
- Frontend: uma pasta em `frontend/src/app/features/<ferramenta>/`, rota lazy-loaded em
  `app.routes.ts` e card em `features/hub/hub.page.ts`.
- Backend: um `Endpoints/<Ferramenta>Endpoints.cs` no `Notas.Api`, com tabelas e DTOs
  próprios, reaproveitando JWT, usuários e banco.
- Proibido criar outro sistema de login, outro deploy ou outro domínio para uma ferramenta.
  Serviço separado (como `cerebro/`, `deployer/`, `ops/`) só com justificativa escrita no
  plano (isolamento de segurança, runtime diferente, processo de longa duração).

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
abstração sem necessidade demonstrada no plano. SQLite no `Notas.Api` até que haja motivo
medido para outra coisa. Complexidade extra é registrada na tabela "Complexity Tracking" do
plano com o motivo e a alternativa mais simples rejeitada.

## Restrições técnicas

| Camada | Padrão |
|---|---|
| Frontend | Angular 21, standalone components, signals, rotas lazy por ferramenta |
| Backend | ASP.NET Core 9, Minimal APIs, EF Core + SQLite (WAL) |
| Serviços à parte | .NET 10 (`cerebro/`, `ops/`), `deployer/` é o único com `docker.sock` |
| Android | Kotlin + Jetpack Compose, Room, local-first |
| Desktop | WPF + WebView2 hospedando o mesmo `NotasApp` |
| MCP | Cada ferramenta pode expor MCP em `/api/mcp/<ferramenta>`, com o mesmo login |
| Deploy | Docker Compose na VPS, via GitHub Actions a cada push em `main` (ver `DEPLOY.md`) |

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

**Version**: 1.0.0 | **Ratified**: 2026-11-18 | **Last Amended**: 2026-11-18
