import { CAPTION_TONES, DEFAULT_BRAND_PROFILE, captionFormat, captionText } from './social-caption-panel';

describe('legenda com IA', () => {
  it('junta legenda e hashtags com uma linha em branco no meio', () => {
    expect(captionText({ texto: 'chegou novidade 🎀', hashtags: ['#viihmimos', '#maraba'] }))
      .toBe('chegou novidade 🎀\n\n#viihmimos #maraba');
    expect(captionText({ texto: 'só texto', hashtags: [] })).toBe('só texto');
  });

  it('diz à IA se é story, feed ou carrossel', () => {
    expect(captionFormat('story', 1)).toBe('story');
    expect(captionFormat('feed', 1)).toBe('feed');
    expect(captionFormat('retrato', 1)).toBe('feed');
    expect(captionFormat('retrato', 3)).toBe('carrossel');
  });

  it('usa os tons que o servidor conhece e já traz a marca preenchida', () => {
    expect(CAPTION_TONES.map((t) => t.id)).toEqual(['carinhoso', 'divertido', 'vendedor', 'informativo']);
    expect(DEFAULT_BRAND_PROFILE).toContain('@viihmimos_');
    expect(DEFAULT_BRAND_PROFILE.length).toBeLessThan(3000);
  });
});
