import { describe, expect, it, vi } from 'vitest';

// postApi importa auth → config, que exige as credenciais já no import. vi.hoisted
// roda antes dos imports abaixo; os testes daqui não fazem chamadas de rede.
vi.hoisted(() => {
  process.env.HUB_EMAIL ??= 'teste@example.com';
  process.env.HUB_PASSWORD ??= 'teste';
});
import { descreverSalvo, montarCatalogo } from './catalogo.js';
import { MODELOS_DO_EDITOR } from './modelos.js';
import { ordemCompleta, textosFinais } from './postApi.js';
import { cookieDaSessao, siteConfig, slug } from './siteApi.js';

describe('catálogo de modelos', () => {
  it('traz os modelos do editor, com fotos e textos', () => {
    const entregas = MODELOS_DO_EDITOR.find((m) => m.id === 'vm-carrossel-entregas')!;
    expect(entregas.cresce).toBe(true);
    expect(entregas.fotos).toBe(4);
    expect(MODELOS_DO_EDITOR.find((m) => m.id === 'vm-feed-novidade')!.fotos).toBe(1);
  });

  it('versão editada substitui o original; modelo novo entra no fim', () => {
    const data = JSON.stringify({ slot: null, overlays: [{ kind: 'texto', text: 'oi' }, { kind: 'forma', placeholder: true }] });
    const lista = montarCatalogo(MODELOS_DO_EDITOR, [
      { id: 'c1', name: 'Novidade minha', group: 'Feed', replaces: 'vm-feed-novidade', data },
      { id: 'c2', name: 'Meu', group: 'Story', replaces: '', data },
      { id: 'c3', name: 'Quebrado', group: 'Story', replaces: '', data: '{' },
    ]);
    expect(lista.find((m) => m.id === 'vm-feed-novidade')).toBeUndefined();
    expect(lista.find((m) => m.id === 'c1')).toMatchObject({ fotos: 1, cresce: true, textos: ['oi'] });
    expect(lista[lista.length - 1].id).toBe('c2');
    expect(descreverSalvo({ id: 'x', name: '', group: '', replaces: '', data: '{' }, '')).toBeNull();
  });
});

describe('post', () => {
  it('põe no fim as fotos que a IA esqueceu, sem repetir', () => {
    expect(ordemCompleta([2, 2, 9, 0], 4)).toEqual([2, 0, 1, 3]);
  });

  it('aplica os textos novos por índice', () => {
    const m = { id: 'a', nome: '', grupo: 'Feed', ajuda: '', fotos: 1, cresce: false, textos: ['x', 'y'] };
    expect(textosFinais(m, { modeloId: 'a', textos: [{ indice: 1, texto: 'z' }], ordemFotos: [], filtro: null, explicacao: '' })).toEqual(['x', 'z']);
  });
});

describe('site', () => {
  it('lê o cookie da sessão do Set-Cookie', () => {
    expect(cookieDaSessao('vm_sessao=abc.def; path=/; httponly')).toBe('abc.def');
    expect(cookieDaSessao('outro=1')).toBeNull();
  });

  it('faz slug sem acento', () => {
    expect(slug('Topo de Bolo Unicórnio!')).toBe('topo-de-bolo-unicornio');
  });

  it('sem as variáveis do painel, o site fica desligado', () => {
    expect(siteConfig({})).toBeNull();
    expect(siteConfig({ VIIH_PAINEL_URL: 'https://x/', VIIH_PAINEL_LOGIN: 'v', VIIH_PAINEL_SENHA: 's' })).toEqual({ url: 'https://x', login: 'v', senha: 's' });
  });
});
