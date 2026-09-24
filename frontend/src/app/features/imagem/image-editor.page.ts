import { DatePipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import {
  CORNER_ANGLE, CubicPath, Point, Polygon, cubicPathsToData, mapCubicPath, pngBlobWithDpi,
  polygonToCubics, smallestPathContaining, traceCutPaths,
} from './contour';
import { CutShape, fillPolygon, shapeCanvasSize, shapePolygon } from './shapes';
import { PackInput, PlacedPiece, SheetOrientation, SheetSize, jpegToPdf, packShelves, sheetDimensionsMm } from './sheet';
import {
  Erasure, applyErasures, buildContourLayer, encodeCanvas, flipHorizontal, floodRemoveBackground,
  downscale, makeThumb,
} from './raster';
import { ImageProjectMetaDto, ImageProjectsService } from './image-projects.service';
import { SocialModeComponent } from './social-mode';
import { SocialProjectData, SocialStore } from './social-store';
import { SplitElement, SplitOptions, SplitPlan, planSplit } from './split';
import { TemplateModeComponent } from './template-mode';
import { ElementNamingService } from './element-naming.service';
import { FontLibrary } from './fonts';
import { IllustrationModeComponent } from './illustration-mode';
import { IllustrationProjectData, IllustrationStore } from './illustration-store';
import { IllustrationTracer } from './illustration-tracer';
import { IlIconComponent, IlIconName } from './illustration-icons';
import { IlNumComponent } from './illustration-num';
import { IlStudioBaseStylesComponent, IlStudioChromeStylesComponent } from './studio-styles';
import { VectorizeService } from './vectorize.service';
import { uniqueNames, zipStore } from './zip';
import { TemplateProjectData, TemplateStore } from './template-store';
import { uuid } from '../../core/uuid';

/** Um clique de "remover fundo". Guardado em vez do bitmap resultante: ao abrir
 * um projeto salvo, os cliques são reaplicados sobre a arte original, então o
 * backend só precisa carregar a imagem de origem. */
interface BgRemoval {
  x: number;
  y: number;
  tolerance: number;
}

/** Ponto (em pixels da arte) que marca uma linha de corte a descartar: no
 * rebuild, o contorno mais justo que o contiver é removido. Guardar o ponto em
 * vez do índice do caminho sobrevive a re-vetorizações (mudar margem, suavizar). */
interface CutRemoval {
  x: number;
  y: number;
}

interface ImportedImage {
  id: string;
  name: string;
  thumbUrl: string;
  /** Arte atual (pode ter o fundo removido). */
  source: HTMLCanvasElement;
  /** Cópia intocada pra "restaurar" e pra salvar no backend. */
  original: HTMLCanvasElement;
  /** Codificação da arte original, calculada uma vez na importação. */
  originalDataUrl: string;
  bgRemovals: BgRemoval[];
  /** Muda a cada edição do source, pra invalidar o cache da peça. */
  srcVersion: number;
  bgRemoved: boolean;
  widthMm: number;
  marginMm: number;
  gapMm: number;
  color: string;
  shape: CutShape;
  mirrored: boolean;
  copies: number;
  /** Só desenha contorno na região ligada à borda (ignora vãos internos). */
  outerOnly: boolean;
  /** Ajustes da linha de corte, por imagem: cada arte tem a sua exigência, e
   * mexer numa não pode mudar as outras. */
  smoothing: number;
  keepCorners: boolean;
  fillHoles: boolean;
  erasures: Erasure[];
  cutRemovals: CutRemoval[];
  /** Sobe a cada borrachada/ajuste destrutivo, pra invalidar o cache da peça. */
  editVersion: number;
}

interface Piece {
  canvas: HTMLCanvasElement;
  paths: Polygon[];
  /** Curvas já ajustadas, em px da peça. Ficam guardadas com a peça pra o
   * ajuste não rodar de novo a cada quadro — e pra prévia e exportação saírem
   * provadamente do mesmo caminho. */
  cuts: CubicPath[];
  /** Pixels por mm DESTA peça (muda com a escala de trabalho). */
  ppm: number;
  artX: number;
  artY: number;
  /** Fator entre a arte original e a resolução em que a peça foi montada. */
  scale: number;
}

type EditorMode = 'corte' | 'molde' | 'social' | 'ilustracao';

interface Prefs {
  modo: EditorMode;
  widthMm: number;
  marginMm: number;
  gapMm: number;
  color: string;
  shape: CutShape;
  smoothing: number;
  keepCorners: boolean;
  fillHoles: boolean;
  outerOnly: boolean;
  brushMm: number;
  openSections: Record<string, boolean>;
  sheetSize: SheetSize;
  orientation: SheetOrientation;
  spacingMm: number;
}

const MAX_MARGIN_MM = 20;
const MAX_GAP_MM = 10;
const MAX_SMOOTHING = 60;
/** Cada passo do controle de suavização vale isto em mm de desvio-padrão: o
 * passo 1 (≈0,08 mm, ou 1 px a 300 DPI) já tira a escada do pixel e o teto
 * arredonda de verdade. */
const SMOOTHING_MM_PER_STEP = 0.08;
/** Piso da suavização, em pixels do traçado. A escada não mora em milímetros,
 * mora em pixel: numa arte de 68 DPI um pixel vale 0,37 mm, e aí os 0,32 mm do
 * ajuste padrão viram 0,86 px — menos de um pixel, incapaz de tirar um degrau
 * de um pixel. Com o piso a escada some em qualquer resolução, e em arte densa
 * o valor em mm passa na frente e volta a mandar. */
const MIN_SMOOTH_PX = 1.5;
/** Erro máximo que o ajuste de curvas aceita entre a Bézier e o contorno.
 * 0,015 mm é uma ordem de grandeza abaixo da precisão de qualquer lâmina, e
 * como o ajuste é por mínimos quadrados isso sai com *menos* curvas, não mais. */
const FIT_TOLERANCE_MM = 0.015;
/** Decimação antes do ajuste: só tira ponto colinear pra baratear a conta, com
 * folga bem abaixo da tolerância do ajuste pra não entrar no erro final. */
const SIMPLIFY_MM = FIT_TOLERANCE_MM / 4;
/** Teto de resolução na importação: 3000 px ≈ 25 cm a 300 DPI, com folga pra
 * qualquer adesivo/topo, e mantém o projeto salvo dentro do limite do backend. */
const MAX_IMPORT_DIMENSION = 3000;
/** Vãos, em mm, testados pela escolha automática de separação: de "nada se
 * junta" (folha de estrelinhas com as pontas quase se tocando) a "junta o
 * desenho inteiro" (polvo com faixa de nome e estrela solta na cabeça). */
const SPLIT_GAP_CANDIDATES_MM = [0, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3];
const MAX_SPLIT_GAP_MM = 3;
/** Área mínima, em mm², pra um pedaço virar elemento ao dividir. */
const SPLIT_MIN_AREA_MM2 = 4;
/** Largura em que a prévia da divisão lê a arte: o bastante pra marcar os
 * elementos com fidelidade e leve o bastante pra acompanhar o controle. */
const SPLIT_PREVIEW_WIDTH = 900;
const MIN_WORK_WIDTH = 360;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const EXPORT_DPI = 300;
const SHEET_MARGIN_MM = 10;
const SWATCHES = ['#ffffff', '#000000', '#6d5ef8', '#ff6b6b', '#ffd93d', '#4ecdc4'];
const PREFS_KEY = 'imagem-editor-prefs';
const DEFAULT_PREFS: Prefs = {
  modo: 'corte',
  widthMm: 100, marginMm: 3, gapMm: 0, color: '#ffffff', shape: 'silhueta',
  smoothing: 4, keepCorners: true, fillHoles: true, outerOnly: false, brushMm: 4,
  openSections: { imagens: true, contorno: true },
  sheetSize: 'A4', orientation: 'retrato', spacingMm: 4,
};

/** Passos do painel, na ordem do fluxo de trabalho. */
const STEPS = ['projeto', 'imagens', 'tamanho', 'contorno', 'arte', 'retoques', 'folha', 'exportar'] as const;
type StepId = (typeof STEPS)[number];

const SHAPES: { id: CutShape; label: string }[] = [
  { id: 'silhueta', label: 'Silhueta' },
  { id: 'retangulo', label: 'Retângulo' },
  { id: 'arredondado', label: 'Arredondado' },
  { id: 'elipse', label: 'Elipse' },
];

type PieceQuality = 'preview' | 'full';

type PcTool = 'nenhuma' | 'fundo' | 'borracha' | 'corte' | 'dividir';
type PcTab = 'imagens' | 'ajustes' | 'folha' | 'exportar';

const MODES: { id: EditorMode; label: string }[] = [
  { id: 'corte', label: 'Print & Cut' },
  { id: 'molde', label: 'Molde SVG' },
  { id: 'social', label: 'Redes sociais' },
  { id: 'ilustracao', label: 'Ilustração' },
];

/** Ferramentas do Print & Cut na coluna da esquerda, com a tecla de cada uma. */
const PC_TOOLS: { id: PcTool; icon: IlIconName; label: string; key: string; help: string }[] = [
  { id: 'nenhuma', icon: 'select', label: 'Visualizar', key: 'V', help: 'Só olhar a peça, sem editar' },
  { id: 'fundo', icon: 'wand', label: 'Remover fundo', key: 'W', help: 'Clique na cor do fundo pra apagar' },
  { id: 'borracha', icon: 'eraser', label: 'Borracha de contorno', key: 'E', help: 'Arraste pra apagar a borda (a arte fica)' },
  { id: 'corte', icon: 'cut', label: 'Remover linha de corte', key: 'C', help: 'Clique dentro da linha que sobra' },
  { id: 'dividir', icon: 'split', label: 'Dividir em elementos', key: 'D', help: 'Uma folha com vários desenhos vira um item por desenho' },
];

const PC_TABS: { id: PcTab; label: string }[] = [
  { id: 'imagens', label: 'Imagens' },
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'folha', label: 'Folha' },
  { id: 'exportar', label: 'Exportar' },
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
}

/** As borrachadas ficam em pixels da arte original; a peça pode estar numa
 * escala menor, então os círculos precisam acompanhar. */
function scaleErasures(erasures: Erasure[], escala: number): Erasure[] {
  if (escala === 1) return erasures;
  return erasures.map((e) => ({ x: e.x * escala, y: e.y * escala, r: e.r * escala }));
}

function smoothingSigmaMm(step: number): number {
  return Math.max(0, step) * SMOOTHING_MM_PER_STEP;
}

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao carregar imagem do projeto.'));
    img.src = src;
  });
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { /* prefs são só conveniência */ }
  return { ...DEFAULT_PREFS };
}

