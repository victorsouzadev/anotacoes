import { toCsv } from '../../shared/csv';
import { Transacao } from './models/transacao.model';
import { AcompanhamentoItem } from './models/orcamento.model';

/** Valor no formato que o Excel em português entende como número (vírgula decimal). */
function moeda(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

function dataBr(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

export function transacoesParaCsv(transacoes: Transacao[]): string {
  const linhas = [
    ['Data', 'Descrição', 'Tipo', 'Categoria', 'Valor', 'Forma de pagamento', 'Situação', 'Observações'],
  ];

  for (const t of transacoes) {
    linhas.push([
      dataBr(t.data),
      t.descricao,
      t.tipo === 'receita' ? 'Receita' : 'Despesa',
      t.categoriaRotulo,
      moeda(t.valor),
      t.formaPagamento ?? '',
      t.status === 'pendente_revisao' ? 'A revisar' : 'Confirmado',
      t.observacoes ?? '',
    ]);
  }

  return toCsv(linhas);
}

export function orcamentoParaCsv(itens: AcompanhamentoItem[]): string {
  const linhas = [['Categoria', 'Grupo', '% do total', 'Planejado', 'Gasto', 'Restante', '% usado', 'Situação']];

  const situacoes: Record<string, string> = {
    ok: 'Dentro do previsto',
    atencao: 'Atenção',
    estourado: 'Estourado',
    sem_orcamento: 'Fora do orçamento',
  };

  for (const i of itens) {
    linhas.push([
      i.categoriaRotulo,
      i.grupo,
      moeda(i.percentual),
      moeda(i.valorPlanejado),
      moeda(i.valorRealizado),
      moeda(i.valorRestante),
      moeda(i.percentualUtilizado),
      situacoes[i.situacao] ?? i.situacao,
    ]);
  }

  return toCsv(linhas);
}

/** Nome de arquivo com a competência, para os downloads não se sobrescreverem. */
export function nomeArquivoCsv(prefixo: string, ano: number, mes: number): string {
  return `${prefixo}-${ano}-${String(mes).padStart(2, '0')}.csv`;
}
