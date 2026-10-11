import { describeForAi, rewriteTexts } from './social-ai-post-panel';
import { SOCIAL_TEMPLATES } from './social-templates';
import { GalleryEntry } from './social-templates.service';

const entry = (id: string) => {
  const t = SOCIAL_TEMPLATES.find((x) => x.id === id)!;
  return { id: t.id, label: t.label, group: t.group, help: t.help, photo: t.photo, photos: !!t.photos, slides: t.slides, kind: 'editor', build: t.build } as GalleryEntry;
};

describe('post com IA', () => {
  it('conta quantas fotos cabem em cada modelo', () => {
    const feed = entry('vm-feed-novidade');
    expect(describeForAi(feed, feed.build())).toEqual(expect.objectContaining({ fotos: 1, cresce: false }));
    const entregas = entry('vm-carrossel-entregas');
    expect(describeForAi(entregas, entregas.build())).toEqual(expect.objectContaining({ fotos: 4, cresce: true }));
    const obrigada = entry('vm-feed-obrigada');
    expect(describeForAi(obrigada, obrigada.build()).fotos).toBe(0);
  });

  it('troca só os textos que a IA mandou, pelo índice', () => {
    const look = entry('vm-feed-novidade').build();
    const antes = describeForAi(entry('vm-feed-novidade'), look).textos;
    const depois = rewriteTexts(look, [{ indice: 0, texto: 'kit jardim' }]);
    const textos = depois.overlays.flatMap((o) => (o.kind === 'texto' ? [o.text] : []));
    expect(textos[0]).toBe('kit jardim');
    expect(textos.slice(1)).toEqual(antes.slice(1));
    expect(depois.overlays.length).toBe(look.overlays.length);
  });
});
