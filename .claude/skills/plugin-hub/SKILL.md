---
name: plugin-hub
description: Especialista em ferramentas do hub (notas-vps) como plug-ins. Cobre criar um plug-in novo a partir do hub-modelo, mudar um plug-in existente (telas, endpoints, tabelas, MCP, versão no plugins.lock), trazer um app de fora para dentro do hub (login, banco, rotas) e diagnosticar um plug-in na VPS (deployer, health, logs, permissões no Postgres). Use sempre que o pedido envolver "plug-in", "ferramenta nova", "hub-<id>", plugin.json, plugins.lock, Hub.Plugin.Sdk, @grafite/ui, rotasLegadas, HUB_BANCO, ou quando um app precisar "entrar no hub", mesmo que a palavra plug-in não apareça.
---

# Plug-ins do hub

O hub é um núcleo (`victorsouzadev/anotacoes`: login, contas, hub, IA, Publicar, deployer) e várias ferramentas,
cada uma num repositório `hub-<id>` com container próprio. Esta skill diz como criar, mudar, adaptar e diagnosticar
essas ferramentas sem quebrar o contrato.

## Antes de começar

1. Descubra qual dos quatro caminhos é o pedido: **novo**, **mudar**, **adaptar** ou **diagnosticar**. Se não der para
   saber, pergunte.
2. Leia o que é a fonte da verdade e confie nele, não nesta skill, quando os dois discordarem:
   - `pacotes/README.md` (SDK e `@grafite/ui`) e `pacotes/plugin.schema.json` (manifesto);
   - `DEPLOY.md`, seção "Núcleo e plug-ins" (deployer, banco, `data/plugins/env`);
   - `specs/029-nucleo-plugins/contracts/plugin-manifesto.md` e a spec da ferramenta em `specs/`;
   - `plugins.lock` (quem está no ar e em que commit).
3. Mudança grande (ferramenta nova, adaptar um app, tabela que muda de dono) passa pelo Spec Kit (`/speckit-specify`).
   Correção pequena não precisa.
4. **Pergunte ao usuário** antes de decidir sozinho qualquer um destes pontos:
   - o `id` e o nome que aparece no hub;
   - se a ferramenta usa IA, MCP ou app Android;
   - URLs antigas que precisam continuar funcionando (`rotasLegadas`);
   - se o plug-in é congelado (`"congelado": true`);
   - o que fazer com os dados de um app que já existe (copiar, migrar ou começar do zero).

## Regras que não mudam

- **Login só do núcleo.** O plug-in nunca emite token: só valida ES256 pelo JWKS (`AdicionarPlugin()`), com `aud` igual ao
  id. Nada de outro login, outro domínio ou deploy por fora do deployer.
- **Banco.** É um banco `hub` no `notas-postgres`, com um schema e um papel com o nome do id. O plug-in só toca nas tabelas
  com o prefixo do manifesto (`tabelas.prefixo`, ex.: `dieta_`). A única ponte com o núcleo é a chave estrangeira para
  `nucleo.users` (`ReferenciarUsuarios()`). O teste `Dados.TabelasForaDoDono(db.Model, manifesto)` tem de dar vazio.
- **Esquema sem migrações.** Ao subir, `BancoVazio.CriarSeNaoForDoHub(db)` chama `Esquema.Garantir(db)` do SDK, que cria
  tabelas, índices e colunas novas. Ele nunca apaga nem muda o tipo de nada. Remover, renomear ou trocar o tipo de uma
  coluna exige backup, SQL feito à mão com confirmação do usuário, e só depois o deploy.
- **Dados do usuário são sagrados.** Nunca apague tabela ou coluna. Toda mudança precisa ser compatível com o que já está
  gravado.
- **Telas.** Ficam no próprio plug-in, em `/<id>/`, com `/grafite/grafite.css`, `<grafite-barra atual="<id>">` e
  `fetchDoPlugin`. O visual é o Grafite: use as skills `design-system-grafite` (tela nova) e `aplicar-grafite` (tela que já
  existe).