@Component({
  selector: 'app-image-editor-page',
  standalone: true,
  imports: [
    RouterLink, IconComponent, DatePipe, TemplateModeComponent, SocialModeComponent, IllustrationModeComponent,
    IlIconComponent, IlNumComponent, IlStudioBaseStylesComponent, IlStudioChromeStylesComponent,
  ],
  providers: [TemplateStore, SocialStore, IllustrationStore, FontLibrary, VectorizeService, IllustrationTracer],
  template: `
    <il-studio-base-styles /><il-studio-chrome-styles />
    <div class="page">
      <header class="il-appbar">
        <a class="ab-home" routerLink="/" title="Voltar ao início" aria-label="Voltar ao início"><app-icon name="grid" [size]="15" /></a>
        <span class="ab-title"><span class="ab-mark"><app-icon name="image" [size]="12" /></span> Editor de Imagens</span>
        <nav class="ab-modes" role="tablist" aria-label="Modo">
          @for (m of modes; track m.id) {
            <button type="button" role="tab" [class.il-on]="modo() === m.id" [attr.aria-selected]="modo() === m.id" (click)="setModo(m.id)">{{ m.label }}</button>
          }
        </nav>
        <div class="ab-project">
          <input class="ab-name" type="text" maxlength="300" placeholder="Projeto sem nome" aria-label="Nome do projeto" [value]="projectName()" (input)="onProjectNameInput($event)" />
          <button type="button" class="il-btn il-primary" [disabled]="savingProject()" data-tip="Salvar projeto  Ctrl+S" (click)="saveProject()">
            <il-icon name="save" [size]="13" /> {{ savingProject() ? 'Salvando…' : 'Salvar' }}
          </button>
          <div class="ab-menu-wrap">
            <button type="button" class="il-btn" [class.il-on]="projectsOpen()" (click)="toggleProjects()"><il-icon name="folder" [size]="13" /> Abrir <il-icon name="chevron" [size]="11" /></button>
            @if (projectsOpen()) {
              <div class="ab-menu" role="menu">
                <button type="button" class="ab-menu-item ab-new" (click)="newProject(); projectsOpen.set(false)"><il-icon name="file-new" [size]="14" /> Novo projeto</button>
                @for (p of projects(); track p.id) {
                  <div class="ab-menu-row" [class.il-on]="p.id === projectId()">
                    <button type="button" class="ab-menu-item" (click)="openProject(p.id); projectsOpen.set(false)">
                      <span class="ab-p-name">{{ p.name }}</span><span class="ab-p-date">{{ p.updatedAt | date: 'dd/MM HH:mm' }}</span>
                    </button>
                    <button type="button" class="il-ib il-ib-sm il-danger" title="Excluir projeto" aria-label="Excluir projeto" (click)="deleteProject(p.id, $event)"><il-icon name="trash" [size]="13" /></button>
                  </div>
                } @empty {
                  <p class="ab-menu-empty">Nenhum projeto salvo ainda.</p>
                }
              </div>
            }
          </div>
          @if (projectStatus()) { <span class="ab-status" [title]="projectStatus()">{{ projectStatus() }}</span> }
        </div>
        <div class="ab-right">
          <button type="button" class="il-ib" (click)="theme.cycle()" [title]="themeLabel()" [attr.aria-label]="themeLabel()"><app-icon [name]="themeIconName()" [size]="15" /></button>
          <span class="ab-user">{{ auth.user()?.email }}</span>
          <button type="button" class="il-ib" (click)="auth.logout()" title="Sair" aria-label="Sair"><app-icon name="logout" [size]="14" /></button>
        </div>
      </header>

      <main class="content">
        @if (modo() === 'corte') {
        <div class="il-studio il-basic pc">
          <input #fileInput type="file" accept="image/*" multiple hidden (change)="onFilesSelected($event)" />

          <div class="il-controlbar">
            <div class="il-cb-group">
              <div class="il-seg pc-seg">
                <button type="button" [class.il-on]="view() === 'peca'" (click)="setView('peca')"><il-icon name="piece" [size]="14" /> Peça</button>
                <button type="button" [class.il-on]="view() === 'folha'" (click)="setView('folha')"><il-icon name="sheet" [size]="14" /> Folha @if (totalCopies()) { ({{ totalCopies() }}) }</button>
              </div>
            </div>
            @if (view() === 'peca') {
              @if (selected(); as sel) {
                <span class="il-cb-kind pc-name" [title]="sel.name">{{ sel.name }}</span>
                <div class="il-cb-group">
                  <il-num label="L" title="Largura da arte" unit="cm" [value]="sel.widthMm / 10" [step]="0.1" [min]="1" [max]="100" (valueChange)="onWidthCmChange(ev($event.value))" />
                  <il-num label="Cópias" [value]="sel.copies" [min]="1" [max]="99" [decimals]="0" (valueChange)="onCopiesChange(ev($event.value))" />
                </div>
                <div class="il-cb-group">
                  <select class="il-select" [value]="sel.shape" (change)="setShape($any($event.target).value)" aria-label="Forma do contorno">
                    @for (s of shapes; track s.id) { <option [value]="s.id">{{ s.label }}</option> }
                  </select>
                  <il-num label="Borda" title="Largura da borda" unit="mm" [value]="sel.marginMm" [step]="0.1" [min]="0" [max]="maxMarginMm" (valueChange)="onMarginInput(ev($event.value))" />
                  <button type="button" class="il-swatch-btn" data-tip="Cor da borda" aria-label="Cor da borda" (click)="borderColor.click()"><span class="il-sw" [style.background]="sel.color"></span></button>
                  <input #borderColor type="color" class="il-hidden-color" tabindex="-1" aria-hidden="true" [value]="sel.color" (input)="onColorInput($event)" />
                </div>
                @switch (tool()) {
                  @case ('fundo') {
                    <div class="il-cb-group">
                      <il-num label="Tolerância" [value]="tolerance()" [step]="5" [min]="5" [max]="120" [decimals]="0" (valueChange)="onToleranceInput(ev($event.value))" />
                      @if (sel.bgRemoved) { <button type="button" class="il-btn" (click)="restoreOriginal()">Restaurar original</button> }
                    </div>
                  }
                  @case ('borracha') {
                    <div class="il-cb-group">
                      <il-num label="Borracha" unit="mm" [value]="brushMm()" [step]="0.5" [min]="0.5" [max]="20" (valueChange)="onBrushInput(ev($event.value))" />
                      @if (sel.erasures.length) {
                        <button type="button" class="il-btn" (click)="undoErase()">Desfazer</button>
                        <button type="button" class="il-btn" (click)="clearErasures()">Limpar</button>
                      }
                    </div>
                  }
                  @case ('corte') {
                    @if (sel.cutRemovals.length) {
                      <div class="il-cb-group">
                        <button type="button" class="il-btn" (click)="undoCutRemoval()">Desfazer</button>
                        <button type="button" class="il-btn" (click)="restoreCuts()">Restaurar linhas</button>
                      </div>
                    }
                  }
                  @case ('dividir') {
                    <div class="il-cb-group">
                      <il-num label="Juntar até" title="Pedaços a menos que isso viram um elemento só" unit="mm" [value]="splitGapMm()" [step]="0.05" [min]="0" [max]="maxSplitGapMm" [decimals]="2" (valueChange)="onSplitGapInput(ev($event.value))" />
                      <il-num label="Fundo" title="Tolerância do fundo" [value]="splitTolerance()" [min]="5" [max]="120" [decimals]="0" (valueChange)="onSplitToleranceInput(ev($event.value))" />
                      <button type="button" class="il-btn" (click)="autoSplit()"><il-icon name="sparkle" [size]="13" /> Escolher sozinho</button>
                      <button type="button" class="il-btn il-primary" [disabled]="splitFound().length < 2" (click)="splitSelected()">Dividir em {{ splitFound().length }}</button>
                    </div>
                  }
                }
              } @else {
                <span class="il-cb-hint">Importe imagens pra gerar o contorno e a linha de corte.</span>
              }
            } @else {
              <div class="il-cb-group">
                <span class="il-cb-label">Folha</span>
                <select class="il-select" [value]="sheetSize()" (change)="onSheetSizeChange($event)" aria-label="Tamanho da folha">
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                </select>
                <select class="il-select" [value]="orientation()" (change)="onOrientationChange($event)" aria-label="Orientação">
                  <option value="retrato">Retrato</option>
                  <option value="paisagem">Paisagem</option>
                </select>
                <il-num label="Espaço" title="Espaço entre peças" unit="mm" [value]="spacingMm()" [min]="0" [max]="10" [decimals]="0" (valueChange)="onSpacingInput(ev($event.value))" />
              </div>
              <button type="button" class="il-btn il-primary" [disabled]="!images().length" (click)="exportSheetPdf()"><il-icon name="download" [size]="13" /> PDF da folha</button>
            }
          </div>

          <nav class="il-tools-col" aria-label="Ferramentas">
            <div class="il-tb-group">
              @for (t of pcTools; track t.id) {
                <button type="button" class="il-tool" [class.il-on]="tool() === t.id" [disabled]="t.id !== 'nenhuma' && !selected()"
                  [attr.aria-label]="t.label" [attr.data-tip]="t.label + '  ' + t.key" [attr.data-help]="t.help" (click)="setTool(t.id)">
                  <il-icon [name]="t.icon" [size]="18" />
                </button>
              }
            </div>
            <div class="il-tb-group">
              <button type="button" class="il-tool" aria-label="Importar imagens" data-tip="Importar imagens" data-help="PNG transparente é o ideal; foto também serve" (click)="fileInput.click()"><il-icon name="photo-add" [size]="18" /></button>
              <button type="button" class="il-tool" [class.il-on]="selected()?.mirrored" [disabled]="!selected()" aria-label="Espelhar" data-tip="Espelhar" data-help="Só pra vinil termocolante" (click)="toggleMirror()"><il-icon name="flip-h" [size]="18" /></button>
              <button type="button" class="il-tool" [disabled]="!selected()" aria-label="Vetorizar na Ilustração" data-tip="Vetorizar na Ilustração" data-help="Curvas, cores ou linha central" (click)="vectorizeSelected()"><il-icon name="trace" [size]="18" /></button>
            </div>
          </nav>

          @if (view() === 'peca') {
            @if (selected()) {
              <div #pieceStage class="il-stage pc-stage" [class.il-drag-over]="dragOver()" [attr.data-tool]="tool()"
                (wheel)="onWheel($event)" (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
                <canvas
                  #previewCanvas
                  class="il-checker il-paper"
                  (click)="onPreviewClick($event)"
                  (pointerdown)="onPreviewPointerDown($event)"
                  (pointermove)="onPreviewPointerMove($event)"
                  (pointerup)="onPreviewPointerUp($event)"
                  (pointercancel)="onPreviewPointerUp($event)"
                ></canvas>
              </div>
            } @else {
              <div class="il-stage" [class.il-drag-over]="dragOver()" (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
                <button type="button" class="il-empty" (click)="fileInput.click()">
                  <il-icon name="photo-add" [size]="34" />
                  <strong>Importe imagens pra gerar o contorno e a linha de corte</strong>
                  <span>Clique ou arraste arquivos aqui. PNG com fundo transparente fica com contorno na forma do desenho; em foto ou JPG, use "Remover fundo".</span>
                </button>
              </div>
            }
          } @else {
            <div #sheetStage class="il-stage pc-stage" (wheel)="onWheel($event)">
              <canvas #sheetCanvas class="il-paper"></canvas>
            </div>
          }

          <aside class="il-dock">
            <div class="il-tabs" role="tablist">
              @for (t of pcTabs; track t.id) {
                <button type="button" role="tab" class="il-tab" [class.il-on]="pcTab() === t.id" [attr.aria-selected]="pcTab() === t.id" (click)="pcTab.set(t.id)">{{ t.label }}</button>
              }
            </div>
            <div class="il-tab-body">
              @switch (pcTab()) {
                @case ('imagens') {
                  <div class="il-sec"><div class="il-sec-body il-sec-body-top">
                    <button type="button" class="il-btn il-primary il-wide" (click)="fileInput.click()"><il-icon name="photo-add" [size]="14" /> Importar imagens</button>
                    <p class="il-note">PNG com fundo transparente é o ideal: o contorno segue o desenho. Foto ou JPG também dá — use "Remover fundo" (W).</p>
                  </div></div>
                  @for (item of images(); track item.id) {
                    <div class="il-item" [class.il-on]="item.id === selectedId()">
                      <button type="button" class="il-item-main" (click)="select(item.id)">
                        <img class="il-item-thumb il-checker" [src]="item.thumbUrl" [alt]="item.name" />
                        <span class="il-item-text">
                          <span class="il-item-name">{{ item.name }}</span>
                          <span class="il-item-sub">{{ (item.widthMm / 10).toFixed(1).replace('.', ',') }} cm · {{ shapeLabel(item.shape) }}{{ item.bgRemoved ? ' · sem fundo' : '' }}</span>
                        </span>
                      </button>
                      @if (item.copies > 1) { <span class="il-badge">×{{ item.copies }}</span> }
                      <button type="button" class="il-ib il-ib-sm il-danger" title="Remover" aria-label="Remover" (click)="remove(item.id)"><il-icon name="x" [size]="12" /></button>
                    </div>
                  }
                }
                @case ('ajustes') {
                  @if (selected(); as sel) {
                    <section class="il-sec" [class.il-closed]="pcClosed('tamanho')">
                      <button type="button" class="il-sec-head" (click)="pcFlip('tamanho')"><il-icon name="chevron" [size]="12" /> Tamanho</button>
                      <div class="il-sec-body">
                        <div class="il-grid2">
                          <il-num label="L" title="Largura" unit="cm" [value]="sel.widthMm / 10" [step]="0.1" [min]="1" [max]="100" (valueChange)="onWidthCmChange(ev($event.value))" />
                          <il-num label="Cópias" [value]="sel.copies" [min]="1" [max]="99" [decimals]="0" (valueChange)="onCopiesChange(ev($event.value))" />
                        </div>
                        <p class="il-note">Altura {{ formatMm(artHeightMm(sel)) }} (segue a proporção) · peça {{ pieceLabel() }} · impressão a {{ dpi }} DPI.</p>
                      </div>
                    </section>
                    <section class="il-sec" [class.il-closed]="pcClosed('contorno')">
                      <button type="button" class="il-sec-head" (click)="pcFlip('contorno')"><il-icon name="chevron" [size]="12" /> Contorno</button>
                      <div class="il-sec-body">
                        <div class="il-seg pc-seg pc-seg-full">
                          @for (s of shapes; track s.id) {
                            <button type="button" [class.il-on]="sel.shape === s.id" (click)="setShape(s.id)">{{ s.label }}</button>
                          }
                        </div>
                        <label class="il-range"><span>Borda</span><input type="range" min="0" [max]="maxMarginMm" step="0.1" [value]="sel.marginMm" (input)="onMarginInput($event)" /><b>{{ sel.marginMm.toFixed(1) }}</b></label>
                        <label class="il-range"><span>Respiro</span><input type="range" min="0" [max]="maxGapMm" step="0.1" [value]="sel.gapMm" (input)="onGapInput($event)" /><b>{{ sel.gapMm.toFixed(1) }}</b></label>
                        <p class="il-note">Borda e respiro em mm. O respiro é a faixa branca entre o desenho e a borda colorida.</p>
                        <div class="il-row">
                          <input type="color" class="il-color-input" [value]="sel.color" (input)="onColorInput($event)" aria-label="Cor da borda" />
                          @for (sw of swatches; track sw) {
                            <button type="button" class="pc-swatch" [class.il-on]="sw === sel.color" [style.background]="sw" [title]="sw" (click)="setColor(sw)"></button>
                          }
                        </div>
                        @if (sel.shape === 'silhueta') {
                          <label class="il-range"><span>Suavizar</span><input type="range" min="0" [max]="maxSmoothing" step="1" [value]="sel.smoothing" (input)="onSmoothingInput($event)" /><b class="pc-wide-b">{{ smoothingLabel() }}</b></label>
                          <label class="il-check"><input type="checkbox" [checked]="sel.keepCorners" (change)="onKeepCornersChange($event)" /> Manter cantos vivos</label>
                          <label class="il-check"><input type="checkbox" [checked]="sel.fillHoles" (change)="onFillHolesChange($event)" /> Não cortar buracos internos</label>
                        }
                      </div>
                    </section>
                    <section class="il-sec" [class.il-closed]="pcClosed('arte')">
                      <button type="button" class="il-sec-head" (click)="pcFlip('arte')"><il-icon name="chevron" [size]="12" /> Arte</button>
                      <div class="il-sec-body">
                        <button type="button" class="il-btn il-wide" [class.il-on]="tool() === 'fundo'" (click)="setTool('fundo')"><il-icon name="wand" [size]="14" /> {{ tool() === 'fundo' ? 'Clique no fundo da imagem…' : 'Remover fundo' }}</button>
                        @if (tool() === 'fundo') {
                          <label class="il-range"><span>Tolerância</span><input type="range" min="5" max="120" step="5" [value]="tolerance()" (input)="onToleranceInput($event)" /><b>{{ tolerance() }}</b></label>
                        }
                        @if (sel.bgRemoved) { <button type="button" class="il-btn il-wide" (click)="restoreOriginal()">Restaurar imagem original</button> }
                        <button type="button" class="il-btn il-wide" [class.il-on]="tool() === 'dividir'" (click)="setTool('dividir')"><il-icon name="split" [size]="14" /> {{ tool() === 'dividir' ? 'Fechar divisão' : 'Dividir em elementos' }}</button>
                        @if (tool() === 'dividir') {
                          <label class="il-range"><span>Juntar até</span><input type="range" min="0" [max]="maxSplitGapMm" step="0.05" [value]="splitGapMm()" (input)="onSplitGapInput($event)" /><b>{{ splitGapMm().toFixed(2) }}</b></label>
                          <label class="il-range"><span>Fundo</span><input type="range" min="5" max="120" step="1" [value]="splitTolerance()" (input)="onSplitToleranceInput($event)" /><b>{{ splitTolerance() }}</b></label>
                          <p class="il-note">{{ splitSummary() }}</p>
                          <div class="il-row">
                            <button type="button" class="il-btn il-grow" (click)="autoSplit()"><il-icon name="sparkle" [size]="13" /> Escolher sozinho</button>
                            <button type="button" class="il-btn il-primary il-grow" [disabled]="splitFound().length < 2" (click)="splitSelected()">Dividir em {{ splitFound().length }}</button>
                          </div>
                        }
                        <label class="il-check"><input type="checkbox" [checked]="sel.mirrored" (change)="onMirrorChange($event)" /> Espelhar (só pra vinil termocolante)</label>
                        <button type="button" class="il-btn il-wide" (click)="vectorizeSelected()"><il-icon name="trace" [size]="14" /> Vetorizar na Ilustração</button>
                      </div>
                    </section>
                    <section class="il-sec" [class.il-closed]="pcClosed('retoques')">
                      <button type="button" class="il-sec-head" (click)="pcFlip('retoques')"><il-icon name="chevron" [size]="12" /> Retoques do corte</button>
                      <div class="il-sec-body">
                        @if (sel.shape === 'silhueta') {
                          <label class="il-check"><input type="checkbox" [checked]="sel.outerOnly" (change)="onOuterOnlyChange($event)" /> Só contorno por fora</label>
                        }
                        <button type="button" class="il-btn il-wide" [class.il-on]="tool() === 'borracha'" (click)="setTool('borracha')"><il-icon name="eraser" [size]="14" /> {{ tool() === 'borracha' ? 'Arraste sobre o contorno…' : 'Borracha de contorno' }}</button>
                        @if (tool() === 'borracha') {
                          <label class="il-range"><span>Tamanho</span><input type="range" min="0.5" max="20" step="0.5" [value]="brushMm()" (input)="onBrushInput($event)" /><b>{{ brushMm().toFixed(1) }}</b></label>
                        }
                        @if (sel.erasures.length) {
                          <div class="il-row"><button type="button" class="il-btn il-grow" (click)="undoErase()">Desfazer</button><button type="button" class="il-btn il-grow" (click)="clearErasures()">Limpar borrachadas</button></div>
                        }
                        <button type="button" class="il-btn il-wide" [class.il-on]="tool() === 'corte'" (click)="setTool('corte')"><il-icon name="cut" [size]="14" /> {{ tool() === 'corte' ? 'Clique na linha a remover…' : 'Remover linha de corte' }}</button>
                        @if (sel.cutRemovals.length) {
                          <div class="il-row"><button type="button" class="il-btn il-grow" (click)="undoCutRemoval()">Desfazer</button><button type="button" class="il-btn il-grow" (click)="restoreCuts()">Restaurar linhas</button></div>
                        }
                      </div>
                    </section>
                  } @else {
                    <p class="il-note pc-pad">Selecione ou importe uma imagem na aba Imagens.</p>
                  }
                }
                @case ('folha') {
                  <section class="il-sec"><div class="il-sec-body il-sec-body-top">
                    <div class="il-grid2">
                      <select class="il-select" [value]="sheetSize()" (change)="onSheetSizeChange($event)" aria-label="Tamanho da folha">
                        <option value="A4">A4</option>
                        <option value="A3">A3</option>
                      </select>
                      <select class="il-select" [value]="orientation()" (change)="onOrientationChange($event)" aria-label="Orientação">
                        <option value="retrato">Retrato</option>
                        <option value="paisagem">Paisagem</option>
                      </select>
                    </div>
                    <label class="il-range"><span>Espaço</span><input type="range" min="0" max="10" step="1" [value]="spacingMm()" (input)="onSpacingInput($event)" /><b>{{ spacingMm().toFixed(0) }} mm</b></label>
                    <p class="il-note">Junta todas as peças (e as cópias) numa folha pra imprimir de uma vez. Imprima o PNG ou o PDF e leve o SVG pra máquina: as posições batem.</p>
                  </div></section>
                  <div class="il-export-list">
                    <button type="button" class="il-export" [disabled]="!images().length" (click)="exportSheetPdf()"><il-icon name="artboard" [size]="20" /><span><strong>PDF da folha</strong><small>No tamanho físico, pronto pra imprimir</small></span></button>
                    <button type="button" class="il-export" [disabled]="!images().length" (click)="exportSheetPng()"><il-icon name="image" [size]="20" /><span><strong>PNG da folha ({{ dpi }} DPI)</strong><small>Imagem pra imprimir em outro programa</small></span></button>
                    <button type="button" class="il-export" [disabled]="!images().length" (click)="exportSheetSvg()"><il-icon name="cut" [size]="20" /><span><strong>SVG de corte da folha</strong><small>Só as linhas de corte, em mm, nas mesmas posições</small></span></button>
                  </div>
                }
                @case ('exportar') {
                  <div class="il-export-list">
                    <button type="button" class="il-export" [disabled]="!selected()" (click)="exportPrintPng()"><il-icon name="image" [size]="20" /><span><strong>PNG {{ dpi }} DPI</strong><small>A peça selecionada, pra imprimir</small></span></button>
                    <button type="button" class="il-export" [disabled]="!selected()" (click)="exportCutSvg()"><il-icon name="cut" [size]="20" /><span><strong>SVG da linha de corte</strong><small>Pra ScanNCut / CanvasWorkspace, em mm</small></span></button>
                    <button type="button" class="il-export" [disabled]="!selected()" (click)="exportFullSvg()"><il-icon name="export" [size]="20" /><span><strong>SVG arte + corte</strong><small>A arte embutida com a linha de corte por cima</small></span></button>
                    <button type="button" class="il-export" [disabled]="images().length < 2 || zipping()" (click)="exportCutSvgZip()"><il-icon name="split" [size]="20" /><span><strong>{{ zipping() ? 'Nomeando com IA…' : 'ZIP com um SVG por imagem' }}</strong><small>Cada arquivo nomeado por IA pelo que o desenho é</small></span></button>
                  </div>
                  @if (zipStatus()) { <p class="il-note pc-pad">{{ zipStatus() }}</p> }
                  <p class="il-note pc-pad">Importe o SVG no CanvasWorkspace (ou direto no pendrive nos modelos SDX) — as medidas já vão em mm.</p>
                }
              }
            </div>
          </aside>

          <footer class="il-status">
            <div class="il-status-zoom">
              <button type="button" class="il-ib il-ib-sm" data-tip="Afastar  Ctrl+−" aria-label="Afastar" (click)="zoomBy(1 / 1.25)">−</button>
              <il-num label="" title="Zoom (100% = cabe na tela)" unit="%" [value]="zoom() * 100" [step]="10" [min]="50" [max]="800" [decimals]="0" (valueChange)="setZoomPct($event.value)" />
              <button type="button" class="il-ib il-ib-sm" data-tip="Aproximar  Ctrl+=" aria-label="Aproximar" (click)="zoomBy(1.25)">+</button>
              <button type="button" class="il-ib il-ib-sm" data-tip="Ajustar à janela  Ctrl+0" aria-label="Ajustar à janela" (click)="resetZoom()"><il-icon name="fit" [size]="13" /></button>
            </div>
            @if (view() === 'peca') {
              @if (selected(); as sel) {
                <span class="il-status-info">{{ sel.name }}</span>
                <span class="pc-dims">arte {{ formatMm(sel.widthMm) }} × {{ formatMm(artHeightMm(sel)) }} · peça {{ pieceLabel() }}</span>
              }
              <span class="il-status-msg" [class.pc-active]="tool() !== 'nenhuma'">{{ pcHint() }}</span>
            } @else {
              <span class="il-status-info">{{ sheetSize() }} {{ orientation() }} · {{ packInfo().placed }} peça(s)</span>
              <span class="il-status-msg" [class.il-warn]="packInfo().overflow > 0">
                {{ packInfo().overflow > 0 ? packInfo().overflow + ' não couberam — reduza cópias ou tamanho, ou use A3' : 'Imprima a folha e corte com o SVG da folha: as posições batem.' }}
              </span>
            }
          </footer>
        </div>
        } @else if (modo() === 'molde') {
          <app-template-mode />
        } @else if (modo() === 'social') {
          <app-social-mode />
        } @else {
          <app-illustration-mode (sendToCut)="onIllustrationToCut($event)" (sendToTemplate)="onIllustrationToTemplate($event)" />
        }
      </main>
    </div>
  `,
  styles: [`
    .page { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
    .content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .content > * { flex: 1; min-height: 0; }

    /* ---- barra do app, como a barra de aplicativo da Adobe ---- */
    .il-appbar {
      display: flex; align-items: center; gap: 12px; height: 42px; padding: 0 10px; flex-shrink: 0;
      background: var(--il-chrome-2); border-bottom: 1px solid var(--il-line);
    }
    .ab-home { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 4px; color: var(--text-muted); }
    .ab-home:hover { background: var(--il-hover); color: var(--text); }
    .ab-title { display: inline-flex; align-items: center; gap: 7px; font-weight: 700; white-space: nowrap; }
    .ab-mark { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 5px; background: var(--il-blue); color: #fff; }
    .ab-modes { display: flex; gap: 2px; padding: 2px; background: var(--il-field); border: 1px solid var(--il-line); border-radius: 5px; }
    .ab-modes button { height: 26px; padding: 0 12px; border: none; border-radius: 4px; background: none; color: var(--text-muted); font-weight: 600; white-space: nowrap; }
    .ab-modes button:hover { color: var(--text); }
    .ab-modes button.il-on { background: var(--il-active); color: var(--il-blue); }
    .ab-project { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 5px; }
    .ab-name { width: 200px; min-width: 90px; height: 26px; padding: 0 8px; font: inherit; color: var(--text); background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px; }
    .ab-name:focus { outline: none; border-color: var(--il-blue); }
    .ab-status { max-width: 220px; font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ab-menu-wrap { position: relative; }
    .ab-menu {
      position: absolute; z-index: 120; top: calc(100% + 4px); right: 0; width: 300px; max-height: 60vh; overflow-y: auto; padding: 4px;
      background: var(--il-chrome); border: 1px solid var(--il-line-strong); border-radius: 6px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
    }
    .ab-menu-row { display: flex; align-items: center; gap: 2px; border-radius: 3px; }
    .ab-menu-row.il-on { background: var(--il-active); }
    .ab-menu-item { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 8px; border: none; border-radius: 3px; background: none; color: var(--text); text-align: left; }
    .ab-menu-item:hover { background: var(--il-hover); }
    .ab-new { justify-content: flex-start; font-weight: 600; border-bottom: 1px solid var(--il-line); border-radius: 0; margin-bottom: 3px; width: 100%; }
    .ab-p-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ab-p-date { flex-shrink: 0; font-size: 11px; color: var(--text-muted); }
    .ab-menu-empty { margin: 8px; font-size: 11px; color: var(--text-muted); }
    .ab-right { display: flex; align-items: center; gap: 4px; }
    .ab-user { font-size: 11px; color: var(--text-muted); max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ---- Print & Cut ---- */
    .pc-seg button { width: auto; padding: 0 10px; gap: 5px; font-size: 12px; }
    .pc-seg-full { display: flex; }
    .pc-seg-full button { flex: 1; padding: 0 4px; font-size: 11px; }
    .pc-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
    .pc-stage canvas { margin: auto; flex: none; }
    .pc-stage[data-tool='fundo'] canvas, .pc-stage[data-tool='corte'] canvas { cursor: crosshair; }
    .pc-stage[data-tool='borracha'] canvas { cursor: cell; touch-action: none; }
    .pc-swatch { width: 20px; height: 20px; padding: 0; border-radius: 50%; border: 1px solid var(--il-line-strong); }
    .pc-swatch.il-on { outline: 2px solid var(--il-blue); outline-offset: 1px; }
    .pc-wide-b { font-size: 10px; }
    .pc-pad { margin: 10px; }
    .pc-dims { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .il-status-msg.pc-active { color: var(--il-blue); font-weight: 600; }

    @media (max-width: 900px) {
      .page { height: auto; overflow: visible; }
      .il-appbar { height: auto; flex-wrap: wrap; padding: 6px 8px; row-gap: 6px; }
      .ab-modes { order: 5; width: 100%; }
      .ab-modes button { flex: 1; padding: 0 4px; }
      .ab-project { order: 6; width: 100%; justify-content: flex-start; }
      .ab-name { flex: 1; }
      .ab-status, .ab-user { display: none; }
      .ab-right { margin-left: auto; }
      .pc-dims { display: none; }
    }
  `],
})
export class ImageEditorPageComponent implements AfterViewInit, OnDestroy {
  @ViewChild('previewCanvas') previewCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('sheetCanvas') sheetCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('pieceStage') pieceStage?: ElementRef<HTMLElement>;
  @ViewChild('sheetStage') sheetStage?: ElementRef<HTMLElement>;

