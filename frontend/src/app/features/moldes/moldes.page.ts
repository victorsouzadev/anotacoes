import { Component, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { FONT_CATALOG, FONT_CATEGORIES, FontLibrary, nearestWeight } from '../imagem/fonts';
import { pathsBounds, pathsToD, unionBounds } from '../imagem/illustration-model';
import { downloadBlob } from '../imagem/svg-template';
import { zipStore, ZipEntry } from '../imagem/zip';
import { CATEGORIAS, TIPOS, tipoPorId } from './catalogo';
import {
  COR_CORTE,
  COR_DOBRA,
  FORMATOS,
  Folha,
  ModoDobra,
  Orientacao,
  distribuir,
  dxfDaFolha,
  limitesDaPeca,
  svgDaFolha,
  temArte,
} from './folha';
import { carregarImagem, pngDaFolha } from './impressao';
import { Campo, CampoNumero, ImagemCarregada, Molde, Params, TipoMolde, Valor, fmt, sim, str } from './modelo';

const STORAGE_KEY = 'moldes:v1';

interface ConfigFolha {
  formato: string;
  orientacao: Orientacao;
  margem: number;
  espaco: number;
  copias: number;
  dobra: ModoDobra;
  traco: number;
  vao: number;
}

const FOLHA_PADRAO: ConfigFolha = { formato: 'a4', orientacao: 'auto', margem: 10, espaco: 4, copias: 1, dobra: 'linha', traco: 2, vao: 2 };

interface Salvo {
  tipo: string;
  params: Record<string, Params>;
  folha: ConfigFolha;
}

function lerSalvo(): Partial<Salvo> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Salvo>) : {};
  } catch {
    return {};
  }
}

/** Miniatura da primeira peça do molde padrão, pro seletor de tipos. */
function miniatura(tipo: TipoMolde): string | null {
  let molde: Molde;
  try {
    molde = tipo.gerar(tipo.padrao, { fonte: null, imagem: null });
  } catch {
    return null;
  }
  const peca = molde.pecas[0];
  const b = peca && limitesDaPeca(peca);
  if (!b) return null;
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.04;
  const vb = `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">` +
    `<path d="${pathsToD(peca.dobra)}" fill="none" stroke="${COR_DOBRA}" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-dasharray="3 2"/>` +
    `<path d="${pathsToD(peca.corte)}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/>` +
    `</svg>`
  );
}

@Component({
  selector: 'app-moldes-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  providers: [FontLibrary],
  templateUrl: './moldes.page.html',
  styleUrl: './moldes.page.css',
})
export class MoldesPageComponent {
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  readonly fonts = inject(FontLibrary);
  private readonly sanitizer = inject(DomSanitizer);

  readonly categorias = CATEGORIAS;
  readonly tipos = TIPOS;
  readonly formatos = FORMATOS;
  readonly fontCategories = FONT_CATEGORIES.filter((c) => c !== 'Enviadas');
  readonly fontCatalog = FONT_CATALOG;
  readonly corCorte = COR_CORTE;
  readonly corDobra = COR_DOBRA;
  readonly miniaturas: Record<string, SafeHtml | null> = Object.fromEntries(
    TIPOS.map((t) => {
      const svg = miniatura(t);
      return [t.id, svg ? this.sanitizer.bypassSecurityTrustHtml(svg) : null];
    }),
  );

  private readonly salvo = lerSalvo();
  readonly tipoId = signal<string>(tipoPorId(this.salvo.tipo ?? '').id);
  readonly todosParams = signal<Record<string, Params>>(
    Object.fromEntries(TIPOS.map((t) => [t.id, { ...t.padrao, ...(this.salvo.params?.[t.id] ?? {}) }])),
  );
  readonly folhaCfg = signal<ConfigFolha>({ ...FOLHA_PADRAO, ...(this.salvo.folha ?? {}) });
  /** Foto do topper: fica só na memória (pode ter vários MB). */
  readonly imagem = signal<ImagemCarregada | null>(null);
  readonly nomeImagem = signal('');
  readonly carregandoImagem = signal(false);
  readonly erro = signal('');
  readonly exportando = signal(false);
  readonly folhaAtual = signal(0);

  readonly tipo = computed(() => tipoPorId(this.tipoId()));
  readonly params = computed(() => this.todosParams()[this.tipoId()] ?? this.tipo().padrao);
  readonly camposVisiveis = computed(() => {
    const p = this.params();
    return this.tipo().campos.filter((c) => !c.visivel || c.visivel(p));
  });

