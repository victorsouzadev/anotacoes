import { IconName } from '../../shared/icon';
import { TipoMidia } from './estudio.models';

/**
 * Tudo o que o Estúdio abre, num lugar só: a grade da tela inicial, a busca e o MCP leem daqui.
 *
 * - craft: os 13 apps do ArtCraft (Rust/WebAssembly), servidos em /crafts/<id>/ e abertos num
 *   iframe que troca arquivos com a biblioteca pela ponte `<id>:ready/open/save/dirty`.
 * - ia: gerações no fal.ai (e World Labs), numa tela comum configurada por app.
 * - ferramenta: telas próprias (Editor de Imagens, Palco 3D, Storyboard…).
 */
export type CategoriaApp = 'craft' | 'ia' | 'ferramenta';

export interface AppEstudio {
  id: string;
  nome: string;
  subtitulo: string;
  descricao: string;
  icone: IconName;
  categoria: CategoriaApp;
  rota: string;
  /** Selo na grade. */
  selo?: 'alfa' | 'em desenvolvimento' | 'beta';
}

export interface CraftApp extends AppEstudio {
  categoria: 'craft';
  /** Extensões que o app abre (para filtrar a biblioteca e escolher o app de um arquivo). */
  abre: string[];
  /** Tipos de mídia da biblioteca que o painel de IA pode mandar para o app. */
  recebe: TipoMidia[];
  /** Precisa de WebGPU (todos menos LightCraft e PdfCraft, que usam WebGL2). */
  webgpu: boolean;
  /** Versão do commit fixado em estudio/crafts/crafts.json. */
  versao: string;
  repo: string;
}

