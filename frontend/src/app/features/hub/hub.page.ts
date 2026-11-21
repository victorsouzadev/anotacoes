import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { WindowsDownloadService } from '../../core/windows-download';
import { PublicarService } from '../publicar/publicar.service';
import { CerebroService } from '../cerebro/cerebro.service';
import { AnotacaoService } from '../anotacao/anotacao.service';
import { SistemaService, alertaBackup } from '../../core/sistema.service';
import { PluginsService, ItemDoHub, mesclarCards } from '../../core/plugins.service';

/** Ícones que um plug-in pode pedir no manifesto; outro nome cai no ícone do card antigo ou em "grid". */
const ICONES_DE_PLUGIN: readonly IconName[] = ['pen', 'wallet', 'checklist', 'apple', 'run', 'image', 'box', 'cake',
  'calculator', 'globe', 'sticky', 'edit', 'grid', 'book', 'tag', 'share'];

interface ToolCard {
  path: string;
  icon: IconName;
  title: string;
  description: string;
  downloadUrl?: string;
  downloadFileName?: string;
  downloadLabel?: string;
  /** Mostra o link do instalador do Windows, quando houver um publicado. */
  windows?: boolean;
  /** Plug-in (spec 029): página fora do Angular, aberta por link comum. */
  externo?: boolean;
  /** Ferramenta do plug-in criativo (spec 034): fica indisponível junto com ele. */
  criativo?: boolean;
  indisponivel?: boolean;
}

/** Só aparece para quem está em PUBLICADORES no servidor. */
const PUBLICAR: ToolCard = {
  path: '/publicar',
  icon: 'globe',
  title: 'Publicar',
  description: 'Envie um ZIP com front e API C# e ganhe uma URL própria, com banco SQLite, versões e volta para a anterior.',
};

/** Só aparece para quem está em CEREBRO_USUARIOS, com o serviço no ar e o hub aberto por HTTPS. */
const CEREBRO: ToolCard = {
  path: '/cerebro',
  icon: 'sticky',
  title: 'Segundo Cérebro',
  description: 'Vault do Obsidian na VPS: capture ideias e links, revise a Inbox classificada pelo Claude e busque nas notas.',
};

/** Plug-in hub-anotacao (spec 035): o card só aparece para quem está em Anotacao__Usuarios, que o /api/anotacao/estado do plug-in responde. */
const ANOTACAO: ToolCard = {
  path: '/anotacao',
  icon: 'edit',
  title: 'Anotação',
  description: 'Aprove ou corrija as marcações de dados pessoais que o Claude fez nos relatos.',
};

const TOOLS: ToolCard[] = [
  { path: '/notas', icon: 'pen', title: 'Notas', description: 'Notas manuscritas, texto, desenho e checklists num canvas por página.' },
  { path: '/financas', icon: 'wallet', title: 'Finanças', description: 'Lançamentos financeiros a partir de texto livre, com dashboard de receitas e despesas.' },
  {
    path: '/tarefas',
    icon: 'checklist',
    title: 'Tarefas',
    description: 'Tarefas com subtarefas, categorias, prioridade, recorrência, pomodoro e estatísticas — sincronizadas com o app Android.',
    downloadUrl: '/downloads/organizador.apk',
    downloadFileName: 'organizador.apk',
    downloadLabel: 'Baixar app Android (.apk)',
  },
  {
    path: '/dieta',
    icon: 'apple',
    title: 'Dieta',
    description: 'Diário alimentar com a tabela TACO, metas de calorias e macros, água, peso, plano alimentar e progresso — com o app Android.',
    downloadUrl: '/downloads/android/Dieta.apk',
    downloadFileName: 'Dieta.apk',
    downloadLabel: 'Baixar app Android (.apk)',
  },
  // Spec 034: Treino é o plug-in treino (o card dele toma este lugar quando está registrado).
  {
    path: '/treino',
    icon: 'run',
    title: 'Treino',
    description: 'Treinos de corrida enviados pelo app Treino Corrida: andamento do programa, totais, km por semana e ritmo.',
    externo: true,
  },
  {
    path: '/imagens',
    icon: 'image',
    title: 'Editor de Imagens',
    description: 'Print & cut pra ScanNCut (contorno, remoção de fundo, folha A4/A3) e moldes SVG: encaixe fotos nos buracos do molde, em camadas com ordem e transparência.',
    windows: true,
    externo: true,
    criativo: true,
  },
  {
    path: '/moldes',
    icon: 'box',
    title: 'Moldes',
    description: 'Gerador de moldes para Silhouette: caixa milk, bombom, sacolinha, pirâmide, cone, topo de bolo e topper com foto — por medidas, com corte e vinco.',
    externo: true,
    criativo: true,
  },
  {
    path: '/bolo-3d',
    icon: 'cake',
    title: 'Simulador de Bolo 3D',
    description: 'Monte um bolo em 3D: camadas, sabores, cobertura, granulado, cerejas e velas para acender.',
    externo: true,
    criativo: true,
  },
  {
    path: '/precificacao',
    icon: 'calculator',
    title: 'Precificação',
    description: 'Calculadora de precificação para papelaria personalizada: materiais, HH, HM, custos fixos, margem e preço sugerido.',
    externo: true,
    criativo: true,
  },
];