  readonly maxMarginMm = MAX_MARGIN_MM;
  readonly maxGapMm = MAX_GAP_MM;
  readonly maxSmoothing = MAX_SMOOTHING;
  readonly maxSplitGapMm = MAX_SPLIT_GAP_MM;
  readonly dpi = EXPORT_DPI;
  readonly swatches = SWATCHES;
  readonly shapes = SHAPES;
  readonly modes = MODES;
  readonly pcTools = PC_TOOLS;
  readonly pcTabs = PC_TABS;

  private prefs = loadPrefs();

  modo = signal<EditorMode>(this.prefs.modo ?? 'corte');
  pcTab = signal<PcTab>('imagens');
  /** Tamanho físico da peça desenhada por último (arte + borda). */
  pieceLabel = signal('');
  projectsOpen = signal(false);
  images = signal<ImportedImage[]>([]);
  selectedId = signal<string | null>(null);
  view = signal<'peca' | 'folha'>('peca');
  sheetSize = signal<SheetSize>(this.prefs.sheetSize);
  orientation = signal<SheetOrientation>(this.prefs.orientation);
  spacingMm = signal(this.prefs.spacingMm);
  tool = signal<'nenhuma' | 'fundo' | 'borracha' | 'corte' | 'dividir'>('nenhuma');
  tolerance = signal(40);
  brushMm = signal(this.prefs.brushMm);
  cutHint = signal('');
  splitTolerance = signal(32);
  splitGapMm = signal(0.5);
  zipStatus = signal('');
  zipping = signal(false);
  splitFound = signal<SplitElement[]>([]);
  private splitPlan: SplitPlan | null = null;
  /** 1 = imagem ajustada ao palco; acima disso, o palco ganha rolagem. */
  zoom = signal(1);
  openSections = signal<Record<string, boolean>>({ ...this.prefs.openSections });
  dragOver = signal(false);
  packInfo = signal<{ placed: number; overflow: number }>({ placed: 0, overflow: 0 });

