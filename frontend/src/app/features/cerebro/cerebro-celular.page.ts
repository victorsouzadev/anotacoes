import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { CerebroResumoComponent } from './cerebro-resumo.component';
import { CerebroGrafoComponent } from './cerebro-grafo.component';
import { CerebroService, Nota } from './cerebro.service';

/** Um arquivo esperando envio: gravado aqui, escolhido no celular ou compartilhado de outro app. */
interface Anexo {
  blob: Blob;
  nome: string;
  tipo: string;
  url: string;
  compartilhado: boolean;
}

/** Evento do Chrome que permite mostrar o botão "Instalar app". */
interface PedidoInstalacao extends Event {
  prompt(): Promise<void>;
}

const CACHE_COMPARTILHADO = 'cerebro-compartilhado';

/**
 * App do Segundo Cérebro no celular (PWA instalável, rota /capturar). Captura texto, link e áudio
 * gravado na hora; recebe o que for compartilhado de outros apps, como o WhatsApp (Web Share Target,
 * tratado no sw-cerebro.js); e mostra o grafo das notas. Tudo cai na Inbox, como no site.
 */
@Component({
  selector: 'app-cerebro-celular',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, CerebroGrafoComponent, CerebroResumoComponent],
  templateUrl: './cerebro-celular.page.html',
  styleUrls: ['./cerebro-comum.css', './cerebro-celular.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroCelularPageComponent implements OnInit {
  private readonly api = inject(CerebroService);
  private readonly router = inject(Router);

  readonly aba = signal<'capturar' | 'resumo' | 'grafo'>('capturar');
  readonly anexos = signal<Anexo[]>([]);
  readonly gravando = signal(false);
  readonly segundos = signal(0);
  readonly enviando = signal(false);
  readonly erro = signal('');
  readonly aviso = signal('');
  readonly podeInstalar = signal(false);
  readonly nota = signal<Nota | null>(null);

  texto = '';
  link = '';
  tags = '';

  private gravador: MediaRecorder | null = null;
  private relogio = 0;
  private pedido: PedidoInstalacao | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pararGravacao(false);
      for (const a of this.anexos()) URL.revokeObjectURL(a.url);
    });
  }

  ngOnInit(): void {
    this.prepararPwa();
    const q = new URLSearchParams(location.search);
    if (q.get('aba') === 'grafo' || q.get('aba') === 'resumo') this.aba.set(q.get('aba') as 'grafo' | 'resumo');
    if (q.get('compartilhado') === '1') void this.lerCompartilhado();
    if (q.get('compartilhado') === 'erro') this.erro.set('Não foi possível receber o que foi compartilhado. Tente de novo.');
    if (q.get('gravar') === '1') void this.gravar();
    if (q.has('compartilhado') || q.has('gravar') || q.has('aba')) history.replaceState(null, '', '/capturar');
  }

  /** Manifesto e service worker só nesta rota: é ela que vira o app instalado. */
  private prepararPwa(): void {
    if (!document.querySelector('link[rel="manifest"]')) {
      const l = document.createElement('link');
      l.rel = 'manifest';
      l.href = '/cerebro-app/manifest.webmanifest';
      document.head.appendChild(l);
      const cor = document.createElement('meta');
      cor.name = 'theme-color';
      cor.content = '#7c6cf0';
      document.head.appendChild(cor);
    }
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw-cerebro.js', { scope: '/' }).catch(() => undefined);
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.pedido = e as PedidoInstalacao;
      this.podeInstalar.set(true);
    });
  }

  async instalar(): Promise<void> {
    await this.pedido?.prompt();
    this.pedido = null;
    this.podeInstalar.set(false);
  }

  /** O service worker guardou o compartilhamento no Cache Storage: traz para a tela e limpa. */
  private async lerCompartilhado(): Promise<void> {
    try {
      const cache = await caches.open(CACHE_COMPARTILHADO);
      const meta = await cache.match('/__compartilhado/meta');
      if (!meta) return;
      const m = (await meta.json()) as { titulo: string; texto: string; link: string; arquivos: { chave: string; nome: string; tipo: string }[] };
      const partes = [m.titulo, m.texto].map((s) => s.trim()).filter(Boolean);
      // O WhatsApp manda link no meio do texto: se não veio no campo próprio, tira do texto.
      let link = m.link.trim();
      if (!link) {
        const achado = partes.join(' ').match(/https?:\/\/\S+/);
        if (achado && partes.join(' ').trim() === achado[0]) { link = achado[0]; partes.length = 0; }
      }
      this.texto = partes.join('\n\n');
      this.link = link;
      const novos: Anexo[] = [];
      for (const a of m.arquivos) {
        const r = await cache.match(a.chave);
        if (!r) continue;
        const blob = await r.blob();
        novos.push({ blob, nome: a.nome, tipo: a.tipo || blob.type, url: URL.createObjectURL(blob), compartilhado: true });
      }
      this.anexos.update((l) => [...l, ...novos]);
      for (const k of await cache.keys()) await cache.delete(k);
      this.aviso.set('Recebido. Confira e toque em Enviar para a Inbox.');
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível ler o que foi compartilhado.'));
    }
  }

  async gravar(): Promise<void> {
    if (this.gravando()) { this.pararGravacao(true); return; }
    this.erro.set('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      const pedacos: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!(rec as MediaRecorder & { salvar?: boolean }).salvar || pedacos.length === 0) return;
        const mime = rec.mimeType || tipo || 'audio/webm';
        const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(pedacos, { type: mime });
        const agora = new Date();
        const nome = `audio-${agora.toISOString().slice(0, 16).replace(/[-:T]/g, '')}.${ext}`;
        this.anexos.update((l) => [...l, { blob, nome, tipo: mime, url: URL.createObjectURL(blob), compartilhado: false }]);
      };
      rec.start(1000);
      this.gravador = rec;
      this.gravando.set(true);
      this.segundos.set(0);
      this.relogio = window.setInterval(() => this.segundos.update((s) => s + 1), 1000);
    } catch (e) {
      this.erro.set(e instanceof DOMException && e.name === 'NotAllowedError'
        ? 'Permita o uso do microfone para gravar áudio.'
        : 'Não foi possível acessar o microfone.');
    }
  }

  private pararGravacao(salvar: boolean): void {
    clearInterval(this.relogio);
    const rec = this.gravador;
    this.gravador = null;
    this.gravando.set(false);
    if (rec && rec.state !== 'inactive') {
      (rec as MediaRecorder & { salvar?: boolean }).salvar = salvar;
      rec.stop();
    }
  }

  cancelarGravacao(): void {
    this.pararGravacao(false);
  }

  escolher(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const novos = [...(input.files ?? [])].map((f) => ({
      blob: f as Blob, nome: f.name, tipo: f.type, url: URL.createObjectURL(f), compartilhado: false,
    }));
    this.anexos.update((l) => [...l, ...novos]);
    input.value = '';
  }

  remover(a: Anexo): void {
    URL.revokeObjectURL(a.url);
    this.anexos.update((l) => l.filter((x) => x !== a));
  }

  ehAudio(a: Anexo): boolean { return a.tipo.startsWith('audio/') || /\.(ogg|opus|m4a|mp3|wav|webm|aac)$/i.test(a.nome); }
  ehImagem(a: Anexo): boolean { return a.tipo.startsWith('image/'); }

  tempo(): string {
    const s = this.segundos();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Sem anexo: uma captura de texto/link. Com anexos: uma captura por arquivo, com o texto no primeiro. */
  async enviar(): Promise<void> {
    if (this.gravando()) this.pararGravacao(true);
    // Dá tempo do onstop da gravação montar o arquivo.
    await new Promise((r) => setTimeout(r, 50));
    const anexos = this.anexos();
    const tags = this.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const texto = [this.texto.trim(), anexos.length ? this.link.trim() : ''].filter(Boolean).join('\n\n');
    if (!anexos.length && !this.texto.trim() && !this.link.trim()) return;
    this.enviando.set(true);
    this.erro.set('');
    this.aviso.set('');
    try {
      if (!anexos.length) {
        await this.api.capturar(this.texto.trim(), this.link.trim(), tags);
      } else {
        for (let i = 0; i < anexos.length; i++) {
          const a = anexos[i];
          await this.api.capturarArquivo(a.blob, a.nome, i === 0 ? texto : '', tags, a.compartilhado ? 'compartilhado' : 'celular');
        }
      }
      for (const a of anexos) URL.revokeObjectURL(a.url);
      this.anexos.set([]);
      this.texto = this.link = this.tags = '';
      this.aviso.set(anexos.some((a) => this.ehAudio(a))
        ? 'Enviado para a Inbox. O áudio será transcrito e classificado.'
        : 'Enviado para a Inbox.');
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível enviar. Nada foi perdido: tente de novo.'));
    } finally {
      this.enviando.set(false);
    }
  }

  async abrirNota(path: string): Promise<void> {
    try {
      this.nota.set(await this.api.nota(path));
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível abrir a nota.'));
    }
  }

  abrirNoSite(): void {
    void this.router.navigateByUrl('/cerebro');
  }
}
