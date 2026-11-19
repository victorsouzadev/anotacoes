# Quickstart: Pacotes compartilhados dos plug-ins

1. `dotnet test pacotes/Hub.Plugin.Sdk.Tests` e `npm test` em `pacotes/grafite-ui`.
2. Mudar a versão de um pacote e fazer merge: `pacotes.yml` publica no GitHub Packages.
3. Criar `hub-exemplo` a partir do template `hub-modelo`, trocar o `id`, fazer push: a CI passa e publica a imagem.
4. No hub, abrir o Exemplo: a barra aparece, o tema acompanha o do hub, nada de novo login.
5. Manifesto com `contrato` igual ao atual menos 2: o deployer recusa.