  readonly fonte = computed(() => {
    const p = this.params();
    if (!this.tipo().campos.some((c) => c.tipo === 'fonte')) return null;
    this.fonts.version();
    const fam = this.fonts.family(str(p, 'fonte', 'poppins'));
    return this.fonts.get(fam.id, nearestWeight(fam.weights, sim(p, 'negrito') ? 700 : 400));
  });

  readonly molde = computed<Molde>(() => {
    try {
      return this.tipo().gerar(this.params(), { fonte: this.fonte(), imagem: this.imagem() });
    } catch (e) {
      console.error(e);
      return { pecas: [], avisos: ['Não consegui montar o molde com essas medidas. Confira os valores.'] };
    }
  });

  readonly distribuicao = computed(() => {
    const c = this.folhaCfg();
    const formato = FORMATOS.find((f) => f.id === c.formato) ?? FORMATOS[0];
    return distribuir(this.molde().pecas, { formato, orientacao: c.orientacao, margem: c.margem, espaco: c.espaco, copias: c.copias });
  });
  readonly folhas = computed(() => this.distribuicao().folhas);
  readonly folhaVisivel = computed<Folha | null>(() => {
    const f = this.folhas();
    return f[Math.min(this.folhaAtual(), f.length - 1)] ?? null;
  });
  readonly comArte = computed(() => temArte(this.folhas()));

  readonly previa = computed<SafeHtml | null>(() => {
    const folha = this.folhaVisivel();
    if (!folha) return null;
    const c = this.folhaCfg();
    const svg = svgDaFolha(folha, { dobra: c.dobra, traco: c.traco, vao: c.vao, arte: true, linhas: true, previa: true });
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  });

  /** Tamanho de cada peça planificada, pra conferir antes de cortar. */
  readonly medidas = computed(() =>
    this.molde().pecas.map((p) => {
      const b = unionBounds(pathsBounds(p.corte), pathsBounds(p.dobra));
      return { nome: p.nome, w: b ? (b.maxX - b.minX) / 10 : 0, h: b ? (b.maxY - b.minY) / 10 : 0 };
    }),
  );

  readonly avisos = computed(() => {
    const lista = [...this.molde().avisos];
    const nao = this.distribuicao().naoCabem;
    if (nao.length) {
      const metades = this.tipo().campos.some((c) => c.chave === 'partes') && str(this.params(), 'partes') !== '2';
      lista.push(`${nao.join(', ')} não cabe na folha escolhida, nem girado. Use uma folha maior, diminua as medidas${metades ? ' ou escolha "Duas metades" em Peças' : ''}.`);
    }
    return lista;
  });

  readonly fmt = fmt;

