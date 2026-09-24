/** Estilos da área de trabalho do Editor de Imagens, no molde do Illustrator
 * e do Inkscape: um "cromo" neutro derivado do tema, botões e campos
 * compactos, dicas ricas, dock de painéis, barra de status e palco sobre a
 * área de rascunho. Valem pros quatro modos (Print & Cut, Molde SVG, Redes
 * sociais e Ilustração), por isso ficam sem encapsulamento, com prefixo
 * `il-`, em dois componentes renderizados uma vez pela página — dois só pra
 * cada um caber no orçamento de CSS por componente. */

import { Component, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'il-studio-base-styles',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  template: '',
  styles: [`
    /* ---- tokens da área de trabalho: um "cromo" neutro derivado do tema ---- */
    .il-studio, .il-appbar {
      --il-chrome: color-mix(in srgb, var(--text) 3%, var(--bg));
      --il-chrome-2: color-mix(in srgb, var(--text) 6%, var(--bg));
      --il-field: var(--bg);
      --il-line: color-mix(in srgb, var(--text) 11%, transparent);
      --il-line-strong: color-mix(in srgb, var(--text) 24%, transparent);
      --il-hover: color-mix(in srgb, var(--text) 7%, transparent);
      --il-active: color-mix(in srgb, var(--il-blue) 16%, transparent);
      --il-paste: color-mix(in srgb, var(--text) 12%, var(--bg));
      --il-blue: #2d7ff9;
      font: 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; color: var(--text);
    }
    .il-studio { height: 100%; min-height: 0; overflow: hidden; position: relative; background: var(--il-chrome); }
    .il-studio button, .il-appbar button { font: inherit; cursor: pointer; }
    .il-studio button:disabled, .il-appbar button:disabled { cursor: default; }

    /* ---- barra de controle ---- */
    .il-controlbar {
      grid-area: control; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-height: 38px; padding: 4px 8px;
      background: var(--il-chrome); border-bottom: 1px solid var(--il-line); z-index: 4;
    }
    .il-cb-group { display: flex; align-items: center; gap: 3px; padding-right: 6px; border-right: 1px solid var(--il-line); }
    .il-cb-kind { font-weight: 700; padding: 0 6px 0 2px; min-width: 72px; white-space: nowrap; }
    .il-cb-label { color: var(--text-muted); font-size: 11px; padding: 0 3px; }
    .il-cb-hint { color: var(--text-muted); font-size: 11px; padding-left: 4px; }
    .il-cb-font { width: 150px; }
    .il-controlbar .il-num input { width: 38px; }

    /* ---- primitivos ---- */
    .il-ib {
      position: relative; display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 4px;
      border: 1px solid transparent; border-radius: 4px; background: none; color: var(--text);
    }
    .il-ib:hover:not(:disabled) { background: var(--il-hover); }
    .il-ib:disabled { opacity: 0.35; }
    .il-ib.il-on { background: var(--il-active); color: var(--il-blue); }
    .il-ib.il-danger:hover:not(:disabled) { color: var(--danger); }
    .il-ib-sm { min-width: 22px; height: 22px; }
    .il-ib-lg { min-width: 32px; height: 32px; }
    .il-txt { font-size: 10px; font-weight: 700; }
    .il-btn {
      position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 26px; padding: 0 10px;
      font-size: 12px; color: var(--text); background: var(--il-field); border: 1px solid var(--il-line-strong); border-radius: 4px;
    }
    .il-btn:hover:not(:disabled) { border-color: var(--text-muted); }
    .il-btn:disabled { opacity: 0.45; }
    .il-btn.il-danger:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); }
    .il-btn.il-primary { background: var(--il-blue); border-color: var(--il-blue); color: #fff; }
    .il-btn.il-primary:hover:not(:disabled) { filter: brightness(1.08); border-color: var(--il-blue); }
    .il-btn.il-on { background: var(--il-active); border-color: var(--il-blue); color: var(--il-blue); }
    .il-btn.il-wide { width: 100%; }
    .il-grow { flex: 1; }
    .il-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .il-row-tight { gap: 1px; }
    .il-sep { width: 1px; height: 18px; background: var(--il-line); margin: 0 4px; }
    .il-num { display: inline-flex; align-items: center; height: 24px; background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px; min-width: 0; }
    .il-num:focus-within { border-color: var(--il-blue); }
    .il-num-label { padding: 0 3px 0 6px; font-size: 11px; color: var(--text-muted); cursor: ew-resize; user-select: none; white-space: nowrap; touch-action: none; }
    .il-num-label:hover { color: var(--text); }
    .il-num input { width: 46px; min-width: 0; flex: 1; height: 100%; border: none; background: none; color: var(--text); font: 12px inherit; font-variant-numeric: tabular-nums; padding: 0 2px; outline: none; }
    .il-num-unit { padding-right: 6px; font-size: 10px; color: var(--text-muted); }
    .il-select { height: 24px; padding: 0 4px; font: inherit; color: var(--text); background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px; }
    .il-check { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text); }
    .il-check input { accent-color: var(--il-blue); margin: 0; }
    .il-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-muted); }
    .il-field input { height: 26px; padding: 0 7px; font: inherit; font-size: 12px; color: var(--text); background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px; }
    .il-note { margin: 0; font-size: 11px; line-height: 1.45; color: var(--text-muted); }
    .il-error { margin: 0; font-size: 11.5px; color: var(--danger); }
    .il-swatch-btn { position: relative; width: 26px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; border-radius: 4px; }
    .il-swatch-btn:hover { background: var(--il-hover); }
    .il-sw { width: 18px; height: 18px; border: 1px solid var(--il-line-strong); border-radius: 2px; }
    .il-sw-stroke { background: var(--il-field); box-shadow: inset 0 0 0 4px var(--c, transparent); }
    .il-sw-none { background: #fff linear-gradient(to top left, transparent calc(50% - 1px), #e5484d calc(50% - 1px), #e5484d calc(50% + 1px), transparent calc(50% + 1px)) !important; box-shadow: none; }
    .il-hidden-color { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

    /* ---- dicas (como as dicas ricas da Adobe: nome, atalho, e o que faz) ---- */
    @media (hover: hover) {
      .il-studio [data-tip]:hover::after {
        content: attr(data-tip); position: absolute; z-index: 90; top: calc(100% + 6px); left: 50%; transform: translateX(-50%);
        padding: 4px 8px; white-space: pre; font-size: 11px; font-weight: 500; line-height: 1.4; text-align: left;
        color: #f2f2f2; background: #262626; border-radius: 4px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        pointer-events: none; animation: il-tip 0.12s 0.35s both;
      }
      .il-toolbar [data-tip]:hover::after, .il-tools-col [data-tip]:hover::after { top: 50%; left: calc(100% + 10px); transform: translateY(-50%); content: attr(data-tip) '\\A' attr(data-help); }
      .il-toolbar [data-tip]:not([data-help]):hover::after, .il-tools-col [data-tip]:not([data-help]):hover::after { content: attr(data-tip); }
      .il-dock [data-tip]:hover::after, .il-status [data-tip]:hover::after { left: auto; right: 0; transform: none; }
      .il-status [data-tip]:hover::after { top: auto; bottom: calc(100% + 6px); }
    }
    @keyframes il-tip { from { opacity: 0; } to { opacity: 1; } }

    /* ---- barra de status ---- */
    .il-status {
      grid-area: status; display: flex; align-items: center; gap: 10px; padding: 0 6px; font-size: 11px; color: var(--text-muted);
      background: var(--il-chrome-2); border-top: 1px solid var(--il-line); min-width: 0;
    }
    .il-status-zoom { display: flex; align-items: center; gap: 1px; }
    .il-status-zoom .il-num { height: 20px; }
    .il-status-zoom .il-num input { width: 36px; font-size: 11px; }
    .il-status-pos { min-width: 124px; font-variant-numeric: tabular-nums; }
    .il-status-msg { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .il-status-info { max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }


  `],
})
export class IlStudioBaseStylesComponent {}