- **Idioma.** Tudo em pt-BR: código de domínio, interface, documentos e commits (`<Ferramenta>: <o que mudou>`).
- **Segredos.** Nunca no git nem no chat. Configuração própria do plug-in vai em `data/plugins/env/<id>.env` na VPS (root,
  modo 600). Na VPS, leia só os nomes das variáveis, nunca os valores. Nunca abra `/root/.docker/config.json`.

## Caminho 1: plug-in novo

1. Repositório: "Use this template" no `hub-modelo` (o `hub-exemplo` já vem com login e banco). Nome `hub-<id>`.
2. `plugin.json`: `id`, `nome`, `icone`, `contrato: 1`, `rota: "/<id>"`, `porta: 8080`, `health` sob a rota e
   `tabelas.prefixo`. Inclua `mcp`, `usaIa`, `rotasLegadas`, `dados` e `android` só quando forem usados. As rotas
   reservadas (`/api/auth`, `/api/core`, `/api/plugins`, `/api/sistema`, `/autorizar`, `/.well-known`, `/ops`, `/sites`)
   são recusadas.
3. Backend:

   ```csharp
   var manifesto = builder.AdicionarPlugin();
   builder.Services.AddDbContext<AppDbContext>((sp, o) => o.UsarBancoDoHub(sp.GetRequiredService<OpcoesDoHub>()));
   // depois do Build:
   using (var e = app.Services.CreateScope()) BancoVazio.CriarSeNaoForDoHub(e.ServiceProvider.GetRequiredService<AppDbContext>());
   app.UseAuthentication(); app.UseAuthorization();
   app.MapHealthDoPlugin();
   ```

   Se tiver MCP: `app.MapMcp(manifesto.Mcp!).ExigirMcpDoPlugin()`. Se usar IA: `IaDoHub.ObterConfiguracao(ctx)`; a chave
   do usuário fica no núcleo, nunca no plug-in.
4. SDK: `sh scripts/baixar-sdk.sh`, que baixa da Release `sdk-v<versão>` para `pacotes-locais/` (o `nuget.config` do
   repositório aponta para lá). Depois rode `dotnet test`.
5. A CI do plug-in testa, sobe o container e publica `ghcr.io/victorsouzadev/hub-<id>:<commit>`.
6. VPS, sempre com confirmação do usuário:
   - inclua o id em `PG_PLUGINS` e gere `PG_SENHA_<ID>` em `/root/.config/notas-pg.env`;
   - rode `scripts/postgres-hub.sh papeis`;
   - grave `data/plugins/banco/<id>` (modo 600, `Host=notas-postgres;Database=hub;Username=<id>;Password=...;Maximum Pool Size=5`).
     O Postgres tem `max_connections=60`: some os pools antes de pôr mais um.
7. Num PR do núcleo, adicione a linha `<id>: ghcr.io/victorsouzadev/hub-<id>@<commit>` no `plugins.lock`. Depois do deploy:
   rode `postgres-hub.sh permissoes` e confira (ver "Caminho 4").

## Caminho 2: mudar um plug-in que já existe

- Trabalhe no repositório `hub-<id>`, não no núcleo. Clone na pasta de scratchpad se ele não estiver local.
- Coluna ou tabela nova: só mude a entidade, e o `Esquema.Garantir` cria na próxima subida. Coluna `NOT NULL` precisa de
  um valor padrão no modelo para as linhas que já existem.
- Rota que saiu ou mudou de lugar vai para `rotasLegadas`. Apps Android e conectores do Claude instalados não podem
  quebrar.
- SDK novo: mude `<Version>` em `pacotes/Hub.Plugin.Sdk/Hub.Plugin.Sdk.csproj` no núcleo; o merge publica a Release. Depois
  atualize a versão em `scripts/baixar-sdk.sh` de cada plug-in. O deployer aceita o contrato atual e o anterior.
