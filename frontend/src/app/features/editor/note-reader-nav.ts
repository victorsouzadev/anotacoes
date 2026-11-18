/** Navegação do modo leitura (spec 024), separada do componente para ser testada. */

export type AcaoLeitura = 'proxima' | 'anterior' | 'primeira' | 'ultima';

/** Próxima página para uma ação, sem dar a volta nas pontas. */
export function navegar(atual: number, total: number, acao: AcaoLeitura): number {
  if (total <= 0) return 0;
  switch (acao) {
    case 'proxima': return Math.min(total - 1, atual + 1);
    case 'anterior': return Math.max(0, atual - 1);
    case 'primeira': return 0;
    case 'ultima': return total - 1;
  }
}

/** Tecla → ação (null = a tecla não é de navegação). */
export function acaoDaTecla(key: string): AcaoLeitura | null {
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': return 'proxima';
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': return 'anterior';
    case 'Home': return 'primeira';
    case 'End': return 'ultima';
    default: return null;
  }
}

/** Toque/clique perto das bordas troca de página: 15% da largura de cada lado. */
export function acaoDoToque(x: number, largura: number): AcaoLeitura | null {
  if (largura <= 0) return null;
  if (x < largura * 0.15) return 'anterior';
  if (x > largura * 0.85) return 'proxima';
  return null;
}

/** Deslizar na horizontal (rápido e mais largo que alto) troca de página. */
export function acaoDoGesto(dx: number, dy: number, ms: number): AcaoLeitura | null {
  if (ms > 600 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'proxima' : 'anterior';
}
