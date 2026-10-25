# Terceiros

## Craft apps (ArtCraft)

Os 13 craft apps que o Estúdio abre são compilados, sem alteração de
funcionalidade, a partir dos repositórios públicos da Storytold
(<https://github.com/storytold>, <https://getartcraft.com/apps>):

PhotoCraft, VectorCraft, LightCraft, FilmCraft, EffectCraft, SoundCraft,
DesignCraft, FigCraft, DeckCraft, WordCraft, GridCraft, PdfCraft, CADCraft.

- **Licença:** dupla, MIT ou Apache-2.0, à escolha. O texto de cada licença
  acompanha o código-fonte de cada repositório, no commit fixado em
  `estudio/crafts/crafts.json`.
- **O que muda no build:** o hub acrescenta só o script `ponte-hub.js` no
  `<head>` do build web, para abrir e salvar arquivos na biblioteca. Patches
  eventuais ficam em `estudio/crafts/patches/<app>/`, à vista.
- **Marcas:** "ArtCraft" e os nomes dos apps são marcas dos seus donos. O
  Estúdio só os usa para identificar os apps, e não há vínculo nem endosso.

## Outros componentes

| Componente | Licença | Uso |
|---|---|---|
| [Three.js](https://threejs.org) | MIT | Palco 3D e visualizador de modelos |
| [Spark](https://sparkjs.dev) (`@sparkjsdev/spark`) | MIT | Splats dos mundos 3D |
| [FFmpeg](https://ffmpeg.org) | LGPL/GPL (build "essentials" do gyan.dev no Windows é GPL) | Montagem de vídeo, quadros, troca de fundo, miniaturas. No servidor vem do pacote do Debian; no Windows vai ao lado do programa, com a licença |
| [ModelContextProtocol C# SDK](https://github.com/modelcontextprotocol/csharp-sdk) | MIT | MCPs da API |

Os modelos de IA rodam nos servidores do fal.ai e da World Labs, sob os termos
de cada provedor e de cada modelo. O uso é cobrado na conta de quem cadastrou
a chave.
