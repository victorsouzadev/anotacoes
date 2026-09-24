/** Ícones da área de trabalho do modo Ilustração. Os do app (`app-icon`) são
 * de uso geral; um editor vetorial precisa do vocabulário próprio dos editores
 * (seleção direta, Pathfinder, alinhar à borda, nós…), desenhado no mesmo
 * traço pra conversar com o resto. */

import { Component, input } from '@angular/core';

export type IlIconName =
  | 'select' | 'direct' | 'pen' | 'text' | 'rect' | 'ellipse' | 'star' | 'polygon' | 'eyedropper' | 'hand' | 'zoom'
  | 'undo' | 'redo' | 'swap' | 'default-colors' | 'none'
  | 'eye' | 'eye-off' | 'lock' | 'unlock' | 'layers' | 'properties' | 'trace' | 'export' | 'artboard'
  | 'plus' | 'trash' | 'copy' | 'group' | 'ungroup' | 'front' | 'back' | 'forward' | 'backward'
  | 'flip-h' | 'flip-v' | 'link' | 'unlink'
  | 'align-left' | 'align-hcenter' | 'align-right' | 'align-top' | 'align-vcenter' | 'align-bottom' | 'dist-h' | 'dist-v'
  | 'unite' | 'minus-front' | 'intersect' | 'exclude' | 'offset' | 'break-apart' | 'to-path' | 'letters'
  | 'text-left' | 'text-center' | 'text-right' | 'text-straight' | 'text-arc' | 'text-path'
  | 'node-smooth' | 'node-corner' | 'node-add' | 'node-delete'
  | 'chevron' | 'fit' | 'keyboard' | 'image' | 'x' | 'search' | 'upload' | 'magnet' | 'panels' | 'cut';