  /** O controle guarda um passo inteiro, mas quem lê a tela quer saber o
   * tamanho real do afastamento — em mm, como o resto do painel. */
  smoothingLabel = computed(() => {
    const s = this.selected()?.smoothing ?? 0;
    return s > 0 ? `${smoothingSigmaMm(s).toFixed(2).replace('.', ',')} mm` : 'desligada';
  });
  selected = computed(() => this.images().find((i) => i.id === this.selectedId()) ?? null);
  totalCopies = computed(() => this.images().reduce((sum, i) => sum + i.copies, 0));

  projects = signal<ImageProjectMetaDto[]>([]);
  projectId = signal<string | null>(null);
  projectName = signal('');
  projectStatus = signal('');
  savingProject = signal(false);

  private renderQueued = false;
  private erasing = false;
  /** Enquanto true, a prévia é montada em meia resolução pra responder na hora. */
  private interacting = false;
  private interactionTimer?: ReturnType<typeof setTimeout>;
  private projectCreatedAt = new Date().toISOString();
  private pieceCache = new Map<string, { sig: string; piece: Piece }>();

  constructor(
    public auth: AuthService,
    public theme: ThemeService,
    private projectsApi: ImageProjectsService,
    private naming: ElementNamingService,
    public templates: TemplateStore,
    public social: SocialStore,
    public illustration: IllustrationStore,
  ) {}

  ngAfterViewInit(): void {
    this.scheduleRender();
    void this.refreshProjects();
  }

  ngOnDestroy(): void {
    clearTimeout(this.interactionTimer);
    this.pieceCache.clear();
  }

  // ---------- helpers de exibição ----------

  artHeightMm(item: ImportedImage): number {
    return (item.widthMm * item.source.height) / item.source.width;
  }

  formatMm(mm: number): string {
    return mm >= 100 ? `${(mm / 10).toFixed(1)} cm` : `${mm.toFixed(1)} mm`;
  }

  pieceSizeLabel(item: ImportedImage): string {
    const piece = this.pieceFor(item);
    return `${this.formatMm(piece.canvas.width / piece.ppm)} × ${this.formatMm(piece.canvas.height / piece.ppm)}`;
  }

  private pxPerMm(item: ImportedImage): number {
    return item.source.width / item.widthMm;
  }

