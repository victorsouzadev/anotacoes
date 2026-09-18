import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { uuid } from '../../core/uuid';
import { IconComponent } from '../../shared/icon';
import {
  calcularPrecificacao,
  custoItem,
  simularMargens,
  simularQuantidades,
  somaMinutos,
  somaValorAtivo,
  valorHora,
  validaComposicaoPercentual,
} from './calc';
import { itemCustoVazio, produtoExemplo, produtoVazio, valorNomeadoVazio } from './factory';
import {
  AtividadeHH,
  CATEGORIAS_PADRAO,
  CustoFixo,
  Equipamento,
  FaixaQuantidade,
  ItemCusto,
  PersonalizacaoItem,
  ProdutoFicha,
  TaxaItem,
  UsoMaquina,
  ValorNomeado,
} from './models';
import { PrecificacaoStorageService } from './precificacao-storage.service';

type ListaId = 'materiais' | 'insumos' | 'embalagens' | 'outrosCustos' | 'atividadesHH' | 'usosMaquina' | 'personalizacoes' | 'taxas' | 'faixasQuantidade';

@Component({
  selector: 'app-precificacao-page',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, CurrencyPipe, DecimalPipe],
  templateUrl: './precificacao.page.html',
  styleUrl: './precificacao.page.css',
})
export class PrecificacaoPageComponent {
  readonly categorias = CATEGORIAS_PADRAO;
  readonly custoItem = custoItem;

  private storage = inject(PrecificacaoStorageService);
  auth = inject(AuthService);
  theme = inject(ThemeService);

  mostrarConfiguracoes = signal(false);
  mostrarComposicao = signal(false);

  config = this.storage.config;
  produtos = this.storage.produtos;
  produto = signal<ProdutoFicha>(produtoVazio(this.storage.config()));

  configRascunho = signal(structuredClone(this.storage.config()));

  // ---------------------------------------------------------------- cálculo

  valorHoraAtual = computed(() => valorHora(this.config().hh));
  minutosHHTotais = computed(() => somaMinutos(this.produto().atividadesHH));
  horasMaquinaTotais = computed(() => this.produto().usosMaquina.reduce((s, u) => s + u.minutos / 60, 0));

  resultado = computed(() => {
    const p = this.produto();
    const cfg = this.config();
    const totalCustosFixos = cfg.custosFixos.reduce((s, c) => s + c.valorMensal, 0);
    const energiaEfetiva = p.usarEnergiaDireta
      ? { ...cfg.energia, usarCustoDireto: true, custoDiretoPorProduto: p.energiaDireta }
      : cfg.energia;
    return calcularPrecificacao({
      materiais: p.materiais,
      insumos: p.insumos,
      embalagens: p.embalagens,
      outrosCustos: p.outrosCustos,
      minutosHH: this.minutosHHTotais(),
      valorHoraCalculado: this.valorHoraAtual(),
      usosMaquina: p.usosMaquina,
      equipamentos: cfg.equipamentos,
      energia: energiaEfetiva,
      custosFixosMensais: totalCustosFixos,
      producaoMensalEstimada: cfg.producaoMensalEstimada,
      percentualPerda: p.percentualPerda,
      taxas: p.taxas,
      impostosPercentual: p.impostosPercentual,
      margemDesejada: p.margemDesejada,
      descontoMaximo: p.descontoMaximo,
      personalizacoes: p.personalizacoes,
      urgente: p.urgente,
      taxaUrgenciaPercentual: cfg.taxaUrgenciaPercentual,
      quantidadeVendida: p.quantidadeVendida,
    });
  });

  composicaoValida = computed(() =>
    validaComposicaoPercentual(this.resultado().taxasPercentualTotal, this.produto().impostosPercentual, this.produto().margemDesejada),
  );

  extraPersonalizacoes = computed(() => somaValorAtivo(this.produto().personalizacoes));

  valorTaxasNoPreco = computed(() => {
    const r = this.resultado();
    return r.precoSugerido !== null ? (r.precoSugerido * r.taxasPercentualTotal) / 100 : 0;
  });

