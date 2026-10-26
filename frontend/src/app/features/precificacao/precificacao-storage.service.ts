import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal, WritableSignal } from '@angular/core';
import { uuid } from '../../core/uuid';
import { calcularPrecificacao, somaMinutos, valorHora } from './calc';
import { ConfiguracaoPrecificacao, HistoricoEntrada, Orcamento, ProdutoFicha } from './models';

const CONFIG_KEY = 'precificacao.config.v1';
const PRODUTOS_KEY = 'precificacao.produtos.v1';
const HISTORICO_KEY = 'precificacao.historico.v1';
const ORCAMENTOS_KEY = 'precificacao.orcamentos.v1';
/** Marca que o que estava neste navegador já foi levado para o painel (não leva duas vezes). */
const MIGRADO_KEY = 'precificacao.migrado-para-o-painel.v1';
const HISTORICO_MAXIMO = 300;
const API = '/api/precificacao';

function configuracaoPadrao(): ConfiguracaoPrecificacao {
  return {
    hh: { valorHoraDesejado: 1500, horasPorDia: 6, diasPorMes: 22 },
    margemPadrao: 30,
    perdaPadrao: 5,
    descontoMaximoPadrao: 10,
    taxaUrgenciaPercentual: 20,
    taxas: [
      { id: uuid(), nome: 'Taxa da maquininha', percentual: 2 },
      { id: uuid(), nome: 'Taxa do marketplace', percentual: 5 },
    ],
    impostosPercentual: 4,
    custosFixos: [],
    producaoMensalEstimada: 100,
    equipamentos: [],
    energia: { valorConta: 150, percentualProducao: 30, horasProdutivasMes: 132, usarCustoDireto: false, custoDiretoPorProduto: 0 },
    faixasQuantidade: [
      { id: uuid(), quantidade: 1, descontoPercentual: 0 },
      { id: uuid(), quantidade: 10, descontoPercentual: 5 },
      { id: uuid(), quantidade: 20, descontoPercentual: 8 },
      { id: uuid(), quantidade: 50, descontoPercentual: 12 },
      { id: uuid(), quantidade: 100, descontoPercentual: 15 },
    ],
  };
}

function lerJson<T>(chave: string, padrao: T): T {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return padrao;
    return { ...padrao, ...JSON.parse(bruto) } as T;
  } catch {
    return padrao;
  }
}

function lerLista<T>(chave: string): T[] {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? (JSON.parse(bruto) as T[]) : [];
  } catch {
    return [];
  }
}

/** Como o painel devolve cada coisa: a ficha da tela fica em "dados". */
interface FichaDoServidor { id: number; nome: string; categoria: string; produtoId: number | null; dados: ProdutoFicha }
interface HistoricoDoServidor { id: number; em: string; dados: Omit<HistoricoEntrada, 'id' | 'dataISO'> }
interface OrcamentoDoServidor { id: number; numero: number; dados: Orcamento }

/**
 * Onde a calculadora guarda as coisas. Com a ligação ao painel da Viih Mimos
 * configurada no servidor (ViihMimos__*), tudo fica no banco do painel — o
 * mesmo que o painel e o app usam, então uma ficha salva aqui aparece lá e
 * vice-versa. Sem a ligação (ou na versão desktop), fica neste navegador.
 */
@Injectable({ providedIn: 'root' })
export class PrecificacaoStorageService {
  private http = inject(HttpClient);

  readonly config = signal<ConfiguracaoPrecificacao>(lerJson(CONFIG_KEY, configuracaoPadrao()));
  readonly produtos = signal<ProdutoFicha[]>(lerLista<ProdutoFicha>(PRODUTOS_KEY));
  readonly historico = signal<HistoricoEntrada[]>(lerLista<HistoricoEntrada>(HISTORICO_KEY));
  readonly orcamentos = signal<Orcamento[]>(lerLista<Orcamento>(ORCAMENTOS_KEY));
  /** true = lendo e gravando no painel da Viih Mimos. */
  readonly noPainel = signal(false);
  readonly erro = signal<string | null>(null);

  private idDaFicha = new Map<string, number>();
  private idDoHistorico = new Map<string, number>();
  private idDoOrcamento = new Map<string, number>();

  constructor() {
    this.http.get<{ ligado: boolean }>(`${API}/estado`).subscribe({
      next: (e) => { if (e.ligado) this.ligarNoPainel(); },
      error: () => { /* sem servidor (desktop) ou sem login: segue no navegador */ },
    });
  }

