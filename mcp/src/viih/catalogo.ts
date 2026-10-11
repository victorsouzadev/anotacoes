// Catálogo de modelos que a IA pode escolher: os do editor (gerados a partir
// do frontend em modelos.ts) mais os que o usuário salvou na galeria. Uma
// versão editada de um modelo do editor substitui o original, como na galeria.

export interface ModeloIa {
  id: string;
  nome: string;
  grupo: string;
  ajuda: string;
  /** Quantas fotos cabem: espaço principal + espaços tracejados. */
  fotos: number;
  /** Tem espaços tracejados: o carrossel cresce pra caber mais fotos. */
  cresce: boolean;
  textos: string[];
}

export interface ModeloSalvoDto {
  id: string;
  name: string;
  group: string;
  replaces: string;
  data: string;
}

interface CamadaSalva {
  kind?: string;
  text?: string;
  placeholder?: boolean;
}

export function descreverSalvo(dto: ModeloSalvoDto, ajuda: string): ModeloIa | null {
  try {
    const d = JSON.parse(dto.data) as { slot?: unknown; overlays?: CamadaSalva[] };
    if (!d || !Array.isArray(d.overlays)) return null;
    const espacos = d.overlays.filter((o) => o.kind === 'forma' && o.placeholder).length;
    return {
      id: dto.id, nome: dto.name, grupo: dto.group, ajuda,
      fotos: (d.slot ? 1 : 0) + espacos, cresce: espacos > 0,
      textos: d.overlays.flatMap((o) => (o.kind === 'texto' && typeof o.text === 'string' ? [o.text] : [])),
    };
  } catch {
    return null;
  }
}

export function montarCatalogo(doEditor: ModeloIa[], salvos: ModeloSalvoDto[]): ModeloIa[] {
  const conhecidos = new Set(doEditor.map((m) => m.id));
  const lista = doEditor.map((m) => {
    const editado = salvos.find((s) => s.replaces === m.id);
    return (editado && descreverSalvo(editado, `Sua versão de "${m.nome}". ${m.ajuda}`)) || m;
  });
  for (const s of salvos) {
    if (s.replaces && conhecidos.has(s.replaces)) continue;
    const m = descreverSalvo(s, 'Modelo seu');
    if (m) lista.push(m);
  }
  return lista;
}

export function capacidade(m: ModeloIa): string {
  if (m.fotos === 0) return 'sem foto';
  if (m.cresce) return `${m.fotos}+ fotos (carrossel cresce até 10 posts)`;
  return m.fotos === 1 ? '1 foto' : `${m.fotos} fotos`;
}
