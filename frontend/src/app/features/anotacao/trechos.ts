/**
 * Partição do relato em pedaços para a tela de Anotação, fora do Angular para ser testada.
 * Cada pedaço guarda a posição em que começa no texto original: é o que transforma uma
 * seleção do mouse em índices exatos, mesmo com as tags HTML do relato no meio.
 */

export interface Marcacao {
  id: number;
  tipo: string;
  inicio: number;
  fim: number;
  removida: boolean;
}

export type Pedaco =
  | { kind: 'texto'; inicio: number; texto: string; tag: boolean; quebra: boolean }
  | { kind: 'marca'; inicio: number; texto: string; marcacao: Marcacao };

/** Tags e entidades HTML do relato (`<BR>`, `&NBSP;`): aparecem apagadas, mas continuam no texto. */
const MARKUP = /<[^>]+>|&[A-Za-z#0-9]+;/g;
const QUEBRA = /^<(br|\/p)\b/i;

function textoSolto(texto: string, inicio: number, fim: number): Pedaco[] {
  const pedacos: Pedaco[] = [];
  const trecho = texto.slice(inicio, fim);
  let pos = 0;
  for (const m of trecho.matchAll(MARKUP)) {
    const i = m.index ?? 0;
    if (i > pos) pedacos.push({ kind: 'texto', inicio: inicio + pos, texto: trecho.slice(pos, i), tag: false, quebra: false });
    pedacos.push({ kind: 'texto', inicio: inicio + i, texto: m[0], tag: true, quebra: QUEBRA.test(m[0]) });
    pos = i + m[0].length;
  }
  if (pos < trecho.length) pedacos.push({ kind: 'texto', inicio: inicio + pos, texto: trecho.slice(pos), tag: false, quebra: false });
  return pedacos;
}

export function partir(texto: string, marcacoes: Marcacao[]): Pedaco[] {
  const ordenadas = [...marcacoes].sort((a, b) => a.inicio - b.inicio);
  const pedacos: Pedaco[] = [];
  let pos = 0;
  for (const m of ordenadas) {
    if (m.inicio < pos) continue; // sobreposta a uma anterior: fica só na lista
    pedacos.push(...textoSolto(texto, pos, m.inicio));
    pedacos.push({ kind: 'marca', inicio: m.inicio, texto: texto.slice(m.inicio, m.fim), marcacao: m });
    pos = m.fim;
  }
  pedacos.push(...textoSolto(texto, pos, texto.length));
  return pedacos;
}

const ehDigito = (c: string) => c >= '0' && c <= '9';
const ehLetra = (c: string) => c.toLowerCase() !== c.toUpperCase();
const mesmaClasse = (a: string, b: string) => (ehDigito(a) && ehDigito(b)) || (ehLetra(a) && ehLetra(b));

/**
 * Todas as ocorrências do trecho no relato, sem cortar palavra ou número ao meio — a mesma
 * regra do pipeline (`locate_entities`): o guia manda marcar cada repetição do dado.
 */
export function ocorrencias(texto: string, trecho: string): Array<[number, number]> {
  const achadas: Array<[number, number]> = [];
  if (!trecho) return achadas;
  let i = texto.indexOf(trecho);
  while (i >= 0) {
    const fim = i + trecho.length;
    const corta = (i > 0 && mesmaClasse(texto[i - 1], texto[i])) || (fim < texto.length && mesmaClasse(texto[fim - 1], texto[fim]));
    if (!corta) achadas.push([i, fim]);
    i = texto.indexOf(trecho, i + 1);
  }
  return achadas;
}

/** Ajusta a seleção para não começar nem terminar em espaço. */
export function aparar(texto: string, inicio: number, fim: number): [number, number] {
  while (inicio < fim && /\s/.test(texto[inicio])) inicio++;
  while (fim > inicio && /\s/.test(texto[fim - 1])) fim--;
  return [inicio, fim];
}