- Para pôr no ar: PR no plug-in, CI verde, merge, e então um PR no núcleo trocando o commit da linha no `plugins.lock`.
  Plug-in congelado só muda quando o usuário pedir.
- A CI inteira tem de passar nos dois repositórios: backend, também com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`,
  frontend, Android quando existir, e no núcleo também cerebro e deployer.

## Caminho 3: adaptar um app que vem de fora

Siga a receita de extração do `DEPLOY.md` (specs 031 e 033–035), nesta ordem:

1. **Levantar.** Liste as rotas, as tabelas, o login atual, os segredos, os arquivos em disco, o app Android ou MCP e as URLs
   que estão em uso. Mostre o levantamento ao usuário antes de mexer.
2. **Login.** Troque o login próprio do app pelo do núcleo (`AdicionarPlugin()` + `RequireAuthorization()`, `c.UsuarioId()`).
   Os usuários do app viram ids de `nucleo.users`. Se o app tiver contas próprias, pergunte como casar cada uma com uma
   conta do hub.
3. **Banco.** Ponha o prefixo do id nas tabelas, use `UsarBancoDoHub` e `ReferenciarUsuarios()`. Os dados que já existem
   entram por uma cópia única, num ensaio feito antes com uma cópia da produção. A `ferramentas/CopiaParaPostgres` e a
   `Migracao033` do hub-cerebro servem de modelo. Nunca apague a origem: ela é a volta.
4. **Arquivos.** Vão para `data/plugins/dados/<id>/`, declarados em `dados` no manifesto, com dono root, porque o
   container roda como `0:0` sem capacidades.
5. **Rotas.** Tudo sob `/<id>/`. O que já era usado fora disso vai para `rotasLegadas`.
6. **Telas.** Aplique o Grafite e ponha a `<grafite-barra>`.
7. **Virada, com confirmação.** Ensaio local rodando a imagem como o deployer (`--user 0:0 --cap-drop ALL`). Depois o
   backup, a linha no lock, a conferência, e só por último o PR que tira o código antigo.

## Caminho 4: diagnosticar na VPS

Use as ferramentas `mcp__vps__*` e comece só lendo. Não grave nada na VPS sem confirmação.

```sh
cat /opt/notas-vps/data/plugins/estado.json            # versão, anterior, no ar, última falha
docker logs notas-vps-deployer-1 --tail 80             # o que o deployer fez e por quê
docker logs plugin-<id> --tail 80
docker exec notas-caddy wget -qO- http://plugin-<id>:8080/<id>/api/health
ls /opt/notas-vps/data/plugins/banco/                  # sem arquivo = o plug-in recebe o notas.db
docker exec notas-postgres psql -U postgres -d hub -c '\dn+'   # schemas e donos
```

O que costuma dar errado:

| O que aparece | Causa provável |
|---|---|
| `permission denied for schema nucleo` | faltou rodar `postgres-hub.sh permissoes` depois que o plug-in subiu |
| `too many clients` | os pools somam mais que 60 conexões: baixe o `Maximum Pool Size` |
| health falha e o deployer volta a versão anterior | veja o `ultimaFalha` no `estado.json` e o log do plug-in |
| 401 em tudo | `aud` errado, JWKS fora do alcance ou `HUB_ACEITAR_AUDIENCIA_LEGADA` |
| rota antiga dá 404 | falta em `rotasLegadas`, ou o Caddy não foi recarregado (`data/plugins/caddy/<id>.caddy`) |
| não grava arquivo | a pasta em `data/plugins/dados/<id>` não é do root |

Para corrigir, descreva o que vai mudar e espere o "sim" do usuário.

## Como trabalhar com o usuário

- Ao terminar cada passo, mostre o resultado e pergunte antes de seguir para o próximo.
- Não abra nem faça merge de PR sem ele pedir.
- Commits terminam com a linha de coautoria da sessão. Valores financeiros do usuário nunca vão para o GitHub.
