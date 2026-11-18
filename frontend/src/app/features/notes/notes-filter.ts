import { NoteRecord } from '../../data/models';

export type SortMode = 'updated' | 'created' | 'title';

export interface FiltroNotas {
  pasta: string | null;
  busca: string;
  ordem: SortMode;
  /** A nota precisa ter todas (E). */
  tags?: string[];
}

export const MAX_TAGS = 20;
export const MAX_TAG = 40;

/** Minúsculas, aparadas, sem vazias, únicas e dentro dos limites do servidor (20 × 40). */
export function normalizarTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const n = t.trim().toLowerCase().slice(0, MAX_TAG);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(0, MAX_TAGS);
}

/** Tags em uso com a quantidade de notas vivas, em ordem alfabética. */
export function contarTags(notes: NoteRecord[]): { tag: string; total: number }[] {
  const mapa = new Map<string, number>();
  for (const n of notes) {
    if (n.deletedAt || n.trashedAt) continue;
    for (const t of n.tags ?? []) mapa.set(t, (mapa.get(t) ?? 0) + 1);
  }
  return [...mapa.entries()].map(([tag, total]) => ({ tag, total })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Dias que a lixeira guarda uma nota (o servidor esvazia depois disso — spec 018). */
export const DIAS_LIXEIRA = 30;

/**
 * Busca no título e no conteúdo de texto, adesivo e checklist de todas as páginas — dá pra
 * achar uma nota lembrando só de uma palavra escrita nela.
 */
export function combinaBusca(note: NoteRecord, q: string): boolean {
  if (note.title.toLowerCase().includes(q)) return true;
  if ((note.tags ?? []).some((t) => t.includes(q))) return true;
  for (const page of note.pages) {
    for (const el of page.elements) {
      if ((el.type === 'text' || el.type === 'sticky') && el.content.toLowerCase().includes(q)) return true;
      if (el.type === 'checklist' && el.items.some((it) => it.text.toLowerCase().includes(q))) return true;
    }
  }
  return false;
}

/** Pasta + busca + ordenação da lista de notas. Não mostra notas na lixeira nem tombstones. */
export function filtrarNotas(notes: NoteRecord[], f: FiltroNotas): NoteRecord[] {
  let list = notes.filter((n) => !n.deletedAt && !n.trashedAt);
  if (f.pasta !== null) list = list.filter((n) => n.folderId === f.pasta);
  if (f.tags?.length) list = list.filter((n) => f.tags!.every((t) => (n.tags ?? []).includes(t)));
  const q = f.busca.trim().toLowerCase();
  if (q) list = list.filter((n) => combinaBusca(n, q));
  const sorted = [...list];
  switch (f.ordem) {
    case 'updated': sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); break;
    case 'created': sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); break;
    case 'title': sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
  }
  return sorted;
}

/** Quantos dias faltam para a nota sair da lixeira de vez (nunca negativo). */
export function diasRestantes(trashedAt: string, agora: Date = new Date()): number {
  const passou = (agora.getTime() - new Date(trashedAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(DIAS_LIXEIRA - passou));
}
