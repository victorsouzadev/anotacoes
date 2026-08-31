import { Chart, ChartOptions, ChartType, TooltipItem } from 'chart.js';

/** Lê um token de cor do CSS para dentro do Chart.js, que não entende var(). */
function token(nome: string, fallback: string): string {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return valor || fallback;
}

export interface PaletaGrafico {
  texto: string;
  grade: string;
  superficie: string;
  positivo: string;
  negativo: string;
  categorias: string[];
}

export function paletaAtual(): PaletaGrafico {
  const escuro = temaEscuro();
  return {
    texto: token('--text-muted', escuro ? '#9494a8' : '#7a7a8c'),
    grade: token('--grade', escuro ? 'rgba(236,236,243,0.1)' : 'rgba(28,28,38,0.08)'),
    superficie: token('--surface', escuro ? '#1f1f2b' : '#ffffff'),
    positivo: token('--positivo', escuro ? '#4ade80' : '#16a34a'),
    negativo: token('--negativo', escuro ? '#f87171' : '#dc2626'),
    // Paleta categórica com contraste suficiente nos dois temas — as cores fixas
    // anteriores sumiam no fundo escuro.
    categorias: escuro
      ? ['#8b7bff', '#4ade80', '#f87171', '#fbbf24', '#c084fc', '#38bdf8', '#f472b6', '#a3e635', '#94a3b8', '#fb923c', '#2dd4bf']
      : ['#6d5ef8', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#64748b', '#ea580c', '#0f766e'],
  };
}

export function temaEscuro(): boolean {
  const atributo = document.documentElement.getAttribute('data-theme');
  if (atributo === 'dark') return true;
  if (atributo === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Opções comuns aos gráficos da ferramenta, já nas cores do tema atual. */
export function opcoesBase<T extends ChartType>(paleta: PaletaGrafico): ChartOptions<T> {
  // O objeto é montado igual para todo tipo de gráfico, mas os tipos do Chart.js
  // são invariantes no tipo do gráfico, então a conversão fica contida aqui em
  // vez de espalhar `any` por cada chamada.
  const opcoes = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { color: paleta.texto, boxWidth: 12, boxHeight: 12, padding: 14, usePointStyle: true },
      },
      tooltip: {
        callbacks: {
          // Valores no tooltip em reais, e não como número cru.
          label: (ctx: TooltipItem<T>) => {
            const bruto = ctx.parsed as number | { y: number | null } | null;
            const valor = typeof bruto === 'number' ? bruto : bruto?.y ?? 0;
            // O tipo do dataset varia com o tipo do gráfico; só o rótulo interessa.
            const nome = (ctx.dataset as { label?: string }).label;
            return (nome ? `${nome}: ` : '') + formatarMoeda(valor);
          },
        },
      },
    },
  };

  return opcoes as ChartOptions<T>;
}

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Registra o Chart.js uma única vez, sob demanda. */
let registrado = false;
export async function registrarChartJs(): Promise<void> {
  if (registrado) return;
  const { registerables } = await import('chart.js');
  Chart.register(...registerables);
  registrado = true;
}
