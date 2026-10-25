import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { mensagemDeErro } from '../../../core/erro-http';
import { EstudioService } from '../estudio.service';
import { Midia } from '../estudio.models';
import { ESTUDIO_CSS } from '../shared/estilos';
import { MidiaCardComponent, duracaoLegivel } from '../shared/midia';
import { SeletorMidiaComponent } from '../shared/seletor-midia';

/**
 * Extrair quadros: pause o vídeo no instante certo e guarde o quadro (no navegador, na resolução
 * do vídeo), ou peça ao servidor um quadro a cada N segundos (ffmpeg).
 */
@Component({
  selector: 'app-quadros',
  standalone: true,
  imports: [IconComponent, RouterLink, MidiaCardComponent, SeletorMidiaComponent],
  template: `
    <div class="qd">
      <div class="qd-topo">
        <h1 class="e-titulo">Extrair quadros</h1>
        <button type="button" class="e-btn" (click)="seletor.set(true)"><app-icon name="film" [size]="14" /> {{ video() ? 'Trocar vídeo' : 'Escolher vídeo' }}</button>
      </div>
      @if (video(); as v) {
        <div class="qd-corpo">
          <div class="e-card qd-player">
            <video #player [src]="v.url" controls playsinline crossorigin="anonymous" (loadedmetadata)="carregou()" (timeupdate)="tempo.set(player.currentTime)"></video>
            <div class="qd-controles">
              <button type="button" class="e-ib" (click)="passo(-1)" title="Quadro anterior" aria-label="Quadro anterior">‹</button>
              <span class="qd-tempo">{{ legivel(tempo()) }} / {{ legivel(v.duracaoSeg) }}</span>
              <button type="button" class="e-ib" (click)="passo(1)" title="Próximo quadro" aria-label="Próximo quadro">›</button>
              <button type="button" class="e-btn e-pri" [disabled]="salvando()" (click)="capturar()"><app-icon name="camera" [size]="14" /> Guardar este quadro</button>
            </div>
            <div class="qd-lote">
              <span class="e-muted">Ou no servidor, um quadro a cada</span>
              <input class="e-input qd-int" type="number" min="0.2" step="0.5" [value]="intervalo()" (input)="intervalo.set(+$any($event.target).value)" />
              <span class="e-muted">s</span>
              <button type="button" class="e-btn e-sm" [disabled]="lote()" (click)="extrairLote()">{{ lote() ? 'Extraindo…' : 'Extrair todos' }}</button>
            </div>
            @if (erro()) { <p class="e-erro">{{ erro() }}</p> }
          </div>
          <div class="qd-res">
            <h2>Quadros guardados</h2>
            <div class="e-grid-midias">
              @for (m of quadros(); track m.id) {
                <a [routerLink]="'/estudio/biblioteca'" [queryParams]="{ m: m.id }"><e-midia-card [midia]="m" /></a>
              } @empty {
                <p class="e-vazio">Os quadros vão para a Biblioteca, na pasta "Quadros".</p>
              }
            </div>
          </div>
        </div>
      } @else {
        <p class="e-vazio">Escolha um vídeo da biblioteca ou do computador.</p>
      }
    </div>
    @if (seletor()) {
      <e-seletor-midia titulo="Vídeo" [tipos]="['video']" (escolhido)="trocar($event[0])" (fechar)="seletor.set(false)" />
    }
  `,
  styles: [ESTUDIO_CSS, `
    .qd { padding: 20px; max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
    .qd-topo { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .qd-corpo { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr); gap: 16px; align-items: start; }
    .qd-player { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .qd-player video { width: 100%; max-height: 62vh; background: #000; border-radius: var(--radius-sm); }
    .qd-controles, .qd-lote { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .qd-tempo { font-variant-numeric: tabular-nums; font-size: 13px; min-width: 110px; text-align: center; }
    .qd-int { width: 80px; }
    .qd-res h2 { font-size: 14px; margin: 0 0 8px; }
    .qd-res a { text-decoration: none; color: inherit; }
    @media (max-width: 860px) { .qd-corpo { grid-template-columns: 1fr; } }
  `],
})
export class QuadrosPageComponent {
  private readonly api = inject(EstudioService);
  private readonly route = inject(ActivatedRoute);
  @ViewChild('player') player?: ElementRef<HTMLVideoElement>;

  readonly video = signal<Midia | null>(null);
  readonly quadros = signal<Midia[]>([]);
  readonly seletor = signal(false);
  readonly tempo = signal(0);
  readonly intervalo = signal(1);
  readonly salvando = signal(false);
  readonly lote = signal(false);
  readonly erro = signal('');
  private fps = 30;

  constructor() {
    const entrada = this.route.snapshot.queryParamMap.get('entrada');
    if (entrada) void this.api.midia(entrada).then((m) => this.video.set(m), () => undefined);
  }

  legivel(s: number | null): string {
    if (s == null) return '–';
    return `${duracaoLegivel(s)}.${Math.floor((s % 1) * 100).toString().padStart(2, '0')}`;
  }

  trocar(m: Midia | undefined): void {
    this.seletor.set(false);
    if (m) {
      this.video.set(m);
      this.quadros.set([]);
    }
  }

  carregou(): void {
    this.tempo.set(0);
  }

  passo(dir: number): void {
    const v = this.player?.nativeElement;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir / this.fps));
  }

  async capturar(): Promise<void> {
    const v = this.player?.nativeElement;
    const midia = this.video();
    if (!v || !midia || !v.videoWidth) return;
    this.salvando.set(true);
    this.erro.set('');
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      const blob = await new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('quadro'))), 'image/png'));
      const nome = `${midia.nome.replace(/\.[^.]+$/, '')}-${v.currentTime.toFixed(2)}s.png`;
      const m = await this.api.enviarBytes(blob, nome, 'quadro', 'Quadros');
      this.quadros.update((l) => [m, ...l]);
    } catch (e) {
      this.erro.set(e instanceof DOMException ? 'O navegador não deixou ler o vídeo. Tente "Extrair todos" (no servidor).' : mensagemDeErro(e, 'Não consegui guardar o quadro'));
    } finally {
      this.salvando.set(false);
    }
  }

  async extrairLote(): Promise<void> {
    const midia = this.video();
    if (!midia) return;
    this.lote.set(true);
    this.erro.set('');
    try {
      const job = await this.api.local('quadros', { intervalo: this.intervalo() }, { video: [midia.id] }, 'quadros');
      const fim = await this.api.aguardar(job.id);
      if (fim.status === 'falhou') this.erro.set(fim.erro ?? 'Falhou.');
      this.quadros.update((l) => [...fim.resultado, ...l]);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui extrair'));
    } finally {
      this.lote.set(false);
    }
  }
}