  private ligarNoPainel(): void {
    this.noPainel.set(true);
    const local = { config: this.config(), produtos: this.produtos(), historico: this.historico(), orcamentos: this.orcamentos() };
    const temLocal = local.produtos.length + local.historico.length + local.orcamentos.length > 0;
    if (!temLocal || localStorage.getItem(MIGRADO_KEY)) { this.carregarDoPainel(); return; }
    // Primeira vez ligado: se o painel ainda está vazio, leva o que estava neste
    // navegador para lá (com a configuração daqui). Se o painel já tem fichas, o
    // arquivo foi importado antes: não duplica. O navegador fica como cópia.
    this.http.get<FichaDoServidor[]>(`${API}/fichas`).subscribe({
      next: (noPainel) => {
        if (noPainel.length > 0) { localStorage.setItem(MIGRADO_KEY, 'ja-tinha'); this.carregarDoPainel(); return; }
        this.http.post(`${API}/importar`, local).subscribe({
          next: () => { localStorage.setItem(MIGRADO_KEY, new Date().toISOString()); this.carregarDoPainel(); },
          error: () => { this.falhou('levar as fichas deste navegador'); this.carregarDoPainel(); },
        });
      },
      error: () => this.falhou('carregar as fichas'),
    });
  }

  private carregarDoPainel(): void {
    this.http.get<ConfiguracaoPrecificacao | null>(`${API}/config`).subscribe({
      next: (c) => { if (c) this.config.set({ ...configuracaoPadrao(), ...c }); },
      error: () => this.falhou('carregar a configuração'),
    });
    this.http.get<FichaDoServidor[]>(`${API}/fichas`).subscribe({
      next: (lista) => {
        this.idDaFicha.clear();
        this.produtos.set(lista.map((f) => {
          const ficha = { ...f.dados, id: f.dados?.id || `srv-${f.id}`, nome: f.dados?.nome || f.nome, produtoCatalogoId: f.produtoId } as ProdutoFicha;
          this.idDaFicha.set(ficha.id, f.id);
          return ficha;
        }));
      },
      error: () => this.falhou('carregar as fichas'),
    });
    this.http.get<HistoricoDoServidor[]>(`${API}/historico`).subscribe({
      next: (lista) => {
        this.idDoHistorico.clear();
        this.historico.set(lista.map((h) => {
          const entrada = { ...h.dados, id: `srv-${h.id}`, dataISO: h.em } as HistoricoEntrada;
          this.idDoHistorico.set(entrada.id, h.id);
          return entrada;
        }));
      },
    });
    this.http.get<OrcamentoDoServidor[]>(`${API}/orcamentos`).subscribe({
      next: (lista) => {
        this.idDoOrcamento.clear();
        this.orcamentos.set(lista.map((o) => {
          const orc = { ...o.dados, id: o.dados?.id || `srv-${o.id}`, numero: o.numero };
          this.idDoOrcamento.set(orc.id, o.id);
          return orc;
        }));
      },
    });
  }

  private falhou(oque: string) {
    this.erro.set(`Não consegui ${oque} no painel da Viih Mimos. Confira a conexão e recarregue a página.`);
  }

  private persistir<T>(chave: string, sinal: WritableSignal<T[]>, lista: T[]): void {
    sinal.set(lista);
    if (!this.noPainel()) localStorage.setItem(chave, JSON.stringify(lista));
  }

