import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

export interface PassoTutorial {
  /** Aba que precisa estar aberta para o passo (a página troca antes de mostrar). */
  aba: string;
  /** Seletor do elemento destacado; sem ele, o passo aparece centralizado. */
  alvo?: string;
  titulo: string;
  texto: string;
}

interface Caixa {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Tour guiado: escurece a tela, recorta um "buraco" sobre o elemento do passo e
// mostra a explicação ao lado. Avança com os botões ou com as setas do teclado.
@Component({
  selector: 'app-tutorial',
  standalone: true,
  templateUrl: './tutorial.component.html',
  styleUrl: './tutorial.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TutorialComponent implements OnDestroy {
  readonly passos = input.required<PassoTutorial[]>();
  /** Pede à página para abrir a aba do passo. */
  readonly trocarAba = output<string>();
  readonly fechar = output<void>();

  readonly indice = signal(0);
  readonly caixa = signal<Caixa | null>(null);
  readonly passo = computed(() => this.passos()[this.indice()]);
  readonly ultimo = computed(() => this.indice() === this.passos().length - 1);

  private timer?: ReturnType<typeof setTimeout>;
  private readonly aoRedimensionar = () => this.medir();

  constructor() {
    window.addEventListener('resize', this.aoRedimensionar);
    window.addEventListener('scroll', this.aoRedimensionar, true);
    // Espera a página renderizar antes do primeiro destaque.
    this.timer = setTimeout(() => this.irPara(0), 50);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    window.removeEventListener('resize', this.aoRedimensionar);
    window.removeEventListener('scroll', this.aoRedimensionar, true);
  }

  @HostListener('document:keydown', ['$event'])
  tecla(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.fechar.emit();
    else if (e.key === 'ArrowRight') this.proximo();
    else if (e.key === 'ArrowLeft') this.anterior();
  }

  proximo(): void {
    if (this.ultimo()) this.fechar.emit();
    else this.irPara(this.indice() + 1);
  }

  anterior(): void {
    if (this.indice() > 0) this.irPara(this.indice() - 1);
  }

  private irPara(i: number): void {
    this.indice.set(i);
    this.caixa.set(null);
    this.trocarAba.emit(this.passos()[i].aba);
    // A aba nova renderiza (e às vezes carrega dados) antes de o alvo existir.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const el = this.elemento();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      this.timer = setTimeout(() => this.medir(), 350);
    }, 250);
  }

  private elemento(): HTMLElement | null {
    const alvo = this.passo()?.alvo;
    return alvo ? document.querySelector<HTMLElement>(alvo) : null;
  }

  private medir(): void {
    const el = this.elemento();
    if (!el) {
      this.caixa.set(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const folga = 6;
    this.caixa.set({ top: r.top - folga, left: r.left - folga, width: r.width + folga * 2, height: r.height + folga * 2 });
  }

  /** Coloca o balão abaixo do destaque se couber, senão acima; centralizado sem alvo. */
  posicaoBalao(): Record<string, string> {
    const c = this.caixa();
    const largura = Math.min(340, window.innerWidth - 32);
    if (!c) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: `${largura}px` };
    // Alvo maior que meia tela (o dashboard): o balão fica fixo no rodapé. Sem
    // isso ele alternava entre cima e baixo a cada pixel de rolagem.
    if (c.height > window.innerHeight * 0.5)
      return { bottom: '16px', left: '50%', transform: 'translateX(-50%)', width: `${largura}px` };
    const left = Math.max(16, Math.min(c.left, window.innerWidth - largura - 16));
    const abaixo = c.top + c.height + 12;
    const cabeAbaixo = abaixo + 200 < window.innerHeight;
    return cabeAbaixo
      ? { top: `${abaixo}px`, left: `${left}px`, width: `${largura}px` }
      : { top: `${Math.max(16, c.top - 12)}px`, left: `${left}px`, width: `${largura}px`, transform: 'translateY(-100%)' };
  }
}
