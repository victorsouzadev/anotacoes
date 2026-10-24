import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { IconComponent } from '../../../shared/icon';
import { mensagemDeErro } from '../../../core/erro-http';
import { EstudioService } from '../estudio.service';
import { Midia, TipoMidia } from '../estudio.models';
import { ESTUDIO_CSS } from './estilos';
import { MidiaCardComponent, NOME_DO_TIPO } from './midia';

/**
 * Janela para escolher arquivo(s) da biblioteca do Estúdio, ou enviar novos do computador
 * (que entram na biblioteca e já voltam selecionados).
 */
@Component({
  selector: 'e-seletor-midia',
  standalone: true,
  imports: [IconComponent, MidiaCardComponent],
  template: `
    <div class="sm-fundo" (click)="fechar.emit()">
      <div class="sm-caixa e-card" (click)="$event.stopPropagation()" role="dialog" aria-modal="true" [attr.aria-label]="titulo">
        <header class="sm-topo">
          <strong>{{ titulo }}</strong>
          <button type="button" class="e-ib" (click)="fechar.emit()" aria-label="Fechar"><app-icon name="x" [size]="16" /></button>
        </header>
        <div class="sm-filtros">
          <input class="e-input" type="search" placeholder="Buscar pelo nome ou prompt" [value]="busca()" (input)="buscar($event)" />
          @if (tipos.length > 1) {
            <div class="e-chips">
              <button type="button" class="e-chip" [class.e-on]="!tipoAtivo()" (click)="tipoAtivo.set(null); carregar()">Todos</button>
              @for (t of tipos; track t) {
                <button type="button" class="e-chip" [class.e-on]="tipoAtivo() === t" (click)="tipoAtivo.set(t); carregar()">{{ nomeTipo(t) }}</button>
              }
            </div>
          }
          <label class="e-btn e-pri sm-enviar">
            <app-icon name="upload" [size]="14" /> {{ enviando() ? 'Enviando…' : 'Enviar do computador' }}
            <input type="file" hidden [attr.accept]="aceita" [multiple]="multiplo" (change)="enviar($event)" />
          </label>
        </div>
        @if (erro()) { <p class="e-erro sm-pad">{{ erro() }}</p> }
        <div class="sm-lista">
          @if (carregando()) {
            <p class="e-vazio">Carregando…</p>
          } @else {
            <div class="e-grid-midias">
              @for (m of itens(); track m.id) {
                <e-midia-card [midia]="m" [selecionada]="escolhidas().has(m.id)" (escolher)="alternar($event)" />
              } @empty {
                <p class="e-vazio">Nada na biblioteca ainda. Envie um arquivo do computador.</p>
              }
            </div>
          }
        </div>
        @if (multiplo) {
          <footer class="sm-rodape">
            <span class="e-muted">{{ escolhidas().size }} {{ escolhidas().size === 1 ? 'escolhido' : 'escolhidos' }}{{ max ? ' (máx. ' + max + ')' : '' }}</span>
            <button type="button" class="e-btn e-pri" [disabled]="escolhidas().size === 0" (click)="confirmar()">Usar</button>
          </footer>
        }
      </div>
    </div>
  `,
  styles: [ESTUDIO_CSS, `
    .sm-fundo { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .sm-caixa { width: min(880px, 100%); max-height: min(86vh, 900px); display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--shadow-lg); }
    .sm-topo, .sm-rodape { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .sm-rodape { border-bottom: none; border-top: 1px solid var(--border); }
    .sm-filtros { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 16px; }
    .sm-filtros .e-input { flex: 1 1 220px; }
    .sm-enviar { cursor: pointer; }
    .sm-lista { overflow: auto; padding: 4px 16px 16px; flex: 1; }
    .sm-pad { padding: 0 16px; }
  `],
})
export class SeletorMidiaComponent implements OnInit {
  private readonly api = inject(EstudioService);

  @Input() titulo = 'Escolher da biblioteca';
  @Input() tipos: TipoMidia[] = ['imagem'];
  @Input() multiplo = false;
  @Input() max: number | null = null;
  /** Extensões aceitas no envio (ex.: ".xlsx,.csv"); padrão: o que os tipos sugerem. */
  @Input() extensoes: string | null = null;
  @Output() escolhido = new EventEmitter<Midia[]>();
  @Output() fechar = new EventEmitter<void>();

  readonly itens = signal<Midia[]>([]);
  readonly carregando = signal(true);
  readonly enviando = signal(false);
  readonly erro = signal('');
  readonly busca = signal('');
  readonly tipoAtivo = signal<TipoMidia | null>(null);
  readonly escolhidas = signal(new Map<string, Midia>());
  private timer: ReturnType<typeof setTimeout> | null = null;

  get aceita(): string {
    if (this.extensoes) return this.extensoes;
    const mapa: Record<TipoMidia, string> = {
      imagem: 'image/*', video: 'video/*', audio: 'audio/*', modelo3d: '.glb,.gltf,.obj,.fbx,.stl,.usdz', mundo: '.ply,.spz,.splat,.ksplat', documento: '',
    };
    const lista = this.tipos.map((t) => mapa[t]);
    return lista.includes('') ? '' : lista.join(',');
  }

  ngOnInit(): void {
    void this.carregar();
  }

  nomeTipo(t: TipoMidia): string {
    return NOME_DO_TIPO[t];
  }

  buscar(e: Event): void {
    this.busca.set((e.target as HTMLInputElement).value);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.carregar(), 250);
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    try {
      this.itens.set(await this.api.midias({ tipo: this.tipoAtivo() ?? this.tipos, q: this.busca() || undefined, limite: 200 }));
      this.erro.set('');
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui abrir a biblioteca'));
    } finally {
      this.carregando.set(false);
    }
  }

  alternar(m: Midia): void {
    if (!this.multiplo) {
      this.escolhido.emit([m]);
      return;
    }
    const mapa = new Map(this.escolhidas());
    if (mapa.has(m.id)) mapa.delete(m.id);
    else if (!this.max || mapa.size < this.max) mapa.set(m.id, m);
    this.escolhidas.set(mapa);
  }

  confirmar(): void {
    this.escolhido.emit([...this.escolhidas().values()]);
  }

  async enviar(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.enviando.set(true);
    try {
      const novas = await this.api.enviarArquivos(input.files);
      if (!this.multiplo) {
        this.escolhido.emit(novas.slice(0, 1));
        return;
      }
      this.itens.update((l) => [...novas, ...l]);
      const mapa = new Map(this.escolhidas());
      for (const m of novas) if (!this.max || mapa.size < this.max) mapa.set(m.id, m);
      this.escolhidas.set(mapa);
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Não consegui enviar o arquivo'));
    } finally {
      this.enviando.set(false);
      input.value = '';
    }
  }
}