  valorImpostosNoPreco = computed(() => {
    const r = this.resultado();
    return r.precoSugerido !== null ? (r.precoSugerido * this.produto().impostosPercentual) / 100 : 0;
  });

  simulacaoMargens = computed(() => {
    const r = this.resultado();
    const p = this.produto();
    return simularMargens(r.composicao.custoTotal, r.taxasPercentualTotal, p.impostosPercentual, p.margensSimulacao);
  });

  simulacaoQuantidades = computed(() => {
    const r = this.resultado();
    const p = this.produto();
    return simularQuantidades(r.precoSugerido, r.composicao.custoTotal, p.faixasQuantidade);
  });

  // ------------------------------------------------------------ mutação — produto

  setField<K extends keyof ProdutoFicha>(campo: K, valor: ProdutoFicha[K]): void {
    this.produto.update((p) => ({ ...p, [campo]: valor }));
  }

  setNumField<K extends keyof ProdutoFicha>(campo: K, valor: string | number): void {
    this.setField(campo, (Number(valor) || 0) as ProdutoFicha[K]);
  }

  private atualizarLista<T extends { id: string }>(campo: ListaId, fn: (lista: T[]) => T[]): void {
    this.produto.update((p) => ({ ...p, [campo]: fn(p[campo] as unknown as T[]) }));
  }

  adicionar<T extends { id: string }>(campo: ListaId, item: T): void {
    this.atualizarLista<T>(campo, (lista) => [...lista, item]);
  }

  remover(campo: ListaId, id: string): void {
    this.atualizarLista(campo, (lista: { id: string }[]) => lista.filter((i) => i.id !== id));
  }

