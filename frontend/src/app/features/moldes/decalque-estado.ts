/** Estado do decalque, provido pela página: sobrevive à troca de molde (a foto
 * e os cantos continuam lá ao voltar). Reprocessa sozinho, com uma pausa curta,
 * quando a foto, os cantos ou os parâmetros mudam. */

import { Injectable, computed, effect, signal } from '@angular/core';
import { loadImageElement } from '../imagem/svg-template';
import { Cantos, Cinza, OPCOES_PADRAO, ResultadoDecalque, TipoLinha, acharCantos, decalcar, otsu, paraCinza, retificar } from './decalque';
import { tamanhoDoPapel } from './decalque-tipo';
import { LinhasDecalcadas, Params, num } from './modelo';

/** Lado maior da foto guardada pra processar (mais que isso só deixa lento). */
const MAX_FONTE = 2400;
/** Lado maior da imagem endireitada. */
const MAX_RETIFICADA = 2200;
/** Resolução máxima do decalque: 8 px/mm já é traço de 0,125 mm. */
const MAX_PX_MM = 8;

export interface FotoDoMolde {
  src: string;
  nome: string;
  cinza: Cinza;
}

const dist = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function cinzaParaDataUrl(g: Cinza): string {
  const c = document.createElement('canvas');
  c.width = g.w;
  c.height = g.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    const v = g.data[i];
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.8);
}

@Injectable()
export class DecalqueEstado {
  readonly foto = signal<FotoDoMolde | null>(null);
  readonly cantos = signal<Cantos | null>(null);
  readonly params = signal<Params>({});
  readonly processando = signal(false);
  readonly resultado = signal<ResultadoDecalque | null>(null);
  /** Imagem endireitada (data URL), fundo da revisão das linhas. */
  readonly retificada = signal<string | null>(null);
  /** Trocas feitas pelo usuário (clicando nas linhas), por id. */
  readonly trocas = signal<Record<number, TipoLinha>>({});
  readonly erro = signal('');

  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly tipoDe = (id: number, sugerido: TipoLinha): TipoLinha => this.trocas()[id] ?? sugerido;

  /** O que vai pro gerador: só corte e dobra, já com as trocas. */
  readonly saida = computed<LinhasDecalcadas | null>(() => {
    const r = this.resultado();
    if (!r) return null;
    const t = this.trocas();
    const corte = r.linhas.filter((l) => (t[l.id] ?? l.tipo) === 'corte').map((l) => l.path);
    const dobra = r.linhas.filter((l) => (t[l.id] ?? l.tipo) === 'dobra').map((l) => l.path);
    return { corte, dobra, w: r.w, h: r.h };
  });

  /** Parâmetros que mexem no processamento (a escala não: ela é só no gerador). */
  private readonly opcoes = computed(() => {
    const p = this.params();
    return {
      papel: tamanhoDoPapel(p),
      sensibilidade: num(p, 'sensibilidade', 50),
      fecharFalhas: num(p, 'fecharFalhas', OPCOES_PADRAO.fecharFalhas),
      vaoTracejado: num(p, 'vaoTracejado', OPCOES_PADRAO.vaoTracejado),
      minimo: num(p, 'minimo', OPCOES_PADRAO.minimo),
    };
  }, { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });

  constructor() {
    effect(() => {
      const foto = this.foto();
      const cantos = this.cantos();
      const o = this.opcoes();
      if (this.timer) clearTimeout(this.timer);
      if (!foto || !cantos) {
        this.resultado.set(null);
        return;
      }
      this.processando.set(true);
      this.timer = setTimeout(() => this.processar(foto, cantos, o), 250);
    });
  }

