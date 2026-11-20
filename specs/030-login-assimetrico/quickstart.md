# Quickstart: Login com chave assimétrica e OAuth no núcleo

1. `dotnet test backend/Notas.Api.sln` — ES256, JWKS, troca por plug-in, `aud` cruzado, janela HS256, OAuth portado.
2. `curl /.well-known/jwks.json` → uma chave `EC` `P-256` com `kid`.
3. Logado no hub, abrir `/exemplo/` (029): sem novo login; o token usado tem `aud=exemplo`.
4. Usar esse token em `/cerebro/api/...` → 401.
5. `docker exec <plug-in> env | grep -i jwt` → nada.
6. App Android da Dieta já instalado continua sincronizando depois do deploy.
7. Conector do Claude em `/cerebro/mcp` continua funcionando; revogar em Configurações → Conexões derruba em até 60 s.
