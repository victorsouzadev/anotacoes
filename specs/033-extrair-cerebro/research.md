# Research: Extrair o Segundo Cérebro como primeiro plug-in

- **Histórico do código**: **Decision** `git subtree split --prefix=cerebro` para o `hub-cerebro`, mantendo os commits. As telas Angular entram num commit separado. **Alternatives**: copiar sem histórico (rejeitado: perde o `git blame` de 026–028).
- **Migração do `hub.db`**: **Decision** `Migracao033` roda no boot do plug-in quando `cerebro_capturas` está vazia e `data/hub/hub.db` existe: copia em transação, confere contagens, renomeia o arquivo para `hub.db.pre-033`. Idempotente. OAuth: o plug-in chama `POST /api/core/oauth/importar` (token de serviço, uma vez) com clientes e famílias de refresh (só hashes), porque não grava tabela do núcleo (031).
- **Índice e vetores**: **Decision** continuam em `data/cerebro/hub` (FTS5 e `vectors.db`). Colocá-los no banco compartilhado aumentaria o arquivo, o backup e a disputa de escrita sem ganho: são recriáveis a partir do vault.
- **Telas**: **Decision** build Angular próprio em `web/`, servido pelo container em `/cerebro/`, com `<grafite-barra>`. O hub mantém só o card (vindo de `/api/plugins`) e `/autorizar`.
- **WebDAV**: **Decision** o container `cerebro-webdav` passa para o compose gerado do plug-in (segundo serviço do mesmo manifesto num contrato futuro). Nesta spec ele fica no compose do núcleo, sem mudança, para não mexer no Obsidian.
- **Tokens estáticos**: **Decision** o Cérebro para de gerar `apps-token.json` e `ops-token.json` só depois que `Notas.Api` e `ops` leem de `core_mcp_tokens` (030 T014). Até lá, ambos funcionam.