  salvarConfig(config: ConfiguracaoPrecificacao): void {
    this.config.set(config);
    if (!this.noPainel()) { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); return; }
    this.http.put(`${API}/config`, config).subscribe({ error: () => this.falhou('salvar a configuração') });
  }

  /** O preço que vai para o catálogo do site e os kits: a mesma conta que o painel faz. */
  private precoDa(p: ProdutoFicha): { custoTotal: number; precoSugerido: number | null } {
    const cfg = this.config();
    const energia = p.usarEnergiaDireta ? { ...cfg.energia, usarCustoDireto: true, custoDiretoPorProduto: p.energiaDireta } : cfg.energia;
    const r = calcularPrecificacao({
      materiais: p.materiais, insumos: p.insumos, embalagens: p.embalagens, outrosCustos: p.outrosCustos,
      minutosHH: somaMinutos(p.atividadesHH), valorHoraCalculado: valorHora(cfg.hh),
      usosMaquina: p.usosMaquina, equipamentos: cfg.equipamentos, energia,
      custosFixosMensais: cfg.custosFixos.reduce((s, c) => s + c.valorMensal, 0), producaoMensalEstimada: cfg.producaoMensalEstimada,
      percentualPerda: p.percentualPerda, taxas: p.taxas, impostosPercentual: p.impostosPercentual,
      margemDesejada: p.margemDesejada, descontoMaximo: p.descontoMaximo, personalizacoes: [], urgente: false,
      taxaUrgenciaPercentual: cfg.taxaUrgenciaPercentual, quantidadeVendida: 1,
    });
    return { custoTotal: r.composicao.custoTotal, precoSugerido: r.precoAnunciadoComDesconto ?? r.precoSugerido };
  }

  salvarProduto(produto: ProdutoFicha): void {
    const lista = this.produtos();
    const idx = lista.findIndex((p) => p.id === produto.id);
    const atualizado = { ...produto, atualizadoEm: new Date().toISOString() };
    const nova = idx >= 0 ? lista.map((p, i) => (i === idx ? atualizado : p)) : [...lista, atualizado];
    this.persistir(PRODUTOS_KEY, this.produtos, nova);
    if (!this.noPainel()) return;

    const corpo = {
      nome: atualizado.nome || '(sem nome)',
      categoria: atualizado.categoria === 'Outro' ? atualizado.categoriaPersonalizada || 'Outro' : atualizado.categoria,
      produtoId: atualizado.produtoCatalogoId ?? null,
      dados: atualizado,
      ...this.precoDa(atualizado),
    };
    const idNoBanco = this.idDaFicha.get(atualizado.id);
    const pedido = idNoBanco
      ? this.http.put<FichaDoServidor>(`${API}/fichas/${idNoBanco}`, corpo)
      : this.http.post<FichaDoServidor>(`${API}/fichas`, corpo);
    pedido.subscribe({
      next: (f) => this.idDaFicha.set(atualizado.id, f.id),
      error: (e) => this.erro.set(e?.error?.erro ?? 'Não consegui salvar a ficha no painel da Viih Mimos.'),
    });
  }

  removerProduto(id: string): void {
    this.persistir(PRODUTOS_KEY, this.produtos, this.produtos().filter((p) => p.id !== id));
    const idNoBanco = this.idDaFicha.get(id);
    if (this.noPainel() && idNoBanco) this.http.delete(`${API}/fichas/${idNoBanco}`).subscribe({ error: () => this.falhou('apagar a ficha') });
    this.idDaFicha.delete(id);
  }

  /** Registra um retrato congelado do cálculo atual — não é afetado por mudanças futuras nas configurações. */
  registrarHistorico(entrada: Omit<HistoricoEntrada, 'id' | 'dataISO'>): HistoricoEntrada {
    const nova: HistoricoEntrada = { ...entrada, id: uuid(), dataISO: new Date().toISOString() };
    this.persistir(HISTORICO_KEY, this.historico, [nova, ...this.historico()].slice(0, HISTORICO_MAXIMO));
    if (this.noPainel()) {
      this.http.post<HistoricoDoServidor>(`${API}/historico`, entrada).subscribe({
        next: (h) => this.idDoHistorico.set(nova.id, h.id),
        error: () => this.falhou('guardar o histórico'),
      });
    }
    return nova;
  }

  removerHistorico(id: string): void {
    this.persistir(HISTORICO_KEY, this.historico, this.historico().filter((h) => h.id !== id));
    const idNoBanco = this.idDoHistorico.get(id);
    if (this.noPainel() && idNoBanco) this.http.delete(`${API}/historico/${idNoBanco}`).subscribe();
  }

  limparHistorico(): void {
    if (this.noPainel()) for (const h of this.historico()) this.removerHistorico(h.id);
    else this.persistir(HISTORICO_KEY, this.historico, []);
  }

  proximoNumeroOrcamento(): number {
    return this.orcamentos().reduce((maior, o) => Math.max(maior, o.numero), 0) + 1;
  }

  salvarOrcamento(orcamento: Orcamento): void {
    const lista = this.orcamentos();
    const idx = lista.findIndex((o) => o.id === orcamento.id);
    this.persistir(ORCAMENTOS_KEY, this.orcamentos, idx >= 0 ? lista.map((o, i) => (i === idx ? orcamento : o)) : [...lista, orcamento]);
    if (!this.noPainel()) return;
    const idNoBanco = this.idDoOrcamento.get(orcamento.id);
    const pedido = idNoBanco
      ? this.http.put<OrcamentoDoServidor>(`${API}/orcamentos/${idNoBanco}`, { numero: orcamento.numero, dados: orcamento })
      : this.http.post<OrcamentoDoServidor>(`${API}/orcamentos`, { numero: orcamento.numero, dados: orcamento });
    pedido.subscribe({
      next: (o) => this.idDoOrcamento.set(orcamento.id, o.id),
      error: () => this.falhou('salvar o orçamento'),
    });
  }

  removerOrcamento(id: string): void {
    this.persistir(ORCAMENTOS_KEY, this.orcamentos, this.orcamentos().filter((o) => o.id !== id));
    const idNoBanco = this.idDoOrcamento.get(id);
    if (this.noPainel() && idNoBanco) this.http.delete(`${API}/orcamentos/${idNoBanco}`).subscribe();
    this.idDoOrcamento.delete(id);
  }

  /**
   * Tudo o que está na tela, num arquivo: serve de cópia de segurança e é o que
   * o painel da Viih Mimos importa em Precificação → "Importar do hub".
   */
  exportar(): void {
    const dados = { config: this.config(), produtos: this.produtos(), historico: this.historico(), orcamentos: this.orcamentos() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `precificacao-viih-mimos-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