  atualizarItem<T extends { id: string }>(campo: ListaId, id: string, patch: Partial<T>): void {
    this.atualizarLista<T>(campo, (lista) => lista.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  atualizarItemNum<T extends { id: string }>(campo: ListaId, id: string, chave: keyof T, valor: string | number): void {
    this.atualizarItem<T>(campo, id, { [chave]: Number(valor) || 0 } as Partial<T>);
  }

  adicionarMaterial(): void {
    this.adicionar<ItemCusto>('materiais', itemCustoVazio());
  }
  adicionarInsumo(): void {
    this.adicionar<ItemCusto>('insumos', itemCustoVazio());
  }
  adicionarEmbalagem(): void {
    this.adicionar<ItemCusto>('embalagens', itemCustoVazio());
  }
  adicionarOutroCusto(): void {
    this.adicionar<ValorNomeado>('outrosCustos', valorNomeadoVazio());
  }
  adicionarAtividadeHH(): void {
    this.adicionar<AtividadeHH>('atividadesHH', { id: uuid(), nome: '', minutos: 0 });
  }
  adicionarUsoMaquina(): void {
    const primeiraMaquina = this.config().equipamentos[0]?.id ?? '';
    this.adicionar<UsoMaquina>('usosMaquina', { id: uuid(), equipamentoId: primeiraMaquina, minutos: 0 });
  }
  adicionarTaxa(): void {
    this.adicionar<TaxaItem>('taxas', { id: uuid(), nome: '', percentual: 0 });
  }
  adicionarFaixaQuantidade(): void {
    this.adicionar<FaixaQuantidade>('faixasQuantidade', { id: uuid(), quantidade: 1, descontoPercentual: 0 });
  }
  adicionarPersonalizacao(): void {
    this.adicionar<PersonalizacaoItem>('personalizacoes', { id: uuid(), nome: '', valor: 0, ativo: true });
  }

  // Wrappers tipados (o template não permite passar tipo genérico explícito nas chamadas).
  atualizarMaterial(id: string, patch: Partial<ItemCusto>): void {
    this.atualizarItem<ItemCusto>('materiais', id, patch);
  }
  atualizarMaterialNum(id: string, chave: keyof ItemCusto, valor: string | number): void {
    this.atualizarItemNum<ItemCusto>('materiais', id, chave, valor);
  }
  atualizarInsumo(id: string, patch: Partial<ItemCusto>): void {
    this.atualizarItem<ItemCusto>('insumos', id, patch);
  }
  atualizarInsumoNum(id: string, chave: keyof ItemCusto, valor: string | number): void {
    this.atualizarItemNum<ItemCusto>('insumos', id, chave, valor);
  }
  atualizarEmbalagem(id: string, patch: Partial<ItemCusto>): void {
    this.atualizarItem<ItemCusto>('embalagens', id, patch);
  }
  atualizarEmbalagemNum(id: string, chave: keyof ItemCusto, valor: string | number): void {
    this.atualizarItemNum<ItemCusto>('embalagens', id, chave, valor);
  }
  atualizarOutroCusto(id: string, patch: Partial<ValorNomeado>): void {
    this.atualizarItem<ValorNomeado>('outrosCustos', id, patch);
  }
  atualizarOutroCustoNum(id: string, valor: string | number): void {
    this.atualizarItemNum<ValorNomeado>('outrosCustos', id, 'valor', valor);
  }
  atualizarAtividadeHH(id: string, patch: Partial<AtividadeHH>): void {
    this.atualizarItem<AtividadeHH>('atividadesHH', id, patch);
  }
  atualizarAtividadeHHNum(id: string, valor: string | number): void {
    this.atualizarItemNum<AtividadeHH>('atividadesHH', id, 'minutos', valor);
  }
  atualizarUsoMaquina(id: string, patch: Partial<UsoMaquina>): void {
    this.atualizarItem<UsoMaquina>('usosMaquina', id, patch);
  }
  atualizarUsoMaquinaNum(id: string, valor: string | number): void {
    this.atualizarItemNum<UsoMaquina>('usosMaquina', id, 'minutos', valor);
  }
  atualizarPersonalizacao(id: string, patch: Partial<PersonalizacaoItem>): void {
    this.atualizarItem<PersonalizacaoItem>('personalizacoes', id, patch);
  }
  atualizarPersonalizacaoNum(id: string, valor: string | number): void {
    this.atualizarItemNum<PersonalizacaoItem>('personalizacoes', id, 'valor', valor);
  }
  atualizarTaxaProduto(id: string, patch: Partial<TaxaItem>): void {
    this.atualizarItem<TaxaItem>('taxas', id, patch);
  }
  atualizarTaxaProdutoNum(id: string, valor: string | number): void {
    this.atualizarItemNum<TaxaItem>('taxas', id, 'percentual', valor);
  }
  atualizarFaixaQuantidadeNum(id: string, chave: keyof FaixaQuantidade, valor: string | number): void {
    this.atualizarItemNum<FaixaQuantidade>('faixasQuantidade', id, chave, valor);
  }

  setMargemSimulacao(indice: number, valor: string): void {
    this.produto.update((p) => {
      const margens = [...p.margensSimulacao];
      margens[indice] = Number(valor) || 0;
      return { ...p, margensSimulacao: margens };
    });
  }

  // ------------------------------------------------------------ produtos salvos

  novoProduto(): void {
    this.produto.set(produtoVazio(this.config()));
  }

  carregarExemplo(): void {
    this.produto.set(produtoExemplo(this.config()));
  }

  salvarProduto(): void {
    const p = this.produto();
    if (!p.nome.trim()) return;
    this.storage.salvarProduto(p);
  }

  carregarProduto(id: string): void {
    const encontrado = this.produtos().find((p) => p.id === id);
    if (encontrado) this.produto.set(structuredClone(encontrado));
  }

  excluirProduto(id: string): void {
    this.storage.removerProduto(id);
    if (this.produto().id === id) this.novoProduto();
  }

  // ------------------------------------------------------------ configurações globais

  abrirConfiguracoes(): void {
    this.configRascunho.set(structuredClone(this.config()));
    this.mostrarConfiguracoes.set(true);
  }

  fecharConfiguracoes(salvar: boolean): void {
    if (salvar) this.storage.salvarConfig(this.configRascunho());
    this.mostrarConfiguracoes.set(false);
  }

  setConfigNum(campo: 'margemPadrao' | 'perdaPadrao' | 'descontoMaximoPadrao' | 'taxaUrgenciaPercentual' | 'impostosPercentual' | 'producaoMensalEstimada', valor: string): void {
    this.configRascunho.update((c) => ({ ...c, [campo]: Number(valor) || 0 }));
  }

  setConfigHH(campo: 'valorHoraDesejado' | 'horasPorDia' | 'diasPorMes', valor: string): void {
    this.configRascunho.update((c) => ({ ...c, hh: { ...c.hh, [campo]: Number(valor) || 0 } }));
  }

  setConfigEnergia(campo: 'valorConta' | 'percentualProducao' | 'horasProdutivasMes' | 'custoDiretoPorProduto', valor: string): void {
    this.configRascunho.update((c) => ({ ...c, energia: { ...c.energia, [campo]: Number(valor) || 0 } }));
  }

  setConfigEnergiaDireta(valor: boolean): void {
    this.configRascunho.update((c) => ({ ...c, energia: { ...c.energia, usarCustoDireto: valor } }));
  }

  adicionarEquipamento(): void {
    const novo: Equipamento = { id: uuid(), nome: '', precoAquisicao: 0, valorResidual: 0, vidaUtilHoras: 1, manutencaoHora: 0, consumoWatts: 0 };
    this.configRascunho.update((c) => ({ ...c, equipamentos: [...c.equipamentos, novo] }));
  }

  atualizarEquipamento(id: string, patch: Partial<Equipamento>): void {
    this.configRascunho.update((c) => ({ ...c, equipamentos: c.equipamentos.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }

  atualizarEquipamentoNum(id: string, campo: 'precoAquisicao' | 'valorResidual' | 'vidaUtilHoras' | 'manutencaoHora', valor: string | number): void {
    this.atualizarEquipamento(id, { [campo]: Number(valor) || 0 } as Partial<Equipamento>);
  }

  removerEquipamento(id: string): void {
    this.configRascunho.update((c) => ({ ...c, equipamentos: c.equipamentos.filter((e) => e.id !== id) }));
  }

  adicionarCustoFixo(): void {
    const novo: CustoFixo = { id: uuid(), nome: '', valorMensal: 0 };
    this.configRascunho.update((c) => ({ ...c, custosFixos: [...c.custosFixos, novo] }));
  }

  atualizarCustoFixo(id: string, patch: Partial<CustoFixo>): void {
    this.configRascunho.update((c) => ({ ...c, custosFixos: c.custosFixos.map((cf) => (cf.id === id ? { ...cf, ...patch } : cf)) }));
  }

  atualizarCustoFixoValor(id: string, valor: string | number): void {
    this.atualizarCustoFixo(id, { valorMensal: Number(valor) || 0 });
  }

  removerCustoFixo(id: string): void {
    this.configRascunho.update((c) => ({ ...c, custosFixos: c.custosFixos.filter((cf) => cf.id !== id) }));
  }

  adicionarTaxaPadrao(): void {
    this.configRascunho.update((c) => ({ ...c, taxas: [...c.taxas, { id: uuid(), nome: '', percentual: 0 }] }));
  }

  atualizarTaxaPadrao(id: string, patch: Partial<TaxaItem>): void {
    this.configRascunho.update((c) => ({ ...c, taxas: c.taxas.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }

  atualizarTaxaPadraoPercentual(id: string, valor: string | number): void {
    this.atualizarTaxaPadrao(id, { percentual: Number(valor) || 0 });
  }

  removerTaxaPadrao(id: string): void {
    this.configRascunho.update((c) => ({ ...c, taxas: c.taxas.filter((t) => t.id !== id) }));
  }

  nomeEquipamento(id: string): string {
    return this.config().equipamentos.find((e) => e.id === id)?.nome ?? '(sem equipamento)';
  }

  // ------------------------------------------------------------- utilidades UI

  themeIconName(): 'sun' | 'moon' | 'monitor' {
    const pref = this.theme.pref();
    if (pref === 'light') return 'sun';
    if (pref === 'dark') return 'moon';
    return 'monitor';
  }

  themeLabel(): string {
    return 'Alternar tema';
  }
}
