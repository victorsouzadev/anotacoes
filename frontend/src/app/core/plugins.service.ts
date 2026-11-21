import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Item de GET /api/plugins (spec 029): módulo do núcleo ou plug-in, com o último health. */
export interface ItemDoHub {
  id: string;
  nome: string;
  icone: string;
  rota: string;
  origem: 'nucleo' | 'plugin';
  estado: 'no-ar' | 'indisponivel' | 'atualizando';
  versao: string;
  descricao?: string | null;
  android?: string | null;
  ultimaFalha?: string | null;
  /** Caminho do MCP do plug-in (`mcp` do plugin.json), se tiver. */
  mcp?: string | null;
}

/** Card do hub. Plug-in é página à parte (fora do Angular): abre por link comum, não pelo roteador. */
export interface CardDoHub {
  path: string;
  icon: string;
  title: string;
  description: string;
  externo?: boolean;
  indisponivel?: boolean;
  downloadUrl?: string;
  downloadFileName?: string;
  downloadLabel?: string;
  windows?: boolean;
}

/**
 * Junta os cards fixos do hub com os plug-ins da API. Um plug-in que tomou o lugar de um módulo do núcleo
 * (mesma rota, depois da extração) substitui o card antigo na mesma posição; os novos vão para o fim.
 */
export function mesclarCards<T extends CardDoHub>(fixos: T[], itens: ItemDoHub[], icones: readonly string[]): CardDoHub[] {
  const plugins = itens.filter((i) => i.origem === 'plugin');
  const paraCard = (p: ItemDoHub, antigo?: CardDoHub): CardDoHub => ({
    path: p.rota + '/',
    icon: icones.includes(p.icone) ? p.icone : antigo?.icon ?? 'grid',
    title: p.nome,
    description: p.descricao ?? antigo?.description ?? '',
    externo: true,
    indisponivel: p.estado !== 'no-ar',
    ...(p.android ? { downloadUrl: p.android, downloadFileName: p.android.split('/').pop(), downloadLabel: 'Baixar app Android (.apk)' } : {}),
  });
  const usados = new Set<string>();
  const cards: CardDoHub[] = fixos.map((f) => {
    const p = plugins.find((x) => x.rota === f.path);
    if (!p) return f;
    usados.add(p.id);
    return paraCard(p, f);
  });
  for (const p of plugins) if (!usados.has(p.id)) cards.push(paraCard(p));
  return cards;
}

@Injectable({ providedIn: 'root' })
export class PluginsService {
  private readonly http = inject(HttpClient);

  listar(): Promise<ItemDoHub[]> {
    return firstValueFrom(this.http.get<ItemDoHub[]>('/api/plugins'));
  }
}