@Component({
  selector: 'il-studio-chrome-styles',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  template: '',
  styles: [`
    /* ---- dock de painéis ---- */
    .il-dock { grid-area: dock; display: flex; flex-direction: column; min-height: 0; background: var(--il-chrome); border-left: 1px solid var(--il-line); }
    .il-tabs { display: flex; border-bottom: 1px solid var(--il-line); background: var(--il-chrome-2); flex-shrink: 0; }
    .il-tab {
      flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 30px; padding: 0 8px; white-space: nowrap;
      border: none; border-right: 1px solid var(--il-line); background: none; color: var(--text-muted); font-size: 11px; font-weight: 600;
    }
    .il-tab:last-child { border-right: none; }
    .il-tab:hover { color: var(--text); }
    .il-tab.il-on { background: var(--il-chrome); color: var(--text); box-shadow: inset 0 2px 0 var(--il-blue); }
    .il-tab-body { flex: 1; min-height: 0; overflow-y: auto; }
    .il-tab-body.il-tab-fill { display: flex; flex-direction: column; overflow: hidden; }
    .il-sec { border-bottom: 1px solid var(--il-line); }
    .il-sec-head {
      width: 100%; display: flex; align-items: center; gap: 5px; padding: 8px 10px; border: none; background: none;
      color: var(--text); font-size: 11px; font-weight: 700; text-align: left; letter-spacing: 0.01em;
    }
    .il-sec-head small { font-weight: 500; color: var(--text-muted); margin-left: 4px; }
    .il-sec-head il-icon { color: var(--text-muted); transition: transform 0.12s; }
    .il-sec.il-closed .il-sec-head il-icon { transform: rotate(-90deg); }
    .il-sec.il-closed .il-sec-body { display: none; }
    .il-sec-static { cursor: default; }
    .il-sec-body { display: flex; flex-direction: column; gap: 7px; padding: 0 10px 10px; }
    .il-sec-body-top { padding-top: 10px; }
    .il-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
    .il-chips { display: flex; flex-wrap: wrap; gap: 3px; }
    .il-chip { padding: 3px 8px; border-radius: 999px; border: 1px solid var(--il-line); background: none; color: var(--text-muted); font-size: 11px; }
    .il-chip:hover { color: var(--text); border-color: var(--il-line-strong); }
    .il-chip.il-on { color: var(--text); border-color: var(--text); }
    .il-swatches { display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; }
    .il-swatch { aspect-ratio: 1; width: 100%; padding: 0; border: 1px solid var(--il-line-strong); border-radius: 2px; }
    .il-swatch:hover { outline: 2px solid var(--il-blue); outline-offset: 1px; }
    .il-textarea { width: 100%; min-height: 48px; resize: vertical; padding: 5px 7px; font: 13px var(--font-body, inherit); color: var(--text); background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px; }
    .il-textarea:focus { outline: none; border-color: var(--il-blue); }
    .il-seg { display: inline-flex; border: 1px solid var(--il-line); border-radius: 4px; overflow: hidden; }
    .il-seg button { width: 28px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: none; border-right: 1px solid var(--il-line); background: var(--il-field); color: var(--text); }
    .il-seg button:last-child { border-right: none; }
    .il-seg button.il-on { background: var(--il-active); color: var(--il-blue); }
    .il-seg button:disabled { opacity: 0.35; }
    .il-range { display: grid; grid-template-columns: 64px 1fr 38px; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); }
    .il-range input { width: 100%; accent-color: var(--il-blue); }
    .il-range b { font-weight: 600; color: var(--text); text-align: right; font-variant-numeric: tabular-nums; }
    .il-suggest { color: var(--il-blue); }
    .il-drop {
      display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 20px 12px; text-align: center;
      background: var(--il-field); border: 1.5px dashed var(--il-line-strong); border-radius: 6px; color: var(--text-muted); font-size: 11px; line-height: 1.45;
    }
    .il-drop strong { color: var(--text); font-size: 12px; }
    .il-drop:hover { border-color: var(--il-blue); color: var(--text); }
    .il-trace-status { margin: 8px 10px; font-size: 11px; color: var(--text-muted); line-height: 1.45; }
    .il-trace-status.il-busy { color: var(--il-blue); }
    .il-export-list { display: flex; flex-direction: column; padding: 6px; gap: 2px; }
    .il-export { display: flex; align-items: center; gap: 10px; padding: 8px 8px; border: none; border-radius: 4px; background: none; color: var(--text); text-align: left; }
    .il-export:hover:not(:disabled) { background: var(--il-hover); }
    .il-export:disabled { opacity: 0.45; }
    .il-export span { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .il-export strong { font-size: 12px; }
    .il-export small { font-size: 10.5px; color: var(--text-muted); line-height: 1.35; }
    .il-link { display: inline-flex; align-items: center; gap: 5px; margin: 10px; padding: 0; border: none; background: none; color: var(--text-muted); font-size: 11px; }
    .il-link:hover { color: var(--text); }

    /* ---- layout padrão dos modos (sem réguas) ---- */
    .il-basic {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) 304px;
      grid-template-rows: auto minmax(0, 1fr) 26px;
      grid-template-areas: "control control control" "tools canvas dock" "status status status";
    }
    .il-tools-col {
      grid-area: tools; display: flex; flex-direction: column; align-items: center; padding: 6px 0;
      background: var(--il-chrome); border-right: 1px solid var(--il-line); z-index: 3;
    }
    .il-tools-col .il-tb-group { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; border-bottom: 1px solid var(--il-line); }
    .il-tools-col .il-tb-group:last-child { border-bottom: none; }
    .il-tool {
      position: relative; width: 32px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
      border: none; border-radius: 4px; background: none; color: var(--text);
    }
    .il-tool:hover:not(:disabled) { background: var(--il-hover); }
    .il-tool.il-on { background: var(--il-active); box-shadow: inset 0 0 0 1px var(--il-line-strong); }
    .il-tool:disabled { opacity: 0.35; }
    .il-stage {
      grid-area: canvas; position: relative; display: flex; overflow: auto; padding: 24px; min-width: 0; min-height: 0;
      background: var(--il-paste); overscroll-behavior: contain;
    }
    .il-stage.il-drag-over { outline: 2px dashed var(--il-blue); outline-offset: -6px; }
    .il-checker { background: #fff repeating-conic-gradient(rgba(0, 0, 0, 0.07) 0 25%, transparent 0 50%) 0 0 / 16px 16px; }
    .il-paper { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2); }
    .il-empty {
      margin: auto; display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: 400px; padding: 28px 24px;
      text-align: center; line-height: 1.5; color: var(--text-muted); background: var(--il-chrome);
      border: 1.5px dashed var(--il-line-strong); border-radius: 8px; cursor: pointer;
    }
    .il-empty strong { color: var(--text); font-size: 13px; }
    .il-empty:hover, .il-drag-over .il-empty { border-color: var(--il-blue); color: var(--text); }
    .il-item { display: flex; align-items: center; gap: 6px; min-height: 38px; padding: 3px 8px; border-bottom: 1px solid var(--il-line); }
    .il-item:hover { background: var(--il-hover); }
    .il-item.il-on { background: var(--il-active); }
    .il-item-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0; border: none; background: none; color: var(--text); text-align: left; }
    .il-item-thumb { width: 30px; height: 30px; object-fit: contain; flex-shrink: 0; border: 1px solid var(--il-line); border-radius: 3px; }
    .il-item-text { display: flex; flex-direction: column; min-width: 0; }
    .il-item-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .il-item-sub { font-size: 10.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .il-item-input { flex: 1; min-width: 0; height: 24px; padding: 0 5px; font: inherit; font-size: 12px; color: var(--text); background: transparent; border: 1px solid transparent; border-radius: 3px; }
    .il-item-input:hover { border-color: var(--il-line); }
    .il-item-input:focus { border-color: var(--il-blue); background: var(--il-field); outline: none; }
    .il-badge { flex-shrink: 0; font-size: 10px; font-weight: 700; color: var(--text-muted); padding: 1px 6px; border: 1px solid var(--il-line); border-radius: 999px; }
    .il-color-input { width: 28px; height: 22px; padding: 0; border: 1px solid var(--il-line-strong); border-radius: 3px; background: none; cursor: pointer; }
    .il-warn { color: var(--danger); }

    @media (max-width: 900px) {
      .il-basic { display: flex; flex-direction: column; height: auto; overflow: visible; }
      .il-basic > .il-controlbar { order: 1; }
      .il-basic > .il-tools-col { order: 2; flex-direction: row; overflow-x: auto; border-right: none; border-bottom: 1px solid var(--il-line); padding: 0 4px; }
      .il-tools-col .il-tb-group { flex-direction: row; border-bottom: none; border-right: 1px solid var(--il-line); padding: 0 3px; }
      .il-basic > .il-stage { order: 3; height: 56dvh; padding: 12px; }
      .il-basic > .il-status { order: 4; flex-wrap: wrap; height: auto; padding: 4px 6px; }
      .il-basic > .il-dock { order: 5; border-left: none; border-top: 1px solid var(--il-line); }
      .il-basic .il-tab-body { overflow: visible; }
      .il-tool { width: 38px; height: 36px; }
    }

  `],
})
export class IlStudioChromeStylesComponent {}
