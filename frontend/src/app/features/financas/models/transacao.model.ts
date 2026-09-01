export type TipoTransacao = 'receita' | 'despesa';

export type Categoria =
  | 'Alimentacao'
  | 'Transporte'
  | 'Moradia'
  | 'Saude'
  | 'Educacao'
  | 'Lazer'
  | 'Compras'
  | 'ContasServicos'
  | 'Salario'
  | 'Investimentos'
  | 'Outros';

export type FormaPagamento = 'Cartao' | 'Pix' | 'Dinheiro' | 'Boleto';

export type StatusTransacao = 'confirmado' | 'pendente_revisao';

export interface Transacao {
  id: string;
  descricao: string;
  valor: number;
  tipo: TipoTransacao;
  categoria: Categoria;
  /** Rótulo legível da categoria, já acentuado, vindo do backend. */
  categoriaRotulo: string;
  data: string; // ISO 8601 (AAAA-MM-DD)
  formaPagamento: FormaPagamento | null;
  textoOriginal: string;
  confiancaIa: number;
  status: StatusTransacao;
  observacoes: string | null;
  criadoEm: string;
}

export interface CriarTransacaoRequest {
  texto: string;
}

export interface AtualizarTransacaoRequest {
  descricao?: string;
  valor?: number;
  tipo?: TipoTransacao;
  categoria?: Categoria;
  data?: string;
  formaPagamento?: FormaPagamento;
  observacoes?: string;
  status?: 'Confirmado' | 'PendenteRevisao';
  /** `null` significa "não alterar", então limpar a forma de pagamento precisa de flag. */
  limparFormaPagamento?: boolean;
}

export interface ListarTransacoesFiltro {
  dataInicio?: string;
  dataFim?: string;
  categoria?: Categoria;
  tipo?: TipoTransacao;
  status?: 'Confirmado' | 'PendenteRevisao';
  ano?: number;
  mes?: number;
}

export const CATEGORIAS: { valor: Categoria; rotulo: string }[] = [
  { valor: 'Moradia', rotulo: 'Moradia' },
  { valor: 'ContasServicos', rotulo: 'Contas e serviços' },
  { valor: 'Alimentacao', rotulo: 'Alimentação' },
  { valor: 'Transporte', rotulo: 'Transporte' },
  { valor: 'Saude', rotulo: 'Saúde' },
  { valor: 'Educacao', rotulo: 'Educação' },
  { valor: 'Lazer', rotulo: 'Lazer' },
  { valor: 'Compras', rotulo: 'Compras' },
  { valor: 'Investimentos', rotulo: 'Investimentos' },
  { valor: 'Outros', rotulo: 'Outros' },
  { valor: 'Salario', rotulo: 'Salário' },
];

const ROTULOS = new Map(CATEGORIAS.map((c) => [c.valor, c.rotulo]));

/** Fallback para quando só se tem o nome do enum (ex.: rótulo de gráfico). */
export function rotuloCategoria(categoria: string): string {
  return ROTULOS.get(categoria as Categoria) ?? categoria;
}

export const FORMAS_PAGAMENTO: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: 'Cartao', rotulo: 'Cartão' },
  { valor: 'Pix', rotulo: 'Pix' },
  { valor: 'Dinheiro', rotulo: 'Dinheiro' },
  { valor: 'Boleto', rotulo: 'Boleto' },
];

export function rotuloFormaPagamento(forma: FormaPagamento | null): string {
  return FORMAS_PAGAMENTO.find((f) => f.valor === forma)?.rotulo ?? '';
}
