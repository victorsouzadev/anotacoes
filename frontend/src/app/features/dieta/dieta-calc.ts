import { Metas, REFEICOES, Refeicao, Registro } from './dieta.models';

/** Data local no formato da API (yyyy-MM-dd) — nunca toISOString(), que é UTC. */
export function dataLocal(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function somarDias(data: string, dias: number): string {
  const [y, m, d] = data.split('-').map(Number);
  return dataLocal(new Date(y, m - 1, d + dias));
}

/** "Hoje", "Ontem", "Amanhã" ou "qua., 12/11". */
export function rotuloData(data: string, hoje: string = dataLocal()): string {
  if (data === hoje) return 'Hoje';
  if (data === somarDias(hoje, -1)) return 'Ontem';
  if (data === somarDias(hoje, 1)) return 'Amanhã';
  const [y, m, d] = data.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export function nomeRefeicao(r: Refeicao): string {
  return REFEICOES.find((x) => x.valor === r)?.nome ?? r;
}

/** Itens do dia agrupados por refeição, na ordem do dia, com o total de kcal de cada uma. */
export function porRefeicao(registros: Registro[]): { refeicao: Refeicao; nome: string; itens: Registro[]; kcal: number }[] {
  return REFEICOES.map((r) => {
    const itens = registros.filter((x) => x.refeicao === r.valor && !x.deletedAt);
    return { refeicao: r.valor, nome: r.nome, itens, kcal: itens.reduce((s, x) => s + x.kcal, 0) };
  });
}

/** Percentual da meta (0–100+, inteiro); meta zero = 0. */
export function percentual(valor: number, meta: number): number {
  return meta > 0 ? Math.round((valor / meta) * 100) : 0;
}

/** Barras do dia: kcal, proteína, carboidrato, gordura e água contra as metas. */
export function barrasDoDia(t: { kcal: number; proteina: number; carbo: number; gordura: number; aguaMl: number }, m: Metas) {
  return [
    { nome: 'Calorias', valor: t.kcal, meta: m.kcal, unidade: 'kcal' },
    { nome: 'Proteína', valor: t.proteina, meta: m.proteinaG, unidade: 'g' },
    { nome: 'Carboidrato', valor: t.carbo, meta: m.carboG, unidade: 'g' },
    { nome: 'Gordura', valor: t.gordura, meta: m.gorduraG, unidade: 'g' },
    { nome: 'Água', valor: t.aguaMl, meta: m.aguaMl, unidade: 'ml' },
  ].map((b) => ({ ...b, pct: percentual(b.valor, b.meta) }));
}

/** Valores por porção a partir dos valores por 100 g do alimento (para a prévia antes de registrar). */
export function valoresDaPorcao(a: { kcal: number; proteina: number; carbo: number; gordura: number }, gramas: number) {
  const f = gramas / 100;
  return { kcal: a.kcal * f, proteina: a.proteina * f, carbo: a.carbo * f, gordura: a.gordura * f };
}

/** Heatmap estilo GitHub: colunas de semanas (domingo em cima), do mais antigo ao mais novo. */
export function heatmap(dias: { data: string; nivel: number }[], semanas = 12, hoje: string = dataLocal()) {
  const porData = new Map(dias.map((d) => [d.data, d.nivel]));
  const [y, m, d] = hoje.split('-').map(Number);
  const domingoAtual = new Date(y, m - 1, d - new Date(y, m - 1, d).getDay());
  const colunas: { data: string; nivel: number; futuro: boolean }[][] = [];
  for (let s = semanas - 1; s >= 0; s--) {
    const coluna = [];
    for (let i = 0; i < 7; i++) {
      const data = dataLocal(new Date(domingoAtual.getFullYear(), domingoAtual.getMonth(), domingoAtual.getDate() - s * 7 + i));
      coluna.push({ data, nivel: porData.get(data) ?? 0, futuro: data > hoje });
    }
    colunas.push(coluna);
  }
  return colunas;
}

/** Nível do dia como o servidor calcula (DiaDieta.Nivel): 0 nada, 1 registrou, +1 por meta batida. */
export function nivelDia(t: { registros: number; kcalNaMeta: boolean; proteinaNaMeta: boolean; aguaNaMeta: boolean }): number {
  return t.registros === 0 ? 0 : 1 + (t.kcalNaMeta ? 1 : 0) + (t.proteinaNaMeta ? 1 : 0) + (t.aguaNaMeta ? 1 : 0);
}

export function arred(n: number, casas = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 });
}
