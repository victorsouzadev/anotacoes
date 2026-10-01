import { CAIXA_BOMBOM, CAIXA_MILK, CONE, PIRAMIDE, SACOLINHA } from './caixas';
import { Categoria, TipoMolde } from './modelo';
import { TOPO_DE_BOLO, TOPPER_FOTO } from './toppers';

export const TIPOS: TipoMolde[] = [CAIXA_MILK, CAIXA_BOMBOM, SACOLINHA, PIRAMIDE, CONE, TOPO_DE_BOLO, TOPPER_FOTO];

export const CATEGORIAS: Categoria[] = ['Caixas e embalagens', 'Toppers'];

export function tipoPorId(id: string): TipoMolde {
  return TIPOS.find((t) => t.id === id) ?? TIPOS[0];
}
