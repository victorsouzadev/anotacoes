import { Component, inject, signal } from '@angular/core';
import { IconComponent } from '../../shared/icon';
import { mensagemDeErro } from '../../core/erro-http';
import { DesktopMcp, DesktopService } from '../../core/desktop';
import { EstudioService } from './estudio.service';
import { EstudioConfig, dolares } from './estudio.models';
import { ESTUDIO_CSS } from './shared/estilos';

/** Chaves do fal.ai e da World Labs, teto de gasto mensal e limite de confirmação do MCP. */
@Component({
  selector: 'app-estudio-config',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="ec">
      <h1 class="e-titulo">Configurações do Estúdio</h1>
      <p class="e-sub">As chaves ficam cifradas no servidor e nunca voltam para a tela.</p>

      @if (cfg(); as c) {
        <section class="e-card ec-bloco">
          <h2>fal.ai <span class="e-tag">imagem, vídeo, áudio e 3D</span></h2>
          <p class="e-muted">Crie a chave em <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener">fal.ai/dashboard/keys</a> e recarregue o saldo em fal.ai/dashboard/billing. Cada geração é cobrada pelo fal na sua conta.</p>
          <p class="ec-estado">
            @if (c.falConfigurada && !c.falDoServidor) { <app-icon name="check" [size]="14" /> Sua chave: {{ c.falMascarada }} }
            @else if (c.falDoServidor) { Usando a chave do servidor. }
            @else { Nenhuma chave cadastrada. }
          </p>
          <div class="ec-linha">
            <input class="e-input" type="password" autocomplete="off" placeholder="Cole a chave do fal.ai" [value]="chaveFal()" (input)="chaveFal.set($any($event.target).value)" />
            <button type="button" class="e-btn e-pri" [disabled]="salvando() || !chaveFal().trim()" (click)="salvar({ chaveFal: chaveFal() })">Salvar</button>
            @if (c.falConfigurada && !c.falDoServidor) { <button type="button" class="e-btn e-perigo" (click)="salvar({ chaveFal: '' })">Remover</button> }
          </div>
        </section>

        <section class="e-card ec-bloco">
          <h2>World Labs <span class="e-tag">mundos Marble</span></h2>
          <p class="e-muted">Opcional: só para gerar mundos 3D com o Marble (platform.worldlabs.ai). Sem ela, o Mundo 3D usa o TripoSplat do fal.</p>
          <p class="ec-estado">
            @if (c.worldLabsConfigurada && !c.worldLabsDoServidor) { <app-icon name="check" [size]="14" /> Sua chave: {{ c.worldLabsMascarada }} }
            @else if (c.worldLabsDoServidor) { Usando a chave do servidor. }
            @else { Nenhuma chave cadastrada. }
          </p>
          <div class="ec-linha">
            <input class="e-input" type="password" autocomplete="off" placeholder="Cole a chave da World Labs" [value]="chaveWl()" (input)="chaveWl.set($any($event.target).value)" />
            <button type="button" class="e-btn e-pri" [disabled]="salvando() || !chaveWl().trim()" (click)="salvar({ chaveWorldLabs: chaveWl() })">Salvar</button>
            @if (c.worldLabsConfigurada && !c.worldLabsDoServidor) { <button type="button" class="e-btn e-perigo" (click)="salvar({ chaveWorldLabs: '' })">Remover</button> }
          </div>
        </section>

        <section class="e-card ec-bloco">
          <h2>Gasto</h2>
          <p>Estimado este mês: <strong>{{ dolar(c.gastoMesCentavos) }}</strong> em {{ c.geracoesNoMes }} gerações.</p>
          <p class="e-muted">A estimativa usa a tabela de preços de cada modelo; o valor exato está no painel do fal.</p>
          <div class="ec-grade">
            <label class="e-campo">
              <span>Teto mensal (US$) — vazio = sem teto</span>
              <input class="e-input" type="number" min="0" step="1" [value]="teto()" (input)="teto.set($any($event.target).value)" />
            </label>
            <label class="e-campo">
              <span>MCP pede confirmação acima de (US$)</span>
              <input class="e-input" type="number" min="0" step="0.5" [value]="confirmar()" (input)="confirmar.set($any($event.target).value)" />
            </label>
          </div>
          <button type="button" class="e-btn e-pri" [disabled]="salvando()" (click)="salvarGasto()">Salvar limites</button>
        </section>

        @if (desktop.enabled) {
          <section class="e-card ec-bloco">
            <h2>Conectar ao Claude <span class="e-tag">MCP neste PC</span></h2>
            @if (mcp(); as m) {
              @if (m.ativo) {
                <p class="e-muted">O Claude Desktop e o Claude Code usam o Estúdio por este endereço enquanto o programa estiver aberto.</p>
                <p class="ec-estado"><app-icon name="check" [size]="14" /> {{ m.url }}</p>
                <span class="ec-rotulo">Claude Code (terminal)</span>
                <pre class="ec-cod">{{ m.claudeCode }}</pre>
                <button type="button" class="e-btn" (click)="copiar(m.claudeCode)">Copiar comando</button>
                <span class="ec-rotulo">Claude Desktop (claude_desktop_config.json, precisa do Node.js)</span>
                <pre class="ec-cod">{{ m.claudeDesktop }}</pre>
                <div class="ec-linha">
                  <button type="button" class="e-btn" (click)="copiar(m.claudeDesktop)">Copiar configuração</button>
                  <button type="button" class="e-btn e-perigo" [disabled]="salvando()" (click)="renovarMcp()">Trocar token</button>
                </div>
              } @else {
                <p class="e-muted">A porta {{ porta(m.url) }} está ocupada por outro programa, então o MCP local não subiu. Feche o que estiver usando-a e reabra o Estúdio.</p>
              }
            } @else {
              <p class="e-muted">Carregando…</p>
            }
          </section>
        }

        <section class="e-card ec-bloco">
          <h2>Servidor</h2>
          <p class="e-muted">ffmpeg (montagem de vídeo, quadros, troca de fundo, miniaturas): {{ c.ffmpegDisponivel ? 'disponível' : 'não instalado' }}.</p>
        </section>
      } @else if (!erro()) {
        <p class="e-vazio">Carregando…</p>
      }
      @if (erro()) { <p class="e-erro">{{ erro() }}</p> }
      @if (ok()) { <p class="ec-ok">{{ ok() }}</p> }
    </div>
  `,
  styles: [ESTUDIO_CSS, `
    .ec { max-width: 720px; margin: 0 auto; padding: 28px 20px 48px; display: flex; flex-direction: column; gap: 14px; }
    .ec-bloco { padding: 18px; display: flex; flex-direction: column; gap: 10px; }
    .ec-bloco h2 { font-size: 15px; margin: 0; display: flex; align-items: center; gap: 8px; }
    .ec-bloco p { margin: 0; font-size: 13.5px; }
    .ec-estado { display: flex; align-items: center; gap: 6px; font-weight: 600; }
    .ec-linha { display: flex; gap: 8px; flex-wrap: wrap; }
    .ec-linha .e-input { flex: 1 1 260px; }
    .ec-grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .ec-ok { color: var(--positivo); font-size: 13px; }
    .ec-rotulo { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .ec-cod { margin: 0; padding: 10px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); font-size: 12px; white-space: pre-wrap; word-break: break-all; }
    a { color: var(--accent); }
  `],
})
export class EstudioConfigPageComponent {
  private readonly api = inject(EstudioService);
  readonly desktop = inject(DesktopService);
  readonly mcp = signal<DesktopMcp | null>(null);
  readonly cfg = signal<EstudioConfig | null>(null);
  readonly chaveFal = signal('');
  readonly chaveWl = signal('');
  readonly teto = signal('');
  readonly confirmar = signal('1');
  readonly salvando = signal(false);
  readonly erro = signal('');
  readonly ok = signal('');
  readonly dolar = dolares;

  constructor() {
    void this.api.config().then((c) => this.aplicar(c), (e) => this.erro.set(mensagemDeErro(e, 'Não consegui abrir as configurações')));
    if (this.desktop.enabled) void this.desktop.mcp().then((m) => this.mcp.set(m), () => undefined);
  }

  porta(url: string): string {
    return new URL(url).port;
  }

  async copiar(texto: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      this.ok.set('Copiado.');
    } catch {
      this.erro.set('Não consegui copiar; selecione o texto e copie à mão.');
    }
  }

  async renovarMcp(): Promise<void> {
    if (!confirm('Trocar o token? O Claude para de acessar o Estúdio até você colar a configuração nova.')) return;
    this.salvando.set(true);
    try {
      this.mcp.set(await this.desktop.renewMcp());
      this.ok.set('Token trocado. Atualize a configuração no Claude.');
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui trocar o token'));
    } finally {
      this.salvando.set(false);
    }
  }

  async salvar(body: { chaveFal?: string; chaveWorldLabs?: string }): Promise<void> {
    await this.enviar(body, 'Chave salva.');
    this.chaveFal.set('');
    this.chaveWl.set('');
  }

  async salvarGasto(): Promise<void> {
    const teto = this.teto().toString().trim();
    await this.enviar({
      ...(teto === '' ? { semLimite: true } : { limiteMensalCentavos: Math.round(Number(teto) * 100) }),
      confirmarAcimaCentavos: Math.round(Number(this.confirmar() || 0) * 100),
    }, 'Limites salvos.');
  }

  private async enviar(body: Parameters<EstudioService['salvarConfig']>[0], msg: string): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    this.ok.set('');
    try {
      this.aplicar(await this.api.salvarConfig(body));
      this.ok.set(msg);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui salvar'));
    } finally {
      this.salvando.set(false);
    }
  }

  private aplicar(c: EstudioConfig): void {
    this.cfg.set(c);
    this.teto.set(c.limiteMensalCentavos == null ? '' : String(c.limiteMensalCentavos / 100));
    this.confirmar.set(String(c.confirmarAcimaCentavos / 100));
  }
}
