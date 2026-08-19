import type { Priority } from './tasksApi.js';

const MAP: Record<string, Priority> = {
  low: 'Low',
  baixa: 'Low',
  medium: 'Medium',
  média: 'Medium',
  media: 'Medium',
  normal: 'Medium',
  high: 'High',
  alta: 'High',
  urgente: 'High',
};

// Aceita a prioridade em qualquer forma que o LLM mandar (pt-BR, en, maiúsculo/minúsculo) e
// normaliza pro enum exato que o backend espera (Low/Medium/High, case-sensitive).
export function normalizePriority(input: string | undefined): Priority {
  if (!input) return 'Medium';
  return MAP[input.trim().toLowerCase()] ?? 'Medium';
}