@Component({
  selector: 'il-icon',
  standalone: true,
  host: { class: 'il-icon', '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (name()) {
        @case ('select') { <path d="M5 2.8v13.4l3.4-3.3 2.4 4.9 2-1-2.4-4.8 4.6-.4z" fill="currentColor" /> }
        @case ('direct') { <path d="M5 2.8v13.4l3.4-3.3 2.4 4.9 2-1-2.4-4.8 4.6-.4z" /><rect x="13.5" y="13.5" width="3.5" height="3.5" fill="currentColor" stroke="none" /> }
        @case ('pen') { <path d="M10 2.5l4.5 7-2 5.5h-5l-2-5.5z" /><path d="M10 2.5V9" /><circle cx="10" cy="10" r="1" /><path d="M7 17.5h6" /> }
        @case ('text') { <path d="M4 4.5h12M10 4.5v11.5M7.5 16h5" /> }
        @case ('rect') { <rect x="3.5" y="4.5" width="13" height="11" rx="0.8" /> }
        @case ('ellipse') { <ellipse cx="10" cy="10" rx="6.8" ry="5.8" /> }
        @case ('star') { <path d="M10 2.8l2.1 4.5 4.8.6-3.5 3.3.9 4.8L10 13.6 5.7 16l.9-4.8L3.1 7.9l4.8-.6z" /> }
        @case ('polygon') { <path d="M10 2.8l6.3 3.6v7.2L10 17.2l-6.3-3.6V6.4z" /> }
        @case ('eyedropper') { <path d="M12.4 3.6a2 2 0 0 1 2.9 0l1.1 1.1a2 2 0 0 1 0 2.9l-1.6 1.6-4-4z" /><path d="M11 5.4l3.6 3.6-7.3 7.3H3.7v-3.6z" /> }
        @case ('hand') { <path d="M7.3 10V4.6a1.2 1.2 0 0 1 2.4 0V9m0-.7V3.4a1.2 1.2 0 0 1 2.4 0V9m0-.4V5a1.2 1.2 0 0 1 2.4 0v6c0 2.8-1.9 5.2-4.6 5.2-1.9 0-3-.7-4.1-2.4l-1.9-3a1.1 1.1 0 0 1 1.8-1.2L7.3 12" /> }
        @case ('zoom') { <circle cx="8.5" cy="8.5" r="5" /><path d="M12.2 12.2l4.6 4.6M6.5 8.5h4M8.5 6.5v4" /> }
        @case ('undo') { <path d="M7.5 5L4 8.5 7.5 12" /><path d="M4 8.5h8a4 4 0 0 1 0 8H9" /> }
        @case ('redo') { <path d="M12.5 5L16 8.5 12.5 12" /><path d="M16 8.5H8a4 4 0 0 0 0 8h3" /> }
        @case ('swap') { <path d="M5 8V6.5A2.5 2.5 0 0 1 7.5 4H13" /><path d="M11 2l2 2-2 2" /><path d="M15 12v1.5a2.5 2.5 0 0 1-2.5 2.5H7" /><path d="M9 18l-2-2 2-2" /> }
        @case ('default-colors') { <rect x="3" y="3" width="8" height="8" fill="#fff" stroke="currentColor" /><rect x="9" y="9" width="8" height="8" /><rect x="11.3" y="11.3" width="3.4" height="3.4" /> }
        @case ('none') { <rect x="3.5" y="3.5" width="13" height="13" /><path d="M4 16L16 4" stroke="#e5484d" stroke-width="1.8" /> }
        @case ('eye') { <path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z" /><circle cx="10" cy="10" r="2.5" /> }
        @case ('eye-off') { <path d="M3 3l14 14M8.3 5A8.6 8.6 0 0 1 10 4.5c5 0 8.2 5.5 8.2 5.5a14 14 0 0 1-2.4 3M5.5 6.5A13 13 0 0 0 1.8 10S5 15.5 10 15.5a7.6 7.6 0 0 0 3.3-.8" /> }
        @case ('lock') { <rect x="4.5" y="9" width="11" height="8" rx="1.2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /> }
        @case ('unlock') { <rect x="4.5" y="9" width="11" height="8" rx="1.2" /><path d="M7 9V6.5a3 3 0 0 1 5.8-1" /> }
        @case ('layers') { <path d="M10 3l7.5 4-7.5 4-7.5-4z" /><path d="M2.5 10.5l7.5 4 7.5-4" /><path d="M2.5 14l7.5 4 7.5-4" /> }
        @case ('properties') { <path d="M3 5h8M15 5h2M3 10h3M10 10h7M3 15h9M16 15h1" /><circle cx="13" cy="5" r="1.8" /><circle cx="8" cy="10" r="1.8" /><circle cx="14" cy="15" r="1.8" /> }
        @case ('trace') { <rect x="2.5" y="3.5" width="8" height="8" rx="1" /><path d="M4 9.5l2-2.2 1.6 1.5 1.4-1.3" /><path d="M11.5 16.5c2-4.5 3.5-5.5 6-5" /><path d="M12.5 7.5l2 2" /><circle cx="11.5" cy="16.5" r="1" fill="currentColor" /><circle cx="17.5" cy="11.5" r="1" fill="currentColor" /> }
        @case ('export') { <path d="M10 12.5V3M6.5 6.5L10 3l3.5 3.5" /><path d="M4 11v5h12v-5" /> }
        @case ('artboard') { <rect x="5" y="5" width="10" height="10" /><path d="M5 2v3M15 2v3M5 15v3M15 15v3M2 5h3M2 15h3M15 5h3M15 15h3" /> }
        @case ('plus') { <path d="M10 4v12M4 10h12" /> }
        @case ('trash') { <path d="M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l.8 11h8.4l.8-11" /><path d="M8.5 8.5v5M11.5 8.5v5" /> }
        @case ('copy') { <rect x="7" y="7" width="10" height="10" rx="1" /><path d="M13 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3" /> }
        @case ('group') { <rect x="2.5" y="2.5" width="15" height="15" stroke-dasharray="2 2" /><rect x="5" y="5" width="5" height="5" /><circle cx="12.5" cy="12.5" r="2.7" /> }
        @case ('ungroup') { <rect x="3" y="3" width="6" height="6" /><circle cx="13.5" cy="13.5" r="3" /><path d="M11 5h6M5 11v6" stroke-dasharray="1.5 1.5" /> }
        @case ('front') { <rect x="3" y="3" width="9" height="9" stroke-dasharray="2 1.5" /><rect x="8" y="8" width="9" height="9" fill="currentColor" /> }
        @case ('back') { <rect x="8" y="8" width="9" height="9" stroke-dasharray="2 1.5" /><rect x="3" y="3" width="9" height="9" fill="currentColor" /> }
        @case ('forward') { <path d="M10 15V4M6 8l4-4 4 4" /><path d="M4 17h12" /> }
        @case ('backward') { <path d="M10 3v11M6 10l4 4 4-4" /><path d="M4 17h12" /> }
        @case ('flip-h') { <path d="M10 2.5v15" stroke-dasharray="1.5 1.5" /><path d="M8 5L3 14h5z" fill="currentColor" /><path d="M12 5l5 9h-5z" /> }
        @case ('flip-v') { <path d="M2.5 10h15" stroke-dasharray="1.5 1.5" /><path d="M5 8l9-5v5z" fill="currentColor" /><path d="M5 12l9 5v-5z" /> }
        @case ('link') { <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9" /><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" /> }
        @case ('unlink') { <path d="M11.1 4.7l.9-.9a3 3 0 0 1 4.2 4.2l-.9.9M8.9 15.3l-.9.9a3 3 0 0 1-4.2-4.2l.9-.9" /><path d="M3 3l2 2M15 15l2 2M7 2.5v2M13 15.5v2" /> }
        @case ('align-left') { <path d="M3.5 2.5v15" /><rect x="6" y="5" width="10" height="3.5" /><rect x="6" y="11.5" width="6" height="3.5" /> }
        @case ('align-hcenter') { <path d="M10 2.5v15" /><rect x="4" y="5" width="12" height="3.5" /><rect x="6.5" y="11.5" width="7" height="3.5" /> }
        @case ('align-right') { <path d="M16.5 2.5v15" /><rect x="4" y="5" width="10" height="3.5" /><rect x="8" y="11.5" width="6" height="3.5" /> }
        @case ('align-top') { <path d="M2.5 3.5h15" /><rect x="5" y="6" width="3.5" height="10" /><rect x="11.5" y="6" width="3.5" height="6" /> }
        @case ('align-vcenter') { <path d="M2.5 10h15" /><rect x="5" y="4" width="3.5" height="12" /><rect x="11.5" y="6.5" width="3.5" height="7" /> }
        @case ('align-bottom') { <path d="M2.5 16.5h15" /><rect x="5" y="4" width="3.5" height="10" /><rect x="11.5" y="8" width="3.5" height="6" /> }
        @case ('dist-h') { <path d="M2.5 3v14M17.5 3v14" /><rect x="7.5" y="6" width="5" height="8" /> }
        @case ('dist-v') { <path d="M3 2.5h14M3 17.5h14" /><rect x="6" y="7.5" width="8" height="5" /> }
        @case ('unite') { <path d="M3 3h9v5h5v9H8v-5H3z" fill="currentColor" /> }
        @case ('minus-front') { <path d="M3 3h9v5H8v4H3z" fill="currentColor" /><rect x="8" y="8" width="9" height="9" stroke-dasharray="2 1.5" /> }
        @case ('intersect') { <rect x="3" y="3" width="9" height="9" stroke-dasharray="2 1.5" /><rect x="8" y="8" width="9" height="9" stroke-dasharray="2 1.5" /><rect x="8" y="8" width="4" height="4" fill="currentColor" /> }
        @case ('exclude') { <path d="M3 3h9v5H8v4H3zM12 8h5v9H8v-5h4z" fill="currentColor" /><rect x="8" y="8" width="4" height="4" /> }
        @case ('offset') { <rect x="6" y="6" width="8" height="8" rx="0.5" fill="currentColor" /><rect x="3" y="3" width="14" height="14" rx="3.5" stroke="#e53935" /> }
        @case ('break-apart') { <rect x="2.5" y="4" width="6" height="6" /><circle cx="14" cy="13" r="3.5" /><path d="M9.5 12.5l2-2" stroke-dasharray="1 1.5" /> }
        @case ('to-path') { <path d="M4 15C6 5 14 15 16 5" /><rect x="2.5" y="13.5" width="3" height="3" fill="currentColor" stroke="none" /><rect x="14.5" y="3.5" width="3" height="3" fill="currentColor" stroke="none" /> }
        @case ('letters') { <path d="M2.5 15l3-9 3 9M3.6 12h3.8" /><path d="M11.5 6v9h2.5a2.2 2.2 0 0 0 0-4.5h-2.5M11.5 10.5H14a2.2 2.2 0 0 0 0-4.5h-2.5" /> }
        @case ('text-left') { <path d="M3 5h14M3 8.5h9M3 12h14M3 15.5h9" /> }
        @case ('text-center') { <path d="M3 5h14M5.5 8.5h9M3 12h14M5.5 15.5h9" /> }
        @case ('text-right') { <path d="M3 5h14M8 8.5h9M3 12h14M8 15.5h9" /> }
        @case ('text-straight') { <path d="M3 13h14" /><path d="M5 11V6M5 6h3M11 11V6l3 5V6" /> }
        @case ('text-arc') { <path d="M3 15a8 8 0 0 1 14 0" /><path d="M6 9l1-3M10 7.5V4.5M14 9l-1-3" /> }
        @case ('text-path') { <path d="M2.5 15c3-7 6 1 8-4s4-3 7-5" /><path d="M5 9l.5-2.5M9 8.5V6M13 6.5l-.5-2.5" /> }
        @case ('node-smooth') { <path d="M3 14c3-6 11-6 14 0" /><path d="M4.5 8h11" /><rect x="8.5" y="6.5" width="3" height="3" fill="currentColor" /><circle cx="4.5" cy="8" r="1" /><circle cx="15.5" cy="8" r="1" /> }
        @case ('node-corner') { <path d="M3 15l7-9 7 9" /><rect x="8.5" y="4.5" width="3" height="3" fill="currentColor" /> }
        @case ('node-add') { <path d="M2.5 13c3-4 6-4 9 0" /><rect x="5.5" y="8.5" width="3" height="3" fill="currentColor" /><path d="M15 4v6M12 7h6" /> }
        @case ('node-delete') { <path d="M2.5 13c3-4 6-4 9 0" /><rect x="5.5" y="8.5" width="3" height="3" fill="currentColor" /><path d="M12 7h6" /> }
        @case ('chevron') { <path d="M6 8l4 4 4-4" /> }
        @case ('fit') { <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /><rect x="7" y="7" width="6" height="6" /> }
        @case ('keyboard') { <rect x="2" y="5" width="16" height="10" rx="1.5" /><path d="M5 8h1M8 8h1M11 8h1M14 8h1M5 11h1M7.5 12h5M14 11h1" /> }
        @case ('image') { <rect x="3" y="4" width="14" height="12" rx="1.2" /><circle cx="7.5" cy="8.3" r="1.4" /><path d="M3.5 14l4.2-4 3 2.8 2.3-2 3.5 3.2" /> }
        @case ('x') { <path d="M5 5l10 10M15 5L5 15" /> }
        @case ('search') { <circle cx="8.5" cy="8.5" r="5" /><path d="M12.2 12.2l4.6 4.6" /> }
        @case ('upload') { <path d="M10 13V3.5M6.5 7L10 3.5 13.5 7" /><path d="M3.5 13.5v3h13v-3" /> }
        @case ('magnet') { <path d="M4 3.5v6a6 6 0 0 0 12 0v-6h-3.5v6a2.5 2.5 0 0 1-5 0v-6z" /><path d="M4 7h3.5M12.5 7H16" /> }
        @case ('panels') { <rect x="2.5" y="3.5" width="15" height="13" rx="1" /><path d="M12.5 3.5v13" /><path d="M14.5 7h1.5M14.5 10h1.5" /> }
        @case ('cut') { <circle cx="5.5" cy="14.5" r="2.5" /><circle cx="14.5" cy="14.5" r="2.5" /><path d="M7.3 12.8L15 3M12.7 12.8L5 3" /> }
      }
    </svg>
  `,
  styles: [`:host { display: inline-flex; flex-shrink: 0; } svg { width: 100%; height: 100%; }`],
})
export class IlIconComponent {
  name = input.required<IlIconName>();
  size = input(16);
}
