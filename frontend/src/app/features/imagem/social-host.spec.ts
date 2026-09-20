import { SocialModeComponent } from './social-mode';

describe('host do modo social', () => {
  it('some da grade da página, em vez de virar um item só', () => {
    const styles: string[] = (SocialModeComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles;
    const host = styles.find((s) => s.includes('display:contents') || s.includes('display: contents'));
    expect(host).toBeDefined();
    // O seletor tem de mirar o próprio elemento. Escrito como nome de tag, o
    // escopo por atributo o transforma em algo que não casa com nada — foi o
    // que empilhou prévia e painel e estourou a largura no celular.
    expect(host).toMatch(/_nghost|:host/);
    expect(host).not.toMatch(/app-social-mode\[/);
  });
});
