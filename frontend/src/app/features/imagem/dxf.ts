/** DXF pra Silhouette Studio (edição Basic, que não abre SVG nem PDF). Sai no
 * formato R12 em ASCII — o mais antigo e o que qualquer programa de corte lê —,
 * com as curvas achatadas em polilinha fina (0,1 mm) e cada tipo de linha numa
 * camada com cor própria. Unidades em mm; o Y é invertido (no DXF ele cresce
 * pra cima) pra o desenho cair na página do mesmo jeito que na tela. */

import { CubicPath, Point } from './contour';

export interface DxfPolyline {
  points: Point[];
  closed: boolean;
  layer: string;
}

export interface DxfLayer {
  name: string;
  /** Cor do AutoCAD (1 vermelho, 3 verde, 5 azul, 7 preto/branco, 8 cinza). */
  color: number;
}

/** Erro máximo entre a curva e a polilinha, em mm. */
const FLATNESS_MM = 0.1;

function cubicPoint(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [w0 * a[0] + w1 * c1[0] + w2 * c2[0] + w3 * b[0], w0 * a[1] + w1 * c1[1] + w2 * c2[1] + w3 * b[1]];
}

/** Curva → polilinha. `scale` leva as unidades do caminho pra mm. */
export function cubicToPolyline(path: CubicPath, scale = 1, flatness = FLATNESS_MM): Point[] {
  const s = (p: Point): Point => [p[0] * scale, p[1] * scale];
  const out: Point[] = [s(path.start)];
  let a = path.start;
  for (const seg of path.segments) {
    if (seg.c1 && seg.c2) {
      // passos pela "barriga" da curva: controles longe da corda pedem mais
      const hull = Math.hypot(seg.c1[0] - a[0], seg.c1[1] - a[1]) + Math.hypot(seg.c2[0] - seg.c1[0], seg.c2[1] - seg.c1[1]) + Math.hypot(seg.to[0] - seg.c2[0], seg.to[1] - seg.c2[1]);
      const n = Math.min(200, Math.max(2, Math.ceil(Math.sqrt((hull * scale) / flatness))));
      for (let i = 1; i <= n; i++) out.push(s(cubicPoint(a, seg.c1, seg.c2, seg.to, i / n)));
    } else {
      out.push(s(seg.to));
    }
    a = seg.to;
  }
  return out;
}

const n = (v: number): string => (Math.round(v * 1000) / 1000).toString();

/** Monta o arquivo. `pageH` é a altura da página em mm (pra inverter o Y). */
export function buildDxf(lines: DxfPolyline[], layers: DxfLayer[], pageH: number): string {
  const out: string[] = [];
  const g = (code: number, value: string | number): void => { out.push(String(code), String(value)); };
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  // milímetros (quem lê a unidade respeita; quem não lê assume a do programa)
  g(9, '$INSUNITS'); g(70, 4);
  g(9, '$MEASUREMENT'); g(70, 1);
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const l of layers) {
    g(0, 'LAYER'); g(2, l.name); g(70, 0); g(62, l.color); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const line of lines) {
    let pts = line.points;
    // polilinha fechada não repete o primeiro ponto no fim
    if (line.closed && pts.length > 2) {
      const [f, l] = [pts[0], pts[pts.length - 1]];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) pts = pts.slice(0, -1);
    }
    if (pts.length < 2) continue;
    g(0, 'POLYLINE'); g(8, line.layer); g(66, 1); g(70, line.closed ? 1 : 0);
    g(10, 0); g(20, 0); g(30, 0);
    for (const [x, y] of pts) {
      g(0, 'VERTEX'); g(8, line.layer); g(10, n(x)); g(20, n(pageH - y)); g(30, 0);
    }
    g(0, 'SEQEND'); g(8, line.layer);
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

/** Moldura da página numa camada à parte: no Studio, agrupe tudo, alinhe a
 * moldura com a página e apague a moldura — as linhas caem no lugar certo. */
export function pageFrame(wMm: number, hMm: number, layer = 'PAGINA'): DxfPolyline {
  return { layer, closed: true, points: [[0, 0], [wMm, 0], [wMm, hMm], [0, hMm]] };
}
