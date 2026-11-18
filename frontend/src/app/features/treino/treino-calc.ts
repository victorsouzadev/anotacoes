import { Atividade } from './treino.models';

/** As mesmas contas do MCP (Mcp/TreinoMcpTools.cs), para a tela e o resumo baterem. */

export function km(m: number): string {
  return (m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km';
}

export function duracao(s: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}h${p(Math.floor((s % 3600) / 60))}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}

/** Ritmo em min/km; só faz sentido a partir de 100 m (como no MCP). */
export function ritmo(a: Pick<Atividade, 'duracaoSeg' | 'distanciaM'>): string | null {
  if (a.distanciaM < 100) return null;
  const s = Math.round(a.duracaoSeg / (a.distanciaM / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/km`;
}

export function ativas(lista: Atividade[]): Atividade[] {
  return lista.filter((a) => !a.deletedAt).sort((a, b) => b.inicio.localeCompare(a.inicio));
}

export interface Totais {
  dias: number;
  treinos: number;
  metros: number;
  segundos: number;
  esforcoMedio: number | null;
  comDor: number;
}

/** Totais dos últimos N dias contados a partir de agora (mesma janela do treino_resumo). */
export function totais(lista: Atividade[], dias: number, agora: Date = new Date()): Totais {
  const limite = agora.getTime() - dias * 86_400_000;
  const p = lista.filter((a) => !a.deletedAt && new Date(a.inicio).getTime() >= limite);
  const esf = p.filter((a) => a.esforco !== null);
  return {
    dias,
    treinos: p.length,
    metros: p.reduce((s, a) => s + a.distanciaM, 0),
    segundos: p.reduce((s, a) => s + a.duracaoSeg, 0),
    esforcoMedio: esf.length ? esf.reduce((s, a) => s + (a.esforco ?? 0), 0) / esf.length : null,
    comDor: p.filter((a) => a.dor).length,
  };
}

/** Segunda-feira (local) da semana de uma data, como chave yyyy-MM-dd. */
export function inicioDaSemana(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

/** km e ritmo médio (s/km) por semana nas últimas N semanas, da mais antiga para a mais nova. */
export function porSemana(lista: Atividade[], semanas = 12, agora: Date = new Date()) {
  const chaves: string[] = [];
  for (let i = semanas - 1; i >= 0; i--) chaves.push(inicioDaSemana(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - i * 7)));
  const mapa = new Map(chaves.map((k) => [k, { semana: k, metros: 0, segundosComDistancia: 0 }]));
  for (const a of lista) {
    if (a.deletedAt) continue;
    const k = mapa.get(inicioDaSemana(new Date(a.inicio)));
    if (!k) continue;
    k.metros += a.distanciaM;
    if (a.distanciaM >= 100) k.segundosComDistancia += a.duracaoSeg;
  }
  return [...mapa.values()].map((s) => ({
    semana: s.semana,
    km: s.metros / 1000,
    ritmoSegKm: s.metros >= 100 && s.segundosComDistancia > 0 ? s.segundosComDistancia / (s.metros / 1000) : null,
  }));
}
