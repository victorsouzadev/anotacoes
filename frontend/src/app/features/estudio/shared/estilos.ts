/**
 * Estilos comuns das telas do Estúdio. Os componentes são isolados (encapsulamento do Angular),
 * então cada um inclui esta folha em `styles`. Usa só os tokens do tema do hub (--bg, --surface,
 * --accent…), para valer em todos os temas e no modo escuro.
 */
export const ESTUDIO_CSS = `
  :host { color: var(--text); }
  .e-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 34px; padding: 0 14px; border-radius: var(--radius-sm);
    border: 1px solid var(--border); background: var(--surface); color: var(--text);
    font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap;
  }
  .e-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .e-btn:disabled { opacity: .5; cursor: not-allowed; }
  .e-btn.e-pri { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
  .e-btn.e-pri:hover:not(:disabled) { background: var(--accent-dark); color: var(--accent-contrast); }
  .e-btn.e-sm { height: 28px; padding: 0 10px; font-size: 12px; }
  .e-btn.e-perigo:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
  .e-ib {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: var(--radius-sm);
    border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
  }
  .e-ib:hover { border-color: var(--accent); color: var(--accent); }
  .e-campo { display: flex; flex-direction: column; gap: 6px; }
  .e-campo > span { font-size: 12px; font-weight: 600; color: var(--text-muted); }
  .e-input, .e-select, .e-textarea {
    width: 100%; border: 1px solid var(--border); background: var(--bg); color: var(--text);
    border-radius: var(--radius-sm); padding: 8px 10px; font: inherit; font-size: 14px;
  }
  .e-textarea { resize: vertical; min-height: 84px; line-height: 1.45; }
  .e-input:focus, .e-select:focus, .e-textarea:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
  .e-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .e-chip {
    height: 30px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--border);
    background: var(--surface); font-size: 12px; font-weight: 600; color: var(--text-muted);
  }
  .e-chip.e-on { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
  .e-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .e-muted { color: var(--text-muted); }
  .e-erro { color: var(--danger); font-size: 13px; }
  .e-vazio { padding: 40px 16px; text-align: center; color: var(--text-muted); font-size: 14px; }
  .e-grid-midias { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .e-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--tag-bg); color: var(--tag-text); font-size: 11px; font-weight: 600; }
  .e-titulo { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
  .e-sub { font-size: 13px; color: var(--text-muted); margin: 4px 0 0; }
  @media (max-width: 760px) { .e-grid-midias { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); } }
`;
