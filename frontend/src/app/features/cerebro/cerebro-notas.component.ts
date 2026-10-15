import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { CerebroService, Conflito, Decisao, Nota, ResultadoBusca, ResumoNota, Versao } from './cerebro.service';
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

  /** O que o painel da direita mostra. */
  readonly modo = signal<'ler' | 'editar' | 'mover' | 'historico' | 'nova'>('ler');
  readonly aviso = signal('');
  /** Para o "Desfazer" depois de excluir: onde a nota estava e onde foi parar. */
  readonly desfazer = signal<{ de: string; para: string } | null>(null);
  readonly salvando = signal(false);
  readonly pastasDestino = signal<string[]>([]);

  rascunho = '';
  readonly conflito = signal<Conflito | null>(null);

  novaPasta = '00-Inbox';
  novoTitulo = '';
  novoConteudo = '';

  destinoPasta = '';
  novoNome = '';

  readonly versoes = signal<Versao[]>([]);
  readonly versaoVista = signal<{ v: Versao; conteudo: string } | null>(null);

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
    if (this.modo() === 'editar' && this.alterado() && !confirm('Descartar as alterações não salvas?')) return;
    try {
      this.nota.set(await this.api.nota(path));
      this.modo.set('ler');
      this.conflito.set(null);
      this.versaoVista.set(null);
      this.erro.set('');
      document.querySelector('.leitor')?.scrollTo({ top: 0 });
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Abrir a nota'));
    }
  }

  fechar(): void {
    if (this.modo() === 'editar' && this.alterado() && !confirm('Descartar as alterações não salvas?')) return;
    this.nota.set(null);
    this.modo.set('ler');
  }

  private recarregarLista(): void {
    void this.carregar(this.pasta());
    void this.api.decisoes().then((d) => this.decisoes.set(d), () => undefined);
  }

  private async garantirPastas(): Promise<void> {
    if (!this.pastasDestino().length) this.pastasDestino.set(await this.api.pastasEditaveis());
  }

  private falha(err: unknown, acao: string): void {
    this.erro.set(mensagemDeErro(err, acao));
  }

  // ------------------------------------------------------------ editar

  alterado(): boolean {
    return this.nota() !== null && this.rascunho !== this.nota()!.raw;
  }

  editar(): void {
    const n = this.nota();
    if (!n) return;
    this.rascunho = n.raw;
    this.conflito.set(null);
    this.modo.set('editar');
  }

  cancelarEdicao(): void {
    if (this.alterado() && !confirm('Descartar as alterações?')) return;
    this.conflito.set(null);
    this.modo.set('ler');
  }

  /** forcar = salvar por cima da versão que mudou no meio (depois de ver o conflito). */
  async salvar(forcar = false): Promise<void> {
    const n = this.nota();
    if (!n) return;
    this.salvando.set(true);
    this.erro.set('');
    try {
      const versao = forcar && this.conflito() ? this.conflito()!.versao_atual : n.versao;
      await this.api.salvarNota(n.path, this.rascunho, versao);
      this.conflito.set(null);
      await this.abrirNota(n.path);
      this.aviso.set('Nota salva. A versão anterior fica no histórico.');
      this.recarregarLista();
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409) this.conflito.set(err.error as Conflito);
      else this.falha(err, 'Salvar a nota');
    } finally {
      this.salvando.set(false);
    }
  }

  async descartarERecarregar(): Promise<void> {
    const n = this.nota();
    if (!n) return;
    this.rascunho = n.raw;
    this.modo.set('ler');
    await this.abrirNota(n.path);
  }

  // ------------------------------------------------------------ criar

  async novaNota(): Promise<void> {
    if (this.modo() === 'editar' && this.alterado() && !confirm('Descartar as alterações não salvas?')) return;
    await this.garantirPastas();
    const atual = this.pasta();
    this.novaPasta = atual && this.pastasDestino().includes(atual) ? atual : '00-Inbox';
    this.novoTitulo = '';
    this.novoConteudo = '';
    this.nota.set(null);
    this.modo.set('nova');
  }

  async criar(): Promise<void> {
    if (!this.novoTitulo.trim()) return;
    this.salvando.set(true);
    try {
      const r = await this.api.criarNota(this.novaPasta, this.novoTitulo.trim(), this.novoConteudo);
      await this.abrirNota(r.path);
      this.aviso.set('Nota criada.');
      this.recarregarLista();
    } catch (err) {
      this.falha(err, 'Criar a nota');
    } finally {
      this.salvando.set(false);
    }
  }

  // ------------------------------------------------------------ mover, renomear, excluir

  async abrirMover(): Promise<void> {
    const n = this.nota();
    if (!n) return;
    await this.garantirPastas();
    this.destinoPasta = n.folder;
    this.novoNome = n.path.split('/').pop()!.replace(/\.md$/i, '');
    this.modo.set('mover');
  }

  async mover(): Promise<void> {
    const n = this.nota();
    if (!n) return;
    this.salvando.set(true);
    try {
      const r = await this.api.moverNota(n.path, this.destinoPasta, this.novoNome.trim() || null);
      await this.abrirNota(r.path);
      this.aviso.set(`Nota em ${r.path}.`);
      this.recarregarLista();
    } catch (err) {
      this.falha(err, 'Mover a nota');
    } finally {
      this.salvando.set(false);
    }
  }

  async excluir(): Promise<void> {
    const n = this.nota();
    if (!n || !confirm(`Excluir "${n.title}"? Ela vai para a lixeira (_sistema/lixeira) e dá para desfazer.`)) return;
    try {
      const r = await this.api.excluirNota(n.path);
      this.desfazer.set({ de: n.folder, para: r.path });
      this.nota.set(null);
      this.modo.set('ler');
      this.aviso.set('Nota enviada para a lixeira.');
      this.recarregarLista();
    } catch (err) {
      this.falha(err, 'Excluir a nota');
    }
  }

  async desfazerExclusao(): Promise<void> {
    const d = this.desfazer();
    if (!d) return;
    try {
      const r = await this.api.moverNota(d.para, d.de, null);
      this.desfazer.set(null);
      this.aviso.set('Exclusão desfeita.');
      this.recarregarLista();
      await this.abrirNota(r.path);
    } catch (err) {
      this.falha(err, 'Desfazer a exclusão');
    }
  }

  // ------------------------------------------------------------ histórico da nota

  async abrirHistorico(): Promise<void> {
    const n = this.nota();
    if (!n) return;
    this.versaoVista.set(null);
    this.modo.set('historico');
    try {
      this.versoes.set((await this.api.historico(n.path, 0, 50)).versoes);
    } catch (err) {
      this.falha(err, 'Carregar o histórico');
    }
  }

  async verVersao(v: Versao): Promise<void> {
    const n = this.nota();
    if (!n) return;
    try {
      // Depois de um rename, a nota tinha outro caminho nessa versão.
      const caminho = v.arquivos.find((a) => a.path === n.path)?.path ?? v.arquivos.find((a) => a.path.endsWith('.md'))?.path ?? n.path;
      this.versaoVista.set({ v, conteudo: await this.api.conteudoNaVersao(v.versao, caminho) });
    } catch (err) {
      this.falha(err, 'Abrir a versão');
    }
  }

  async restaurarVersao(v: Versao): Promise<void> {
    const n = this.nota();
    if (!n) return;
    const quando = new Date(v.data).toLocaleString('pt-BR');
    if (!confirm(`Voltar "${n.title}" para a versão de ${quando}? O conteúdo atual fica salvo no histórico.`)) return;
    try {
      await this.api.restaurarNota(v.versao, n.path);
      await this.abrirNota(n.path);
      this.aviso.set(`Nota restaurada para a versão de ${quando}.`);
      this.recarregarLista();
    } catch (err) {
      this.falha(err, 'Restaurar a versão');
    }
  }

  rotuloOrigem(o: string): string {
    switch (o) {
      case 'tela': return 'você, pela tela';
      case 'claude': return 'Claude (MCP)';
      case 'obsidian': return 'Obsidian (sync)';
      default: return 'Cérebro';
    }
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
