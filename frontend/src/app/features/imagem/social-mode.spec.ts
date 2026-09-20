import { FILTER_PRESETS, NEUTRAL, SOCIAL_FORMATS, filterString, frameRect } from './social-mode';

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

  it('todo preset e formato tem id único', () => {
    expect(new Set(FILTER_PRESETS.map((p) => p.id)).size).toBe(FILTER_PRESETS.length);
    expect(new Set(SOCIAL_FORMATS.map((f) => f.id)).size).toBe(SOCIAL_FORMATS.length);
    expect(SOCIAL_FORMATS.every((f) => f.ratio > 0 && f.width >= 200)).toBe(true);
  });
});
