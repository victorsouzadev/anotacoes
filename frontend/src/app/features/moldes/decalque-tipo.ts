/** "Molde de uma foto": o tipo só monta a peça com as linhas que o painel do
 * decalque já tirou da foto (e o usuário revisou); a parte pesada mora em
 * `decalque.ts` e o estado em `decalque-estado.ts`. */

import { mapVPath } from '../imagem/illustration-model';
import { Molde, Params, Contexto, TipoMolde, num, str } from './modelo';

export const PAPEIS_FOTO: Record<string, [number, number]> = {
  a4: [210, 297],
  carta: [215.9, 279.4],
  a5: [148, 210],
  oficio: [216, 330],
  a3: [297, 420],
};

/** Tamanho real, em mm, do retângulo marcado pelos cantos. */
export function tamanhoDoPapel(p: Params): [number, number] {
  const id = str(p, 'papelFoto', 'a4');
  if (id === 'personalizado') return [Math.max(10, num(p, 'larguraFoto', 21) * 10), Math.max(10, num(p, 'alturaFoto', 29.7) * 10)];
  return PAPEIS_FOTO[id] ?? PAPEIS_FOTO['a4'];
}

export function moldeDeFoto(p: Params, ctx: Contexto): Molde {
  const d = ctx.decalque;
  if (!d) return { pecas: [], avisos: ['Envie a foto ou o scan do molde e confira os cantos do papel.'] };
  const k = Math.max(0.1, num(p, 'escala', 100) / 100);
  const esc = (paths: typeof d.corte) => paths.map((q) => mapVPath(q, ([x, y]) => [x * k, y * k]));
  if (!d.corte.length) return { pecas: [], avisos: ['Nenhuma linha marcada como corte. Clique no contorno na revisão das linhas.'] };
  return { pecas: [{ nome: 'Molde decalcado', corte: esc(d.corte), dobra: esc(d.dobra) }], avisos: [] };
}

export const MOLDE_DE_FOTO: TipoMolde = {
  id: 'decalque',
  nome: 'Molde de uma foto ou scan',
  categoria: 'A partir de imagem',
  descricao: 'Fotografe ou escaneie um molde de papel: o contorno vira corte e as linhas de dentro (inclusive tracejadas) viram dobra.',
  campos: [
    { chave: 'decalque', rotulo: 'Foto do molde', tipo: 'decalque' },
    {
      chave: 'papelFoto', rotulo: 'Papel fotografado (dá a escala)', tipo: 'opcoes',
      ajuda: 'Os cantos marcados na foto são os cantos deste papel.',
      opcoes: [
        { valor: 'a4', rotulo: 'A4 (21 × 29,7 cm)' },
        { valor: 'carta', rotulo: 'Carta (21,6 × 27,9 cm)' },
        { valor: 'a5', rotulo: 'A5 (14,8 × 21 cm)' },
        { valor: 'oficio', rotulo: 'Ofício (21,6 × 33 cm)' },
        { valor: 'a3', rotulo: 'A3 (29,7 × 42 cm)' },
        { valor: 'personalizado', rotulo: 'Outra medida' },
      ],
    },
    { chave: 'larguraFoto', rotulo: 'Largura do retângulo', tipo: 'numero', unidade: 'cm', min: 1, max: 100, passo: 0.1, visivel: (p) => str(p, 'papelFoto') === 'personalizado' },
    { chave: 'alturaFoto', rotulo: 'Altura do retângulo', tipo: 'numero', unidade: 'cm', min: 1, max: 100, passo: 0.1, visivel: (p) => str(p, 'papelFoto') === 'personalizado' },
    { chave: 'sensibilidade', rotulo: 'Sensibilidade da tinta', tipo: 'numero', unidade: '%', min: 0, max: 100, passo: 1, ajuda: 'Mais alto pega traço clarinho (lápis); mais baixo ignora sombra e sujeira.' },
    { chave: 'fecharFalhas', rotulo: 'Fechar falhas do contorno', tipo: 'numero', unidade: 'mm', min: 0, max: 3, passo: 0.1 },
    { chave: 'vaoTracejado', rotulo: 'Maior vão do tracejado', tipo: 'numero', unidade: 'mm', min: 1, max: 20, passo: 0.5 },
    { chave: 'minimo', rotulo: 'Dobra mais curta aceita', tipo: 'numero', unidade: 'mm', min: 1, max: 40, passo: 0.5, ajuda: 'Linha menor que isso é tratada como sujeira ou texto.' },
    { chave: 'escala', rotulo: 'Ampliar / reduzir', tipo: 'numero', unidade: '%', min: 25, max: 300, passo: 5 },
  ],
  padrao: { papelFoto: 'a4', larguraFoto: 21, alturaFoto: 29.7, sensibilidade: 50, fecharFalhas: 0.4, vaoTracejado: 5, minimo: 5, escala: 100 },
  montagem: [
    'Fotografe o molde de cima, com o papel inteiro na foto e boa luz (sem sombra do celular).',
    'Confira os quatro cantos do papel: é deles que sai a escala.',
    'Na revisão, clique numa linha para trocar entre corte, dobra e ignorar.',
    'Exporte e corte uma vez em papel comum pra conferir antes de usar o papel bom.',
  ],
  nomeArquivo: (p) => `molde-decalcado-${num(p, 'escala', 100)}pct`,
  gerar: moldeDeFoto,
};
