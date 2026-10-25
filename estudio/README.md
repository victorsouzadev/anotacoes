# Estúdio

O Estúdio (`/estudio`) junta, numa ferramenta só do hub, os craft apps do
[ArtCraft](https://getartcraft.com/apps), as IAs de imagem, vídeo, áudio e 3D
via [fal.ai](https://fal.ai) e as ferramentas do próprio hub: Editor de Imagens,
Palco 3D, Storyboard, Moodboard, Montagem de vídeo e Extrair quadros. Tudo
grava na mesma **biblioteca** de mídia, e cada parte pode ser usada pelo
Claude por MCP.

| Onde | O quê |
|---|---|
| `/estudio` | Início: os apps por categoria e o que foi criado por último |
| `/estudio/apps/<craft>` | Um craft app (PhotoCraft, FilmCraft…) |
| `/estudio/ia/<app>` | Um app de IA (Criar imagem, Criar vídeo, Objeto 3D…) |
| `/estudio/ferramentas/<id>` | Palco 3D, Storyboard, Moodboard, Montagem, Quadros, Editar imagem |
| `/estudio/editor` | O antigo Editor de Imagens (`/imagens` redireciona para cá) |
| `/estudio/biblioteca` | Todos os arquivos, com pastas, busca e filtros por tipo |
| `/estudio/config` | Chaves (fal.ai, World Labs), teto de gasto e, no Windows, "Conectar ao Claude" |

## Craft apps

Os 13 apps do ArtCraft (código MIT/Apache-2.0, em Rust e WebAssembly) rodam
**dentro do navegador**, sem servidor de IA nem custo por uso.

| App | Para quê | Build | Abrir/salvar no hub |
|---|---|---|---|
| PhotoCraft | Editor de imagem (camadas, PSD) | Trunk | ponte JS |
| VectorCraft | Ilustração vetorial | Trunk | ponte JS |
| LightCraft | Fotos e revelação RAW | xtask | ponte JS |
| FilmCraft | Editor de vídeo | xtask | ponte JS |
| EffectCraft | Motion graphics | xtask | ponte JS |
| SoundCraft | Áudio e mixagem | Trunk | ponte JS |
| DesignCraft | Diagramação | Trunk | ponte JS |
| FigCraft | Design de interface | Trunk | ponte JS |
| DeckCraft | Apresentações (.pptx) | Trunk | ponte JS |
| WordCraft | Texto (.docx) | Trunk | ponte nativa |
| GridCraft | Planilhas (.xlsx) | Trunk | ponte nativa |
| PdfCraft | PDF | Trunk | ponte nativa |
| CADCraft | Desenho técnico (DXF/DWG) | Trunk | ponte nativa |

**Como são publicados.** `estudio/crafts/crafts.json` fixa o repositório e o
commit de cada app. O workflow **Craft apps** (`.github/workflows/crafts.yml`)
roda quando o manifesto muda na main, ou à mão, para todos ou só alguns apps.
Ele compila com `estudio/crafts/build.sh`, que clona, aplica os patches de
`estudio/crafts/patches/<id>/` se houver, gera o build web e injeta a ponte. Os
arquivos vão já comprimidos (br/gz) para `/opt/notas-vps/downloads/crafts/<id>`,
que o Caddy serve em `/crafts/<id>/`. Para atualizar um app, troque o `commit`
no manifesto.

O mesmo workflow também:

- compila a linha de comando de cada app (em Alpine), para o MCP remoto;
- gera o pacote `downloads/crafts-web/crafts-web.tar.gz`, que o instalador do
  Windows embute.

**Como abrem.** A tela abre `/crafts/<id>/index.html` num iframe do mesmo
endereço. Antes, um `HEAD` com o cabeçalho `X-Craft-App` confere se o build
existe: sem ele, aparece "ainda não publicado". O diálogo com o app vai por
`postMessage` (`<app>:ready/open/save/dirty/failed`):

- **nativa:** WordCraft, GridCraft, PdfCraft e CADCraft já falam esse
  protocolo;
- **JS:** nos outros 9, `estudio/crafts/ponte-hub.js` (injetado no `<head>`)
  faz o papel da ponte:
  - o "baixar" do app (`createObjectURL` + clique num `<a download>`) vira
    salvar na biblioteca;
  - "abrir" solta o arquivo no canvas com um arrastar sintético;
  - o aviso de "não salvo" do app vira o estado de alterações pendentes.

O teste fica em `estudio/crafts/teste/` e roda no Playwright, no CI.

Cada app tem ainda o painel **IA**, que gera com o fal sem sair do app e
manda o resultado para dentro dele.

## IA pelo fal.ai

O fal.ai é um agregador: uma chave só dá acesso a cerca de 60 modelos de
vários fabricantes, cobrados por uso na sua conta do fal.

| Tipo | Modelos | Exemplos |
|---|---|---|
| Imagem | 23 | Nano Banana, GPT Image, FLUX, Seedream, ângulos, remover fundo, ampliar |
| Vídeo | 16 | Veo 3.1, Kling, Seedance, Vidu, MiniMax, remover fundo de vídeo |
| Áudio | 7 | Lyria 2, ACE-Step, Stable Audio, ElevenLabs (efeitos e voz), MMAudio |
| Objeto 3D | 10 | Hunyuan 3D, Tripo3D, Meshy, Rodin |
| Mundo 3D | 4 | TripoSplat (fal), Marble (World Labs, chave própria) |

**Configurar.**

1. Crie a chave em [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) e
   ponha saldo em fal.ai/dashboard/billing.
2. Cole a chave em `/estudio/config`. Ela é guardada cifrada no banco, por
   usuário, e só volta mascarada.
3. Opcional: uma chave padrão do servidor, `FAL_KEY` no `.env`, vale para quem
   não cadastrou a própria. A World Labs (`WORLDLABS_API_KEY`, ou na tela) só é
   necessária para os mundos Marble.

**Como uma geração anda.**

1. A tela (ou o MCP) manda `POST /api/estudio/geracoes` com
   `{modelo, operacao, parametros, entradas}`. As entradas são ids da
   biblioteca.
2. O backend confere obrigatórios, opções e limites pelo catálogo, estima o
   custo e recusa se passar do teto mensal.
3. Entradas: cada arquivo vai para o armazenamento do fal (`storage/upload`).
   Se o upload falhar, imagem pequena vai como data URL.
4. A geração entra na fila do fal (`queue.fal.run/<endpoint>`).
5. O `EstudioWorker` consulta o status com intervalo crescente, por até 3 horas,
   baixa o resultado para a biblioteca, mede (duração, tamanho) e faz a
   miniatura.
6. Cancelar chama o `cancel_url` do fal. Erros definitivos (chave inválida,
   sem saldo, conteúdo recusado) param na hora. Os temporários são
   retentados.

**Custo.** Cada operação do catálogo tem a fórmula de preço do fal: fixo, por
imagem, por segundo de vídeo ou de áudio de entrada, ou por caractere. A tela
mostra a estimativa antes de gerar. Em `/estudio/config` ficam:

- o gasto estimado do mês;
- o **teto mensal**;
- o valor acima do qual o MCP pede confirmação (padrão US$ 1).

O valor exato é o do painel do fal.

**Catálogo.** Fica em `backend/Notas.Api/Services/Estudio/catalogo.json`,
embutido na API. Cada modelo diz:

- o endpoint;
- o mapa dos parâmetros genéricos (prompt, proporção, duração…) para os campos
  daquele modelo;
- opções, padrões e limites;
- a fórmula de custo.

Um endpoint mudou de nome ou faltou um modelo? `Estudio__CatalogoArquivo`
aponta para um JSON no mesmo formato, que soma ou substitui modelos sem novo
deploy.

**O que roda sem fal (ffmpeg).** Estas operações rodam no próprio servidor ou
PC e não custam nada:

- montagem de vídeo: cortes, trilhas e volumes, com `filter_complex`;
- extrair quadros;
- miniaturas e medição.

O **Trocar fundo de vídeo** junta as duas coisas: tira o fundo no fal e
compõe o fundo novo com ffmpeg, mantendo o áudio.

## Ferramentas do hub

- **Editor de Imagens.** O mesmo de antes (Print & Cut, Molde SVG, Redes
  sociais, Ilustração), agora em `/estudio/editor`. Recebe arquivos da
  biblioteca (`POST /api/estudio/midias/{id}/editor`).
- **Editar imagem / Remover marca d'água.** Você pinta a máscara e diz o que
  fazer (inpainting), ou só descreve a mudança.
- **Palco 3D.** Cena em Three.js com:
  - modelos GLB e splats (Spark) da biblioteca;
  - bonecos articulados para pose;
  - luzes e câmera.

  "Gerar a partir da cena" manda a captura para uma IA de imagem ou vídeo.
- **Storyboard.** Quadros com prompt, imagem e duração. Gera cada quadro e
  junta tudo num vídeo.
- **Moodboard.** Quadro livre de referências, que vira entrada de uma geração.
- **Montagem de vídeo** e **Extrair quadros**, com ffmpeg.

Storyboards, moodboards, cenas e montagens são guardados em
`/api/estudio/quadros`.

## MCPs

| MCP | Endereço | Para quê |
|---|---|---|
| Estúdio (remoto) | `https://<site>/api/mcp/estudio` | Tudo o que a tela faz: gerar, acompanhar, biblioteca, montar vídeo, quadros, documentos |
| Crafts (remoto) | `https://<site>/api/mcp/crafts/<app>` | A linha de comando de cada craft app (`<app>-cli mcp`), com uma pasta de trabalho por sessão |
| Estúdio (local) | `mcp/` (Node, stdio) | O mesmo do remoto e mais: enviar arquivos do computador e baixar resultados para uma pasta |
| Estúdio (Windows) | `http://127.0.0.1:47820/api/mcp/estudio` | O do remoto, servido pelo programa desktop |

**Remoto.** Usa o mesmo token dos outros MCPs do hub, o arquivo gerado na tela
do Segundo Cérebro (`Authorization: Bearer <token>`). Ferramentas:

- gerar e acompanhar: `estudio_modelos`, `estudio_estimar`, `estudio_gerar`,
  `estudio_trocar_fundo_video`, `estudio_status`, `estudio_cancelar`,
  `estudio_geracoes`, `estudio_uso`;
- biblioteca: `estudio_midias`, `estudio_midia`, `estudio_enviar_url`,
  `estudio_enviar_arquivo`, `estudio_organizar_midia`, `estudio_apagar_midia`;
- levar para outra tela: `estudio_para_editor`, `estudio_abrir_no_app`;
- edição local: `estudio_montar_video`, `estudio_extrair_quadros`;
- documentos (storyboard, moodboard, cena, timeline): `estudio_documentos`,
  `estudio_documento`, `estudio_salvar_documento`.

`estudio_gerar` acima do limite de confirmação devolve o custo e só gera com
`confirmar: true`. `estudio_apagar_midia` também pede confirmação.

**Crafts.** Liga com o profile `crafts` e `CRAFTS_MCP_URL`:

```bash
echo "COMPOSE_PROFILES=crafts" >> /opt/notas-vps/.env   # ou some aos profiles que já estão lá
echo "CRAFTS_MCP_URL=http://crafts-mcp:8080" >> /opt/notas-vps/.env
```

O serviço `crafts-mcp` (`crafts-mcp/servidor.mjs`) abre uma CLI por sessão MCP
e repassa as mensagens. As CLIs vêm de `downloads/crafts-cli`, gravadas pelo
workflow, e cada uma só lê e grava na pasta da sessão
(`--automation-read-root/--automation-write-root`). A API soma três
ferramentas a cada app:

- `hub_trazer_midia`: biblioteca → pasta da sessão;
- `hub_guardar_arquivo`: pasta da sessão → biblioteca;
- `hub_arquivos_da_sessao`.

**Local e Windows.** Ver [mcp/README.md](../mcp/README.md#estúdio) e
[desktop/README.md](../desktop/README.md#estúdio-no-windows).

## Configuração do servidor

| Variável (`.env`) | Para quê |
|---|---|
| `FAL_KEY` | Chave padrão do fal.ai (opcional; cada usuário pode pôr a sua na tela) |
| `WORLDLABS_API_KEY` | Chave padrão da World Labs (mundos Marble) |
| `CRAFTS_MCP_URL` | `http://crafts-mcp:8080` para ligar o MCP dos crafts (com o profile `crafts`) |

Os arquivos ficam em `./data/estudio` (volume `/data/estudio` da API). Os links
de mídia são assinados (HMAC com prazo), para `<img>` e `<video>` abrirem sem
cabeçalho de login. Outras opções (`Estudio__*`, ver `EstudioOptions.cs`):
`MaxUploadBytes` (500 MB), `MaxDownloadBytes`, `ConsultaSegundos`,
`CatalogoArquivo`, `Ffmpeg`/`Ffprobe`.

## Limites conhecidos

- Os builds em Rust e as CLIs só foram validados no CI. Rode o workflow
  **Craft apps** uma vez antes de abrir os apps.
- A ponte JS depende de como cada app baixa e recebe arquivos. Uma versão nova
  do app pode exigir ajuste em `ponte-hub.js`, e o teste do Playwright avisa.
- Alguns endpoints do fal são novos e podem mudar de nome, como Bria Video,
  Seedream 4.5 e ACE-Step. Se uma geração falhar com "endpoint não
  encontrado", corrija pelo `Estudio__CatalogoArquivo`.

Créditos e licenças dos apps: [TERCEIROS.md](TERCEIROS.md).
