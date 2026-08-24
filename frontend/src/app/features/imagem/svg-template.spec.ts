import { describe, expect, it } from 'vitest';
import {
  EDITOR_ATTR,
  PhotoLayer,
  SlotRect,
  TemplateSlot,
  autoDetectSlots,
  coverPlacement,
  lengthToPx,
  parseTemplateSvg,
  physicalWidthMm,
  renderPhotos,
  serializeForExport,
} from './svg-template';

function photo(overrides: Partial<PhotoLayer> = {}): PhotoLayer {
  return {
    id: overrides.id ?? 'p1',
    slotId: overrides.slotId ?? 's1',
    name: 'foto.jpg',
    src: 'data:image/png;base64,AAA',
    naturalW: 400,
    naturalH: 200,
    fit: 'cover',
    scale: 1,
    dx: 0,
    dy: 0,
    rotation: 0,
    flipX: false,
    opacity: 1,
    z: 1,
    depth: 'frente',
    ...overrides,
  };
}

function slot(id: string, elId: string, rect: SlotRect, transform = ''): TemplateSlot {
  return { id, elId, label: id, rect, transform };
}

const RECT_100x100: SlotRect = { x: 0, y: 0, w: 100, h: 100 };

describe('lengthToPx / physicalWidthMm', () => {
  it('converte as unidades de comprimento do SVG', () => {
    expect(lengthToPx('100px')).toBeCloseTo(100);
    expect(lengthToPx('800')).toBeCloseTo(800);
    expect(lengthToPx('1in')).toBeCloseTo(96);
    expect(lengthToPx('72pt')).toBeCloseTo(96);
    expect(lengthToPx('25.4mm')).toBeCloseTo(96);
  });

  it('recusa porcentagem e lixo', () => {
    expect(lengthToPx('50%')).toBeNull();
    expect(lengthToPx('auto')).toBeNull();
    expect(lengthToPx(null)).toBeNull();
  });

  it('deriva o tamanho de impressão do atributo width', () => {
    expect(physicalWidthMm('210mm', 744)).toBeCloseTo(210, 2);
    expect(physicalWidthMm('8.5in', 816)).toBeCloseTo(215.9, 2);
    expect(physicalWidthMm('100pt', 133)).toBeCloseTo(35.28, 2);
  });

  it('sem unidade, trata o viewBox como px a 96 dpi', () => {
    expect(physicalWidthMm('800', 800)).toBeCloseTo(211.67, 2);
    expect(physicalWidthMm(null, 800)).toBeCloseTo(211.67, 2);
  });
});

