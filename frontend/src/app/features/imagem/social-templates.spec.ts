import { CustomTemplateDto, galleryEntries, groupFor, lookFromCustom, parseCustom } from './social-templates.service';
import { BRAND_ASSETS, brandAssetDef } from './brand-assets';
import { SOCIAL_FORMATS } from './social-model';
import { TEXT_FONTS, hitOverlay } from './social-overlays';
import { SocialProjectData, SocialStore } from './social-store';
import { SOCIAL_TEMPLATES, TEMPLATE_GROUPS, TemplateBuilder } from './social-templates';

describe('modelos Viih Mimos', () => {
  it('tem story, feed e carrossel, com ids únicos', () => {
    expect(TEMPLATE_GROUPS.map((g) => g.name)).toEqual(['Story', 'Feed', 'Carrossel']);
    for (const g of TEMPLATE_GROUPS) expect(g.templates.length).toBeGreaterThan(0);
    expect(new Set(SOCIAL_TEMPLATES.map((t) => t.id)).size).toBe(SOCIAL_TEMPLATES.length);
  });

  it('cada modelo monta no formato e na quantidade de posts que anuncia', () => {
    for (const t of SOCIAL_TEMPLATES) {
      const look = t.build();
      expect(look.templateId).toBe(t.id);
      expect(look.formatId).toBe(t.formatId);
      expect(look.slides).toBe(t.slides);
      expect(SOCIAL_FORMATS.some((f) => f.id === look.formatId)).toBe(true);
      if (t.group === 'Story') expect(look.formatId).toBe('story');
      if (t.group === 'Carrossel') expect(look.slides).toBeGreaterThan(1);
      else expect(look.slides).toBe(1);
      expect(look.overlays.length).toBeGreaterThan(0);
    }
  });

  it('só reserva espaço de foto nos modelos que dizem pedir foto', () => {
    for (const t of SOCIAL_TEMPLATES) {
      const { slot } = t.build();
      expect(!!slot).toBe(t.photo);
      if (!slot) continue;
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.y).toBeGreaterThanOrEqual(0);
      expect(slot.x + slot.w).toBeLessThanOrEqual(1);
      expect(slot.y + slot.h).toBeLessThanOrEqual(1);
    }
  });

  it('põe toda camada dentro do quadro, com fonte e arquivo que existem', () => {
    for (const t of SOCIAL_TEMPLATES) {
      for (const o of t.build().overlays) {
        expect(o.x, `${t.id}: ${o.kind}`).toBeGreaterThan(0);
        expect(o.x).toBeLessThan(1);
        expect(o.y).toBeGreaterThan(0);
        expect(o.y).toBeLessThan(1);
        expect(o.size).toBeGreaterThan(0);
        if (o.kind === 'texto') {
          // A fonte precisa estar na lista do painel, senão o seletor mostra outra.
          expect(TEXT_FONTS).toContain(o.fontId);
          expect(o.text.trim().length).toBeGreaterThan(0);
        }
        if (o.kind === 'imagem') expect(brandAssetDef(o.asset), o.asset).toBeTruthy();
      }
    }
  });

  it('não repete id de camada entre duas aplicações do mesmo modelo', () => {
    const a = SOCIAL_TEMPLATES[0].build().overlays.map((o) => o.id);
    const b = SOCIAL_TEMPLATES[0].build().overlays.map((o) => o.id);
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });

  it('distribui o carrossel pelos posts: cada um tem o seu conteúdo', () => {
    for (const t of SOCIAL_TEMPLATES.filter((x) => x.slides > 1)) {
      const look = t.build();
      const perSlide = new Array(t.slides).fill(0);
      for (const o of look.overlays) perSlide[Math.min(t.slides - 1, Math.floor(o.x * t.slides))]++;
      expect(perSlide.every((n) => n > 0), t.id).toBe(true);
    }
  });

  it('converte px de design pro post certo da faixa', () => {
    const b = new TemplateBuilder('feed', 3);
    const o = b.text(1, 540, 540, 'meio do segundo post', 54);
    expect(o.x).toBeCloseTo(0.5, 6);
    expect(o.y).toBeCloseTo(0.5, 6);
    // lado menor da faixa de 3 posts quadrados é a altura (1080)
    expect(o.size).toBeCloseTo(54 / 1080, 6);
    b.photo(2, 0, 0, 1080, 1080, 0);
    expect(b.slot).toEqual({ x: 2 / 3, y: 0, w: 1 / 3, h: 1, radius: 0 });
  });

  it('trava a moldura, pra ela não roubar o arraste da foto', () => {
    const b = new TemplateBuilder('story');
    b.frame(0);
    const [moldura] = b.overlays;
    expect(moldura.locked).toBe(true);
    const box = { id: moldura.id, cx: 540, cy: 960, w: 1000, h: 1800, rotation: 0, locked: true };
    expect(hitOverlay([box], 540, 960)).toBeNull();
    expect(hitOverlay([{ ...box, locked: false }], 540, 960)).toBe(moldura.id);
  });

  it('registra cada arquivo da marca uma vez, com proporção válida', () => {
    expect(new Set(BRAND_ASSETS.map((a) => a.id)).size).toBe(BRAND_ASSETS.length);
    for (const a of BRAND_ASSETS) {
      expect(a.file).toMatch(/\.svg$/);
      expect(a.aspect).toBeGreaterThan(0);
    }
  });
});

