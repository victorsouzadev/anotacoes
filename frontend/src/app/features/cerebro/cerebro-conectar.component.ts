import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { Acessos, CerebroService, ItemAcesso } from './cerebro.service';

type Secao = 'obsidian' | 'mcp' | 'ops' | 'api';
type Cliente = 'code' | 'web';

/** Aba "Conectar": todos os acessos do Cérebro, com os valores para copiar e como usar cada um. */
@Component({
  selector: 'app-cerebro-conectar',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './cerebro-conectar.component.html',
  styleUrls: ['./cerebro-comum.css', './cerebro-conectar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroConectarComponent {
  private readonly api = inject(CerebroService);

  readonly origem = location.origin;
  readonly acessos = signal<Acessos | null>(null);
  readonly erro = signal('');
  readonly aviso = signal('');
  readonly ocupado = signal<string | null>(null);
  readonly aberta = signal<Secao>('mcp');
  readonly clienteMcp = signal<Cliente>('code');
  readonly clienteOps = signal<Cliente>('code');

  /** Valores já revelados nesta visita (item → valor). Some ao sair da página. */
  readonly valores = signal<Record<ItemAcesso, string>>({});

  usuarioWebdav = '';
  novaFonte = '';

  readonly urlDav = computed(() => `${this.origem}/dav`);

  readonly cmdCodeMcp = computed(() =>
    `claude mcp add --transport http --scope user cerebro ${this.origem}/cerebro/mcp \\\n  --header "Authorization: Bearer ${this.v('mcp')}"`);
  readonly urlWebMcp = computed(() => `${this.origem}/cerebro/mcp?key=${this.v('mcp')}`);

  readonly cmdCodeOps = computed(() =>
    `claude mcp add --transport http --scope user vps ${this.origem}/ops/mcp \\\n  --header "Authorization: Bearer ${this.v('ops')}"`);
  readonly urlWebOps = computed(() => `${this.origem}/ops/mcp?key=${this.v('ops')}`);

  constructor() {
    void this.carregar();
  }

  /** Valor revelado ou um marcador, para os comandos ficarem legíveis antes de revelar. */
  v(item: ItemAcesso): string {
    return this.valores()[item] ?? (item.startsWith('api:') ? '<CHAVE>' : '<TOKEN>');
  }

  revelado(item: ItemAcesso): boolean {
    return item in this.valores();
  }

  async carregar(): Promise<void> {
    try {
      const a = await this.api.acessos();
      this.acessos.set(a);
      this.usuarioWebdav = a.webdav.usuario ?? 'obsidian';
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Carregar os acessos'));
    }
  }

  private guardar(item: ItemAcesso, valor: string): void {
    this.valores.update((v) => ({ ...v, [item]: valor }));
  }

  async alternar(item: ItemAcesso): Promise<void> {
    if (this.revelado(item)) {
      this.valores.update((v) => {
        const { [item]: _, ...resto } = v;
        return resto;
      });
      return;
    }
    await this.revelar(item);
  }

  private async revelar(item: ItemAcesso): Promise<boolean> {
    try {
      this.guardar(item, await this.api.revelar(item));
      return true;
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Mostrar o acesso'));
      return false;
    }
  }

  /** Copia um texto que depende de segredos: revela antes, para não copiar o marcador. */
  async copiarCom(itens: ItemAcesso[], texto: () => string): Promise<void> {
    for (const item of itens) {
      if (!this.revelado(item) && !(await this.revelar(item))) return;
    }
    this.copiar(texto());
  }

  copiar(texto: string): void {
    const ok = () => {
      this.aviso.set('Copiado.');
      setTimeout(() => this.aviso.set(''), 2000);
    };
    if (!navigator.clipboard) {
      this.erro.set('Este navegador não deixa copiar automaticamente: clique em Mostrar e copie à mão.');
      return;
    }
    navigator.clipboard.writeText(texto).then(ok, () =>
      this.erro.set('O navegador bloqueou a cópia: clique em Mostrar e copie à mão.'));
  }

  async gerar(qual: 'mcp' | 'ops'): Promise<void> {
    const a = this.acessos();
    const jaTem = qual === 'mcp' ? a?.mcp.configurado : a?.ops.configurado;
    if (jaTem && !confirm('Gerar um token novo desliga o atual na hora. Os clientes conectados (Claude Code, Claude web) vão precisar do novo. Continuar?')) return;
    await this.executar(qual, async () => {
      this.guardar(qual, await this.api.gerarToken(qual));
      this.aviso.set('Token novo gerado e já em uso. Atualize os clientes com os comandos abaixo.');
    });
  }

  async salvarWebdav(): Promise<void> {
    const msg = 'Trocar o login do WebDAV desconecta o Obsidian em todos os aparelhos até você colar o novo login no Remotely Save. Continuar?';
    if (this.acessos()?.webdav.configurado && !confirm(msg)) return;
    await this.executar('webdav', async () => {
      const r = await this.api.salvarWebdav(this.usuarioWebdav.trim(), null);
      this.guardar('webdav', r.senha);
      this.aviso.set('Login do WebDAV salvo e já em uso.');
    });
  }

  async criarFonte(): Promise<void> {
    const nome = this.novaFonte.trim().toLowerCase();
    if (!nome) return;
    await this.executar('api', async () => {
      const r = await this.api.criarApiKey(nome);
      this.guardar(`api:${r.nome}`, r.valor);
      this.novaFonte = '';
      this.aviso.set(`Chave da fonte "${r.nome}" criada.`);
    });
  }

  async apagarFonte(nome: string): Promise<void> {
    if (!confirm(`Apagar a chave "${nome}"? Quem usa essa chave deixa de conseguir enviar capturas.`)) return;
    await this.executar(`api:${nome}`, async () => {
      await this.api.apagarApiKey(nome);
      this.aviso.set(`Chave "${nome}" apagada.`);
    });
  }

  private async executar(chave: string, acao: () => Promise<void>): Promise<void> {
    this.ocupado.set(chave);
    this.erro.set('');
    try {
      await acao();
      await this.carregar();
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Salvar o acesso'));
    } finally {
      this.ocupado.set(null);
    }
  }

  curl(nome: string): string {
    return `curl -X POST ${this.origem}/cerebro/api/v1/captures \\\n  -H "X-Api-Key: ${this.v('api:' + nome)}" -H "Content-Type: application/json" \\\n  -d '{"content": "Ideia: …", "tags": ["ideia"]}'`;
  }

  webhook(nome: string): string {
    return `${this.origem}/cerebro/api/v1/webhooks/${nome}   (header X-Api-Key: ${this.v('api:' + nome)})`;
  }

  bookmarklet(nome: string): string {
    const hub = `${this.origem}/cerebro`;
    return `javascript:(()=>{const q=new URLSearchParams({key:'${this.v('api:' + nome)}',url:location.href,title:document.title,text:String(getSelection()||'')});window.open('${hub}/api/v1/quick?'+q,'cerebro','width=420,height=220');})();`;
  }

  rotuloOrigem(o: string): string {
    switch (o) {
      case 'tela': return 'gerenciado por esta tela';
      case 'servidor': return 'vem do .env da VPS';
      default: return 'não configurado';
    }
  }
}
