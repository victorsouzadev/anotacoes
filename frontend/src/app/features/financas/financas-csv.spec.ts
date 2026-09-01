import { describe, expect, it } from 'vitest';
import { nomeArquivoCsv, orcamentoParaCsv, transacoesParaCsv } from './financas-csv';
import { Transacao } from './models/transacao.model';
import { AcompanhamentoItem } from './models/orcamento.model';

function transacao(over: Partial<Transacao> = {}): Transacao {
  return {
    id: 'id-1',
    descricao: 'Mercado',
    valor: 45.5,
    tipo: 'despesa',
    categoria: 'Alimentacao',
    categoriaRotulo: 'Alimentação',
    data: '2026-08-31',
    formaPagamento: null,
    textoOriginal: 'gastei 45,50 no mercado',
    confiancaIa: 0.9,
    status: 'confirmado',
    observacoes: null,
    criadoEm: '2026-08-31T12:00:00Z',
    ...over,
  };
}

describe('transacoesParaCsv', () => {
  it('usa cabeçalho, ponto e vírgula e CRLF', () => {
    const csv = transacoesParaCsv([transacao()]);
    const linhas = csv.split('\r\n');

    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toBe(
      '"Data";"Descrição";"Tipo";"Categoria";"Valor";"Forma de pagamento";"Situação";"Observações"',
    );
  });

  it('escreve valor com vírgula decimal, como o Excel em português espera', () => {
    const csv = transacoesParaCsv([transacao({ valor: 1234.5 })]);
    expect(csv).toContain('"1234,50"');
    expect(csv).not.toContain('"1234.50"');
  });

  it('formata a data no padrão brasileiro', () => {
    const csv = transacoesParaCsv([transacao({ data: '2026-08-31' })]);
    expect(csv).toContain('"31/08/2026"');
  });

  it('usa o rótulo acentuado da categoria, não o nome do enum', () => {
    const csv = transacoesParaCsv([transacao()]);
    expect(csv).toContain('"Alimentação"');
    expect(csv).not.toContain('"Alimentacao"');
  });

  it('escapa aspas na descrição sem quebrar a coluna', () => {
    const csv = transacoesParaCsv([transacao({ descricao: 'Almoço no "Bar do Zé"' })]);
    expect(csv).toContain('"Almoço no ""Bar do Zé"""');
    // O escape não pode introduzir um separador extra.
    expect(csv.split('\r\n')[1].split(';')).toHaveLength(8);
  });

  it('não quebra a linha quando a observação tem ponto e vírgula', () => {
    const csv = transacoesParaCsv([transacao({ observacoes: 'dividido; metade minha' })]);
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('traduz tipo e situação', () => {
    const csv = transacoesParaCsv([
      transacao({ tipo: 'receita', status: 'pendente_revisao' }),
    ]);
    expect(csv).toContain('"Receita"');
    expect(csv).toContain('"A revisar"');
  });

  it('trata campos nulos como coluna vazia, sem escrever "null"', () => {
    const csv = transacoesParaCsv([transacao({ formaPagamento: null, observacoes: null })]);
    const colunas = csv.split('\r\n')[1].split(';');

    expect(colunas[5]).toBe('""'); // forma de pagamento
    expect(colunas[7]).toBe('""'); // observações
    expect(csv).not.toContain('null');
  });

  it('lista vazia gera só o cabeçalho', () => {
    expect(transacoesParaCsv([]).split('\r\n')).toHaveLength(1);
  });
});

describe('orcamentoParaCsv', () => {
  const item: AcompanhamentoItem = {
    categoria: 'Moradia',
    categoriaRotulo: 'Moradia',
    grupo: 'Essenciais',
    percentual: 25,
    valorPlanejado: 1625,
    valorRealizado: 1850,
    valorRestante: -225,
    percentualUtilizado: 113.85,
    situacao: 'estourado',
  };

  it('inclui planejado, gasto e situação em português', () => {
    const csv = orcamentoParaCsv([item]);
    expect(csv).toContain('"1625,00"');
    expect(csv).toContain('"1850,00"');
    expect(csv).toContain('"Estourado"');
  });

  it('mantém o sinal negativo do restante estourado', () => {
    expect(orcamentoParaCsv([item])).toContain('"-225,00"');
  });

  it('traduz a situação de categoria fora do orçamento', () => {
    const csv = orcamentoParaCsv([{ ...item, situacao: 'sem_orcamento' }]);
    expect(csv).toContain('"Fora do orçamento"');
  });
});

describe('nomeArquivoCsv', () => {
  it('inclui a competência com mês de dois dígitos', () => {
    expect(nomeArquivoCsv('lancamentos', 2026, 8)).toBe('lancamentos-2026-08.csv');
    expect(nomeArquivoCsv('orcamento', 2026, 12)).toBe('orcamento-2026-12.csv');
  });
});