describe('modelo no store do modo redes sociais', () => {
  it('aplica formato, carrossel, fundo e camadas — e o Ctrl+Z volta', () => {
    const store = new SocialStore();
    const t = SOCIAL_TEMPLATES.find((x) => x.id === 'vm-carrossel-produto')!;
    expect(store.hasContent()).toBe(false);
    store.applyTemplate(t.build());
    expect(store.hasContent()).toBe(true);
    expect(store.hasImage()).toBe(false);
    expect(store.format().id).toBe('retrato');
    expect(store.slides()).toBe(3);
    expect(store.slot()).not.toBeNull();
    expect(store.bgMode()).toBe('cor');
    expect(store.photoW()).toBeCloseTo(store.frameW() * store.slot()!.w, 6);
    store.undo();
    expect(store.templateId()).toBe('');
    expect(store.slides()).toBe(1);
    expect(store.overlays()).toEqual([]);
    store.redo();
    expect(store.templateId()).toBe(t.id);
  });

  it('salva e reabre um modelo que ainda não recebeu foto', async () => {
    const store = new SocialStore();
    store.applyTemplate(SOCIAL_TEMPLATES.find((x) => x.id === 'vm-story-obrigada')!.build());
    const data = store.serialize();
    expect(data).not.toBeNull();
    expect(data!.src).toBe('');
    expect(data!.templateId).toBe('vm-story-obrigada');
    expect(data!.bgPattern).toBe('padrao-coracoes');

    const again = new SocialStore();
    let loads = 0;
    await again.hydrate(JSON.parse(JSON.stringify(data)) as SocialProjectData, async () => {
      loads++;
      return new Image();
    });
    expect(loads).toBe(0);
    expect(again.templateId()).toBe('vm-story-obrigada');
    expect(again.format().id).toBe('story');
    expect(again.bgPattern()).toBe('padrao-coracoes');
    expect(again.overlays().length).toBe(data!.overlays!.length);
    expect(again.hasContent()).toBe(true);
  });

  it('projeto antigo, sem os campos de modelo, abre como post comum', async () => {
    const store = new SocialStore();
    const old = { version: 1, src: '', formatId: 'feed' } as unknown as SocialProjectData;
    await store.hydrate(old, async () => new Image());
    expect(store.templateId()).toBe('');
    expect(store.slot()).toBeNull();
    expect(store.bgPattern()).toBe('');
  });

  it('esconde a foto num modelo sem espaço pra ela, e devolve ao tirar o modelo', () => {
    const store = new SocialStore();
    store.applyTemplate(SOCIAL_TEMPLATES.find((x) => x.id === 'vm-feed-produto')!.build());
    expect(store.photoVisible()).toBe(true);
    store.applyTemplate(SOCIAL_TEMPLATES.find((x) => x.id === 'vm-carrossel-lancamento')!.build());
    expect(store.photoVisible()).toBe(false);
    store.undo();
    expect(store.photoVisible()).toBe(true);
    expect(new SocialStore().photoVisible()).toBe(true);
  });

  it('não salva nada sem foto e sem modelo', () => {
    expect(new SocialStore().serialize()).toBeNull();
  });
});

describe('modelos da conta na galeria', () => {
  const dto = (over: Partial<CustomTemplateDto>, look = SOCIAL_TEMPLATES[0].build()): CustomTemplateDto => ({
    id: 'c1', name: 'Meu', group: 'Story', replaces: '', thumb: '', createdAt: '', updatedAt: '',
    data: JSON.stringify({ version: 1, formatId: look.formatId, slides: look.slides, bgColor: look.bgColor, bgPattern: look.bgPattern, slot: look.slot, overlays: look.overlays }),
    ...over,
  });

  it('sem modelos da conta, mostra só os do editor, na ordem', () => {
    expect(galleryEntries([]).map((e) => e.id)).toEqual(SOCIAL_TEMPLATES.map((t) => t.id));
    expect(galleryEntries([]).every((e) => e.kind === 'editor')).toBe(true);
  });

  it('a versão editada toma o lugar do original, sem duplicar', () => {
    const entries = galleryEntries([dto({ id: 'ed', name: 'Encomendas (minha)', replaces: 'vm-story-encomendas' })]);
    expect(entries.length).toBe(SOCIAL_TEMPLATES.length);
    const i = SOCIAL_TEMPLATES.findIndex((t) => t.id === 'vm-story-encomendas');
    expect(entries[i].id).toBe('ed');
    expect(entries[i].kind).toBe('editado');
    expect(entries[i].builtin?.id).toBe('vm-story-encomendas');
  });

  it('modelo novo entra no fim, e modelo corrompido é ignorado', () => {
    const entries = galleryEntries([dto({ id: 'novo', group: 'Feed' }), dto({ id: 'ruim', data: '{oops' })]);
    expect(entries.length).toBe(SOCIAL_TEMPLATES.length + 1);
    expect(entries.at(-1)!.id).toBe('novo');
    expect(entries.at(-1)!.kind).toBe('meu');
  });

  it('aplicar um modelo salvo gera ids de camada novos e aponta pro modelo', () => {
    const c = dto({ id: 'abc' });
    const data = parseCustom(c)!;
    const a = lookFromCustom(c, data);
    const b = lookFromCustom(c, data);
    expect(a.templateId).toBe('abc');
    expect(a.overlays.length).toBe(data.overlays.length);
    expect(a.overlays[0].id).not.toBe(b.overlays[0].id);
    expect(a.overlays[0].id).not.toBe(data.overlays[0].id);
  });

  it('decide o grupo pelo formato', () => {
    expect(groupFor('story', 1)).toBe('Story');
    expect(groupFor('feed', 1)).toBe('Feed');
    expect(groupFor('retrato', 1)).toBe('Feed');
    expect(groupFor('feed', 4)).toBe('Carrossel');
  });
});
