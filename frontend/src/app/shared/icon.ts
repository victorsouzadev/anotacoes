import { Component, Input } from '@angular/core';

export type IconName =
  | 'select' | 'pan' | 'pen' | 'eraser-stroke' | 'eraser-area'
  | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'sticky' | 'checklist'
  | 'undo' | 'redo' | 'zoom-in' | 'zoom-out' | 'fit-to-screen'
  | 'duplicate' | 'delete' | 'bring-to-front' | 'send-to-back'
  | 'download' | 'more'
  | 'folder' | 'search' | 'edit' | 'grid-view' | 'list-view'
  | 'sun' | 'moon' | 'monitor' | 'plus' | 'logout';

/** Conjunto de ícones da própria app — sem dependência externa (nenhuma lib de
 * ícones no projeto). Um único componente com switch em vez de SVG inline em cada
 * botão, pra não duplicar markup e manter espessura/estilo de traço consistentes. */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round">
      @switch (name) {
        @case ('select') { <path d="M4 3l11 8.5-4.6.7 2.2 4.6-2 1-2.2-4.6-3.4 3z" /> }
        @case ('pan') {
          <path d="M7.3 10V4.6a1.2 1.2 0 0 1 2.4 0V9m0-.7V3.4a1.2 1.2 0 0 1 2.4 0V9m0-.4V5a1.2 1.2 0 0 1 2.4 0v6c0 2.8-1.9 5.2-4.6 5.2-1.9 0-3-.7-4.1-2.4l-1.9-3a1.1 1.1 0 0 1 1.8-1.2L7.3 12" />
        }
        @case ('pen') { <path d="M12.5 3.3l4.2 4.2L6.4 17.8H2.2v-4.2z" /><path d="M11 4.8l4.2 4.2" /> }
        @case ('eraser-stroke') { <path d="M4 13.5l6.5-6.5 6 6-4.5 4.5H8z" /><path d="M8 17.5H3.5" /> }
        @case ('eraser-area') { <rect x="3" y="6.5" width="13" height="8.5" rx="1.8" transform="rotate(-9 9.5 10.75)" /><path d="M2.7 13l14-2.4" /> }
        @case ('rect') { <rect x="3.2" y="4.5" width="13.6" height="11" rx="1.4" /> }
        @case ('ellipse') { <ellipse cx="10" cy="10" rx="6.8" ry="5.5" /> }
        @case ('line') { <path d="M4 16L16 4" /> }
        @case ('arrow') { <path d="M3.3 16.7L16 4" /><path d="M9 4h7v7" /> }
        @case ('text') { <path d="M4.5 5.2h11M10 5.2v10.6" /> }
        @case ('sticky') { <path d="M4 3.2h8.8l4 4v9.6H4z" /><path d="M12.8 3.2v4h4" /> }
        @case ('checklist') {
          <path d="M8.2 5.3h8M8.2 10h8M8.2 14.7h8" />
          <path d="M3 5.3l1 1 1.8-1.8M3 10l1 1 1.8-1.8M3 14.7l1 1 1.8-1.8" />
        }
        @case ('undo') { <path d="M6.2 5.3L3 8.5l3.2 3.2" /><path d="M3 8.5h9a4 4 0 0 1 0 8h-2.2" /> }
        @case ('redo') { <path d="M13.8 5.3L17 8.5l-3.2 3.2" /><path d="M17 8.5H8a4 4 0 0 0 0 8h2.2" /> }
        @case ('zoom-in') { <circle cx="8.5" cy="8.5" r="5.3" /><path d="M14.3 14.3L18 18M8.5 6v5M6 8.5h5" /> }
        @case ('zoom-out') { <circle cx="8.5" cy="8.5" r="5.3" /><path d="M14.3 14.3L18 18M6 8.5h5" /> }
        @case ('fit-to-screen') { <path d="M3 7.5V3h4.5M17 7.5V3h-4.5M3 12.5V17h4.5M17 12.5V17h-4.5" /> }
        @case ('duplicate') { <rect x="3" y="6.5" width="9.5" height="10.3" rx="1.4" /><path d="M6.8 6.5V4.7A1.7 1.7 0 0 1 8.5 3H15a1.7 1.7 0 0 1 1.7 1.7v6.5A1.7 1.7 0 0 1 15 13" /> }
        @case ('delete') { <path d="M4 6.2h12M8 6.2V4.3h4v1.9" /><path d="M5.8 6.2l.9 10.5h6.6l.9-10.5" /> }
        @case ('bring-to-front') { <rect x="6.8" y="2.2" width="9.5" height="9.5" rx="1.4" /><path d="M3.2 7.7v8.4a1.7 1.7 0 0 0 1.7 1.7h8.4" /> }
        @case ('send-to-back') { <rect x="3.2" y="7.7" width="9.5" height="9.5" rx="1.4" /><path d="M7.7 3.4A1.7 1.7 0 0 1 9.4 1.7H15a1.7 1.7 0 0 1 1.7 1.7v5.6" /> }
        @case ('download') { <path d="M10 3v9.4m0 0l-3.6-3.6M10 12.4l3.6-3.6" /><path d="M4 15.5h12" /> }
        @case ('more') { <circle cx="4.2" cy="10" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="15.8" cy="10" r="1.3" /> }
        @case ('folder') { <path d="M2.5 5.3a1.3 1.3 0 0 1 1.3-1.3h3.6l1.6 1.8h7.2a1.3 1.3 0 0 1 1.3 1.3v7.6a1.3 1.3 0 0 1-1.3 1.3H3.8a1.3 1.3 0 0 1-1.3-1.3z" /> }
        @case ('search') { <circle cx="8.6" cy="8.6" r="5.4" /><path d="M12.6 12.6L17.5 17.5" /> }
        @case ('edit') { <path d="M12.8 3.5l3.7 3.7L6.7 17H3v-3.7z" /><path d="M11.3 5l3.7 3.7" /> }
        @case ('grid-view') {
          <rect x="2.7" y="2.7" width="6" height="6" rx="1.1" />
          <rect x="11.3" y="2.7" width="6" height="6" rx="1.1" />
          <rect x="2.7" y="11.3" width="6" height="6" rx="1.1" />
          <rect x="11.3" y="11.3" width="6" height="6" rx="1.1" />
        }
        @case ('list-view') {
          <path d="M7 5h10M7 10h10M7 15h10" />
          <path d="M3 5h.01M3 10h.01M3 15h.01" stroke-width="2.4" />
        }
        @case ('sun') {
          <circle cx="10" cy="10" r="3.4" />
          <path d="M10 2.3v2M10 15.7v2M17.7 10h-2M4.3 10h-2M15.4 4.6l-1.4 1.4M6 12.6l-1.4 1.4M15.4 15.4l-1.4-1.4M6 7.4L4.6 6" />
        }
        @case ('moon') { <path d="M16.5 12.3A6.8 6.8 0 0 1 7.7 3.5a6.8 6.8 0 1 0 8.8 8.8z" /> }
        @case ('monitor') { <rect x="2.5" y="3.8" width="15" height="10" rx="1.4" /><path d="M7 17h6M10 13.8V17" /> }
        @case ('plus') { <path d="M10 4v12M4 10h12" /> }
        @case ('logout') { <path d="M8 3.5H4.7a1.2 1.2 0 0 0-1.2 1.2v10.6a1.2 1.2 0 0 0 1.2 1.2H8" /><path d="M8.5 10h8m0 0l-3-3m3 3l-3 3" /> }
      }
    </svg>
  `,
  host: {
    '[style.width.px]': 'size',
    '[style.height.px]': 'size',
  },
  styles: [`
    :host { display: inline-flex; flex-shrink: 0; }
    svg { width: 100%; height: 100%; }
  `],
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() size = 20;
}
