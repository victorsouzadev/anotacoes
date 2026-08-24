import { describe, expect, it } from 'vitest';
import { NEW_PHOTO_DEFAULTS, TemplateStore } from './template-store';
import { TemplateSlot } from './svg-template';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
  <circle id="foto1" cx="90" cy="100" r="70" />
  <rect id="janela" x="190" y="40" width="90" height="120" />
</svg>`;

function slot(id: string, elId: string): TemplateSlot {
  return { id, elId, label: id, rect: { x: 0, y: 0, w: 100, h: 100 }, transform: '' };
}

/** Os encaixes normalmente vêm de medir o SVG na tela; em jsdom não há layout,
 * então aqui eles são postos na mão. */
function storeComMolde(): TemplateStore {
  const store = new TemplateStore();
  const parsed = store.loadSvgText(SVG, 'molde.svg');
  store.slots.set([slot('s1', `${parsed.idPrefix}foto1`), slot('s2', `${parsed.idPrefix}janela`)]);
  return store;
}

function addFoto(store: TemplateStore, slotId: string, name: string): string {
  return store.addPhoto(slotId, { ...NEW_PHOTO_DEFAULTS, name, src: `data:${name}`, naturalW: 400, naturalH: 200 });
}

describe('TemplateStore', () => {
  it('a foto nova entra no topo da pilha e já fica selecionada', () => {
    const store = storeComMolde();
    const primeira = addFoto(store, 's1', 'a');
    const segunda = addFoto(store, 's1', 'b');
    expect(store.selectedPhotoId()).toBe(segunda);
    expect(store.stack().map((p) => p.id)).toEqual([segunda, primeira]);
  });

  it('várias fotos cabem no mesmo encaixe', () => {
    const store = storeComMolde();
    addFoto(store, 's1', 'a');
    addFoto(store, 's1', 'b');
    addFoto(store, 's2', 'c');
    expect(store.photosOfSlot('s1').length).toBe(2);
    expect(store.photosOfSlot('s2').length).toBe(1);
  });

  it('reordenar renumera z sem empate', () => {
    const store = storeComMolde();
    const a = addFoto(store, 's1', 'a');
    const b = addFoto(store, 's1', 'b');
    const c = addFoto(store, 's1', 'c');
    store.reorder(c, 'fundo');
    expect(store.stack().map((p) => p.id)).toEqual([b, a, c]);
    store.reorder(c, 'topo');
    expect(store.stack().map((p) => p.id)).toEqual([c, b, a]);
    store.reorder(c, 'tras');
    expect(store.stack().map((p) => p.id)).toEqual([b, c, a]);
    const zs = store.photos().map((p) => p.z).sort();
    expect(new Set(zs).size).toBe(3);
  });

  it('mover além das pontas não faz nada', () => {
    const store = storeComMolde();
    const a = addFoto(store, 's1', 'a');
    const b = addFoto(store, 's1', 'b');
    store.reorder(b, 'frente');
    expect(store.stack().map((p) => p.id)).toEqual([b, a]);
    store.reorder(a, 'tras');
    expect(store.stack().map((p) => p.id)).toEqual([b, a]);
  });

  it('remover o encaixe leva junto as fotos dele', () => {
    const store = storeComMolde();
    addFoto(store, 's1', 'a');
    const c = addFoto(store, 's2', 'c');
    store.removeSlot('s1');
    expect(store.photos().map((p) => p.id)).toEqual([c]);
    expect(store.emptySlotIds().has('s2')).toBe(false);
  });

  it('reenquadrar zera o ajuste e preserva opacidade e ordem', () => {
    const store = storeComMolde();
    const a = addFoto(store, 's1', 'a');
    store.patchPhoto(a, { scale: 3, dx: 20, rotation: 45, flipX: true, opacity: 0.4 });
    store.reframe(a);
    const foto = store.photos()[0];
    expect([foto.scale, foto.dx, foto.rotation, foto.flipX]).toEqual([1, 0, 0, false]);
    expect(foto.opacity).toBe(0.4);
    expect(foto.z).toBe(1);
  });

  it('salvar e reabrir preserva as camadas e reaponta os encaixes pros ids novos', () => {
    const store = storeComMolde();
    addFoto(store, 's1', 'a');
    addFoto(store, 's1', 'b');
    store.patchPhoto(store.photos()[1].id, { opacity: 0.5, depth: 'atras' });
    const data = store.serialize()!;

    const outro = new TemplateStore();
    outro.hydrate(data);
    // O prefixo dos ids é sorteado a cada parse: os encaixes têm que acompanhar.
    const prefixo = outro.parsed()!.idPrefix;
    expect(outro.slots().map((s) => s.elId)).toEqual([`${prefixo}foto1`, `${prefixo}janela`]);
    expect(outro.slots().every((s) => outro.parsed()!.root.querySelector(`[id="${s.elId}"]`))).toBe(true);
    expect(outro.photos().length).toBe(2);
    expect(outro.photos()[1].opacity).toBe(0.5);
    expect(outro.photos()[1].depth).toBe('atras');
  });

  it('altura acompanha a proporção do molde', () => {
    const store = storeComMolde();
    store.widthMm.set(150);
    expect(store.heightMm()).toBe(100);
  });
});