  constructor() {
    effect(() => {
      const salvar: Salvo = { tipo: this.tipoId(), params: this.todosParams(), folha: this.folhaCfg() };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(salvar));
      } catch { /* sem armazenamento, só não lembra da próxima vez */ }
    });
    // ao trocar de molde ou de medidas, volta pra primeira folha se a atual sumiu
    effect(() => {
      const n = this.folhas().length;
      if (this.folhaAtual() > Math.max(0, n - 1)) this.folhaAtual.set(Math.max(0, n - 1));
    });
  }

  // ------------------------------------------------------------ campos

  escolherTipo(id: string): void {
    this.tipoId.set(id);
    this.folhaAtual.set(0);
    this.erro.set('');
  }

  valor(c: Campo): Valor {
    return this.params()[c.chave] ?? '';
  }

  numero(c: Campo): number {
    const v = this.params()[c.chave];
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  definir(chave: string, valor: Valor): void {
    const id = this.tipoId();
    this.todosParams.update((todos) => ({ ...todos, [id]: { ...todos[id], [chave]: valor } }));
  }

  /** Enquanto digita, só aceita o que já está dentro dos limites (senão o "1"
   * de "15" viraria o mínimo no meio da digitação); ao sair do campo, prende. */
  definirNumero(c: CampoNumero, bruto: string, final = false): void {
    const n = parseFloat(bruto.replace(',', '.'));
    if (!Number.isFinite(n)) return;
    if (final) this.definir(c.chave, Math.max(c.min, Math.min(c.max, n)));
    else if (n >= c.min && n <= c.max) this.definir(c.chave, n);
  }

  restaurarPadrao(): void {
    const t = this.tipo();
    this.todosParams.update((todos) => ({ ...todos, [t.id]: { ...t.padrao } }));
  }

  definirFolha<K extends keyof ConfigFolha>(chave: K, valor: ConfigFolha[K]): void {
    this.folhaCfg.update((c) => ({ ...c, [chave]: valor }));
  }

  numeroFolha(chave: 'margem' | 'espaco' | 'copias' | 'traco' | 'vao', bruto: string, min: number, max: number): void {
    const n = parseFloat(bruto.replace(',', '.'));
    if (Number.isFinite(n) && n >= min && n <= max) this.definirFolha(chave, chave === 'copias' ? Math.round(n) : n);
  }

  fontesDa(cat: string) {
    return this.fontCatalog.filter((f) => f.category === cat);
  }

  previewFamily(id: string): string {
    return this.fonts.previewFamily(id);
  }

  async escolherImagem(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.erro.set('');
    this.carregandoImagem.set(true);
    try {
      const img = await carregarImagem(file);
      this.imagem.set(img);
      this.nomeImagem.set(file.name);
      // PNG sem fundo já sugere seguir o contorno do desenho
      if (img.contorno && this.tipoId() === 'topper-foto' && str(this.params(), 'forma') !== 'contorno') this.definir('forma', 'contorno');
    } catch (e) {
      this.erro.set(e instanceof Error ? e.message : 'Não consegui abrir a imagem.');
    } finally {
      this.carregandoImagem.set(false);
    }
  }

  removerImagem(): void {
    this.imagem.set(null);
    this.nomeImagem.set('');
  }

  // ------------------------------------------------------------ exportação

  private nomeBase(): string {
    return this.tipo().nomeArquivo(this.params()).replace(/,/g, '.');
  }

  private sufixo(i: number): string {
    return this.folhas().length > 1 ? `-folha${i + 1}` : '';
  }

  private svgCorte(folha: Folha): string {
    const c = this.folhaCfg();
    return svgDaFolha(folha, { dobra: c.dobra, traco: c.traco, vao: c.vao, arte: false, linhas: true });
  }

  /** SVG com a arte embaixo e as linhas por cima (Designer Edition abre tudo junto). */
  private svgCompleto(folha: Folha): string {
    const c = this.folhaCfg();
    return svgDaFolha(folha, { dobra: c.dobra, traco: c.traco, vao: c.vao, arte: true, linhas: true });
  }

  baixarSvg(): void {
    const folha = this.folhaVisivel();
    if (!folha) return;
    const i = this.folhas().indexOf(folha);
    const svg = this.comArte() ? this.svgCompleto(folha) : this.svgCorte(folha);
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${this.nomeBase()}${this.sufixo(i)}.svg`);
  }

  baixarDxf(): void {
    const folha = this.folhaVisivel();
    if (!folha) return;
    const i = this.folhas().indexOf(folha);
    const c = this.folhaCfg();
    downloadBlob(new Blob([dxfDaFolha(folha, c)], { type: 'application/dxf' }), `${this.nomeBase()}${this.sufixo(i)}.dxf`);
  }

  async baixarPng(): Promise<void> {
    const folha = this.folhaVisivel();
    if (!folha) return;
    const i = this.folhas().indexOf(folha);
    await this.comEspera(async () => downloadBlob(await pngDaFolha(folha), `${this.nomeBase()}${this.sufixo(i)}-impressao.png`));
  }

  /** Todas as folhas, em todos os formatos, num ZIP só. */
  async baixarTudo(): Promise<void> {
    await this.comEspera(async () => {
      const base = this.nomeBase();
      const c = this.folhaCfg();
      const entradas: ZipEntry[] = [];
      for (const [i, folha] of this.folhas().entries()) {
        const s = this.sufixo(i);
        entradas.push({ name: `${base}${s}-corte.svg`, content: this.svgCorte(folha) });
        entradas.push({ name: `${base}${s}.dxf`, content: dxfDaFolha(folha, c) });
        if (this.comArte()) {
          entradas.push({ name: `${base}${s}-completo.svg`, content: this.svgCompleto(folha) });
          const png = await pngDaFolha(folha);
          entradas.push({ name: `${base}${s}-impressao.png`, content: new Uint8Array(await png.arrayBuffer()) });
        }
      }
      downloadBlob(zipStore(entradas), `${base}.zip`);
    });
  }

  private async comEspera(job: () => Promise<void>): Promise<void> {
    this.exportando.set(true);
    this.erro.set('');
    try {
      await job();
    } catch (e) {
      this.erro.set(e instanceof Error ? e.message : 'Falhou ao exportar.');
    } finally {
      this.exportando.set(false);
    }
  }

  // ------------------------------------------------------------ topo

  themeIconName(): IconName {
    switch (this.theme.pref()) {
      case 'dark': return 'moon';
      case 'light': return 'sun';
      default: return 'monitor';
    }
  }

  themeLabel(): string {
    switch (this.theme.pref()) {
      case 'dark': return 'Tema: escuro (clique para claro)';
      case 'light': return 'Tema: claro (clique para automático)';
      default: return 'Tema: automático (clique para escuro)';
    }
  }
}