export const CRAFTS: CraftApp[] = [
  {
    id: 'photocraft', nome: 'PhotoCraft', subtitulo: 'Editor de imagem', icone: 'image', categoria: 'craft', rota: '/estudio/apps/photocraft',
    descricao: 'Camadas, máscaras, ajustes não destrutivos, 70+ filtros, PSD/PSB e seleção de objeto no próprio aparelho.',
    abre: ['.psd', '.psb', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'], recebe: ['imagem', 'documento'], webgpu: true,
    selo: 'alfa', versao: '0.15.1', repo: 'storytold/photocraft',
  },
  {
    id: 'vectorcraft', nome: 'VectorCraft', subtitulo: 'Ilustração vetorial', icone: 'vector', categoria: 'craft', rota: '/estudio/apps/vectorcraft',
    descricao: 'Pena, booleanas exatas, efeitos vivos, malha de gradiente, vetorização de imagem. SVG e PDF.',
    abre: ['.svg', '.pdf', '.json', '.png', '.jpg', '.jpeg', '.webp'], recebe: ['imagem', 'documento'], webgpu: true,
    selo: 'em desenvolvimento', versao: '0.16.0', repo: 'storytold/vectorcraft',
  },
  {
    id: 'lightcraft', nome: 'LightCraft', subtitulo: 'Fotos e revelação RAW', icone: 'aperture', categoria: 'craft', rota: '/estudio/apps/lightcraft',
    descricao: 'Biblioteca de fotos e revelação não destrutiva de RAW (DNG, CR2, NEF, ARW, RAF…), máscaras de céu e assunto.',
    abre: ['.dng', '.cr2', '.nef', '.arw', '.raf', '.rw2', '.pef', '.orf', '.jpg', '.jpeg', '.png', '.tif', '.tiff'], recebe: ['imagem', 'documento'], webgpu: false,
    selo: 'em desenvolvimento', versao: '0.13.0', repo: 'storytold/lightcraft',
  },
  {
    id: 'filmcraft', nome: 'FilmCraft', subtitulo: 'Editor de vídeo', icone: 'film', categoria: 'craft', rota: '/estudio/apps/filmcraft',
    descricao: 'Linha do tempo profissional, cortes, correção de cor, 55 efeitos e 30 transições, legendas, áudio com loudness.',
    abre: ['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.mp3', '.wav', '.png', '.jpg', '.srt', '.vtt'], recebe: ['video', 'audio', 'imagem'], webgpu: true,
    selo: 'em desenvolvimento', versao: '0.12.0', repo: 'storytold/filmcraft',
  },
  {
    id: 'effectcraft', nome: 'EffectCraft', subtitulo: 'Motion graphics e efeitos', icone: 'sparkles', categoria: 'craft', rota: '/estudio/apps/effectcraft',
    descricao: 'Composições, keyframes, 259 efeitos, 3D com câmeras e luzes, expressões, Lottie, ProRes com alfa e EXR.',
    abre: ['.mp4', '.mov', '.webm', '.png', '.jpg', '.svg', '.json', '.lottie', '.mp3', '.wav'], recebe: ['video', 'imagem', 'audio'], webgpu: true,
    selo: 'em desenvolvimento', versao: '0.16.0', repo: 'storytold/effectcraft',
  },
  {
    id: 'soundcraft', nome: 'SoundCraft', subtitulo: 'Estúdio de áudio', icone: 'music', categoria: 'craft', rota: '/estudio/apps/soundcraft',
    descricao: 'Gravação, edição e mixagem: console completo, automação, plugins próprios e CLAP, MIDI, partitura, surround.',
    abre: ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.mid', '.midi', '.mp4'], recebe: ['audio', 'video'], webgpu: true,
    selo: 'em desenvolvimento', versao: '0.12.1', repo: 'storytold/soundcraft',
  },
  {
    id: 'designcraft', nome: 'DesignCraft', subtitulo: 'Diagramação', icone: 'book', categoria: 'craft', rota: '/estudio/apps/designcraft',
    descricao: 'Páginas mestras, caixas de texto encadeadas, estilos, tipografia fina e PDF para gráfica (CMYK, sangria, PDF/X).',
    abre: ['.json', '.pdf', '.png', '.jpg', '.jpeg', '.svg'], recebe: ['imagem', 'documento'], webgpu: true,
    selo: 'em desenvolvimento', versao: '0.12.0', repo: 'storytold/designcraft',
  },
  {
    id: 'figcraft', nome: 'FigCraft', subtitulo: 'Design de interface', icone: 'figma', categoria: 'craft', rota: '/estudio/apps/figcraft',
    descricao: 'Auto layout, componentes com variantes, variáveis, protótipos e código para CSS, HTML, React, SwiftUI e Compose.',
    abre: ['.json', '.svg', '.png', '.jpg', '.jpeg'], recebe: ['imagem', 'documento'], webgpu: true,
    selo: 'alfa', versao: '0.10.0', repo: 'storytold/figcraft',
  },
  {
    id: 'deckcraft', nome: 'DeckCraft', subtitulo: 'Apresentações', icone: 'slides', categoria: 'craft', rota: '/estudio/apps/deckcraft',
    descricao: 'Mestres e temas, 150+ formas, transições com Morph, animações, modo apresentador. Abre e salva .pptx.',
    abre: ['.pptx', '.png', '.jpg', '.jpeg', '.svg'], recebe: ['imagem', 'documento'], webgpu: true,
    selo: 'em desenvolvimento', versao: '0.10.0', repo: 'storytold/deckcraft',
  },
  {
    id: 'wordcraft', nome: 'WordCraft', subtitulo: 'Texto', icone: 'file', categoria: 'craft', rota: '/estudio/apps/wordcraft',
    descricao: 'Faixa de opções, estilos, revisão com alterações controladas, sumário, notas, citações APA, MLA, Chicago e IEEE. Abre e salva .docx.',
    abre: ['.docx', '.odt', '.rtf', '.md', '.txt', '.html'], recebe: ['documento', 'imagem'], webgpu: true,
    selo: 'em desenvolvimento', versao: '0.10.0', repo: 'storytold/wordcraft',
  },
  {
    id: 'gridcraft', nome: 'GridCraft', subtitulo: 'Planilhas', icone: 'table', categoria: 'craft', rota: '/estudio/apps/gridcraft',
    descricao: '500+ funções, matrizes dinâmicas, LAMBDA, 17 tipos de gráfico, tabelas dinâmicas. Abre e salva .xlsx.',
    abre: ['.xlsx', '.csv'], recebe: ['documento'], webgpu: true,
    selo: 'em desenvolvimento', versao: '0.11.1', repo: 'storytold/gridcraft',
  },
  {
    id: 'pdfcraft', nome: 'PdfCraft', subtitulo: 'PDF', icone: 'file', categoria: 'craft', rota: '/estudio/apps/pdfcraft',
    descricao: 'Ler, buscar, reorganizar páginas, juntar, separar e proteger PDFs (até AES-256), com salvamento seguro.',
    abre: ['.pdf'], recebe: ['documento'], webgpu: false,
    selo: 'alfa', versao: '0.13.0', repo: 'storytold/pdfcraft',
  },
  {
    id: 'cadcraft', nome: 'CADCraft', subtitulo: 'Desenho técnico', icone: 'ruler', categoria: 'craft', rota: '/estudio/apps/cadcraft',
    descricao: 'Comandos digitados, snaps, cotas associativas, hachuras, blocos, restrições paramétricas. DXF e DWG.',
    abre: ['.dxf', '.dwg'], recebe: ['documento'], webgpu: true,
    selo: 'em desenvolvimento', versao: '0.12.0', repo: 'storytold/cadcraft',
  },
];

/** Ferramentas de geração (tela comum em /estudio/ia/<id>), ligadas ao catálogo pelo tipo e pelas operações. */
export interface AppIa extends AppEstudio {
  categoria: 'ia';
  /** Tipo de modelo do catálogo. */
  tipoModelo: 'imagem' | 'video' | 'audio' | 'modelo3d' | 'mundo';
  /** Operações oferecidas, na ordem das abas (só aparecem as que o modelo escolhido faz). */
  operacoes: { id: string; rotulo: string }[];
  /** Família(s) de modelo a mostrar (vazio = todas do tipo que fazem as operações). */
  familias?: string[];
  promptRotulo?: string;
  promptDica?: string;
  /** Texto que entra no prompt quando o usuário não escreve nada (ex.: tirar marca d'água). */
  promptPadrao?: string;
  /** Etapa depois do provedor, feita no servidor (ex.: juntar o vídeo sem fundo à imagem nova). */
  pipeline?: string;
}

export const IAS: AppIa[] = [
  {
    id: 'criar-imagem', nome: 'Criar imagem', subtitulo: 'Texto e referências', icone: 'sparkles', categoria: 'ia', rota: '/estudio/ia/criar-imagem',
    descricao: 'Nano Banana, GPT Image, FLUX, Seedream: do zero ou a partir de fotos de referência.',
    tipoModelo: 'imagem', operacoes: [{ id: 'texto', rotulo: 'Do texto' }, { id: 'editar', rotulo: 'Com referências' }],
    promptDica: 'Descreva a cena, o estilo, a luz e o enquadramento.',
  },
  {
    id: 'editar-imagem', nome: 'Editar imagem', subtitulo: 'Por texto ou máscara', icone: 'wand', categoria: 'ia', rota: '/estudio/ferramentas/editar-imagem',
    descricao: 'Pinte a área e diga o que fazer (inpainting), ou só peça a mudança por texto.',
    tipoModelo: 'imagem', operacoes: [{ id: 'inpaint', rotulo: 'Área pintada' }, { id: 'editar', rotulo: 'Imagem toda' }],
  },
  {
    id: 'angulos', nome: 'Ângulos', subtitulo: 'Nova câmera', icone: 'camera', categoria: 'ia', rota: '/estudio/ia/angulos',
    descricao: 'Gira a câmera em volta do assunto de uma foto: lado, cima, baixo, perto ou longe.',
    tipoModelo: 'imagem', operacoes: [{ id: 'angulo', rotulo: 'Ângulo' }], familias: ['Ângulos'],
    promptRotulo: 'Detalhe extra (opcional)',
  },
  {
    id: 'remover-fundo', nome: 'Remover fundo', subtitulo: 'Recorte', icone: 'scissors', categoria: 'ia', rota: '/estudio/ia/remover-fundo',
    descricao: 'BiRefNet, Bria ou rembg: PNG transparente pronto para camada, adesivo ou palco 3D.',
    tipoModelo: 'imagem', operacoes: [{ id: 'remover-fundo', rotulo: 'Recortar' }], familias: ['Remover fundo'],
  },
  {
    id: 'ampliar', nome: 'Ampliar', subtitulo: 'Mais resolução', icone: 'zoom-in', categoria: 'ia', rota: '/estudio/ia/ampliar',
    descricao: 'Aumenta 2× ou 4×, recriando detalhes (Clarity) ou sem inventar (Real-ESRGAN).',
    tipoModelo: 'imagem', operacoes: [{ id: 'ampliar', rotulo: 'Ampliar' }], familias: ['Ampliar'],
  },
  {
    id: 'remover-marca', nome: "Remover marca d'água", subtitulo: 'Limpar imagem', icone: 'eraser-area', categoria: 'ia', rota: '/estudio/ferramentas/editar-imagem?modo=marca',
    descricao: "Pinte a marca (melhor) ou deixe a IA achar sozinha e limpar a imagem.",
    tipoModelo: 'imagem', operacoes: [{ id: 'inpaint', rotulo: 'Área pintada' }, { id: 'editar', rotulo: 'Automático' }],
    promptPadrao: 'Remove every watermark, logo overlay, signature and text stamp. Reconstruct the hidden areas naturally and keep everything else exactly the same.',
  },
  {
    id: 'criar-video', nome: 'Criar vídeo', subtitulo: 'Texto, imagem ou referências', icone: 'film', categoria: 'ia', rota: '/estudio/ia/criar-video',
    descricao: 'Veo 3.1, Kling, Seedance, Vidu, MiniMax: do texto, de uma imagem, do quadro inicial ao final ou de referências.',
    tipoModelo: 'video',
    operacoes: [
      { id: 'texto', rotulo: 'Do texto' }, { id: 'imagem', rotulo: 'De uma imagem' },
      { id: 'quadros', rotulo: 'Quadro inicial e final' }, { id: 'referencias', rotulo: 'Referências' },
    ],
    promptDica: 'Descreva a ação, o movimento de câmera e o som.',
  },
  {
    id: 'estender-video', nome: 'Estender vídeo', subtitulo: 'Continuar a cena', icone: 'play', categoria: 'ia', rota: '/estudio/ia/estender-video',
    descricao: 'Continua um vídeo a partir do último quadro (Veo 3.1).',
    tipoModelo: 'video', operacoes: [{ id: 'estender', rotulo: 'Estender' }],
  },
  {
    id: 'trocar-fundo', nome: 'Trocar fundo de vídeo', subtitulo: 'Novo cenário', icone: 'mountain', categoria: 'ia', rota: '/estudio/ia/trocar-fundo',
    descricao: 'Tira o fundo do vídeo e põe a imagem que você escolher atrás, mantendo o áudio.',
    tipoModelo: 'video', operacoes: [{ id: 'remover-fundo', rotulo: 'Trocar fundo' }], familias: ['Remover fundo'], pipeline: 'trocar-fundo',
  },
  {
    id: 'criar-audio', nome: 'Criar áudio', subtitulo: 'Música, efeito e voz', icone: 'mic', categoria: 'ia', rota: '/estudio/ia/criar-audio',
    descricao: 'Música (Lyria 2, ACE-Step), efeitos sonoros (ElevenLabs), narração e som para vídeo mudo (MMAudio).',
    tipoModelo: 'audio',
    operacoes: [
      { id: 'musica', rotulo: 'Música' }, { id: 'efeito', rotulo: 'Efeito sonoro' }, { id: 'fala', rotulo: 'Narração' },
      { id: 'video-para-audio', rotulo: 'Som para vídeo' },
    ],
  },
  {
    id: 'imagem-3d', nome: 'Objeto 3D', subtitulo: 'Imagem ou texto para 3D', icone: 'box', categoria: 'ia', rota: '/estudio/ia/imagem-3d',
    descricao: 'Hunyuan 3D, Tripo, Meshy, Rodin: modelo GLB texturizado de uma foto, várias vistas, texto ou esboço.',
    tipoModelo: 'modelo3d',
    operacoes: [
      { id: 'imagem', rotulo: 'De uma imagem' }, { id: 'multivistas', rotulo: 'Várias vistas' }, { id: 'texto', rotulo: 'Do texto' },
      { id: 'esboco', rotulo: 'De um esboço' }, { id: 'topologia', rotulo: 'Refazer malha' }, { id: 'partes', rotulo: 'Separar partes' },
    ],
  },
  {
    id: 'mundo-3d', nome: 'Mundo 3D', subtitulo: 'Cenário explorável', icone: 'globe', categoria: 'ia', rota: '/estudio/ia/mundo-3d',
    descricao: 'Marble (World Labs) ou TripoSplat: um lugar 3D fotográfico para andar dentro e montar cenas.',
    tipoModelo: 'mundo', operacoes: [{ id: 'imagem', rotulo: 'De uma imagem' }, { id: 'texto', rotulo: 'Do texto' }],
  },
];

export const FERRAMENTAS: AppEstudio[] = [
  {
    id: 'editor', nome: 'Editor de Imagens', subtitulo: 'Print & cut, moldes, redes sociais', icone: 'image', categoria: 'ferramenta', rota: '/estudio/editor',
    descricao: 'Contorno de corte, folha A4/A3, moldes SVG com fotos, posts para Instagram e ilustração vetorial.',
  },
  {
    id: 'palco', nome: 'Palco 3D', subtitulo: 'Cena antes de gerar', icone: 'box', categoria: 'ferramenta', rota: '/estudio/ferramentas/palco',
    descricao: 'Monte a cena com bonecos posáveis, objetos 3D, fundo e câmera, e gere a imagem final com IA.',
  },
  {
    id: 'storyboard', nome: 'Storyboard', subtitulo: 'Planos do filme', icone: 'grid-view', categoria: 'ferramenta', rota: '/estudio/ferramentas/storyboard',
    descricao: 'Planeje os planos com imagem, texto e duração; gere cada plano e vire vídeo na montagem.',
  },
  {
    id: 'moodboard', nome: 'Moodboard', subtitulo: 'Referências', icone: 'layers', categoria: 'ferramenta', rota: '/estudio/ferramentas/moodboard',
    descricao: 'Junte referências num quadro livre e use o quadro todo para guiar as gerações.',
  },
  {
    id: 'montagem', nome: 'Montagem de vídeo', subtitulo: 'Linha do tempo simples', icone: 'film', categoria: 'ferramenta', rota: '/estudio/ferramentas/montagem',
    descricao: 'Junte clipes, imagens e trilha, corte, ajuste volume e transições e exporte em MP4 (ffmpeg no servidor).',
  },
  {
    id: 'quadros', nome: 'Extrair quadros', subtitulo: 'Fotos de um vídeo', icone: 'camera', categoria: 'ferramenta', rota: '/estudio/ferramentas/quadros',
    descricao: 'Escolha os instantes do vídeo e guarde cada quadro como imagem na biblioteca.',
  },
  {
    id: 'biblioteca', nome: 'Biblioteca', subtitulo: 'Tudo o que você criou', icone: 'folder', categoria: 'ferramenta', rota: '/estudio/biblioteca',
    descricao: 'Imagens, vídeos, áudios, modelos 3D, mundos e documentos dos apps, com pastas e busca.',
  },
];

export const TODOS: AppEstudio[] = [...CRAFTS, ...IAS, ...FERRAMENTAS];

export function craft(id: string): CraftApp | undefined {
  return CRAFTS.find((c) => c.id === id);
}

export function ia(id: string): AppIa | undefined {
  return IAS.find((a) => a.id === id);
}

/** Craft app que abre este arquivo (pela extensão), na ordem da lista. */
export function craftsQueAbrem(nome: string): CraftApp[] {
  const ext = nome.includes('.') ? nome.slice(nome.lastIndexOf('.')).toLowerCase() : '';
  return CRAFTS.filter((c) => c.abre.includes(ext));
}
