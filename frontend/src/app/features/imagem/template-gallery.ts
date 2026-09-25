/** Moldes prontos do modo Molde SVG. São SVG comuns: os encaixes se chamam
 * `foto-N` (a detecção automática acha pelo nome) e os textos são `<text>`,
 * editáveis na aba Textos. Medidas no viewBox em mm. */

export interface GalleryTemplate {
  id: string;
  label: string;
  help: string;
  svg: string;
}

function svg(wMm: number, hMm: number, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wMm} ${hMm}">\n${body}\n</svg>\n`;
}

/** Coração centrado em (cx, cy), com largura `w`. */
function heart(cx: number, cy: number, w: number): string {
  const s = w / 100;
  const p = (x: number, y: number): string => `${(cx + (x - 50) * s).toFixed(2)} ${(cy + (y - 48) * s).toFixed(2)}`;
  return `M${p(50, 92)}C${p(18, 70)} ${p(0, 50)} ${p(0, 30)}C${p(0, 12)} ${p(14, 2)} ${p(28, 2)}C${p(38, 2)} ${p(46, 8)} ${p(50, 16)}` +
    `C${p(54, 8)} ${p(62, 2)} ${p(72, 2)}C${p(86, 2)} ${p(100, 12)} ${p(100, 30)}C${p(100, 50)} ${p(82, 70)} ${p(50, 92)}Z`;
}

export const GALLERY: GalleryTemplate[] = [
  {
    id: 'coracao',
    label: 'Coração',
    help: 'Uma foto recortada em coração, com borda',
    svg: svg(100, 92, [
      `  <path d="${heart(50, 46, 96)}" fill="#f7a8b8" />`,
      `  <path id="foto-1" d="${heart(50, 46.5, 86)}" fill="#ffe3ea" />`,
    ].join('\n')),
  },
  {
    id: 'polaroid',
    label: 'Polaroid',
    help: 'Foto quadrada com a faixa de legenda embaixo',
    svg: svg(88, 107, [
      `  <rect x="0" y="0" width="88" height="107" rx="1.5" fill="#ffffff" stroke="#dddddd" stroke-width="0.4" />`,
      `  <rect id="foto-1" x="6" y="6" width="76" height="76" fill="#e9e9e9" />`,
      `  <text x="44" y="96" font-size="8" text-anchor="middle" font-family="cursive" fill="#333333">Momentos</text>`,
    ].join('\n')),
  },
  {
    id: 'colagem',
    label: 'Colagem 3 fotos',
    help: 'Uma grande e duas menores, com título',
    svg: svg(150, 110, [
      `  <rect x="0" y="0" width="150" height="110" fill="#fffaf3" />`,
      `  <rect id="foto-1" x="6" y="6" width="84" height="84" rx="2" fill="#e6e0d6" />`,
      `  <rect id="foto-2" x="96" y="6" width="48" height="39" rx="2" fill="#e6e0d6" />`,
      `  <rect id="foto-3" x="96" y="51" width="48" height="39" rx="2" fill="#e6e0d6" />`,
      `  <text x="75" y="102" font-size="7" text-anchor="middle" font-family="serif" letter-spacing="1.5" fill="#7f5539">NOSSAS MEMÓRIAS</text>`,
    ].join('\n')),
  },
  {
    id: 'caneca',
    label: 'Caneca (sublimação)',
    help: 'Faixa de 20 × 8,5 cm com três fotos redondas e frase',
    svg: svg(200, 85, [
      `  <rect x="0" y="0" width="200" height="85" fill="#fdf0f3" />`,
      `  <circle id="foto-1" cx="38" cy="38" r="26" fill="#f2d4dc" />`,
      `  <circle id="foto-2" cx="100" cy="38" r="26" fill="#f2d4dc" />`,
      `  <circle id="foto-3" cx="162" cy="38" r="26" fill="#f2d4dc" />`,
      `  <text x="100" y="77" font-size="9" text-anchor="middle" font-family="cursive" fill="#c9184a">Melhor mãe do mundo</text>`,
    ].join('\n')),
  },
  {
    id: 'chaveiro',
    label: 'Chaveiro redondo',
    help: '4,5 cm com furo pra argola',
    svg: svg(45, 52, [
      `  <circle cx="22.5" cy="29.5" r="22" fill="#264653" />`,
      `  <circle cx="22.5" cy="5" r="4.5" fill="#264653" />`,
      `  <circle cx="22.5" cy="5" r="2" fill="#ffffff" />`,
      `  <circle id="foto-1" cx="22.5" cy="29.5" r="19" fill="#d8e2dc" />`,
    ].join('\n')),
  },
  {
    id: 'topo-foto',
    label: 'Topo de bolo com foto',
    help: 'Foto redonda com faixa de nome',
    svg: svg(120, 120, [
      `  <circle cx="60" cy="55" r="50" fill="#ffd166" />`,
      `  <circle id="foto-1" cx="60" cy="55" r="44" fill="#fff1c1" />`,
      `  <path d="M8 92 L112 92 L104 104 L112 116 L8 116 L16 104 Z" fill="#ef476f" />`,
      `  <text x="60" y="108" font-size="11" text-anchor="middle" font-family="sans-serif" font-weight="bold" fill="#ffffff">ANA 5 ANOS</text>`,
    ].join('\n')),
  },
];
