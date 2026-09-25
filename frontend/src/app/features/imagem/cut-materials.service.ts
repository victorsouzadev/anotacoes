import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { uuid } from '../../core/uuid';

/** Ajustes de corte de um material, como se anota na Silhouette. Quem decide
 * os números é quem corta — o editor só guarda e repete no passo a passo. */
export interface CutMaterial {
  id: string;
  nome: string;
  lamina: string;
  velocidade: string;
  forca: string;
  passadas: string;
  notas: string;
}

const LOCAL_SELECTED = 'imagem-material-atual';

/** Anotações de material, guardadas nas preferências da conta
 * (/api/imagens/preferencias), junto com o que mais vier a morar lá. */
@Injectable({ providedIn: 'root' })
export class CutMaterialsService {
  readonly materials = signal<CutMaterial[]>([]);
  readonly selectedId = signal<string | null>(readSelected());
  readonly selected = computed(() => this.materials().find((m) => m.id === this.selectedId()) ?? null);
  readonly loaded = signal(false);
  private other: Record<string, unknown> = {};
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(private http: HttpClient) {}

  async load(): Promise<void> {
    if (this.loaded()) return;
    try {
      const r = await firstValueFrom(this.http.get<{ data: string }>('/api/imagens/preferencias'));
      const data = JSON.parse(r.data || '{}') as Record<string, unknown>;
      const list = Array.isArray(data['materiais']) ? (data['materiais'] as CutMaterial[]) : [];
      delete data['materiais'];
      this.other = data;
      this.materials.set(list);
      this.loaded.set(true);
    } catch { /* sem conexão: segue sem as anotações */ }
  }

  select(id: string | null): void {
    this.selectedId.set(id);
    try {
      if (id) localStorage.setItem(LOCAL_SELECTED, id);
      else localStorage.removeItem(LOCAL_SELECTED);
    } catch { /* só conveniência */ }
  }

  add(): CutMaterial {
    const m: CutMaterial = { id: uuid(), nome: 'Novo material', lamina: '', velocidade: '', forca: '', passadas: '1', notas: '' };
    this.materials.update((l) => [...l, m]);
    this.select(m.id);
    this.persist();
    return m;
  }

  patch(id: string, patch: Partial<CutMaterial>): void {
    this.materials.update((l) => l.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    this.persist();
  }

  remove(id: string): void {
    this.materials.update((l) => l.filter((m) => m.id !== id));
    if (this.selectedId() === id) this.select(null);
    this.persist();
  }

  /** Linha pro passo a passo: "Vinil adesivo — lâmina 2, velocidade 5…". */
  describe(m: CutMaterial | null): string {
    if (!m) return '';
    const parts = [
      m.lamina && `lâmina ${m.lamina}`, m.velocidade && `velocidade ${m.velocidade}`,
      m.forca && `força ${m.forca}`, m.passadas && `${m.passadas} passada(s)`,
    ].filter(Boolean);
    return `${m.nome}${parts.length ? ` — ${parts.join(', ')}` : ''}${m.notas ? ` (${m.notas})` : ''}`;
  }

  /** Grava pouco depois da última mudança (digitar não vira uma chamada por tecla). */
  private persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const data = JSON.stringify({ ...this.other, materiais: this.materials() });
      firstValueFrom(this.http.put('/api/imagens/preferencias', { data })).catch(() => undefined);
    }, 800);
  }
}

function readSelected(): string | null {
  try {
    return localStorage.getItem(LOCAL_SELECTED);
  } catch {
    return null;
  }
}