  async carregar(file: File): Promise<void> {
    this.erro.set('');
    if (!file.type.startsWith('image/')) {
      this.erro.set('Escolha uma foto (JPG ou PNG).');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageElement(url);
      const s = Math.min(1, MAX_FONTE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * s));
      const h = Math.max(1, Math.round(img.naturalHeight * s));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const cinza = paraCinza(ctx.getImageData(0, 0, w, h).data, w, h);
      this.trocas.set({});
      this.foto.set({ src: c.toDataURL('image/jpeg', 0.85), nome: file.name, cinza });
      this.cantos.set(this.palpiteDeCantos(cinza));
    } catch {
      this.erro.set('Não consegui abrir essa foto.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Procura o papel numa versão pequena da foto (é só um palpite). */
  palpiteDeCantos(cinza: Cinza): Cantos {
    const s = Math.min(1, 400 / Math.max(cinza.w, cinza.h));
    if (s >= 1) return acharCantos(cinza);
    const w = Math.max(1, Math.round(cinza.w * s)), h = Math.max(1, Math.round(cinza.h * s));
    const pequena = retificar(cinza, [[0, 0], [cinza.w, 0], [cinza.w, cinza.h], [0, cinza.h]], w, h);
    return acharCantos(pequena).map(([x, y]) => [(x * cinza.w) / w, (y * cinza.h) / h]) as Cantos;
  }

  detectarCantos(): void {
    const f = this.foto();
    if (f) this.cantos.set(this.palpiteDeCantos(f.cinza));
  }

  imagemInteira(): void {
    const f = this.foto();
    if (f) this.cantos.set([[0, 0], [f.cinza.w, 0], [f.cinza.w, f.cinza.h], [0, f.cinza.h]]);
  }

  moverCanto(i: number, p: [number, number]): void {
    const c = this.cantos();
    const f = this.foto();
    if (!c || !f) return;
    const novo = [...c] as Cantos;
    novo[i] = [Math.max(0, Math.min(f.cinza.w, p[0])), Math.max(0, Math.min(f.cinza.h, p[1]))];
    this.cantos.set(novo);
  }

  alternar(id: number, sugerido: TipoLinha): void {
    const ordem: TipoLinha[] = ['corte', 'dobra', 'ignorar'];
    const atual = this.tipoDe(id, sugerido);
    const prox = ordem[(ordem.indexOf(atual) + 1) % ordem.length];
    this.trocas.update((t) => ({ ...t, [id]: prox }));
  }

  limpar(): void {
    this.foto.set(null);
    this.cantos.set(null);
    this.resultado.set(null);
    this.retificada.set(null);
    this.trocas.set({});
  }

  private processar(foto: FotoDoMolde, cantos: Cantos, o: { papel: [number, number]; sensibilidade: number; fecharFalhas: number; vaoTracejado: number; minimo: number }): void {
    try {
      const [Wmm, Hmm] = o.papel;
      // resolução: a da própria foto (não adianta inventar pixel), com teto
      const ladoW = (dist(cantos[0], cantos[1]) + dist(cantos[3], cantos[2])) / 2;
      const ladoH = (dist(cantos[0], cantos[3]) + dist(cantos[1], cantos[2])) / 2;
      const daFoto = Math.min(ladoW / Wmm, ladoH / Hmm);
      const k = Math.max(1.5, Math.min(MAX_PX_MM, daFoto, MAX_RETIFICADA / Math.max(Wmm, Hmm)));
      const g = retificar(foto.cinza, cantos, Math.round(Wmm * k), Math.round(Hmm * k));
      const base = otsu(g);
      const limiar = Math.max(5, Math.min(250, base + (o.sensibilidade - 50) * 2.4));
      const r = decalcar(g, { pxPorMm: k, limiar, fecharFalhas: o.fecharFalhas, furoMax: OPCOES_PADRAO.furoMax, vaoTracejado: o.vaoTracejado, minimo: o.minimo });
      if (daFoto < 3) r.avisos.push('A foto tem pouca resolução para esse papel (menos de 3 px por mm): linhas finas podem sumir. Fotografe mais de perto.');
      this.trocas.set({});
      this.resultado.set(r);
      this.retificada.set(cinzaParaDataUrl(g));
    } catch (e) {
      console.error(e);
      this.erro.set('Falhou ao ler as linhas dessa foto.');
      this.resultado.set(null);
    } finally {
      this.processando.set(false);
    }
  }
}