  // ---------- importação e lista ----------

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(Array.from(input.files));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (event.dataTransfer?.files) this.addFiles(Array.from(event.dataTransfer.files));
  }

  private addFiles(files: File[]): void {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        this.addImage(file.name, img);
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    }
  }

  /** Cria a arte a partir de uma imagem carregada, reduzindo se passar do teto
   * de resolução — o que se vê é o que é salvo, sem surpresa ao reabrir. */
  private addImage(name: string, img: HTMLImageElement, overrides: Partial<ImportedImage> = {}): ImportedImage {
    const scale = Math.min(1, MAX_IMPORT_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const original = document.createElement('canvas');
    original.width = w;
    original.height = h;
    const octx = original.getContext('2d')!;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(img, 0, 0, w, h);
    return this.addArt(name, original, overrides);
  }

  /** Entra na lista uma arte que já é um canvas no tamanho final — a
   * importação depois de reduzir, ou um elemento recortado da divisão. */
  private addArt(name: string, original: HTMLCanvasElement, overrides: Partial<ImportedImage> = {}): ImportedImage {
    const w = original.width;
    const h = original.height;
    const source = document.createElement('canvas');
    source.width = w;
    source.height = h;
    source.getContext('2d')!.drawImage(original, 0, 0);

    const item: ImportedImage = {
      id: uid(), name, thumbUrl: makeThumb(source),
      source, original, originalDataUrl: encodeCanvas(original), bgRemovals: [],
      srcVersion: 0, bgRemoved: false,
      widthMm: this.prefs.widthMm, marginMm: this.prefs.marginMm, gapMm: this.prefs.gapMm,
      color: this.prefs.color, shape: this.prefs.shape, mirrored: false, copies: 1,
      outerOnly: this.prefs.outerOnly, erasures: [], cutRemovals: [], editVersion: 0,
      smoothing: this.prefs.smoothing, keepCorners: this.prefs.keepCorners, fillHoles: this.prefs.fillHoles,
      ...overrides,
    };
    // projeto salvo por uma versão anterior pode não trazer todas as listas —
    // um campo ausente vira undefined no spread e quebraria o rebuild da peça
    item.bgRemovals ??= [];
    item.erasures ??= [];
    item.cutRemovals ??= [];
    // projeto salvo quando o corte era global não traz os campos por imagem
    item.smoothing ??= this.prefs.smoothing;
    item.keepCorners ??= this.prefs.keepCorners;
    item.fillHoles ??= this.prefs.fillHoles;
    // remoções de fundo salvas são reaplicadas sobre a arte original
    for (const r of item.bgRemovals) floodRemoveBackground(item.source, r.x, r.y, r.tolerance);
    if (item.bgRemovals.length) {
      item.bgRemoved = true;
      item.thumbUrl = makeThumb(item.source);
    }

    this.images.update((list) => [...list, item]);
    if (!this.selectedId()) this.selectedId.set(item.id);
    this.scheduleRender();
    return item;
  }

  select(id: string): void {
    this.selectedId.set(id);
    this.tool.set('nenhuma');
    this.scheduleRender();
  }

  remove(id: string): void {
    this.images.update((list) => list.filter((i) => i.id !== id));
    this.pieceCache.delete(id);
    if (this.selectedId() === id) {
      this.selectedId.set(this.images()[0]?.id ?? null);
    }
    this.scheduleRender();
  }

  /** Quebra a imagem selecionada em elementos independentes: cada desenho
   * solto vira um item da lista, com seus próprios ajustes de corte, tamanho e
   * cópias. É o caminho pra uma folha com seis adesivos sair como seis SVGs de
   * corte em vez de um só. */
  /** Refaz a leitura dos elementos da imagem selecionada. É ela que alimenta
   * tanto os retângulos desenhados na prévia quanto a divisão de verdade —
   * o que se vê marcado na tela é exatamente o que vai virar item. */
  private refreshSplitPreview(auto = false): void {
    const sel = this.selected();
    if (!sel || this.tool() !== 'dividir') {
      this.splitPlan = null;
      this.splitFound.set([]);
      return;
    }
    // A prévia lê uma cópia reduzida: o controle é arrastado, e varrer 3000 px
    // a cada passo travaria o painel. A divisão de verdade refaz a leitura na
    // arte inteira — os parâmetros são todos em mm, então acompanham a escala.
    const escala = Math.min(1, SPLIT_PREVIEW_WIDTH / sel.source.width);
    const arte = escala < 1 ? downscale(sel.source, escala) : sel.source;
    const plano = planSplit(arte, this.splitOptions(sel, escala, auto));
    this.splitPlan = plano;
    if (auto) {
      const ppm = this.pxPerMm(sel) * escala;
      this.splitGapMm.set(Math.round((plano.gapPx / ppm) * 100) / 100);
    }
    this.splitFound.set(escala < 1
      ? plano.elements.map((el) => ({
          ...el,
          x: Math.round(el.x / escala), y: Math.round(el.y / escala),
          w: Math.round(el.w / escala), h: Math.round(el.h / escala),
        }))
      : plano.elements);
  }

  /** Os mesmos parâmetros pra prévia e pra divisão, convertidos dos mm da peça
   * pra px da arte na escala pedida. */
  private splitOptions(item: ImportedImage, escala: number, auto = false): SplitOptions {
    const ppm = this.pxPerMm(item) * escala;
    return {
      bgTolerance: this.splitTolerance(),
      gapPx: Math.round(this.splitGapMm() * ppm),
      minAreaPx: Math.max(16, Math.round(SPLIT_MIN_AREA_MM2 * ppm * ppm)),
      padPx: Math.max(1, Math.round(ppm)),
      autoGapCandidatesPx: auto ? SPLIT_GAP_CANDIDATES_MM.map((mm) => Math.round(mm * ppm)) : undefined,
    };
  }

  onSplitToleranceInput(event: Event): void {
    this.splitTolerance.set(Number((event.target as HTMLInputElement).value));
    this.refreshSplitPreview();
    this.scheduleRender();
  }

  onSplitGapInput(event: Event): void {
    this.splitGapMm.set(Number((event.target as HTMLInputElement).value));
    this.refreshSplitPreview();
    this.scheduleRender();
  }

  autoSplit(): void {
    this.refreshSplitPreview(true);
    this.scheduleRender();
  }

  /** O que está sendo mostrado agora, em uma frase — o retorno que faltava:
   * antes a divisão era um botão que ou fazia tudo ou dizia "não deu". */
  splitSummary(): string {
    const achados = this.splitFound().length;
    if (!this.splitPlan) return 'Lendo a imagem…';
    const origem = this.splitPlan.fromAlpha ? 'pela transparência' : 'pela cor do fundo';
    if (achados < 2) {
      return achados === 1
        ? `Um elemento só, lido ${origem}. Se a folha tem vários desenhos, desça o "juntar pedaços" até eles se separarem.`
        : `Nenhum elemento ${origem}. Desça a tolerância do fundo — nesse valor a arte inteira está passando por fundo.`;
    }
    return `${plural(achados, 'elemento marcado', 'elementos marcados')} na prévia, lidos ${origem}. Desenho picado em vários? Suba o "juntar pedaços". Vizinhos grudados num só? Desça.`;
  }

  splitSelected(): void {
    const sel = this.selected();
    if (!sel || this.splitFound().length < 2) return;
    // relê na arte inteira: a prévia roda numa cópia reduzida, e o recorte que
    // vira item tem de sair na resolução original
    const plano = planSplit(sel.source, this.splitOptions(sel, 1));
    if (plano.elements.length < 2) return;
    const pedacos = plano.elements.map((el) => plano.crop(el));

    const base = this.baseName(sel);
    const herdado: Partial<ImportedImage> = {
      marginMm: sel.marginMm, gapMm: sel.gapMm, color: sel.color, shape: sel.shape,
      mirrored: sel.mirrored, copies: sel.copies, outerOnly: sel.outerOnly,
      smoothing: sel.smoothing, keepCorners: sel.keepCorners, fillHoles: sel.fillHoles,
    };
    const novos = pedacos.map((canvas, i) => this.addArt(`${base} ${i + 1}`, canvas, {
      ...herdado,
      // cada elemento nasce no tamanho real que já tinha dentro da folha
      widthMm: Math.max(1, (sel.widthMm * canvas.width) / sel.source.width),
    }));

    this.remove(sel.id);
    this.selectedId.set(novos[0].id);
    this.tool.set('nenhuma');
    this.splitPlan = null;
    this.splitFound.set([]);
    this.scheduleRender();
  }

  // ---------- edição da imagem selecionada ----------

  private updateSelected(patch: Partial<ImportedImage>): void {
    const id = this.selectedId();
    if (!id) return;
    this.images.update((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    this.scheduleRender();
  }

  // ---------- área de trabalho ----------

  /** Os campos numéricos novos falam número; os handlers do Print & Cut
   * leem o valor de um evento de input. Este adaptador liga os dois sem
   * duplicar a regra de cada campo. */
  ev(value: number): Event {
    return { target: { value: String(value) } } as unknown as Event;
  }

  toggleMirror(): void {
    const sel = this.selected();
    if (sel) this.updateSelected({ mirrored: !sel.mirrored });
  }

  setZoomPct(pct: number): void {
    this.zoom.set(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pct / 100)));
    this.scheduleRender();
  }

  /** Seções do painel Ajustes: abertas por padrão; o que o usuário fecha fica
   * lembrado nas preferências. */
  pcClosed(id: StepId): boolean {
    return this.openSections()[id] === false;
  }

  pcFlip(id: StepId): void {
    const next = { ...this.openSections(), [id]: this.openSections()[id] === false };
    this.openSections.set(next);
    this.prefs.openSections = next;
    this.savePrefs();
  }

  /** O que a barra de status diz sobre a ferramenta em uso. */
  pcHint(): string {
    if (this.cutHint()) return this.cutHint();
    switch (this.tool()) {
      case 'fundo': return 'Clique na cor de fundo: a região contígua àquela cor é apagada.';
      case 'borracha': return 'Arraste sobre o contorno pra apagá-lo — a arte não é afetada.';
      case 'corte': return 'Clique dentro de uma linha tracejada pra tirá-la do corte.';
      case 'dividir': return this.splitSummary();
      default: return 'A linha tracejada vermelha é a linha de corte que sai no SVG · Ctrl+roda dá zoom';
    }
  }

  toggleProjects(): void {
    this.projectsOpen.update((v) => !v);
    if (this.projectsOpen()) void this.refreshProjects();
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocPointerDown(event: PointerEvent): void {
    if (this.projectsOpen() && !(event.target as Element).closest?.('.ab-menu-wrap')) this.projectsOpen.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  onPageKey(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.saveProject();
      return;
    }
    if (this.modo() !== 'corte' || isTyping(event.target) || event.altKey) return;
    if (ctrl) {
      if (event.code === 'Digit0') { event.preventDefault(); this.resetZoom(); }
      else if (event.key === '=' || event.key === '+') { event.preventDefault(); this.zoomBy(1.25); }
      else if (event.key === '-') { event.preventDefault(); this.zoomBy(1 / 1.25); }
      return;
    }
    if (event.key === 'Escape') { this.setTool('nenhuma'); return; }
    const tool = PC_TOOLS.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
    if (tool && (tool.id === 'nenhuma' || this.selected())) {
      if (this.tool() !== tool.id) this.setTool(tool.id);
    }
  }

  // ---------- ponte com a Ilustração ----------

  /** A arte da ilustração entra como imagem nova do Print & Cut, já na largura
   * física do desenho. */
  onIllustrationToCut(event: { canvas: HTMLCanvasElement; name: string; widthMm: number }): void {
    const item = this.addArt(event.name, event.canvas, { widthMm: event.widthMm });
    this.selectedId.set(item.id);
    this.setModo('corte');
    this.scheduleRender();
  }

  onIllustrationToTemplate(event: { svg: string; name: string }): void {
    try {
      this.templates.loadSvgText(event.svg, event.name);
      this.setModo('molde');
    } catch {
      this.projectStatus.set('Não consegui abrir a ilustração como molde.');
    }
  }

  /** Manda a arte selecionada (com o fundo já removido, se foi) pra vetorizar. */
  vectorizeSelected(): void {
    const sel = this.selected();
    if (!sel) return;
    this.illustration.pendingImport.set({ name: sel.name.replace(/\.[^.]+$/, ''), canvas: sel.source });
    this.setModo('ilustracao');
  }

  setModo(modo: EditorMode): void {
    if (this.modo() === modo) return;
    this.modo.set(modo);
    this.prefs.modo = modo;
    this.savePrefs();
  }

  setView(view: 'peca' | 'folha'): void {
    this.view.set(view);
    this.tool.set('nenhuma');
    this.scheduleRender();
  }

  onWidthCmChange(event: Event): void {
    const cm = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(cm) || cm <= 0) return;
    const widthMm = Math.min(1000, Math.max(10, cm * 10));
    this.prefs.widthMm = widthMm;
    this.savePrefs();
    this.updateSelected({ widthMm });
  }

  onCopiesChange(event: Event): void {
    const copies = Math.min(99, Math.max(1, Math.round(Number((event.target as HTMLInputElement).value) || 1)));
    this.updateSelected({ copies });
  }

  onMirrorChange(event: Event): void {
    this.updateSelected({ mirrored: (event.target as HTMLInputElement).checked });
  }

  setShape(shape: CutShape): void {
    this.prefs.shape = shape;
    this.savePrefs();
    this.updateSelected({ shape });
  }

  onMarginInput(event: Event): void {
    this.markInteracting();
    const marginMm = Number((event.target as HTMLInputElement).value);
    this.prefs.marginMm = marginMm;
    this.savePrefs();
    this.updateSelected({ marginMm });
  }

  nudgeMargin(delta: number): void {
    const sel = this.selected();
    if (!sel) return;
    const marginMm = Math.min(MAX_MARGIN_MM, Math.max(0, Math.round((sel.marginMm + delta) * 10) / 10));
    this.prefs.marginMm = marginMm;
    this.savePrefs();
    this.updateSelected({ marginMm });
  }

  onGapInput(event: Event): void {
    this.markInteracting();
    const gapMm = Number((event.target as HTMLInputElement).value);
    this.prefs.gapMm = gapMm;
    this.savePrefs();
    this.updateSelected({ gapMm });
  }

  onColorInput(event: Event): void {
    this.setColor((event.target as HTMLInputElement).value);
  }

  setColor(color: string): void {
    this.prefs.color = color;
    this.savePrefs();
    this.updateSelected({ color });
  }

  onSmoothingInput(event: Event): void {
    this.markInteracting();
    const smoothing = Number((event.target as HTMLInputElement).value);
    this.prefs.smoothing = smoothing;
    this.savePrefs();
    this.updateSelected({ smoothing });
  }

  onKeepCornersChange(event: Event): void {
    const keepCorners = (event.target as HTMLInputElement).checked;
    this.prefs.keepCorners = keepCorners;
    this.savePrefs();
    this.updateSelected({ keepCorners });
  }

  onFillHolesChange(event: Event): void {
    const fillHoles = (event.target as HTMLInputElement).checked;
    this.prefs.fillHoles = fillHoles;
    this.savePrefs();
    this.updateSelected({ fillHoles });
  }

  // ---------- ferramentas sobre a peça (fundo e borracha) ----------

  setTool(tool: 'nenhuma' | 'fundo' | 'borracha' | 'corte' | 'dividir'): void {
    const next = this.tool() === tool ? 'nenhuma' : tool;
    if (next !== 'nenhuma') this.view.set('peca');
    this.tool.set(next);
    this.cutHint.set('');
    this.refreshSplitPreview(next === 'dividir');
    this.scheduleRender();
  }

  onToleranceInput(event: Event): void {
    this.tolerance.set(Number((event.target as HTMLInputElement).value));
  }

  onBrushInput(event: Event): void {
    this.markInteracting();
    this.brushMm.set(Number((event.target as HTMLInputElement).value));
    this.prefs.brushMm = this.brushMm();
    this.savePrefs();
  }

  onOuterOnlyChange(event: Event): void {
    const outerOnly = (event.target as HTMLInputElement).checked;
    this.prefs.outerOnly = outerOnly;
    this.savePrefs();
    this.updateSelected({ outerOnly });
  }

  /** Coordenada do evento em pixels da arte original (desfazendo o espelho). */
  private artPointFrom(event: PointerEvent | MouseEvent, item: ImportedImage): { x: number; y: number } | null {
    const canvas = this.previewCanvas?.nativeElement;
    if (!canvas) return null;
    // Pelo retângulo real na tela, e não por offsetX: assim vale em qualquer
    // zoom e com o palco rolado, sem precisar saber a escala aplicada.
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const piece = this.pieceFor(item);
    const px = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * canvas.height;
    // de pixels da peça (que pode estar em escala reduzida) pra pixels da arte
    const x = (px - piece.artX) / piece.scale;
    return { x: item.mirrored ? item.source.width - x : x, y: (py - piece.artY) / piece.scale };
  }

  onPreviewClick(event: MouseEvent): void {
    if (this.tool() === 'corte') {
      this.removeCutAt(event);
      return;
    }
    if (this.tool() !== 'fundo') return;
    const sel = this.selected();
    if (!sel) return;
    const point = this.artPointFrom(event, sel);
    if (!point) return;
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    const changed = floodRemoveBackground(sel.source, x, y, this.tolerance());
    if (changed) {
      this.updateSelected({
        srcVersion: sel.srcVersion + 1,
        bgRemoved: true,
        thumbUrl: makeThumb(sel.source),
        bgRemovals: [...sel.bgRemovals, { x, y, tolerance: this.tolerance() }],
      });
    }
  }

  onPreviewPointerDown(event: PointerEvent): void {
    if (this.tool() !== 'borracha') return;
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.erasing = true;
    this.eraseAt(event);
  }

  onPreviewPointerMove(event: PointerEvent): void {
    if (!this.erasing) return;
    this.eraseAt(event);
  }

  onPreviewPointerUp(event: PointerEvent): void {
    if (!this.erasing) return;
    this.erasing = false;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /** Registra uma borrachada, ignorando pontos quase colados no anterior pra não
   * acumular centenas de círculos redundantes num arrasto. */
  private eraseAt(event: PointerEvent): void {
    const sel = this.selected();
    if (!sel) return;
    this.markInteracting();
    const point = this.artPointFrom(event, sel);
    if (!point) return;
    const r = Math.max(1, this.brushMm() * this.pxPerMm(sel));
    const last = sel.erasures[sel.erasures.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < r / 3) return;
    this.updateSelected({
      erasures: [...sel.erasures, { x: point.x, y: point.y, r }],
      editVersion: sel.editVersion + 1,
    });
  }

  /** Descarta a linha de corte clicada (a mais justa ao ponto). */
  private removeCutAt(event: MouseEvent): void {
    const sel = this.selected();
    if (!sel) return;
    const point = this.artPointFrom(event, sel);
    if (!point) return;
    const piece = this.pieceFor(sel);
    const x = piece.artX + (sel.mirrored ? sel.source.width - point.x : point.x);
    if (smallestPathContaining(piece.paths, x, piece.artY + point.y) < 0) {
      this.cutHint.set('Nenhuma linha de corte nesse ponto — clique dentro da linha que quer remover.');
      return;
    }
    this.cutHint.set('');
    this.updateSelected({
      cutRemovals: [...sel.cutRemovals, { x: point.x, y: point.y }],
      editVersion: sel.editVersion + 1,
    });
  }

  undoCutRemoval(): void {
    const sel = this.selected();
    if (!sel || !sel.cutRemovals.length) return;
    this.cutHint.set('');
    this.updateSelected({ cutRemovals: sel.cutRemovals.slice(0, -1), editVersion: sel.editVersion + 1 });
  }

  restoreCuts(): void {
    const sel = this.selected();
    if (!sel || !sel.cutRemovals.length) return;
    this.cutHint.set('');
    this.updateSelected({ cutRemovals: [], editVersion: sel.editVersion + 1 });
  }

  undoErase(): void {
    const sel = this.selected();
    if (!sel || !sel.erasures.length) return;
    this.updateSelected({ erasures: sel.erasures.slice(0, -1), editVersion: sel.editVersion + 1 });
  }

  clearErasures(): void {
    const sel = this.selected();
    if (!sel || !sel.erasures.length) return;
    this.updateSelected({ erasures: [], editVersion: sel.editVersion + 1 });
  }

  restoreOriginal(): void {
    const sel = this.selected();
    if (!sel) return;
    const ctx = sel.source.getContext('2d')!;
    ctx.clearRect(0, 0, sel.source.width, sel.source.height);
    ctx.drawImage(sel.original, 0, 0);
    this.updateSelected({
      srcVersion: sel.srcVersion + 1,
      bgRemoved: false,
      thumbUrl: makeThumb(sel.source),
      bgRemovals: [],
    });
  }

  // ---------- folha ----------

  onSheetSizeChange(event: Event): void {
    this.sheetSize.set((event.target as HTMLSelectElement).value as SheetSize);
    this.prefs.sheetSize = this.sheetSize();
    this.savePrefs();
    this.scheduleRender();
  }

  onOrientationChange(event: Event): void {
    this.orientation.set((event.target as HTMLSelectElement).value as SheetOrientation);
    this.prefs.orientation = this.orientation();
    this.savePrefs();
    this.scheduleRender();
  }

  onSpacingInput(event: Event): void {
    this.markInteracting();
    this.spacingMm.set(Number((event.target as HTMLInputElement).value));
    this.prefs.spacingMm = this.spacingMm();
    this.savePrefs();
    this.scheduleRender();
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch { /* prefs são só conveniência */ }
  }

  // ---------- geração da peça ----------

  /** Largura de trabalho da peça. Na prévia acompanha o que aparece na tela
   * (vezes o zoom, pra manter nitidez ao aproximar) e cai pela metade enquanto
   * um controle está sendo arrastado, pra resposta imediata; ao soltar, o
   * redesenho volta na resolução boa. Exportação sempre usa a arte inteira. */
  private workWidth(item: ImportedImage, quality: PieceQuality): number {
    if (quality === 'full') return item.source.width;
    const stage = this.pieceStage?.nativeElement;
    const exibida = Math.max(320, stage?.clientWidth ?? 800);
    const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    const alvo = exibida * this.zoom() * dpr * (this.interacting ? 0.5 : 1);
    return Math.round(Math.min(item.source.width, Math.max(MIN_WORK_WIDTH, alvo)));
  }

  private pieceFor(item: ImportedImage, quality: PieceQuality = 'preview'): Piece {
    const largura = this.workWidth(item, quality);
    const sig = JSON.stringify([
      item.widthMm, item.marginMm, item.gapMm, item.color, item.shape, item.mirrored,
      item.srcVersion, item.outerOnly, item.editVersion, item.cutRemovals.length,
      item.smoothing, item.keepCorners, item.fillHoles, largura,
    ]);
    if (quality === 'full') return this.buildPiece(item, largura);
    const cached = this.pieceCache.get(item.id);
    if (cached && cached.sig === sig) return cached.piece;
    const piece = this.buildPiece(item, largura);
    this.pieceCache.set(item.id, { sig, piece });
    return piece;
  }

  /** Remove os contornos marcados pelo usuário: pra cada ponto guardado, cai
   * fora o caminho mais justo que o contém. */
  private dropRemovedCuts(
    paths: Polygon[], item: ImportedImage, artX: number, artY: number, escala: number, artWidth: number,
  ): Polygon[] {
    if (!item.cutRemovals.length) return paths;
    let kept = paths;
    for (const c of item.cutRemovals) {
      const cx = c.x * escala;
      const x = artX + (item.mirrored ? artWidth - cx : cx);
      const idx = smallestPathContaining(kept, x, artY + c.y * escala);
      if (idx >= 0) kept = kept.filter((_, i) => i !== idx);
    }
    return kept;
  }

  /** O ajuste de curvas sempre protege canto vivo, independente da chave do
   * painel: ela manda na *suavização*, e com ela desligada a suavização já
   * entrega o canto arredondado. Com a suavização em zero é o que garante que
   * a escada do pixel saia reta, fiel, em vez de virar curva. */
  private fitCuts(paths: Polygon[], ppm: number): CubicPath[] {
    const tolerance = Math.max(0.05, ppm * FIT_TOLERANCE_MM);
    return paths.map((poly) => polygonToCubics(poly, { tolerance, cornerAngle: CORNER_ANGLE }));
  }

  private buildPiece(item: ImportedImage, workWidth: number): Piece {
    const escala = Math.min(1, workWidth / item.source.width);
    const base = item.mirrored ? flipHorizontal(item.source) : item.source;
    const source = escala < 1 ? downscale(base, escala) : base;
    // ppm da peça acompanha a escala, então tudo que vira mm depois continua certo
    const ppm = this.pxPerMm(item) * escala;
    const marginPx = Math.round(item.marginMm * ppm);
    const gapPx = Math.round(item.gapMm * ppm);
    const total = marginPx + gapPx;

    if (item.shape === 'silhueta') {
      const contour = buildContourLayer(source, marginPx, gapPx, item.color, item.outerOnly);
      applyErasures(contour, scaleErasures(item.erasures, escala), total, total, item.mirrored, source.width);

      const canvas = document.createElement('canvas');
      canvas.width = contour.width;
      canvas.height = contour.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(contour, 0, 0);
      ctx.drawImage(source, total, total);

      // tudo em mm vezes o ppm DESTA peça, pra a prévia (que trabalha numa
      // escala menor) suavizar na mesma medida que a exportação
      const paths = traceCutPaths(canvas, {
        fillHoles: item.fillHoles,
        smoothSigma: item.smoothing > 0
          ? Math.max(MIN_SMOOTH_PX, smoothingSigmaMm(item.smoothing) * ppm)
          : 0,
        cornerAngle: item.keepCorners ? CORNER_ANGLE : 0,
        simplifyEpsilon: Math.max(0.05, ppm * SIMPLIFY_MM),
        minArea: Math.max(16, ppm * ppm), // descarta pedaços menores que ~1 mm²
      });
      const mantidos = this.dropRemovedCuts(paths, item, total, total, escala, source.width);
      return {
        canvas, paths: mantidos, cuts: this.fitCuts(mantidos, ppm),
        ppm, artX: total, artY: total, scale: escala,
      };
    }

    const { W, H } = shapeCanvasSize(item.shape, source.width, source.height, total);
    const artX = (W - source.width) / 2;
    const artY = (H - source.height) / 2;
    const cornerRadius = total + 2 * ppm;
    const outer = shapePolygon(item.shape, W, H, 0, cornerRadius);

    const contour = document.createElement('canvas');
    contour.width = W;
    contour.height = H;
    if (total > 0) {
      const cctx = contour.getContext('2d')!;
      fillPolygon(cctx, outer, item.color);
      if (gapPx > 0) fillPolygon(cctx, shapePolygon(item.shape, W, H, marginPx, cornerRadius), '#ffffff');
      applyErasures(contour, scaleErasures(item.erasures, escala), artX, artY, item.mirrored, source.width);
    }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(contour, 0, 0);
    ctx.drawImage(source, artX, artY);
    const mantidos = this.dropRemovedCuts([outer], item, artX, artY, escala, source.width);
    return {
      canvas, paths: mantidos, cuts: this.fitCuts(mantidos, ppm),
      ppm, artX, artY, scale: escala,
    };
  }

  // ---------- render ----------

  /** Marca que um controle está sendo mexido: a prévia cai pra meia resolução e
   * volta à resolução boa pouco depois da última mudança. */
  private markInteracting(): void {
    this.interacting = true;
    clearTimeout(this.interactionTimer);
    this.interactionTimer = setTimeout(() => {
      this.interacting = false;
      this.scheduleRender();
    }, 220);
  }

  /** Agrupa mudanças rápidas (arrastar o slider) num único redesenho por frame. */
  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (this.view() === 'peca') this.renderPreview();
      else this.renderSheet();
    });
  }

  private renderPreview(): void {
    const sel = this.selected();
    const canvas = this.previewCanvas?.nativeElement;
    if (!sel || !canvas) return;
    const piece = this.pieceFor(sel);
    canvas.width = piece.canvas.width;
    canvas.height = piece.canvas.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(piece.canvas, 0, 0);
    this.strokeCutPaths(ctx, piece.cuts, Math.max(1.5, canvas.width / 500));
    if (this.tool() === 'dividir') this.strokeSplitBoxes(ctx, sel, piece);
    this.applyZoom(canvas, this.pieceStage?.nativeElement);
    // Gravado aqui, e não calculado no template: a resolução da prévia depende
    // da largura do palco, e o arredondamento mudava entre duas verificações.
    this.pieceLabel.set(this.pieceSizeLabel(sel));
  }

  /** Marca na prévia cada elemento que a divisão encontrou, numerado na ordem
   * em que vai entrar na lista. Nas coordenadas da peça: a arte mora deslocada
   * pela margem e, quando espelhada, invertida. */
  private strokeSplitBoxes(ctx: CanvasRenderingContext2D, item: ImportedImage, piece: Piece): void {
    const elementos = this.splitFound();
    const escala = piece.scale;
    const larguraArte = item.source.width * escala;
    const linha = Math.max(1.5, ctx.canvas.width / 400);
    ctx.save();
    ctx.lineWidth = linha;
    ctx.font = `bold ${Math.max(12, ctx.canvas.width / 40)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    elementos.forEach((el, i) => {
      const w = el.w * escala;
      const h = el.h * escala;
      const x = piece.artX + (item.mirrored ? larguraArte - el.x * escala - w : el.x * escala);
      const y = piece.artY + el.y * escala;
      ctx.strokeStyle = '#2f6fed';
      ctx.fillStyle = 'rgba(47, 111, 237, 0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      const rotulo = String(i + 1);
      const largura = ctx.measureText(rotulo).width + linha * 4;
      const altura = Math.max(14, ctx.canvas.width / 34);
      ctx.fillStyle = '#2f6fed';
      ctx.fillRect(x, y, largura, altura);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(rotulo, x + linha * 2, y + linha);
    });
    ctx.restore();
  }

  private strokeCutPaths(ctx: CanvasRenderingContext2D, paths: CubicPath[], lineWidth: number): void {
    ctx.strokeStyle = '#e5383b';
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
    // as mesmas curvas que vão pro SVG: o tracejado na tela é literalmente o
    // caminho exportado, então não tem "na prévia parecia liso e saiu diferente"
    for (const { start, segments } of paths) {
      if (!segments.length) continue;
      ctx.beginPath();
      ctx.moveTo(start[0], start[1]);
      for (const s of segments) {
        if (s.c1 && s.c2) ctx.bezierCurveTo(s.c1[0], s.c1[1], s.c2[0], s.c2[1], s.to[0], s.to[1]);
        else ctx.lineTo(s.to[0], s.to[1]);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private packCurrent(): { placed: PlacedPiece[]; overflow: PackInput[]; wMm: number; hMm: number } {
    const { wMm, hMm } = sheetDimensionsMm(this.sheetSize(), this.orientation());
    const inputs: PackInput[] = [];
    for (const item of this.images()) {
      const piece = this.pieceFor(item);
      const pw = piece.canvas.width / piece.ppm;
      const ph = piece.canvas.height / piece.ppm;
      for (let c = 0; c < item.copies; c++) {
        inputs.push({ id: `${item.id}#${c}`, wMm: pw, hMm: ph });
      }
    }
    const { placed, overflow } = packShelves(inputs, wMm, hMm, SHEET_MARGIN_MM, this.spacingMm());
    return { placed, overflow, wMm, hMm };
  }

  private itemOf(placedId: string): ImportedImage | undefined {
    const id = placedId.split('#')[0];
    return this.images().find((i) => i.id === id);
  }

  private renderSheet(): void {
    const canvas = this.sheetCanvas?.nativeElement;
    if (!canvas) return;
    const { placed, overflow, wMm, hMm } = this.packCurrent();
    this.packInfo.set({ placed: placed.length, overflow: overflow.length });

    const scale = 3; // px por mm no preview
    canvas.width = Math.round(wMm * scale);
    canvas.height = Math.round(hMm * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#c9c9d4';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

    for (const p of placed) {
      const item = this.itemOf(p.id);
      if (!item) continue;
      const piece = this.pieceFor(item);
      const x = p.xMm * scale;
      const y = p.yMm * scale;
      const w = p.wMm * scale;
      const h = p.hMm * scale;
      ctx.drawImage(piece.canvas, x, y, w, h);
      const f = scale / piece.ppm; // px da peça → px do preview
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(f, f);
      this.strokeCutPaths(ctx, piece.cuts, Math.max(1.2, 1.2 / f));
      ctx.restore();
    }
    this.applyZoom(canvas, this.sheetStage?.nativeElement);
  }

  // ---------- exportação da peça ----------

  exportPrintPng(): void {
    const sel = this.selected();
    if (!sel) return;
    const piece = this.pieceFor(sel, 'full');
    const totalWMm = piece.canvas.width / piece.ppm;
    const targetW = Math.round((totalWMm / 25.4) * EXPORT_DPI);
    const targetH = Math.round((targetW * piece.canvas.height) / piece.canvas.width);
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(piece.canvas, 0, 0, targetW, targetH);
    out.toBlob(async (blob) => {
      if (!blob) return;
      const withDpi = await pngBlobWithDpi(blob, EXPORT_DPI);
      this.downloadBlob(withDpi, this.baseName(sel) + '-impressao.png');
    }, 'image/png');
  }

  exportCutSvg(): void {
    const sel = this.selected();
    if (!sel) return;
    const piece = this.pieceFor(sel, 'full');
    const svg = this.pieceSvg(piece, null);
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), this.baseName(sel) + '-corte.svg');
  }

  exportFullSvg(): void {
    const sel = this.selected();
    if (!sel) return;
    const piece = this.pieceFor(sel, 'full');
    const svg = this.pieceSvg(piece, piece.canvas.toDataURL('image/png'));
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), this.baseName(sel) + '-arte-corte.svg');
  }

  /** Um SVG de corte por imagem da lista, num ZIP só: depois de dividir a
   * folha em seis elementos, baixar seis arquivos um a um (cada um com seu
   * diálogo do navegador) é o que tornava a divisão inútil na prática. */
  async exportCutSvgZip(): Promise<void> {
    const itens = this.images();
    if (!itens.length || this.zipping()) return;
    this.zipping.set(true);
    this.zipStatus.set('Nomeando os elementos com IA…');

    // Os nomes vêm da IA olhando cada elemento: depois de dividir uma folha os
    // itens se chamam "proj 1…proj 6", e um ZIP assim obriga a abrir arquivo por
    // arquivo pra achar o polvo. Se a IA não estiver configurada ou falhar, o
    // ZIP sai do mesmo jeito com o nome que o item já tinha.
    let nomesIa: string[] = [];
    try {
      const sugestao = await this.naming.nomear(itens.map((i) => this.naming.miniatura(i.source)));
      nomesIa = sugestao.usouIa ? sugestao.nomes : [];
      this.zipStatus.set(sugestao.usouIa
        ? `Nomes dados pela IA a ${plural(sugestao.nomes.length, 'elemento', 'elementos')}.`
        : `Nomes mantidos como estão — ${sugestao.motivo ?? 'a IA não respondeu'}.`);
    } finally {
      this.zipping.set(false);
    }

    const nomes = uniqueNames(itens.map((item, i) => `${nomesIa[i] || this.baseName(item)}-corte.svg`));
    const arquivos = itens.map((item, i) => ({
      name: nomes[i],
      content: this.pieceSvg(this.pieceFor(item, 'full'), null),
    }));
    const projeto = this.projectName().trim() || 'corte';
    this.downloadBlob(zipStore(arquivos), `${projeto}-svgs.zip`);
  }

  private pieceSvg(piece: Piece, imageHref: string | null): string {
    const wMm = piece.canvas.width / piece.ppm;
    const hMm = piece.canvas.height / piece.ppm;
    const d = cubicPathsToData(piece.cuts);
    const strokePx = piece.ppm * 0.2; // 0,2 mm
    const image = imageHref
      ? `\n  <image x="0" y="0" width="${piece.canvas.width}" height="${piece.canvas.height}" href="${imageHref}" />`
      : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${wMm.toFixed(2)}mm" height="${hMm.toFixed(2)}mm" ` +
      `viewBox="0 0 ${piece.canvas.width} ${piece.canvas.height}">${image}\n` +
      `  <path d="${d}" fill="none" stroke="#ff0000" stroke-width="${strokePx.toFixed(2)}" />\n` +
      `</svg>\n`;
  }

  // ---------- exportação da folha ----------

  private renderSheetHiRes(): { canvas: HTMLCanvasElement; wMm: number; hMm: number } | null {
    const { placed, wMm, hMm } = this.packCurrent();
    if (!placed.length) return null;
    const scale = EXPORT_DPI / 25.4; // px por mm
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(wMm * scale);
    canvas.height = Math.round(hMm * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    for (const p of placed) {
      const item = this.itemOf(p.id);
      if (!item) continue;
      const piece = this.pieceFor(item, 'full');
      ctx.drawImage(piece.canvas, p.xMm * scale, p.yMm * scale, p.wMm * scale, p.hMm * scale);
    }
    return { canvas, wMm, hMm };
  }

  exportSheetPng(): void {
    const sheet = this.renderSheetHiRes();
    if (!sheet) return;
    sheet.canvas.toBlob(async (blob) => {
      if (!blob) return;
      const withDpi = await pngBlobWithDpi(blob, EXPORT_DPI);
      this.downloadBlob(withDpi, `folha-${this.sheetSize()}.png`);
    }, 'image/png');
  }

  exportSheetPdf(): void {
    const sheet = this.renderSheetHiRes();
    if (!sheet) return;
    sheet.canvas.toBlob(async (blob) => {
      if (!blob) return;
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const pdf = jpegToPdf(jpeg, sheet.wMm, sheet.hMm, sheet.canvas.width, sheet.canvas.height);
      this.downloadBlob(pdf, `folha-${this.sheetSize()}.pdf`);
    }, 'image/jpeg', 0.92);
  }

  exportSheetSvg(): void {
    const { placed, wMm, hMm } = this.packCurrent();
    if (!placed.length) return;
    // viewBox em mm: os polígonos das peças (em px) são convertidos por ppm
    let paths = '';
    for (const p of placed) {
      const item = this.itemOf(p.id);
      if (!item) continue;
      const piece = this.pieceFor(item, 'full');
      const paraMm = ([x, y]: Point): Point => [p.xMm + x / piece.ppm, p.yMm + y / piece.ppm];
      const mm = piece.cuts.map((c) => mapCubicPath(c, paraMm));
      paths += `  <path d="${cubicPathsToData(mm)}" fill="none" stroke="#ff0000" stroke-width="0.2" />\n`;
    }
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wMm} ${hMm}">\n` +
      paths +
      `</svg>\n`;
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `folha-${this.sheetSize()}-corte.svg`);
  }

  // ---------- projetos no backend ----------

  async refreshProjects(): Promise<void> {
    try {
      this.projects.set(await this.projectsApi.list());
    } catch {
      this.projectStatus.set('Não foi possível listar os projetos salvos.');
    }
  }

  private serialize(): string {
    return JSON.stringify({
      version: 3,
      sheetSize: this.sheetSize(),
      orientation: this.orientation(),
      spacingMm: this.spacingMm(),
      images: this.images().map((i) => ({
        name: i.name,
        original: i.originalDataUrl,
        bgRemovals: i.bgRemovals,
        erasures: i.erasures,
        cutRemovals: i.cutRemovals,
        widthMm: i.widthMm,
        marginMm: i.marginMm,
        gapMm: i.gapMm,
        color: i.color,
        shape: i.shape,
        mirrored: i.mirrored,
        copies: i.copies,
        outerOnly: i.outerOnly,
        smoothing: i.smoothing,
        keepCorners: i.keepCorners,
        fillHoles: i.fillHoles,
      })),
      // O molde entra no mesmo projeto: um documento do Editor de Imagens tem todos os modos.
      molde: this.templates.serialize(),
      social: this.social.serialize(),
      ilustracao: this.illustration.serialize(),
    });
  }

  async saveProject(): Promise<void> {
    if (this.savingProject()) return;
    const name = this.projectName().trim() || 'Projeto sem nome';
    if (!this.images().length && !this.templates.hasTemplate() && !this.social.hasImage() && !this.illustration.hasContent()) {
      this.projectStatus.set('Importe ao menos uma imagem (ou um molde, ou desenhe na ilustração) antes de salvar.');
      return;
    }
    this.savingProject.set(true);
    this.projectStatus.set('Salvando…');
    const id = this.projectId() ?? uuid();
    try {
      const saved = await this.projectsApi.save(id, name, this.serialize(), this.projectCreatedAt);
      this.projectId.set(saved.id);
      this.projectName.set(saved.name);
      this.projectCreatedAt = saved.createdAt;
      this.projectStatus.set(`Salvo às ${new Date().toLocaleTimeString('pt-BR')}`);
      await this.refreshProjects();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      this.projectStatus.set(status === 413
        ? 'Projeto grande demais pro servidor — remova imagens, reduza a quantidade ou tire fotos do molde.'
        : 'Falha ao salvar. Tente de novo.');
    } finally {
      this.savingProject.set(false);
    }
  }

  async openProject(id: string): Promise<void> {
    this.projectStatus.set('Abrindo…');
    try {
      const dto = await this.projectsApi.get(id);
      const data = JSON.parse(dto.data) as {
        smoothing?: number; keepCorners?: boolean; fillHoles?: boolean; sheetSize?: SheetSize;
        orientation?: SheetOrientation; spacingMm?: number;
        images?: (Partial<ImportedImage> & { original: string })[];
        molde?: TemplateProjectData | null;
        social?: SocialProjectData | null;
        ilustracao?: IllustrationProjectData | null;
      };

      this.images.set([]);
      this.pieceCache.clear();
      this.selectedId.set(null);
      // Até a versão 2 o corte era um ajuste só, valendo pra folha inteira;
      // agora ele mora em cada imagem, e o valor antigo vira o padrão delas.
      const cutLegado: Partial<ImportedImage> = {
        smoothing: data.smoothing ?? this.prefs.smoothing,
        keepCorners: data.keepCorners ?? true,
        fillHoles: data.fillHoles ?? this.prefs.fillHoles,
      };
      if (data.sheetSize) this.sheetSize.set(data.sheetSize);
      if (data.orientation) this.orientation.set(data.orientation);
      if (data.spacingMm !== undefined) this.spacingMm.set(data.spacingMm);

      for (const stored of data.images ?? []) {
        const { name, original, ...rest } = stored;
        const img = await loadImage(original);
        this.addImage(name ?? 'imagem', img, { ...cutLegado, ...rest, originalDataUrl: original });
      }

      // Projetos salvos antes do modo molde (version 1) simplesmente não têm a seção.
      if (data.molde?.svg) {
        this.templates.hydrate(data.molde);
        if (!data.images?.length) this.setModo('molde');
      } else {
        this.templates.clear();
      }

      // Projetos salvos antes do modo redes sociais simplesmente não têm a seção.
      if (data.social?.src) {
        await this.social.hydrate(data.social, loadImage);
        if (!data.images?.length && !data.molde?.svg) this.setModo('social');
      } else {
        this.social.clear();
      }

      // Projetos salvos antes do modo ilustração simplesmente não têm a seção.
      if (data.ilustracao?.layers?.length) {
        this.illustration.hydrate(data.ilustracao);
        if (!data.images?.length && !data.molde?.svg && !data.social?.src) this.setModo('ilustracao');
      } else {
        this.illustration.clear();
      }

      this.projectId.set(dto.id);
      this.projectName.set(dto.name);
      this.projectCreatedAt = dto.createdAt;
      this.projectStatus.set(`Aberto: ${dto.name}`);
    } catch {
      this.projectStatus.set('Falha ao abrir o projeto.');
    }
  }

  async deleteProject(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      await this.projectsApi.remove(id);
      if (this.projectId() === id) this.newProject();
      await this.refreshProjects();
    } catch {
      this.projectStatus.set('Falha ao excluir o projeto.');
    }
  }

  newProject(): void {
    this.templates.clear();
    this.illustration.clear();
    this.images.set([]);
    this.pieceCache.clear();
    this.selectedId.set(null);
    this.projectId.set(null);
    this.projectName.set('');
    this.projectCreatedAt = new Date().toISOString();
    this.projectStatus.set('');
    this.scheduleRender();
  }

  zoomBy(factor: number): void {
    this.zoom.update((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
    this.scheduleRender();
  }

  resetZoom(): void {
    this.zoom.set(1);
    this.scheduleRender();
  }

  /** Ctrl/⌘ + roda dá zoom; roda sozinha rola o palco, como de costume. */
  onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  /** Dimensiona o canvas: ajustado ao palco quando zoom = 1, maior a partir
   * daí — o palco rola sozinho porque tem overflow auto. */
  private applyZoom(canvas: HTMLCanvasElement, stage: HTMLElement | undefined): void {
    if (!stage) return;
    const availW = Math.max(40, stage.clientWidth - 32);
    const availH = Math.max(40, stage.clientHeight - 32);
    const escala = Math.min(availW / canvas.width, availH / canvas.height) * this.zoom();
    canvas.style.width = `${Math.round(canvas.width * escala)}px`;
    canvas.style.height = `${Math.round(canvas.height * escala)}px`;
  }

  isOpen(id: StepId): boolean {
    return !!this.openSections()[id];
  }

  toggleSection(id: StepId): void {
    const next = { ...this.openSections(), [id]: !this.openSections()[id] };
    this.openSections.set(next);
    this.prefs.openSections = next;
    this.savePrefs();
  }

  stepNumber(id: StepId): number {
    return STEPS.indexOf(id); // 'projeto' é 0 e não mostra número
  }

  shapeLabel(shape: CutShape): string {
    return SHAPES.find((s) => s.id === shape)?.label ?? shape;
  }

  /** Resumo mostrado no cabeçalho quando o passo está fechado, pra dar o estado
   * atual sem precisar abrir. */
  sectionSummary(id: StepId): string {
    const sel = this.selected();
    switch (id) {
      case 'projeto':
        return this.projectName().trim() || 'não salvo';
      case 'imagens':
        return this.images().length ? plural(this.images().length, 'imagem', 'imagens') : 'nenhuma';
      case 'tamanho':
        return sel ? `${(sel.widthMm / 10).toFixed(1)} cm · ${sel.copies}×` : '';
      case 'contorno':
        return sel ? `${this.shapeLabel(sel.shape)} · ${sel.marginMm.toFixed(1)} mm` : '';
      case 'arte': {
        if (!sel) return '';
        const marks = [sel.bgRemoved ? 'fundo removido' : '', sel.mirrored ? 'espelhada' : ''].filter(Boolean);
        return marks.length ? marks.join(' · ') : 'original';
      }
      case 'retoques': {
        if (!sel) return '';
        const marks = [
          sel.erasures.length ? plural(sel.erasures.length, 'borrachada', 'borrachadas') : '',
          sel.cutRemovals.length ? `${plural(sel.cutRemovals.length, 'linha', 'linhas')} fora` : '',
          sel.outerOnly ? 'só contorno externo' : '',
        ].filter(Boolean);
        return marks.length ? marks.join(' · ') : 'nenhum';
      }
      case 'folha':
        return `${this.sheetSize()} ${this.orientation()}`;
      default:
        return '';
    }
  }

  onProjectNameInput(event: Event): void {
    this.projectName.set((event.target as HTMLInputElement).value);
  }

  private baseName(item: ImportedImage): string {
    return item.name.replace(/\.[^.]+$/, '');
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  themeIconName(): IconName {
    switch (this.theme.pref()) {
      case 'dark': return 'moon';
      case 'light': return 'sun';
      default: return 'monitor';
    }
  }

  themeLabel(): string {
    switch (this.theme.pref()) {
      case 'dark': return 'Tema: escuro (clique para claro)';
      case 'light': return 'Tema: claro (clique para automático)';
      default: return 'Tema: automático (clique para escuro)';
    }
  }
}
