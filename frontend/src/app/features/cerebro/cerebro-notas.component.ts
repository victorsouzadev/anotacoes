import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { CerebroService, Decisao, Nota, ResultadoBusca, ResumoNota } from './cerebro.service';
import { Block, Inline, parseMarkdown } from './markdown';

/** O que cada pasta guarda, para quem está começando a usar o vault. */
const DESCRICAO_PASTA: Record<string, string> = {
  '00-Inbox': 'Esperando revisão',
  '01-Diario': 'Notas do dia',
  '10-Projetos': 'Com prazo ou entrega',
  '20-Areas': 'Responsabilidades contínuas',
  '30-Recursos': 'Referências e aprendizados',
  '40-Pessoas': 'Contatos',
  '90-Arquivo': 'Concluído ou rejeitado',
  '_sistema': 'Criado pela IA e anexos',
};

/**
 * Aba "Notas": navegar pelo vault (o que já foi aprovado e o resto), buscar e ler uma nota com as
 * ligações clicáveis. Só leitura: editar continua sendo no Obsidian.
 */
@Component({
  selector: 'app-cerebro-notas',
  standalone: true,
  imports: [FormsModule, IconComponent, DatePipe, NgTemplateOutlet],
  templateUrl: './cerebro-notas.component.html',
  styleUrls: ['./cerebro-comum.css', './cerebro-notas.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroNotasComponent {
  private readonly api = inject(CerebroService);

  /** Caminho para abrir assim que a aba aparece (ex.: "Ver nota" depois de aprovar). */
  readonly abrir = input<string | null>(null);

  readonly pastas = signal<{ pasta: string; total: number }[]>([]);
  readonly pasta = signal<string | null>(null);
  readonly notas = signal<ResumoNota[]>([]);
  readonly decisoes = signal<Decisao[]>([]);
  readonly resultados = signal<ResultadoBusca[] | null>(null);
  readonly nota = signal<Nota | null>(null);
  readonly carregando = signal(false);
  readonly erro = signal('');
  termo = '';

  readonly blocos = computed<Block[]>(() => {
    const n = this.nota();
    if (!n) return [];
    const blocos = parseMarkdown(n.body);
    // O título já aparece no topo: some o "# Título" igual que abre a nota.
    const primeiro = blocos[0];
    if (primeiro?.t === 'h' && primeiro.nivel === 1 &&
        primeiro.inl.map((x) => ('v' in x ? x.v : '')).join('').trim().toLowerCase() === n.title.trim().toLowerCase()) {
      return blocos.slice(1);
    }
    return blocos;
  });

  readonly total = computed(() => this.pastas().reduce((s, p) => s + p.total, 0));

  constructor() {
    void this.carregar(null);
    void this.api.decisoes().then((d) => this.decisoes.set(d), () => undefined);
    effect(() => {
      const p = this.abrir();
      if (p) void this.abrirNota(p);
    });
  }

  descricao(pasta: string): string {
    return DESCRICAO_PASTA[pasta] ?? '';
  }

  async carregar(pasta: string | null): Promise<void> {
    this.pasta.set(pasta);
    this.resultados.set(null);
    this.termo = '';
    this.carregando.set(true);
    try {
      const r = await this.api.notas(pasta);
      this.pastas.set(r.pastas.filter((p) => p.pasta !== ''));
      this.notas.set(r.notas);
      this.erro.set('');
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Carregar as notas'));
    } finally {
      this.carregando.set(false);
    }
  }

  async buscar(): Promise<void> {
    const q = this.termo.trim();
    if (!q) {
      this.resultados.set(null);
      return;
    }
    this.carregando.set(true);
    try {
      this.resultados.set(await this.api.buscar(q));
      this.erro.set('');
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Buscar no vault'));
    } finally {
      this.carregando.set(false);
    }
  }

  async abrirNota(path: string): Promise<void> {
    try {
      this.nota.set(await this.api.nota(path));
      this.erro.set('');
      document.querySelector('.leitor')?.scrollTo({ top: 0 });
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Abrir a nota'));
    }
  }

  fechar(): void {
    this.nota.set(null);
  }

  /** Caminho para onde um [[wikilink]] aponta (null = nota ainda não existe). */
  destino(alvo: string): string | null {
    const links = this.nota()?.links ?? {};
    const chave = Object.keys(links).find((k) => k.toLowerCase() === alvo.toLowerCase());
    return chave ? links[chave] : null;
  }

  trechos(snippet: string): { texto: string; marcado: boolean }[] {
    return snippet.split('**').map((texto, i) => ({ texto, marcado: i % 2 === 1 }));
  }

  /** Para o template: o Angular não estreita o tipo dentro de @switch em uniões. */
  asInl(x: unknown): Inline[] {
    return x as Inline[];
  }
}
