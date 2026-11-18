# Quickstart: OAuth 2.1 no MCP

1. `dotnet test segundo-cerebro.slnx` — `OAuthTests`.
2. `curl -i https://<domínio>/cerebro/mcp` → 401 com `WWW-Authenticate` e `resource_metadata`.
3. `curl https://<domínio>/.well-known/oauth-authorization-server/cerebro` → JSON com `S256`.
4. No Claude web, adicionar o conector `https://<domínio>/cerebro/mcp`; aprovar na página do hub; chamar `search`.
5. Tela do Cérebro → Conectar → Aplicativos autorizados → Revogar; nova chamada do Claude falha com 401.
6. Claude Code com o token estático continua funcionando.
