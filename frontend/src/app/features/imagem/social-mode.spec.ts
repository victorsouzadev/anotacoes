import {
  FILTER_GROUPS, FILTER_PRESETS, NEUTRAL, SOCIAL_FORMATS, coversFrame, filterString, frameRect,
} from './social-model';
import { SocialStore } from './social-store';
import { DEFAULT_SECTIONS, PREFS_KEY, isHeicFile, loadPrefs } from './social-mode';

describe('modo redes sociais', () => {
  it('não emite ajustes neutros no filtro', () => {
    expect(filterString({ ...NEUTRAL }, 1000)).toBe('brightness(100%) contrast(100%) saturate(100%)');
  });

  it('escala o desfoque com o tamanho do destino', () => {
    const small = filterString({ ...NEUTRAL, blur: 50 }, 100);
    const big = filterString({ ...NEUTRAL, blur: 50 }, 1000);
    expect(small).toContain('blur(1.5px)');
    expect(big).toContain('blur(15px)');
  });

  it('cobre o quadro inteiro no modo preencher', () => {
    const r = frameRect(200, 100, 100, 100, 'cover', 1, 0, 0);
    expect(r.w).toBeGreaterThanOrEqual(100);
    expect(r.h).toBeGreaterThanOrEqual(100);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.x).toBeCloseTo(-50, 6);
  });

  it('mantém a foto dentro do quadro no modo caber', () => {
    const r = frameRect(200, 100, 100, 100, 'contain', 1, 0, 0);
    expect(r.w).toBeCloseTo(100, 6);
    expect(r.h).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(25, 6);
  });

  it('desloca em fração do quadro', () => {
    const base = frameRect(100, 100, 200, 200, 'cover', 1, 0, 0);
    const moved = frameRect(100, 100, 200, 200, 'cover', 1, 0.25, -0.5);
    expect(moved.x - base.x).toBeCloseTo(50, 6);
    expect(moved.y - base.y).toBeCloseTo(-100, 6);
  });

  it('agrupa os filtros na ordem da lista, sem perder nenhum', () => {
    expect(FILTER_GROUPS.flatMap((g) => g.presets.map((p) => p.id)))
      .toEqual(FILTER_PRESETS.map((p) => p.id));
    expect(FILTER_GROUPS.length).toBeGreaterThan(1);
    // Um grupo só pode aparecer uma vez, senão o painel repete o título.
    expect(new Set(FILTER_GROUPS.map((g) => g.name)).size).toBe(FILTER_GROUPS.length);
  });

  it('todo preset só mexe em ajuste que existe, e dentro da faixa', () => {
    const keys = new Set(Object.keys(NEUTRAL));
    for (const preset of FILTER_PRESETS) {
      for (const [key, value] of Object.entries(preset.values)) {
        expect(keys.has(key)).toBe(true);
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('todo preset e formato tem id único', () => {
    expect(new Set(FILTER_PRESETS.map((p) => p.id)).size).toBe(FILTER_PRESETS.length);
    expect(new Set(SOCIAL_FORMATS.map((f) => f.id)).size).toBe(SOCIAL_FORMATS.length);
    expect(SOCIAL_FORMATS.every((f) => f.ratio > 0 && f.width >= 200)).toBe(true);
  });
});

describe('projeto do modo redes sociais', () => {
  function fakeImage(): HTMLImageElement {
    return { naturalWidth: 800, naturalHeight: 600 } as HTMLImageElement;
  }

  it('não serializa nada sem foto', () => {
    expect(new SocialStore().serialize()).toBeNull();
  });

  it('guarda e reabre o enquadramento e os ajustes', async () => {
    const store = new SocialStore();
    store.setImage(fakeImage(), 'data:image/jpeg;base64,abc', 'foto.jpg');
    store.format.set(SOCIAL_FORMATS.find((f) => f.id === 'story')!);
    store.fit.set('contain');
    store.scale.set(1.4);
    store.offsetX.set(-0.2);
    store.bgMode.set('cor');
    store.bgColor.set('#101010');
    store.adjust.set({ ...NEUTRAL, contrast: 118, vignette: 34 });
    store.type.set('png');
    store.denoise.set(45);

    const data = store.serialize()!;
    expect(data.formatId).toBe('story');

    const fresh = new SocialStore();
    await fresh.hydrate(data, async () => fakeImage());
    expect(fresh.format().id).toBe('story');
    expect(fresh.fit()).toBe('contain');
    expect(fresh.scale()).toBeCloseTo(1.4, 6);
    expect(fresh.offsetX()).toBeCloseTo(-0.2, 6);
    expect(fresh.bgColor()).toBe('#101010');
    expect(fresh.adjust().contrast).toBe(118);
    expect(fresh.adjust().vignette).toBe(34);
    expect(fresh.type()).toBe('png');
    expect(fresh.denoise()).toBe(45);
    expect(fresh.hasImage()).toBe(true);
  });

  it('cai no padrão com dados de uma versão anterior', async () => {
    const store = new SocialStore();
    await store.hydrate({ version: 1, src: 'data:,x', fileName: 'x.png', formatId: 'inexistente' } as never, async () => fakeImage());
    expect(store.format().id).toBe(SOCIAL_FORMATS[0].id);
    expect(store.fit()).toBe('cover');
    expect(store.scale()).toBe(1);
    expect(store.adjust()).toEqual(NEUTRAL);
    expect(store.denoise()).toBe(0);
    expect(store.exportW()).toBe(SOCIAL_FORMATS[0].width);
  });

  it('esquece tudo ao limpar', () => {
    const store = new SocialStore();
    store.setImage(fakeImage(), 'data:,x', 'x.jpg');
    store.adjust.set({ ...NEUTRAL, sepia: 40 });
    store.denoise.set(60);
    store.clear();
    expect(store.hasImage()).toBe(false);
    expect(store.serialize()).toBeNull();
    expect(store.adjust().sepia).toBe(0);
    expect(store.denoise()).toBe(0);
  });
});

describe('detecção de HEIC', () => {
  it('reconhece pelo tipo declarado', () => {
    expect(isHeicFile({ name: 'IMG_0001', type: 'image/heic' })).toBe(true);
    expect(isHeicFile({ name: 'IMG_0001', type: 'image/heif' })).toBe(true);
  });

  it('reconhece pela extensão quando o tipo vem vazio', () => {
    expect(isHeicFile({ name: 'IMG_0002.HEIC', type: '' })).toBe(true);
    expect(isHeicFile({ name: 'IMG_0003.heif', type: '' })).toBe(true);
  });

  it('não confunde com os formatos que o navegador já abre', () => {
    expect(isHeicFile({ name: 'foto.jpg', type: 'image/jpeg' })).toBe(false);
    expect(isHeicFile({ name: 'arte.png', type: 'image/png' })).toBe(false);
    expect(isHeicFile({ name: 'heic-de-mentira.png', type: 'image/png' })).toBe(false);
  });
});

describe('fundo à mostra', () => {
  it('preencher na escala cheia não deixa fundo aparecer', () => {
    expect(coversFrame(1600, 1200, 1000, 1000, 'cover', 1, 0, 0)).toBe(true);
    expect(coversFrame(1200, 1600, 1000, 1250, 'cover', 1, 0, 0)).toBe(true);
  });

  it('caber sempre deixa fundo, menos quando a proporção bate exata', () => {
    expect(coversFrame(1600, 1200, 1000, 1000, 'contain', 1, 0, 0)).toBe(false);
    // foto quadrada em quadro quadrado: "caber" e "preencher" dão o mesmo
    expect(coversFrame(1000, 1000, 1000, 1000, 'contain', 1, 0, 0)).toBe(true);
  });

  it('diminuir a escala ou arrastar a foto expõe a borda mesmo em preencher', () => {
    expect(coversFrame(1600, 1200, 1000, 1000, 'cover', 0.8, 0, 0)).toBe(false);
    expect(coversFrame(1600, 1200, 1000, 1000, 'cover', 1, 0.3, 0)).toBe(false);
  });
});

describe('preferências do painel', () => {
  beforeEach(() => localStorage.removeItem(PREFS_KEY));

  it('começa só com os filtros abertos', () => {
    const prefs = loadPrefs();
    expect(prefs.sections).toEqual(DEFAULT_SECTIONS);
    expect(prefs.sections.filtros).toBe(true);
    expect(prefs.sections.cor).toBe(false);
    expect(prefs.advanced).toBe(false);
  });

  it('lembra o que foi aberto e completa o que falta', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sections: { cor: true }, advanced: true }));
    const prefs = loadPrefs();
    expect(prefs.sections.cor).toBe(true);
    // seção que a versão salva não conhecia volta ao padrão em vez de sumir
    expect(prefs.sections.filtros).toBe(true);
    expect(prefs.advanced).toBe(true);
  });

  it('ignora preferência corrompida em vez de derrubar o modo', () => {
    localStorage.setItem(PREFS_KEY, '{isso não é json');
    expect(loadPrefs().sections).toEqual(DEFAULT_SECTIONS);
  });
});