@Component({
  selector: 'app-hub-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="page">
      <!-- A mesma barra dos plug-ins (spec 032, T010); tema e sair passam pelo ThemeService e pelo AuthService. -->
      <grafite-barra atual="hub" (grafite-tema)="trocarTema($event)" (grafite-sair)="sair($event)"></grafite-barra>

      <main class="content">
        @if (alerta(); as a) {
          <a class="alerta" routerLink="/configuracoes" fragment="servidor">
            <app-icon name="alert" [size]="16" /> {{ a }}
          </a>
        }
        <div class="grid">
          @for (tool of tools(); track tool.path) {
            <div class="tool-card-wrapper">
              @if (tool.externo) {
                <a class="tool-card" [href]="tool.path" [class.indisponivel]="tool.indisponivel">
                  <span class="tool-icon"><app-icon [name]="tool.icon" [size]="22" /></span>
                  <span class="tool-title">{{ tool.title }}</span>
                  <span class="tool-description">{{ tool.indisponivel ? 'Indisponível agora. ' : '' }}{{ tool.description }}</span>
                </a>
              } @else {
                <a class="tool-card" [routerLink]="tool.path">
                  <span class="tool-icon"><app-icon [name]="tool.icon" [size]="22" /></span>
                  <span class="tool-title">{{ tool.title }}</span>
                  <span class="tool-description">{{ tool.description }}</span>
                </a>
              }
              @if (tool.downloadUrl) {
                <a class="tool-download" [href]="tool.downloadUrl" [attr.download]="tool.downloadFileName">
                  <app-icon name="download" [size]="13" /> {{ tool.downloadLabel }}
                </a>
              }
              @if (tool.windows && windows.release(); as w) {
                <a class="tool-download" [href]="w.url" download title="Funciona sem internet, com a IA na placa de vídeo">
                  <app-icon name="download" [size]="13" /> Baixar para Windows ({{ w.tamanho }})
                </a>
              }
            </div>
          }
        </div>
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }

    .content { max-width: 900px; margin: 0 auto; padding: 48px 28px; }
    .alerta {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 20px; padding: 10px 14px;
      border: 1px solid var(--atencao); border-radius: var(--radius-sm);
      color: var(--atencao); background: var(--surface);
      font-size: 13px; font-weight: 600; text-decoration: none;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px; align-items: start; }
    .tool-card-wrapper { display: flex; flex-direction: column; gap: 8px; }
    .tool-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
      text-decoration: none;
      color: inherit;
      box-shadow: var(--shadow-sm);
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
    }
    .tool-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: var(--accent); }
    .tool-card.indisponivel { opacity: .6; }
    .tool-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; border-radius: var(--radius);
      background: var(--accent-soft); color: var(--accent-dark);
    }
    .tool-title { font-size: 16px; font-weight: 700; }
    .tool-description { font-size: 13px; color: var(--text-muted); line-height: 1.4; }
    .tool-download {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
    }
    .tool-download:hover { border-color: var(--accent); color: var(--accent); }

    @media (max-width: 760px) {
      .content { padding: 28px 16px; }
    }
  `],
})
export class HubPageComponent {
  private readonly podePublicar = signal(false);
  private readonly temCerebro = signal(false);
  private readonly temAnotacao = signal(false);
  /** Faixa de backup atrasado (spec 025), só para quem opera o servidor. */
  readonly alerta = signal<string | null>(null);
  private readonly plugins = signal<ItemDoHub[]>([]);
  readonly tools = computed(() => {
    // O plug-in criativo não ganha card próprio: as quatro ferramentas dele já estão nos cards fixos.
    const criativo = this.plugins().find((p) => p.id === 'criativo');
    const fixos = TOOLS.map((t) => (t.criativo && criativo && criativo.estado !== 'no-ar' ? { ...t, indisponivel: true } : t));
    return mesclarCards([
      ...(this.temAnotacao() ? [ANOTACAO] : []),
      ...fixos,
      ...(this.temCerebro() ? [CEREBRO] : []),
      ...(this.podePublicar() ? [PUBLICAR] : []),
    ], this.plugins().filter((p) => p.id !== 'criativo' && (p.id !== 'anotacao' || this.temAnotacao())), ICONES_DE_PLUGIN) as ToolCard[];
  });

  constructor(
    public auth: AuthService,
    public theme: ThemeService,
    public windows: WindowsDownloadService,
    publicar: PublicarService,
    cerebro: CerebroService,
    anotacao: AnotacaoService,
    sistema: SistemaService,
    plugins: PluginsService,
  ) {
    windows.check();
    void plugins.listar().then((l) => this.plugins.set(l), () => undefined);
    void anotacao.estado().then((e) => this.temAnotacao.set(e.habilitado), () => undefined);
    void publicar.permissao().then((r) => {
      this.podePublicar.set(r.podePublicar);
      if (r.podePublicar) void sistema.backup().then((b) => this.alerta.set(alertaBackup(b)));
    });
    void cerebro.disponivel().then((ok) => this.temCerebro.set(ok));
  }

  trocarTema(e: Event): void {
    e.preventDefault();
    const t = (e as CustomEvent<string>).detail;
    if (t === 'system' || t === 'light' || t === 'dark') this.theme.set(t);
  }

  sair(e: Event): void {
    e.preventDefault();
    this.auth.logout();
  }
}
