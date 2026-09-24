import { SocialModeComponent } from './social-mode';

describe('host do modo social', () => {
  it('é a própria área de trabalho, com a grade de ferramentas, palco e dock', () => {
    // Antes o host precisava sumir da grade da página (display: contents) pra
    // prévia e painel virarem as duas colunas dela. Agora cada modo é a área de
    // trabalho inteira: a grade mora no host, pelas classes `il-studio il-basic`.
    // Sem elas, ferramentas, palco, dock e barra de status empilhariam.
    const hostAttrs = (SocialModeComponent as unknown as { ɵcmp: { hostAttrs: unknown[] | null } }).ɵcmp.hostAttrs ?? [];
    const classes = hostAttrs.filter((a): a is string => typeof a === 'string');
    expect(classes).toContain('il-studio');
    expect(classes).toContain('il-basic');

    const styles: string[] = (SocialModeComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles;
    expect(styles.some((s) => /display:\s*contents/.test(s))).toBe(false);
  });
});
