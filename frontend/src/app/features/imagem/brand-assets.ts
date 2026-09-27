/** Arquivos da marca Viih Mimos que os modelos de post usam: logo, laço,
 * corações, ícones e os padrões de fundo. São os SVGs do repositório da marca,
 * copiados pra `public/marca/viih-mimos` — o editor não depende do outro
 * repositório pra abrir.
 *
 * O desenho no canvas é síncrono, então cada arquivo é carregado uma vez e
 * guardado aqui; quem desenha pede a imagem já pronta e, se ela ainda não
 * chegou, simplesmente pula (a prévia é refeita quando o carregamento termina). */

export interface BrandAsset {
  id: string;
  label: string;
  file: string;
  /** Largura ÷ altura, do viewBox do arquivo. */
  aspect: number;
  /** Aparece na paleta "Marca" do painel de textos. Padrões de fundo não. */
  palette: boolean;
}

export const BRAND_ASSETS: BrandAsset[] = [
  { id: 'logo', label: 'Logo', file: 'viih-mimos-principal.svg', aspect: 1, palette: true },
  { id: 'assinatura', label: 'Assinatura', file: 'viih-mimos-assinatura.svg', aspect: 800 / 280, palette: true },
  { id: 'assinatura-branca', label: 'Assinatura branca', file: 'viih-mimos-assinatura-branca.svg', aspect: 800 / 280, palette: true },
  { id: 'submarca', label: 'Selo', file: 'viih-mimos-submarca.svg', aspect: 1, palette: true },
  { id: 'laco', label: 'Laço', file: 'laco-cheio.svg', aspect: 220 / 150, palette: true },
  { id: 'laco-contorno', label: 'Laço contorno', file: 'laco-contorno.svg', aspect: 220 / 150, palette: true },
  { id: 'coracao', label: 'Coração', file: 'coracao.svg', aspect: 1, palette: true },
  { id: 'coracao-contorno', label: 'Coração contorno', file: 'coracao-contorno.svg', aspect: 1, palette: true },
  { id: 'divisor', label: 'Divisor', file: 'divisor.svg', aspect: 10, palette: true },
  { id: 'icone-topo-de-bolo', label: 'Topo de bolo', file: 'icone-topo-de-bolo.svg', aspect: 1, palette: true },
  { id: 'icone-kit-festa', label: 'Kit festa', file: 'icone-kit-festa.svg', aspect: 1, palette: true },
  { id: 'icone-agendas', label: 'Agendas', file: 'icone-agendas.svg', aspect: 1, palette: true },
  { id: 'icone-caixas', label: 'Caixas', file: 'icone-caixas.svg', aspect: 1, palette: true },
  { id: 'icone-sacolas', label: 'Sacolas', file: 'icone-sacolas.svg', aspect: 1, palette: true },
  { id: 'icone-convites', label: 'Convites', file: 'icone-convites.svg', aspect: 1, palette: true },
  { id: 'icone-encomendas', label: 'Encomendas', file: 'icone-encomendas.svg', aspect: 1, palette: true },
  { id: 'icone-avaliacoes', label: 'Avaliações', file: 'icone-avaliacoes.svg', aspect: 1, palette: true },
  { id: 'icone-sobre', label: 'Sobre', file: 'icone-sobre.svg', aspect: 1, palette: true },
  { id: 'padrao-coracoes', label: 'Corações', file: 'padrao-coracoes.svg', aspect: 1, palette: false },
  { id: 'padrao-lacos', label: 'Laços', file: 'padrao-lacos.svg', aspect: 1, palette: false },
  { id: 'padrao-confete', label: 'Confete', file: 'padrao-confete.svg', aspect: 1, palette: false },
];

/** Padrões de fundo, na ordem do seletor. O id vazio é "sem padrão". */
export const BRAND_PATTERNS = BRAND_ASSETS.filter((a) => a.id.startsWith('padrao-'));

/** Cores da marca, com os nomes do manual. */
export const BRAND_COLORS = [
  { id: 'rosa-doce', label: 'Rosa doce', hex: '#E7548C' },
  { id: 'rosa-algodao', label: 'Rosa algodão', hex: '#F28BAE' },
  { id: 'rosa-bebe', label: 'Rosa bebê', hex: '#F7B6C7' },
  { id: 'rosa-nuvem', label: 'Rosa nuvem', hex: '#FFE6EE' },
  { id: 'rosa-profundo', label: 'Rosa profundo', hex: '#C2185B' },
  { id: 'grafite', label: 'Grafite', hex: '#4D4D4D' },
  { id: 'branco', label: 'Branco', hex: '#FFFFFF' },
] as const;

export function brandAssetDef(id: string): BrandAsset | undefined {
  return BRAND_ASSETS.find((a) => a.id === id);
}

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<void>>();

/** A imagem já carregada, ou `null` se ainda não chegou (ou o id não existe). */
export function brandImage(id: string): HTMLImageElement | null {
  return cache.get(id) ?? null;
}

/** Carrega os arquivos pedidos. Falha de rede não derruba o desenho: o
 * elemento só não aparece. */
export function ensureBrandAssets(ids: Iterable<string>): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const id of new Set(ids)) {
    if (cache.has(id)) continue;
    const def = brandAssetDef(id);
    if (!def) continue;
    let job = pending.get(id);
    if (!job) {
      job = new Promise<void>((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          cache.set(id, img);
          pending.delete(id);
          resolve();
        };
        img.onerror = () => {
          pending.delete(id);
          resolve();
        };
        img.src = new URL(`marca/viih-mimos/${def.file}`, document.baseURI).href;
      });
      pending.set(id, job);
    }
    jobs.push(job);
  }
  return Promise.all(jobs).then(() => undefined);
}
