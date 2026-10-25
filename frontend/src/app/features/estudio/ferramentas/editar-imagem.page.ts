import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { AppIa, ia } from '../apps';
import { EstudioService } from '../estudio.service';
import { Midia, Valor } from '../estudio.models';
import { ESTUDIO_CSS } from '../shared/estilos';
import { ConfigForm, FormGeracaoComponent } from '../shared/form-geracao';
import { HistoricoGeracoes } from '../shared/historico';
import { JobCardComponent } from '../shared/job-card';
import { SeletorMidiaComponent } from '../shared/seletor-midia';

/**
 * Editar imagem com IA: pinte a área (máscara) e diga o que fazer — ou peça a mudança na imagem
 * toda. Com ?modo=marca vira o "Remover marca d'água" (prompt pronto, mesma pintura).
 */
@Component({
  selector: 'app-editar-imagem',
  standalone: true,
  imports: [IconComponent, FormGeracaoComponent, JobCardComponent, SeletorMidiaComponent],
  template: `
    <div class="ei">
      <section class="ei-tela e-card">
        @if (imagem(); as img) {
          <div class="ei-ferramentas">
            <div class="e-chips">
              <button type="button" class="e-chip" [class.e-on]="ferramenta() === 'pincel'" (click)="ferramenta.set('pincel')"><app-icon name="pen" [size]="12" /> Pintar</button>
              <button type="button" class="e-chip" [class.e-on]="ferramenta() === 'borracha'" (click)="ferramenta.set('borracha')"><app-icon name="eraser-stroke" [size]="12" /> Apagar</button>
            </div>
            <label class="ei-tam">Pincel <input type="range" min="4" max="160" [value]="pincel()" (input)="pincel.set(+$any($event.target).value)" /></label>
            <button type="button" class="e-btn e-sm" (click)="limpar()">Limpar máscara</button>
            <button type="button" class="e-btn e-sm" (click)="seletor.set(true)">Trocar imagem</button>
          </div>
          <div class="ei-area" #area>
            <img #foto [src]="img.url" alt="" (load)="ajustar()" crossorigin="anonymous" />
            <canvas #mascara class="ei-mascara" (pointerdown)="comecar($event)" (pointermove)="mover($event)" (pointerup)="parar()" (pointerleave)="parar()"></canvas>
          </div>
          <p class="e-muted ei-dica">{{ temMascara() ? 'A área em vermelho é a que a IA vai refazer.' : 'Pinte por cima do que quer mudar (para a aba "Imagem toda" a máscara não é usada).' }}</p>
        } @else {
          <div class="ei-vazio">
            <app-icon name="image" [size]="40" />
            <p>Escolha a imagem que vai editar.</p>
            <button type="button" class="e-btn e-pri" (click)="seletor.set(true)">Escolher imagem</button>
          </div>
        }
      </section>

      <section class="ei-lado">
        <div class="e-card ei-form">
          <h1 class="e-titulo">{{ app.nome }}</h1>
          <p class="e-sub">{{ app.descricao }}</p>
          @if (imagem(); as img) {
            @for (k of [chaveForm()]; track k) {
              <e-form-geracao [config]="config" [entradasIniciais]="{ imagem: [img], imagens: [img] }" [antesDeGerar]="antes" (gerado)="historico.adicionar($event)" />
            }
          }
        </div>
        @for (j of historico.jobs(); track j.id) {
          <e-job-card [job]="j" (abrir)="usar($event)" (cancelar)="historico.cancelar($event)" (ocultar)="historico.ocultar($event)" />
        }
      </section>
    </div>
    @if (seletor()) {
      <e-seletor-midia titulo="Imagem para editar" [tipos]="['imagem']" (escolhido)="trocar($event[0])" (fechar)="seletor.set(false)" />
    }
  `,
  styles: [ESTUDIO_CSS, `
    .ei { display: grid; grid-template-columns: 1fr minmax(320px, 400px); gap: 16px; padding: 20px; align-items: start; }
    .ei-tela { padding: 12px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .ei-ferramentas { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .ei-tam { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .ei-area { position: relative; align-self: center; max-width: 100%; touch-action: none; }
    .ei-area img { display: block; max-width: 100%; max-height: 72vh; border-radius: var(--radius-sm); user-select: none; -webkit-user-drag: none; }
    .ei-mascara { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; opacity: .55; }
    .ei-dica { font-size: 12px; margin: 0; }
    .ei-vazio { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 60px 20px; color: var(--text-muted); }
    .ei-lado { display: flex; flex-direction: column; gap: 10px; }
    .ei-form { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    @media (max-width: 900px) { .ei { grid-template-columns: 1fr; } }
  `],
})
export class EditarImagemPageComponent {
  private readonly api = inject(EstudioService);
  private readonly route = inject(ActivatedRoute);
  @ViewChild('foto') foto?: ElementRef<HTMLImageElement>;
  @ViewChild('mascara') mascara?: ElementRef<HTMLCanvasElement>;

