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
}

export interface ListarTransacoesFiltro {
  dataInicio?: string;
  dataFim?: string;
  categoria?: Categoria;
  tipo?: TipoTransacao;
}

export const CATEGORIAS: { valor: Categoria; rotulo: string }[] = [
  { valor: 'Alimentacao', rotulo: 'Alimentação' },
  { valor: 'Transporte', rotulo: 'Transporte' },
  { valor: 'Moradia', rotulo: 'Moradia' },
  { valor: 'Saude', rotulo: 'Saúde' },
  { valor: 'Educacao', rotulo: 'Educação' },
  { valor: 'Lazer', rotulo: 'Lazer' },
  { valor: 'Compras', rotulo: 'Compras' },
  { valor: 'ContasServicos', rotulo: 'Contas/Serviços' },
  { valor: 'Salario', rotulo: 'Salário' },
  { valor: 'Investimentos', rotulo: 'Investimentos' },
  { valor: 'Outros', rotulo: 'Outros' },
];
