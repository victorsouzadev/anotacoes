import { describe, expect, it } from 'vitest';
import { ItemDoHub, mesclarCards } from './plugins.service';

const fixos = [
  { path: '/notes', icon: 'pen', title: 'Notas', description: 'canvas' },
  { path: '/dieta', icon: 'apple', title: 'Dieta', description: 'diário', downloadUrl: '/downloads/android/Dieta.apk' },
];
const item = (p: Partial<ItemDoHub>): ItemDoHub => ({
  id: 'x', nome: 'X', icone: 'grid', rota: '/x', origem: 'plugin', estado: 'no-ar', versao: 'abc', ...p,
});

describe('cards do hub com plug-ins (spec 029)', () => {
  it('módulos do núcleo não mudam nada', () => {
    expect(mesclarCards(fixos, [item({ id: 'notas', rota: '/notes', origem: 'nucleo' })], ['grid'])).toEqual(fixos);
  });

  it('plug-in novo vai para o fim, como link comum', () => {
    const c = mesclarCards(fixos, [item({ id: 'exemplo', nome: 'Exemplo', rota: '/exemplo', descricao: 'teste' })], ['grid']);
    expect(c).toHaveLength(3);
    expect(c[2]).toMatchObject({ path: '/exemplo/', externo: true, indisponivel: false, title: 'Exemplo', description: 'teste' });
  });

  it('plug-in extraído toma o lugar do módulo e herda ícone e texto', () => {
    const c = mesclarCards(fixos, [item({ id: 'dieta', nome: 'Dieta', icone: 'nao-existe', rota: '/dieta', estado: 'indisponivel' })], ['grid']);
    expect(c).toHaveLength(2);
    expect(c[1]).toMatchObject({ path: '/dieta/', icon: 'apple', description: 'diário', externo: true, indisponivel: true });
  });
});
