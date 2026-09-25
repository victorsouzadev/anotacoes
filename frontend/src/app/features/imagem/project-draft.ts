/** Rascunho automático do Editor de Imagens: o projeto inteiro (os quatro
 * modos) guardado no navegador enquanto se trabalha, pra aba fechada, queda
 * de energia ou "sair sem salvar" não levarem o trabalho junto. Fica no
 * IndexedDB porque o projeto chega a vários MB (as artes vão embutidas) e o
 * localStorage para em ~5 MB. Um rascunho só, por navegador. */

import { openDB } from 'idb';

const DB = 'editor-imagens';
const STORE = 'rascunho';
const KEY = 'atual';

export interface ProjectDraft {
  savedAt: string;
  projectId: string | null;
  /** Programa desktop: o arquivo .edimg aberto. */
  projectPath?: string | null;
  projectName: string;
  /** O mesmo JSON que vai pro backend ao salvar. */
  data: string;
}

function db() {
  return openDB(DB, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    },
  });
}

export async function saveDraft(draft: ProjectDraft): Promise<void> {
  try {
    await (await db()).put(STORE, draft, KEY);
  } catch { /* sem IndexedDB (aba anônima em alguns navegadores): segue sem rascunho */ }
}

export async function loadDraft(): Promise<ProjectDraft | null> {
  try {
    return ((await (await db()).get(STORE, KEY)) as ProjectDraft | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await (await db()).delete(STORE, KEY);
  } catch { /* nada a limpar */ }
}