describe('parseTemplateSvg', () => {
  it('remove script, handlers e referências externas, mas mantém data URL', () => {
    const { root } = parseTemplateSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <script>alert(1)</script>
        <rect width="10" height="10" onclick="alert(2)" />
        <image href="https://exemplo.test/x.png" />
        <image id="ok" href="data:image/png;base64,AAA" />
      </svg>`);
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('rect')!.hasAttribute('onclick')).toBe(false);
    expect(root.querySelectorAll('image')[0].hasAttribute('href')).toBe(false);
    expect(root.querySelector('[id$="ok"]')!.getAttribute('href')).toBe('data:image/png;base64,AAA');
  });

  it('prefixa os ids e reescreve as referências que apontam pra eles', () => {
    const { root, idPrefix } = parseTemplateSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <defs><clipPath id="c"><rect width="5" height="5" /></clipPath></defs>
        <rect id="alvo" width="10" height="10" clip-path="url(#c)" />
        <use href="#alvo" />
      </svg>`);
    expect(root.querySelector('clipPath')!.getAttribute('id')).toBe(`${idPrefix}c`);
    expect(root.querySelector('rect[clip-path]')!.getAttribute('clip-path')).toBe(`url(#${idPrefix}c)`);
    expect(root.querySelector('use')!.getAttribute('href')).toBe(`#${idPrefix}alvo`);
  });

  it('resolve o <style> interno pra style inline, sem vazar pro documento', () => {
    const { root } = parseTemplateSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <style>.st0{fill:#ff0000}</style>
        <rect class="st0" width="10" height="10" />
        <rect class="st0" width="4" height="4" style="fill:#00ff00" />
      </svg>`);
    expect(root.querySelector('style')).toBeNull();
    const [primeiro, segundo] = Array.from(root.querySelectorAll('rect'));
    expect(primeiro.getAttribute('style')).toBe('fill:#ff0000');
    // O que já estava inline continua ganhando da regra do arquivo: vem por último.
    expect(segundo.getAttribute('style')).toBe('fill:#ff0000;fill:#00ff00');
  });

  it('deriva o viewBox de width/height quando ele não vem no arquivo', () => {
    const { viewBox } = parseTemplateSvg('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"></svg>');
    expect(viewBox).toEqual({ x: 0, y: 0, w: 300, h: 150 });
  });

  it('recusa arquivo que não é SVG', () => {
    expect(() => parseTemplateSvg('<html><body>oi</body></html>')).toThrow();
  });
});

describe('autoDetectSlots', () => {
  it('pega os elementos nomeados como encaixe e ignora o resto', () => {
    const { root, idPrefix } = parseTemplateSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10">
        <circle id="foto1" r="1" />
        <rect inkscape:label="Foto do topo" width="1" height="1" />
        <ellipse data-slot="a" rx="1" ry="1" />
        <path id="fundo" d="M0 0h1v1z" />
      </svg>`);
    const nomes = autoDetectSlots(root, idPrefix).map((el) => el.localName);
    expect(nomes).toEqual(['circle', 'rect', 'ellipse']);
  });

  it('não confunde formas dentro de defs/clipPath com encaixes', () => {
    const { root, idPrefix } = parseTemplateSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <defs><clipPath id="c"><rect id="foto-recorte" width="5" height="5" /></clipPath></defs>
        <circle id="foto1" r="1" />
      </svg>`);
    expect(autoDetectSlots(root, idPrefix).map((el) => el.localName)).toEqual(['circle']);
  });
});

describe('coverPlacement', () => {
  it('preenchendo, o lado que sobra é o que estoura o encaixe', () => {
    const p = coverPlacement(RECT_100x100, photo());
    expect(p.w).toBeCloseTo(200);
    expect(p.h).toBeCloseTo(100);
    expect(p.x).toBeCloseTo(-50);
    expect(p.y).toBeCloseTo(0);
  });

  it('cabendo, a foto inteira entra e sobra espaço', () => {
    const p = coverPlacement(RECT_100x100, photo({ fit: 'contain' }));
    expect(p.w).toBeCloseTo(100);
    expect(p.h).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(25);
  });

  it('aplica zoom e deslocamento em cima do enquadramento automático', () => {
    const p = coverPlacement(RECT_100x100, photo({ scale: 2, dx: 10, dy: -5 }));
    expect(p.w).toBeCloseTo(400);
    expect(p.h).toBeCloseTo(200);
    expect(p.x).toBeCloseTo(50 + 10 - 200);
    expect(p.y).toBeCloseTo(50 - 5 - 100);
  });

  it('gira e espelha em torno do centro deslocado', () => {
    expect(coverPlacement(RECT_100x100, photo({ rotation: 90 })).transform).toBe('rotate(90 50 50)');
    expect(coverPlacement(RECT_100x100, photo({ flipX: true, dx: 10 })).transform).toBe('translate(120 0) scale(-1 1)');
  });
});

describe('renderPhotos', () => {
  const template = () => parseTemplateSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect id="moldura" width="100" height="100" />
      <circle id="foto1" cx="50" cy="50" r="40" />
    </svg>`);

  function render(photos: PhotoLayer[]) {
    const { root, idPrefix } = template();
    const alvo = root.querySelector('[id$="foto1"]')!.getAttribute('id')!;
    renderPhotos(root, [slot('s1', alvo, RECT_100x100)], photos, idPrefix);
    return root;
  }

  it('empilha as camadas do mesmo encaixe na ordem de z', () => {
    const root = render([
      photo({ id: 'baixo', z: 1, src: 'data:baixo' }),
      photo({ id: 'cima', z: 2, src: 'data:cima' }),
    ]);
    const frente = root.querySelector(`g[${EDITOR_ATTR}="fotos-frente"]`)!;
    expect(Array.from(frente.children).map((g) => g.getAttribute('data-photo-id'))).toEqual(['baixo', 'cima']);
  });

  it('reaproveita um único clipPath por encaixe', () => {
    const root = render([photo({ id: 'a', z: 1 }), photo({ id: 'b', z: 2 })]);
    expect(root.querySelectorAll('clipPath').length).toBe(1);
  });

  it('separa as camadas de trás das da frente do molde', () => {
    const root = render([
      photo({ id: 'atras', z: 1, depth: 'atras' }),
      photo({ id: 'frente', z: 2 }),
    ]);
    expect(root.querySelector(`g[${EDITOR_ATTR}="fotos-atras"]`)!.children.length).toBe(1);
    expect(root.querySelector(`g[${EDITOR_ATTR}="fotos-frente"]`)!.children.length).toBe(1);
    // O grupo de trás vem antes do desenho do molde na ordem do documento.
    const filhos = Array.from(root.children);
    expect(filhos.indexOf(root.querySelector(`g[${EDITOR_ATTR}="fotos-atras"]`)!))
      .toBeLessThan(filhos.indexOf(root.querySelector('[id$="moldura"]')!));
  });

  it('leva o transform herdado pro <use> do recorte', () => {
    const { root, idPrefix } = template();
    const alvo = root.querySelector('[id$="foto1"]')!.getAttribute('id')!;
    renderPhotos(root, [slot('s1', alvo, RECT_100x100, 'matrix(1 0 0 1 190 40)')], [photo()], idPrefix);
    expect(root.querySelector('clipPath use')!.getAttribute('transform')).toBe('matrix(1 0 0 1 190 40)');
  });

  it('põe a opacidade no grupo recortado, não na imagem', () => {
    const root = render([photo({ opacity: 0.5 })]);
    const grupo = root.querySelector('g[data-photo-id]')!;
    expect(grupo.getAttribute('opacity')).toBe('0.5');
    expect(grupo.querySelector('image')!.hasAttribute('opacity')).toBe(false);
  });

  it('redesenha do zero: remover uma camada não deixa resto', () => {
    const { root, idPrefix } = template();
    const alvo = root.querySelector('[id$="foto1"]')!.getAttribute('id')!;
    const slots = [slot('s1', alvo, RECT_100x100)];
    renderPhotos(root, slots, [photo({ id: 'a', z: 1 }), photo({ id: 'b', z: 2 })], idPrefix);
    renderPhotos(root, slots, [photo({ id: 'a', z: 1 })], idPrefix);
    expect(root.querySelectorAll('g[data-photo-id]').length).toBe(1);
  });
});

describe('serializeForExport', () => {
  it('grava o tamanho físico e tira o que é só do editor', () => {
    const { root, idPrefix } = parseTemplateSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
        <circle id="foto1" cx="50" cy="50" r="40" />
      </svg>`);
    const alvo = root.querySelector('[id$="foto1"]')!.getAttribute('id')!;
    renderPhotos(root, [slot('s1', alvo, RECT_100x100)], [photo()], idPrefix);
    const marca = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    marca.setAttribute(EDITOR_ATTR, 'hits');
    root.appendChild(marca);

    const svg = serializeForExport(root, 150, 100);
    expect(svg).toContain('width="150.00mm"');
    expect(svg).toContain('height="100.00mm"');
    expect(svg).toContain('viewBox="0 0 300 200"');
    expect(svg).not.toContain('"hits"');
    expect(svg).toContain('<image');
  });
});
