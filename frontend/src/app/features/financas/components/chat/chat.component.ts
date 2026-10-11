import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../../../core/erro-http';
import { markdownSimples } from './markdown-simples';

interface Mensagem {
  papel: 'usuario' | 'assistente';
  texto: string;
  consultas?: string[];
  erro?: boolean;
}

interface RespostaChat {
  resposta: string;
  consultas: string[];
}

const CHAVE = 'financas.chat.conversa';

const ROTULOS: Record<string, string> = {
  resumo_mes: 'resumo do mês',
  buscar_transacoes: 'lançamentos',
  evolucao_mensal: 'evolução mensal',
  saude_financeira: 'saúde financeira',
  metas: 'metas',
  dividas: 'dívidas',
  gastos_recorrentes: 'gastos recorrentes',
  compromissos_futuros: 'parcelas futuras',
};

// Chat sobre as finanças do usuário. A conversa fica só neste navegador e vai
// inteira a cada pergunta; o backend consulta os dados conforme o modelo pede.
@Component({
  selector: 'app-chat-financeiro',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatFinanceiroComponent {
  private readonly http = inject(HttpClient);
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');

  readonly mensagens = signal<Mensagem[]>(this.carregar());
  readonly pergunta = signal('');
  readonly enviando = signal(false);

  readonly sugestoes = [
    'Quanto gastei este mês e onde gastei mais?',
    'Quanto gastei com iFood nos últimos 3 meses?',
    'Meus gastos estão subindo? Compare os últimos 6 meses.',
    'Quais assinaturas e contas fixas eu tenho?',
    'Quantos meses minha reserva de emergência cobre?',
    'Onde posso cortar para guardar R$ 500 por mês?',
  ];

  constructor() {
    afterNextRender(() => this.rolar());
  }

  html(texto: string): string {
    return markdownSimples(texto);
  }

  rotulos(consultas: string[]): string {
    return [...new Set(consultas.map((c) => ROTULOS[c] ?? c))].join(', ');
  }

  enviar(texto = this.pergunta()): void {
    texto = texto.trim();
    if (!texto || this.enviando()) return;
    const historico = [...this.mensagens().filter((m) => !m.erro), { papel: 'usuario' as const, texto }];
    this.mensagens.set(historico);
    this.pergunta.set('');
    this.enviando.set(true);
    this.salvar();
    this.rolar();

    this.http
      .post<RespostaChat>('/api/financas/chat', {
        mensagens: historico.map(({ papel, texto }) => ({ papel, texto })),
      })
      .subscribe({
        next: (r) => {
          this.mensagens.update((m) => [...m, { papel: 'assistente', texto: r.resposta, consultas: r.consultas }]);
          this.concluir();
        },
        error: (err) => {
          this.mensagens.update((m) => [...m, { papel: 'assistente', texto: mensagemDeErro(err, 'Não foi possível responder'), erro: true }]);
          this.concluir();
        },
      });
  }

  teclado(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.enviar();
    }
  }

  limpar(): void {
    this.mensagens.set([]);
    this.salvar();
  }

  private concluir(): void {
    this.enviando.set(false);
    this.salvar();
    this.rolar();
  }

  private rolar(): void {
    setTimeout(() => {
      const el = this.lista()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private carregar(): Mensagem[] {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? '[]');
      return Array.isArray(salvo) ? salvo : [];
    } catch {
      return [];
    }
  }

  private salvar(): void {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(this.mensagens().slice(-40)));
    } catch {
      /* armazenamento indisponível: a conversa só não sobrevive ao recarregar */
    }
  }
}
