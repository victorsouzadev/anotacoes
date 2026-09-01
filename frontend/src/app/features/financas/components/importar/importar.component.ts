import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../shared/icon';
import { Capacidades } from '../../models/importacao.model';
import { Transacao } from '../../models/transacao.model';
import { TransacaoService } from '../../services/transacao.service';

@Component({
  selector: 'app-importar',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, CurrencyPipe, DatePipe],
  templateUrl: './importar.component.html',
  styleUrl: './importar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportarComponent {
  /** Competência que a página está exibindo, para detectar importação de outro mês. */
  readonly ano = input.required<number>();
  readonly mes = input.required<number>();

  readonly importado = output<void>();
  readonly irParaMes = output<{ ano: number; mes: number }>();

  private readonly service = inject(TransacaoService);

  readonly capacidades = signal<Capacidades | null>(null);
  readonly arquivos = signal<File[]>([]);
  readonly enviando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly arrastando = signal(false);

  readonly criadas = signal<Transacao[]>([]);
  readonly descartes = signal<string[]>([]);
  readonly atingiuLimite = signal(false);

  observacao = '';

  /**
   * Mês em que caiu a maior parte do que foi importado.
   *
   * Um extrato quase sempre é do mês passado, e a lista da página mostra só o
   * mês corrente: sem este aviso o usuário vê "4 lançamentos importados" logo
   * acima de uma lista vazia e conclui que nada foi salvo.
   */
  readonly mesDosImportados = computed(() => {
    const criadas = this.criadas();
    if (criadas.length === 0) return null;

    const contagem = new Map<string, { ano: number; mes: number; total: number }>();
    for (const t of criadas) {
      const [ano, mes] = t.data.split('-').map(Number);
      const chave = `${ano}-${mes}`;
      const atual = contagem.get(chave) ?? { ano, mes, total: 0 };
      atual.total++;
      contagem.set(chave, atual);
    }

    return [...contagem.values()].sort((a, b) => b.total - a.total)[0];
  });

  readonly emOutroMes = computed(() => {
    const alvo = this.mesDosImportados();
    return alvo !== null && (alvo.ano !== this.ano() || alvo.mes !== this.mes());
  });

  readonly nomeDoMesImportado = computed(() => {
    const alvo = this.mesDosImportados();
    if (!alvo) return '';
    return new Date(alvo.ano, alvo.mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  });

  abrirMesImportado(): void {
    const alvo = this.mesDosImportados();
    if (alvo) this.irParaMes.emit({ ano: alvo.ano, mes: alvo.mes });
  }

  constructor() {
    this.service.capacidades().subscribe({
      next: (c) => this.capacidades.set(c),
      error: () => this.capacidades.set(null),
    });
  }

  /** Monta o `accept` do seletor a partir do que o servidor aceita. */
  get accept(): string {
    return (this.capacidades()?.extensoesAceitas ?? []).join(',');
  }

  aoEscolher(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    this.adicionar(Array.from(input.files ?? []));
    // Limpa o input para que escolher o mesmo arquivo de novo dispare o evento.
    input.value = '';
  }

  aoSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastando.set(false);
    this.adicionar(Array.from(evento.dataTransfer?.files ?? []));
  }

  aoArrastarSobre(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastando.set(true);
  }

  aoSairDoArrasto(): void {
    this.arrastando.set(false);
  }

  private adicionar(novos: File[]): void {
    if (novos.length === 0) return;

    const capacidades = this.capacidades();
    const max = capacidades?.maxArquivos ?? 5;
    const maxBytes = (capacidades?.maxTamanhoArquivoMb ?? 10) * 1024 * 1024;

    // Validar antes de subir evita uma ida ao servidor para receber o mesmo "não".
    const grande = novos.find((a) => a.size > maxBytes);
    if (grande) {
      this.erro.set(`"${grande.name}" passa de ${capacidades?.maxTamanhoArquivoMb ?? 10} MB.`);
      return;
    }

    const total = [...this.arquivos(), ...novos];
    if (total.length > max) {
      this.erro.set(`Envie no máximo ${max} arquivos por vez.`);
      return;
    }

    this.erro.set(null);
    this.arquivos.set(total);
  }

  remover(indice: number): void {
    this.arquivos.update((atual) => atual.filter((_, i) => i !== indice));
  }

  limpar(): void {
    this.arquivos.set([]);
    this.criadas.set([]);
    this.descartes.set([]);
    this.atingiuLimite.set(false);
    this.erro.set(null);
    this.observacao = '';
  }

  tamanho(arquivo: File): string {
    const mb = arquivo.size / 1024 / 1024;
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(Math.round(arquivo.size / 1024), 1)} KB`;
  }

  enviar(): void {
    if (this.arquivos().length === 0 || this.enviando()) return;

    this.enviando.set(true);
    this.erro.set(null);
    this.criadas.set([]);
    this.descartes.set([]);

    this.service.importar(this.arquivos(), this.observacao).subscribe({
      next: (r) => {
        this.enviando.set(false);
        this.arquivos.set([]);
        this.observacao = '';
        this.criadas.set(r.transacoes);
        this.descartes.set(r.descartes);
        this.atingiuLimite.set(r.atingiuLimite);
        this.importado.emit();
      },
      error: (err) => {
        this.enviando.set(false);
        this.erro.set(this.mensagemDeErro(err));
      },
    });
  }

  private mensagemDeErro(err: { status?: number; error?: { erro?: string; detail?: string } }): string {
    // 502 é falha ou ausência de configuração do serviço, não culpa do arquivo.
    if (err?.status === 502 || err?.status === 503) {
      return err?.error?.detail ?? 'O serviço de leitura de documentos está indisponível no momento.';
    }
    if (err?.status === 429) {
      return 'Muitas importações seguidas. Aguarde alguns minutos antes de tentar de novo.';
    }
    if (err?.status === 413) {
      return 'O arquivo é grande demais para o servidor.';
    }
    return (
      err?.error?.erro ??
      err?.error?.detail ??
      'Não consegui ler esse arquivo. Tente uma foto mais nítida ou outro formato.'
    );
  }
}
