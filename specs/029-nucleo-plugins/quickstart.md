# Quickstart: Núcleo do hub e contrato de plug-ins

1. `dotnet test backend/Notas.Api.sln` e `dotnet test deployer/Notas.Deployer.sln` — registro, manifesto, rotas.
2. Subir local com o plug-in de exemplo (`hub-exemplo`) no `plugins.lock`; o card "Exemplo" aparece no hub e `/exemplo/` abre.
3. `docker stop` no exemplo: em até 1 minuto o card fica "indisponível"; o resto do hub segue normal.
4. Trocar a versão do exemplo por uma com health quebrado: o deployer volta para a anterior e Configurações → Servidor mostra a falha.
5. Manifesto com `rota: "/api/auth"`: o deploy recusa e explica.
6. `curl /api/dieta/...` com a Dieta ainda no núcleo e depois de extraída (035): mesma resposta.