  readonly app: AppIa;
  readonly config: AppIa & ConfigForm;
  readonly imagem = signal<Midia | null>(null);
  readonly seletor = signal(false);
  readonly ferramenta = signal<'pincel' | 'borracha'>('pincel');
  readonly pincel = signal(40);
  readonly temMascara = signal(false);
  readonly chaveForm = computed(() => this.imagem()?.id ?? '');
  readonly historico: HistoricoGeracoes;
  private desenhando = false;
  private ultimo: { x: number; y: number } | null = null;

  constructor() {
    const marca = this.route.snapshot.queryParamMap.get('modo') === 'marca';
    this.app = ia(marca ? 'remover-marca' : 'editar-imagem')!;
    // A máscara é pintada aqui: o formulário não pede o arquivo dela.
    this.config = { ...this.app, ocultas: ['mascara', 'imagem'] };
    this.historico = new HistoricoGeracoes(this.app.id);
    void this.historico.carregar();
    const entrada = this.route.snapshot.queryParamMap.get('entrada');
    if (entrada) void this.api.midia(entrada).then((m) => this.imagem.set(m), () => undefined);
  }

  trocar(m: Midia | undefined): void {
    this.seletor.set(false);
    if (m) {
      this.imagem.set(m);
      this.temMascara.set(false);
    }
  }

  usar(m: Midia): void {
    // Continuar editando o resultado: vira a imagem da tela.
    if (m.tipo === 'imagem') this.trocar(m);
  }

  ajustar(): void {
    const img = this.foto?.nativeElement;
    const c = this.mascara?.nativeElement;
    if (!img || !c) return;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    this.temMascara.set(false);
  }

  limpar(): void {
    const c = this.mascara?.nativeElement;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    this.temMascara.set(false);
  }

  comecar(e: PointerEvent): void {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this.desenhando = true;
    this.ultimo = null;
    this.mover(e);
  }

  mover(e: PointerEvent): void {
    if (!this.desenhando) return;
    const c = this.mascara!.nativeElement;
    const r = c.getBoundingClientRect();
    const escala = c.width / r.width;
    const p = { x: (e.clientX - r.left) * escala, y: (e.clientY - r.top) * escala };
    const ctx = c.getContext('2d')!;
    ctx.globalCompositeOperation = this.ferramenta() === 'pincel' ? 'source-over' : 'destination-out';
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = this.pincel() * escala;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo((this.ultimo ?? p).x, (this.ultimo ?? p).y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    this.ultimo = p;
    if (this.ferramenta() === 'pincel') this.temMascara.set(true);
  }

  parar(): void {
    this.desenhando = false;
    this.ultimo = null;
  }

  /** Antes de enviar: na aba "área pintada", sobe a máscara em preto e branco (branco = refazer). */
  readonly antes = async (pedido: { operacao: string; entradas: Record<string, string[]>; parametros: Record<string, Valor> }): Promise<void> => {
    const img = this.imagem();
    if (!img) throw new Error('Escolha a imagem.');
    pedido.entradas['imagem'] = [img.id];
    if (!pedido.entradas['imagens']?.length) pedido.entradas['imagens'] = [img.id];
    if (pedido.operacao !== 'inpaint') return;
    if (!this.temMascara()) throw new Error('Pinte por cima da área que a IA deve refazer (ou use a aba "Imagem toda").');
    const c = this.mascara!.nativeElement;
    const pb = document.createElement('canvas');
    pb.width = c.width;
    pb.height = c.height;
    const ctx = pb.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, pb.width, pb.height);
    ctx.drawImage(c, 0, 0);
    // Tudo o que foi pintado (vermelho, qualquer alfa) vira branco puro.
    const dados = ctx.getImageData(0, 0, pb.width, pb.height);
    for (let i = 0; i < dados.data.length; i += 4) {
      const v = dados.data[i] > 40 ? 255 : 0;
      dados.data[i] = dados.data[i + 1] = dados.data[i + 2] = v;
      dados.data[i + 3] = 255;
    }
    ctx.putImageData(dados, 0, 0);
    const blob = await new Promise<Blob>((ok, falha) => pb.toBlob((b) => (b ? ok(b) : falha(new Error('máscara'))), 'image/png'));
    const m = await this.api.enviarBytes(blob, `mascara-${img.nome.replace(/\.[^.]+$/, '')}.png`, 'mascara', 'Máscaras');
    pedido.entradas['mascara'] = [m.id];
  };
}
