import { DatePipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, effect, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import {
  CORNER_ANGLE, CubicPath, Point, Polygon, cubicPathsToData, mapCubicPath, pngBlobWithDpi,
  polygonToCubics, smallestPathContaining, traceCutPaths,
} from './contour';
import { CutShape, fillPolygon, shapeCanvasSize, shapePolygon } from './shapes';
import {
  PackInput, PlacedPiece, REG_MARGIN_MM, SheetOrientation, SheetSize, buildPdf, jpegToPdf, packShelves, pdfPathOps, pdfRectOps,
  registrationMarks, sheetDimensionsMm,
} from './sheet';
import { NestShape, nestShapes } from './sheet-nest';
import { SimLine, animateCut, flattenCubic, lineLength } from './cut-sim';
import { DxfLayer, DxfPolyline, buildDxf, cubicToPolyline, pageFrame } from './dxf';
import { CutMaterialsService } from './cut-materials.service';
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
import { BridgePayload, BridgeTarget, ModeBridge, canvasToFile } from './mode-bridge';
import { ProjectDraft, clearDraft, loadDraft, saveDraft } from './project-draft';
import { SnapshotHistory } from './snapshot-history';
import { ImageUpscaleService } from './image-upscale.service';
import { ImageLibraryService } from './image-library.service';
import { PackageSection, illustrationSection, readme, socialSection, templateSection } from './client-package';
import { ImageLibraryMenuComponent } from './image-library-menu';
import { aiCutout } from './ai-cutout';
import { VectorizeService } from './vectorize.service';
import { ZipEntry, uniqueNames, zipStore } from './zip';
import { TemplateProjectData, TemplateStore } from './template-store';
import { uuid } from '../../core/uuid';

/** Um clique de "remover fundo". Guardado em vez do bitmap resultante: ao abrir
 * um projeto salvo, os cliques são reaplicados sobre a arte original, então o
 * backend só precisa carregar a imagem de origem. */
/** O JSON de um projeto salvo (ou do rascunho), de qualquer versão. */
interface ProjectData {
  smoothing?: number; keepCorners?: boolean; fillHoles?: boolean; sheetSize?: SheetSize;
  orientation?: SheetOrientation; spacingMm?: number; packMode?: PackMode; rotate?: boolean; regMarks?: boolean;
  machine?: Machine; markZoneMm?: number; kissCut?: boolean;
  images?: (Partial<ImportedImage> & { original: string })[];
  molde?: TemplateProjectData | null;
  social?: SocialProjectData | null;
  ilustracao?: IllustrationProjectData | null;
}

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
  /** A foto de antes do recorte por IA (o recorte vira o original). Só na
   * sessão: salvar as duas dobraria o projeto. */
  preAi?: { canvas: HTMLCanvasElement; dataUrl: string };
  /** Acabamento da borda impressa (não muda a linha de corte). */
  borderStyle: BorderStyle;
  /** Sombra suave da arte sobre a borda. */
  artShadow: boolean;
}

type BorderStyle = 'solida' | 'dupla' | 'tracejada';

const BORDER_STYLES: { id: BorderStyle; label: string }[] = [
  { id: 'solida', label: 'Lisa' },
  { id: 'dupla', label: 'Dupla' },
  { id: 'tracejada', label: 'Tracejada' },
];

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
  packMode: PackMode;
  rotate: boolean;
  regMarks: boolean;
  machine: Machine;
  markZoneMm: number;
  kissCut: boolean;
}

/** Pra qual máquina a folha é montada. Silhouette: impressão e corte pelo
 * Silhouette Studio (edição Basic abre DXF, não SVG), com as marcas dele. */
type Machine = 'silhouette' | 'scanncut';

/** Linhas: caixas em prateleiras (previsível). Silhueta: pelo formato, com giro. */
type PackMode = 'linhas' | 'silhueta';

/** Velocidade média de corte pra estimativa de tempo, em mm/s. */
const CUT_SPEED_MM_S = 60;

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
  packMode: 'silhueta', rotate: true, regMarks: false, machine: 'silhouette', markZoneMm: 20, kissCut: false,
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
    IlIconComponent, IlNumComponent, IlStudioBaseStylesComponent, IlStudioChromeStylesComponent, ImageLibraryMenuComponent,
  ],
  providers: [TemplateStore, SocialStore, IllustrationStore, FontLibrary, VectorizeService, IllustrationTracer, ModeBridge],
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
          <il-library-menu (pick)="useFromLibrary($event)" />
          <button type="button" class="il-btn" [disabled]="packaging()" data-tip="Tudo do projeto num ZIP, pra gráfica ou pro cliente" (click)="exportClientPackage()"><il-icon name="download" [size]="13" /> {{ packaging() ? 'Montando…' : 'Pacote' }}</button>
          @if (projectStatus()) { <span class="ab-status" [title]="projectStatus()">{{ projectStatus() }}</span> }
        </div>
        <div class="ab-right">
          <button type="button" class="il-ib" (click)="theme.cycle()" [title]="themeLabel()" [attr.aria-label]="themeLabel()"><app-icon [name]="themeIconName()" [size]="15" /></button>
          <span class="ab-user">{{ auth.user()?.email }}</span>
          <button type="button" class="il-ib" (click)="auth.logout()" title="Sair" aria-label="Sair"><app-icon name="logout" [size]="14" /></button>
        </div>
      </header>

      @if (draftOffer(); as d) {
        <div class="ab-draft" role="alert">
          <il-icon name="save" [size]="15" />
          <span>Há trabalho não salvo{{ d.projectName ? ' em "' + d.projectName + '"' : '' }}, de {{ d.savedAt | date: 'dd/MM HH:mm' }}.</span>
          <button type="button" class="il-btn il-primary" (click)="recoverDraft(d)">Recuperar</button>
          <button type="button" class="il-btn" (click)="discardDraft()">Descartar</button>
        </div>
      }
      <main class="content">
        @if (modo() === 'corte') {
        <div class="il-studio il-basic pc">
          <input #fileInput type="file" accept="image/*" multiple hidden (change)="onFilesSelected($event)" />

          <div class="il-controlbar">
            <div class="il-cb-group">
              <button type="button" class="il-ib" [disabled]="!pcHistory.canUndo()" data-tip="Desfazer  Ctrl+Z" aria-label="Desfazer" (click)="pcUndo()"><il-icon name="undo" /></button>
              <button type="button" class="il-ib" [disabled]="!pcHistory.canRedo()" data-tip="Refazer  Ctrl+Shift+Z" aria-label="Refazer" (click)="pcRedo()"><il-icon name="redo" /></button>
            </div>
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
                  <option value="A3">A3</option><option value="Carta">Carta</option>
                </select>
                <select class="il-select" [value]="orientation()" (change)="onOrientationChange($event)" aria-label="Orientação">
                  <option value="retrato">Retrato</option>
                  <option value="paisagem">Paisagem</option>
                </select>
                <il-num label="Espaço" title="Espaço entre peças" unit="mm" [value]="spacingMm()" [min]="0" [max]="10" [decimals]="0" (valueChange)="onSpacingInput(ev($event.value))" />
              </div>
              <button type="button" class="il-btn" [class.il-on]="simulating()" [disabled]="!images().length" data-tip="A lâmina percorre as linhas de corte" (click)="simulateCut()"><il-icon name="cut" [size]="13" /> {{ simulating() ? 'Parar' : 'Simular corte' }}</button>
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
                        <div class="il-seg pc-seg pc-seg-full">
                          @for (b of borderStyles; track b.id) {
                            <button type="button" [class.il-on]="sel.borderStyle === b.id" (click)="updateSelected({ borderStyle: b.id })">{{ b.label }}</button>
                          }
                        </div>
                        <label class="il-check"><input type="checkbox" [checked]="sel.artShadow" (change)="updateSelected({ artShadow: !sel.artShadow })" /> Sombra da arte sobre a borda</label>
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
                        @if (upscale.disponivel()) {
                          <button type="button" class="il-btn il-wide" [disabled]="aiBusy()" data-help="Cabelo, pelo, degradê e cenário: a IA recorta onde o balde não dá conta" (click)="aiCutoutSelected()"><il-icon name="sparkle" [size]="14" /> {{ aiBusy() ? 'Recortando com IA…' : 'Remover fundo com IA' }}</button>
                          @if (aiError()) { <p class="il-note il-warn">{{ aiError() }}</p> }
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
                        <button type="button" class="il-btn il-wide" [class.il-on]="simulating()" (click)="simulateCut()"><il-icon name="cut" [size]="14" /> {{ simulating() ? 'Parar simulação' : 'Simular o corte desta peça' }}</button>
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
                        <option value="A3">A3</option><option value="Carta">Carta</option>
                      </select>
                      <select class="il-select" [value]="orientation()" (change)="onOrientationChange($event)" aria-label="Orientação">
                        <option value="retrato">Retrato</option>
                        <option value="paisagem">Paisagem</option>
                      </select>
                    </div>
                    <label class="il-range"><span>Espaço</span><input type="range" min="0" max="10" step="1" [value]="spacingMm()" (input)="onSpacingInput($event)" /><b>{{ spacingMm().toFixed(0) }} mm</b></label>
                    <div class="il-seg pc-seg pc-seg-full">
                      <button type="button" [class.il-on]="packMode() === 'silhueta'" data-help="Pelo formato das peças: uma entra no vão da outra" (click)="setSheetOpt('packMode', 'silhueta')">Encaixe por silhueta</button>
                      <button type="button" [class.il-on]="packMode() === 'linhas'" data-help="Em fileiras, pelas caixas das peças" (click)="setSheetOpt('packMode', 'linhas')">Em linhas</button>
                    </div>
                    @if (packMode() === 'silhueta') {
                      <label class="il-check"><input type="checkbox" [checked]="allowRotate()" (change)="setSheetOpt('rotate', !allowRotate())" /> Girar peças pra caber mais</label>
                    }
                    <div class="il-seg pc-seg pc-seg-full">
                      <button type="button" [class.il-on]="machine() === 'silhouette'" (click)="setMachine('silhouette')">Silhouette</button>
                      <button type="button" [class.il-on]="machine() === 'scanncut'" (click)="setMachine('scanncut')">ScanNCut</button>
                    </div>
                    @if (machine() === 'silhouette') {
                      <il-num label="Área das marcas" title="Faixa livre nas bordas pras marcas de registro do Studio" unit="mm" [value]="markZoneMm()" [min]="10" [max]="40" [decimals]="0" (valueChange)="setMarkZone($event.value)" />
                      <p class="il-note">A faixa hachurada fica livre pras marcas que o Silhouette Studio imprime. Imprima e corte pelo Studio com o pacote abaixo.</p>
                      <label class="il-check"><input type="checkbox" [checked]="kissCut()" (change)="setKissCut(!kissCut())" /> Folha de adesivos (meio-corte nas peças, corte total em volta)</label>
                      <div class="il-row">
                        <select class="il-select il-grow" aria-label="Material" (change)="materials.select($any($event.target).value || null)">
                          <option value="" [selected]="!materials.selected()">Material: não anotado</option>
                          @for (mt of materials.materials(); track mt.id) { <option [value]="mt.id" [selected]="mt.id === materials.selectedId()">{{ mt.nome }}</option> }
                        </select>
                        <button type="button" class="il-btn" [class.il-on]="editingMaterials()" (click)="toggleMaterials()">Anotar</button>
                      </div>
                      @if (editingMaterials()) {
                        @for (mt of materials.materials(); track mt.id) {
                          <div class="pc-mat">
                            <div class="il-row il-row-tight">
                              <input class="il-field-input il-grow" [value]="mt.nome" aria-label="Nome do material" (change)="materials.patch(mt.id, { nome: $any($event.target).value })" />
                              <button type="button" class="il-ib il-ib-sm il-danger" aria-label="Apagar material" (click)="materials.remove(mt.id)"><il-icon name="trash" [size]="12" /></button>
                            </div>
                            <div class="pc-mat-grid">
                              <input [value]="mt.lamina" placeholder="Lâmina" aria-label="Lâmina" (change)="materials.patch(mt.id, { lamina: $any($event.target).value })" />
                              <input [value]="mt.velocidade" placeholder="Velocidade" aria-label="Velocidade" (change)="materials.patch(mt.id, { velocidade: $any($event.target).value })" />
                              <input [value]="mt.forca" placeholder="Força" aria-label="Força" (change)="materials.patch(mt.id, { forca: $any($event.target).value })" />
                              <input [value]="mt.passadas" placeholder="Passadas" aria-label="Passadas" (change)="materials.patch(mt.id, { passadas: $any($event.target).value })" />
                            </div>
                            <input class="il-field-input" [value]="mt.notas" placeholder="Notas (ex.: papel adesivo vinílico fosco)" aria-label="Notas" (change)="materials.patch(mt.id, { notas: $any($event.target).value })" />
                          </div>
                        }
                        <button type="button" class="il-btn il-wide" (click)="materials.add()"><il-icon name="plus" [size]="13" /> Novo material</button>
                        <p class="il-note">Os números vêm do teste na sua máquina; o editor só guarda (na conta) e repete no passo a passo do pacote.</p>
                      }
                    } @else {
                      <label class="il-check"><input type="checkbox" [checked]="regMarks()" (change)="setSheetOpt('regMarks', !regMarks())" /> Imprimir marcas de registro</label>
                    }
                    <div class="il-row">
                      <button type="button" class="il-btn il-grow" [disabled]="!selected()" data-help="Põe o máximo de cópias da imagem selecionada que cabe" (click)="fillSheet()"><il-icon name="sheet" [size]="13" /> Encher a folha</button>
                      <button type="button" class="il-btn il-grow" [class.il-on]="simulating()" [disabled]="!images().length" (click)="simulateCut()"><il-icon name="cut" [size]="13" /> {{ simulating() ? 'Parar' : 'Simular corte' }}</button>
                    </div>
                    @if (fillStatus()) { <p class="il-note">{{ fillStatus() }}</p> }
                    @if (cutLengthLabel()) { <p class="il-note">{{ cutLengthLabel() }}</p> }
                    @if (machine() !== 'silhouette') { <p class="il-note">Junta todas as peças (e as cópias) numa folha pra imprimir de uma vez. Imprima o PNG ou o PDF e leve o SVG pra máquina: as posições batem.</p> }
                  </div></section>
                  <div class="il-export-list">
                    @if (machine() === 'silhouette') {
                      <button type="button" class="il-export" [disabled]="!images().length" (click)="exportSilhouettePackage()"><il-icon name="cut" [size]="20" /><span><strong>Pacote pro Silhouette Studio</strong><small>PNG da impressão + DXF do corte, alinhados, com o passo a passo</small></span></button>
                      <button type="button" class="il-export" (click)="exportAlignmentTest()"><il-icon name="sheet" [size]="20" /><span><strong>Folha de teste de alinhamento</strong><small>Cinco quadrados pra conferir impressão e corte antes de gastar papel</small></span></button>
                      <button type="button" class="il-export" [disabled]="!images().length" (click)="exportSheetDxf()"><il-icon name="cut" [size]="20" /><span><strong>DXF de corte da folha</strong><small>Só as linhas de corte, em mm, pro Studio Basic</small></span></button>
                    }
                    <button type="button" class="il-export" [disabled]="!images().length" (click)="exportPrintCutPdf()"><il-icon name="artboard" [size]="20" /><span><strong>PDF impressão + corte</strong><small>Página 1 pra imprimir, página 2 com o corte em vetor</small></span></button>
                    <button type="button" class="il-export" [disabled]="!images().length" (click)="exportSheetPdf()"><il-icon name="artboard" [size]="20" /><span><strong>PDF da folha</strong><small>No tamanho físico, pronto pra imprimir</small></span></button>
                    <button type="button" class="il-export" [disabled]="!images().length" (click)="exportSheetPng()"><il-icon name="image" [size]="20" /><span><strong>PNG da folha ({{ dpi }} DPI)</strong><small>Imagem pra imprimir em outro programa</small></span></button>
                    <button type="button" class="il-export" [disabled]="!images().length" (click)="exportSheetSvg()"><il-icon name="cut" [size]="20" /><span><strong>SVG de corte da folha</strong><small>Só as linhas de corte, em mm, nas mesmas posições</small></span></button>
                  </div>
                }
                @case ('exportar') {
                  <div class="il-export-list">
                    <button type="button" class="il-export" [disabled]="!selected()" (click)="exportPrintPng()"><il-icon name="image" [size]="20" /><span><strong>PNG {{ dpi }} DPI</strong><small>A peça selecionada, pra imprimir</small></span></button>
                    <button type="button" class="il-export" [disabled]="!selected()" (click)="exportCutSvg()"><il-icon name="cut" [size]="20" /><span><strong>SVG da linha de corte</strong><small>Pra ScanNCut, Inkscape ou Studio Designer, em mm</small></span></button>
                    <button type="button" class="il-export" [disabled]="!selected()" (click)="exportCutDxf()"><il-icon name="cut" [size]="20" /><span><strong>DXF da linha de corte</strong><small>Pro Silhouette Studio Basic, em mm</small></span></button>
                    <button type="button" class="il-export" [disabled]="!selected()" (click)="exportFullSvg()"><il-icon name="export" [size]="20" /><span><strong>SVG arte + corte</strong><small>A arte embutida com a linha de corte por cima</small></span></button>
                    <button type="button" class="il-export" [disabled]="images().length < 2 || zipping()" (click)="exportCutSvgZip()"><il-icon name="split" [size]="20" /><span><strong>{{ zipping() ? 'Nomeando com IA…' : 'ZIP com um SVG por imagem' }}</strong><small>Cada arquivo nomeado por IA pelo que o desenho é</small></span></button>
                  </div>
                  @if (zipStatus()) { <p class="il-note pc-pad">{{ zipStatus() }}</p> }
                  <div class="il-sec-head il-sec-static">Enviar a arte selecionada para</div>
                  <div class="il-export-list">
                    @for (t of bridge.targetsFrom('corte'); track t.id) {
                      <button type="button" class="il-export" [disabled]="!selected()" (click)="sendSelectedTo(t.id)"><il-icon name="export" [size]="20" /><span><strong>{{ t.label }}</strong><small>{{ t.help }}</small></span></button>
                    }
                  </div>
                  <p class="il-note pc-pad">{{ machine() === 'silhouette' ? 'Silhouette Studio Basic abre o DXF (SVG e PDF só na Designer Edition). As medidas vão em mm.' : 'Importe o SVG no CanvasWorkspace (ou direto no pendrive nos modelos SDX) — as medidas já vão em mm.' }}</p>
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
                {{ packInfo().overflow > 0 ? packInfo().overflow + ' não couberam — reduza cópias ou tamanho, ou use A3' : (machine() === 'silhouette' ? 'Pacote pro Silhouette Studio: imprima e corte pelo Studio, com as marcas dele.' : 'Imprima a folha e corte com o SVG da folha: as posições batem.') }}
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

    .ab-draft {
      display: flex; align-items: center; gap: 10px; padding: 6px 12px; flex-shrink: 0; font-size: 12px;
      background: color-mix(in srgb, var(--il-blue) 12%, var(--bg)); border-bottom: 1px solid var(--il-line); color: var(--text);
    }
    .ab-draft span { flex: 1; min-width: 0; }
    .pc-mat { display: flex; flex-direction: column; gap: 4px; padding: 6px 0; border-top: 1px solid var(--il-line); }
    .pc-mat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .pc-mat input, .il-field-input { min-width: 0; height: 24px; padding: 0 6px; font: inherit; font-size: 11.5px; color: var(--text); background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px; }

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
  readonly borderStyles = BORDER_STYLES;

  private prefs = loadPrefs();

  modo = signal<EditorMode>(this.prefs.modo ?? 'corte');
  pcTab = signal<PcTab>('imagens');
  /** Desfazer do Print & Cut: fotografa a lista de artes (objetos imutáveis;
   * só o canvas da arte é compartilhado, e é refeito ao voltar). */
  readonly pcHistory = new SnapshotHistory<{ items: ImportedImage[]; selectedId: string | null }>(
    700, (a, b) => a.items === b.items,
  );
  draftOffer = signal<ProjectDraft | null>(null);
  aiBusy = signal(false);
  aiError = signal('');
  private dirty = false;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private applyingProject = false;
  /** Tamanho físico da peça desenhada por último (arte + borda). */
  pieceLabel = signal('');
  projectsOpen = signal(false);
  images = signal<ImportedImage[]>([]);
  selectedId = signal<string | null>(null);
  view = signal<'peca' | 'folha'>('peca');
  sheetSize = signal<SheetSize>(this.prefs.sheetSize);
  orientation = signal<SheetOrientation>(this.prefs.orientation);
  spacingMm = signal(this.prefs.spacingMm);
  packMode = signal<PackMode>(this.prefs.packMode ?? 'silhueta');
  allowRotate = signal(this.prefs.rotate ?? true);
  regMarks = signal(this.prefs.regMarks ?? false);
  machine = signal<Machine>(this.prefs.machine ?? 'silhouette');
  /** Faixa livre nas bordas pras marcas de registro do Silhouette Studio. */
  markZoneMm = signal(this.prefs.markZoneMm ?? 20);
  /** Folha de adesivos: meio-corte nas peças e corte total em volta da folha. */
  kissCut = signal(this.prefs.kissCut ?? false);
  simulating = signal(false);
  cutLengthMm = signal(0);
  fillStatus = signal('');
  private stopSim: (() => void) | null = null;
  private nestCache: { key: string; placed: PlacedPiece[]; overflow: PackInput[] } | null = null;
  private maskCache = new WeakMap<HTMLCanvasElement, NestShape & { key: number }>();
  private maskSeq = 0;
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
    public bridge: ModeBridge,
    public upscale: ImageUpscaleService,
    private library: ImageLibraryService,
    private fonts: FontLibrary,
    public materials: CutMaterialsService,
  ) {
    this.bridge.register((target, payload) => void this.receive(target, payload));
    effect(() => {
      const items = this.images();
      this.pcHistory.observe({ items, selectedId: untracked(() => this.selectedId()) });
    });
    // Rascunho automático: qualquer mudança em qualquer modo marca o projeto
    // como sujo e agenda uma gravação no navegador.
    effect(() => {
      this.images(); this.sheetSize(); this.orientation(); this.spacingMm(); this.projectName();
      this.packMode(); this.allowRotate(); this.regMarks(); this.machine(); this.markZoneMm(); this.kissCut();
      this.templates.svgText(); this.templates.slots(); this.templates.photos(); this.templates.widthMm();
      this.social.image(); this.social.canUndo(); this.social.canRedo(); this.social.exportW();
      this.illustration.layers(); this.illustration.widthMm(); this.illustration.heightMm();
      untracked(() => this.markDirty());
    });
  }

  ngAfterViewInit(): void {
    this.scheduleRender();
    void this.refreshProjects();
    void this.upscale.verificar();
    void this.materials.load();
    void loadDraft().then((d) => {
      if (d?.data && !this.dirty) this.draftOffer.set(d);
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.interactionTimer);
    // saindo da página com mudanças pendentes: grava já, sem esperar o intervalo
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      void this.writeDraft();
    }
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
      borderStyle: 'solida', artShadow: false,
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
    item.borderStyle ??= 'solida';
    item.artShadow ??= false;
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

  updateSelected(patch: Partial<ImportedImage>): void {
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
      const k = event.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        event.preventDefault();
        if (k === 'y' || event.shiftKey) this.pcRedo(); else this.pcUndo();
        return;
      }
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

  // ---------- enviar para outro modo ----------

  /** Recebe a arte que outro modo mandou pelo "Enviar para…". */
  async receive(target: BridgeTarget, p: BridgePayload): Promise<void> {
    try {
      if (target === 'biblioteca') {
        this.projectStatus.set('Guardando na biblioteca…');
        await this.library.save(p.canvas, p.name, this.modo(), p.widthMm ?? 0);
        this.projectStatus.set(`"${p.name}" guardada na biblioteca.`);
        return;
      }
      if (target === 'corte') {
        const item = this.addArt(p.name, p.canvas, p.widthMm ? { widthMm: p.widthMm } : {});
        this.selectedId.set(item.id);
        this.setModo('corte');
        this.scheduleRender();
      } else if (target === 'molde') {
        const file = await canvasToFile(p.canvas, p.name);
        this.templates.pendingPhotos.update((list) => [...list, file]);
        this.setModo('molde');
      } else if (target === 'social') {
        this.social.pendingImport.set(await canvasToFile(p.canvas, p.name));
        this.setModo('social');
      } else {
        this.illustration.pendingImport.set({ name: p.name, canvas: p.canvas });
        this.setModo('ilustracao');
      }
    } catch {
      this.projectStatus.set(target === 'biblioteca' ? 'Não consegui guardar na biblioteca.' : 'Não consegui enviar a arte para o outro modo.');
    }
  }

  /** Arte escolhida na biblioteca: entra no modo aberto. */
  useFromLibrary(e: { canvas: HTMLCanvasElement; name: string; widthMm: number }): void {
    void this.receive(this.modo(), { canvas: e.canvas, name: e.name, widthMm: e.widthMm || undefined });
  }

  /** A arte selecionada do Print & Cut (com o fundo já tirado, se foi). */
  sendSelectedTo(target: BridgeTarget): void {
    const sel = this.selected();
    if (!sel) return;
    if (target === 'ilustracao') {
      this.vectorizeSelected();
      return;
    }
    const copy = document.createElement('canvas');
    copy.width = sel.source.width;
    copy.height = sel.source.height;
    copy.getContext('2d')!.drawImage(sel.source, 0, 0);
    this.bridge.send(target, { canvas: copy, name: sel.name.replace(/\.[^.]+$/, ''), widthMm: sel.widthMm });
  }

  // ---------- desfazer do Print & Cut ----------

  pcUndo(): void {
    const s = this.pcHistory.undo();
    if (s) this.restorePc(s);
  }

  pcRedo(): void {
    const s = this.pcHistory.redo();
    if (s) this.restorePc(s);
  }

  /** Volta a lista de artes. Os objetos são imutáveis, menos o canvas da arte
   * (a remoção de fundo pinta nele): quando as remoções da fotografia não são
   * as que estão no canvas, ele é refeito a partir do original. */
  private restorePc(s: { items: ImportedImage[]; selectedId: string | null }): void {
    const live = new Map(this.images().map((i) => [i.id, i]));
    for (const item of s.items) {
      const now = live.get(item.id);
      const painted = now ? now.bgRemovals : null;
      if (painted === item.bgRemovals) continue;
      const ctx = item.source.getContext('2d')!;
      ctx.clearRect(0, 0, item.source.width, item.source.height);
      ctx.drawImage(item.original, 0, 0);
      for (const r of item.bgRemovals) floodRemoveBackground(item.source, r.x, r.y, r.tolerance);
    }
    this.images.set(s.items);
    const keep = s.items.some((i) => i.id === this.selectedId());
    if (!keep) this.selectedId.set(s.selectedId && s.items.some((i) => i.id === s.selectedId) ? s.selectedId : (s.items[0]?.id ?? null));
    this.tool.set('nenhuma');
    this.pieceCache.clear();
    this.scheduleRender();
  }

  // ---------- rascunho automático ----------

  private hasContent(): boolean {
    return !!this.images().length || this.templates.hasTemplate() || this.social.hasImage() || this.illustration.hasContent();
  }

  private markDirty(): void {
    if (this.applyingProject) return;
    if (!this.hasContent()) return;
    this.dirty = true;
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => void this.writeDraft(), 2500);
  }

  private async writeDraft(): Promise<void> {
    this.draftTimer = undefined;
    if (!this.dirty || !this.hasContent()) return;
    // trabalho novo por cima: o rascunho antigo oferecido deixa de existir
    this.draftOffer.set(null);
    try {
      await saveDraft({
        savedAt: new Date().toISOString(),
        projectId: this.projectId(),
        projectName: this.projectName(),
        data: this.serialize(),
      });
    } catch { /* sem rascunho desta vez */ }
  }

  /** Salvo, aberto ou começado do zero: nada pendente pra recuperar. */
  private settleDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    this.dirty = false;
    void clearDraft();
  }

  async recoverDraft(d: ProjectDraft): Promise<void> {
    this.draftOffer.set(null);
    try {
      await this.applyProjectData(JSON.parse(d.data) as ProjectData);
      this.projectId.set(d.projectId);
      this.projectName.set(d.projectName);
      this.projectStatus.set('Trabalho recuperado. Salve pra guardar na conta.');
      this.dirty = true;
    } catch {
      this.projectStatus.set('Não consegui recuperar o rascunho.');
    }
  }

  discardDraft(): void {
    this.draftOffer.set(null);
    void clearDraft();
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

  /** Recorte por IA: o recorte vira a arte original da peça (é o que se salva),
   * e a foto de antes fica guardada pra "Restaurar". */
  async aiCutoutSelected(): Promise<void> {
    const sel = this.selected();
    if (!sel || this.aiBusy()) return;
    this.aiBusy.set(true);
    this.aiError.set('');
    this.setTool('nenhuma');
    try {
      const cut = await aiCutout(this.upscale, sel.original);
      const source = document.createElement('canvas');
      source.width = cut.width;
      source.height = cut.height;
      source.getContext('2d')!.drawImage(cut, 0, 0);
      const live = this.images().find((i) => i.id === sel.id);
      if (!live) return;
      this.images.update((list) => list.map((i) => (i.id === sel.id ? {
        ...i, original: cut, source, originalDataUrl: encodeCanvas(cut), bgRemovals: [], bgRemoved: true,
        srcVersion: i.srcVersion + 1, thumbUrl: makeThumb(source),
        preAi: i.preAi ?? { canvas: i.original, dataUrl: i.originalDataUrl },
      } : i)));
      this.scheduleRender();
    } catch (e) {
      this.aiError.set(e instanceof Error ? e.message : 'Não consegui remover o fundo agora.');
    } finally {
      this.aiBusy.set(false);
    }
  }

  restoreOriginal(): void {
    const sel = this.selected();
    if (!sel) return;
    if (sel.preAi) {
      const source = document.createElement('canvas');
      source.width = sel.preAi.canvas.width;
      source.height = sel.preAi.canvas.height;
      source.getContext('2d')!.drawImage(sel.preAi.canvas, 0, 0);
      this.updateSelected({
        original: sel.preAi.canvas, originalDataUrl: sel.preAi.dataUrl, source, preAi: undefined,
        srcVersion: sel.srcVersion + 1, bgRemoved: false, thumbUrl: makeThumb(source), bgRemovals: [],
      });
      return;
    }
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

  setMachine(m: Machine): void {
    this.machine.set(m);
    this.prefs.machine = m;
    this.savePrefs();
    this.scheduleRender();
  }

  setKissCut(on: boolean): void {
    this.kissCut.set(on);
    this.prefs.kissCut = on;
    this.savePrefs();
    this.scheduleRender();
  }

  setMarkZone(mm: number): void {
    this.markZoneMm.set(Math.round(Math.min(40, Math.max(10, mm))));
    this.prefs.markZoneMm = this.markZoneMm();
    this.savePrefs();
    this.scheduleRender();
  }

  setSheetOpt(key: 'packMode' | 'rotate' | 'regMarks', value: PackMode | boolean): void {
    if (key === 'packMode') this.packMode.set(value as PackMode);
    else if (key === 'rotate') this.allowRotate.set(value as boolean);
    else this.regMarks.set(value as boolean);
    this.prefs.packMode = this.packMode();
    this.prefs.rotate = this.allowRotate();
    this.prefs.regMarks = this.regMarks();
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
      item.smoothing, item.keepCorners, item.fillHoles, item.borderStyle, item.artShadow, largura,
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
      const contour = buildContourLayer(source, marginPx, gapPx, item.color, item.outerOnly, item.borderStyle === 'dupla' ? 'dupla' : 'solida');
      if (item.borderStyle === 'tracejada' && marginPx >= 4) this.dashBorder(contour, source, marginPx, gapPx, item.outerOnly);
      applyErasures(contour, scaleErasures(item.erasures, escala), total, total, item.mirrored, source.width);

      const canvas = document.createElement('canvas');
      canvas.width = contour.width;
      canvas.height = contour.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(contour, 0, 0);
      if (item.artShadow) this.shadowOnBorder(ctx, source, total, total, ppm);
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
      if (item.borderStyle === 'dupla' && marginPx >= 3) {
        fillPolygon(cctx, shapePolygon(item.shape, W, H, marginPx * 0.4, cornerRadius), '#ffffff');
        fillPolygon(cctx, shapePolygon(item.shape, W, H, marginPx * 0.6, cornerRadius), item.color);
      }
      if (item.borderStyle === 'tracejada' && marginPx >= 4) {
        this.dashPolygon(cctx, shapePolygon(item.shape, W, H, marginPx / 2, cornerRadius), marginPx);
      }
      if (gapPx > 0) fillPolygon(cctx, shapePolygon(item.shape, W, H, marginPx, cornerRadius), '#ffffff');
      applyErasures(contour, scaleErasures(item.erasures, escala), artX, artY, item.mirrored, source.width);
    }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(contour, 0, 0);
    if (item.artShadow) this.shadowOnBorder(ctx, source, artX, artY, ppm);
    ctx.drawImage(source, artX, artY);
    const mantidos = this.dropRemovedCuts([outer], item, artX, artY, escala, source.width);
    return {
      canvas, paths: mantidos, cuts: this.fitCuts(mantidos, ppm),
      ppm, artX, artY, scale: escala,
    };
  }

  /** Linha tracejada branca no meio da borda: o contorno do meio da faixa é
   * traçado de novo e pintado por cima. */
  private dashBorder(contour: HTMLCanvasElement, source: HTMLCanvasElement, marginPx: number, gapPx: number, outerOnly: boolean): void {
    const half = Math.round(marginPx / 2);
    const mid = buildContourLayer(source, half, gapPx, '#000000', outerOnly);
    const polys = traceCutPaths(mid, { smoothSigma: Math.max(1, marginPx / 6), simplifyEpsilon: 0.5, minArea: 16 });
    const ctx = contour.getContext('2d')!;
    const off = marginPx - half;
    ctx.save();
    ctx.translate(off, off);
    ctx.globalCompositeOperation = 'source-atop';
    for (const poly of polys) this.dashPolygon(ctx, poly, marginPx);
    ctx.restore();
  }

  private dashPolygon(ctx: CanvasRenderingContext2D, poly: Polygon, marginPx: number): void {
    if (poly.length < 3) return;
    const w = Math.max(1, marginPx * 0.16);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.setLineDash([w * 2.6, w * 2.2]);
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /** Sombra da arte caindo na borda. Fica só onde já há borda
   * (source-atop): não aumenta a peça nem muda a linha de corte. */
  private shadowOnBorder(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, x: number, y: number, ppm: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
    ctx.shadowBlur = Math.max(1, 0.8 * ppm);
    ctx.shadowOffsetX = 0.5 * ppm;
    ctx.shadowOffsetY = 0.7 * ppm;
    ctx.drawImage(source, x, y);
    ctx.restore();
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

  private packCurrent(items: ImportedImage[] = this.images()): { placed: PlacedPiece[]; overflow: PackInput[]; wMm: number; hMm: number } {
    const { wMm, hMm } = sheetDimensionsMm(this.sheetSize(), this.orientation());
    const margin = this.sheetMargin();
    if (this.packMode() === 'silhueta') return { ...this.nestPieces(items, wMm, hMm, margin), wMm, hMm };
    const inputs: PackInput[] = [];
    for (const item of items) {
      const piece = this.pieceFor(item);
      const pw = piece.canvas.width / piece.ppm;
      const ph = piece.canvas.height / piece.ppm;
      for (let c = 0; c < item.copies; c++) {
        inputs.push({ id: `${item.id}#${c}`, wMm: pw, hMm: ph });
      }
    }
    const { placed, overflow } = packShelves(inputs, wMm, hMm, margin, this.spacingMm());
    return { placed, overflow, wMm, hMm };
  }

  /** Borda livre da folha: a das marcas do Studio (Silhouette), a das marcas
   * impressas pelo editor, ou a margem comum da impressora. */
  sheetMargin(): number {
    if (this.machine() === 'silhouette') return Math.max(SHEET_MARGIN_MM, this.markZoneMm());
    return this.regMarks() ? REG_MARGIN_MM : SHEET_MARGIN_MM;
  }

  /** Máscara da peça numa grade de 1 mm (o que a peça ocupa, borda inclusa). */
  private maskOf(piece: Piece): NestShape & { key: number } {
    const hit = this.maskCache.get(piece.canvas);
    if (hit) return hit;
    const w = Math.max(1, Math.ceil(piece.canvas.width / piece.ppm));
    const h = Math.max(1, Math.ceil(piece.canvas.height / piece.ppm));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(piece.canvas, 0, 0, (piece.canvas.width / piece.ppm), (piece.canvas.height / piece.ppm));
    const data = ctx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 16 ? 1 : 0;
    const shape = { id: '', w, h, mask, key: ++this.maskSeq };
    this.maskCache.set(piece.canvas, shape);
    return shape;
  }

  private nestPieces(items: ImportedImage[], wMm: number, hMm: number, margin: number): { placed: PlacedPiece[]; overflow: PackInput[] } {
    const shapes: NestShape[] = [];
    const dims = new Map<string, { pw: number; ph: number }>();
    for (const item of items) {
      const piece = this.pieceFor(item);
      const m = this.maskOf(piece);
      const pw = piece.canvas.width / piece.ppm, ph = piece.canvas.height / piece.ppm;
      for (let c = 0; c < item.copies; c++) {
        const id = `${item.id}#${c}`;
        shapes.push({ id, w: m.w, h: m.h, mask: m.mask });
        dims.set(id, { pw, ph });
      }
    }
    const key = JSON.stringify([
      shapes.map((sh) => `${sh.id}:${this.maskOf(this.pieceFor(this.itemOf(sh.id)!)).key}`),
      wMm, hMm, margin, this.spacingMm(), this.allowRotate(),
    ]);
    if (this.nestCache?.key === key) return this.nestCache;
    const r = nestShapes(shapes, {
      sheetW: Math.floor(wMm), sheetH: Math.floor(hMm), margin: Math.ceil(margin),
      spacing: Math.round(this.spacingMm()), rotate: this.allowRotate(),
    });
    const placed: PlacedPiece[] = r.placed.map((p) => {
      const { pw, ph } = dims.get(p.id)!;
      const turned = p.rot === 90 || p.rot === 270;
      return { id: p.id, xMm: p.x, yMm: p.y, wMm: turned ? ph : pw, hMm: turned ? pw : ph, rot: p.rot };
    });
    const overflow = r.overflow.map((id) => ({ id, wMm: dims.get(id)!.pw, hMm: dims.get(id)!.ph }));
    this.nestCache = { key, placed, overflow };
    return this.nestCache;
  }

  /** Onde a peça vai na folha: centro, giro e tamanho sem giro (mm). */
  private frameOf(p: PlacedPiece, piece: Piece): { cx: number; cy: number; angle: number; pw: number; ph: number } {
    return {
      cx: p.xMm + p.wMm / 2, cy: p.yMm + p.hMm / 2,
      angle: ((p.rot ?? 0) * Math.PI) / 180,
      pw: piece.canvas.width / piece.ppm, ph: piece.canvas.height / piece.ppm,
    };
  }

  /** Desenha a peça posta (com o giro) num canvas de `scale` px/mm. */
  private drawPlaced(ctx: CanvasRenderingContext2D, p: PlacedPiece, piece: Piece, scale: number, cuts: boolean): void {
    const f = this.frameOf(p, piece);
    ctx.save();
    ctx.translate(f.cx * scale, f.cy * scale);
    ctx.rotate(f.angle);
    ctx.translate((-f.pw / 2) * scale, (-f.ph / 2) * scale);
    ctx.drawImage(piece.canvas, 0, 0, f.pw * scale, f.ph * scale);
    if (cuts) {
      const k = scale / piece.ppm;
      ctx.scale(k, k);
      this.strokeCutPaths(ctx, piece.cuts, Math.max(1.2, 1.2 / k));
    }
    ctx.restore();
  }

  /** Ponto da peça (px da peça) → mm na folha, com o giro. */
  private toSheetMm(p: PlacedPiece, piece: Piece): (pt: Point) => Point {
    const f = this.frameOf(p, piece);
    const cos = Math.cos(f.angle), sin = Math.sin(f.angle);
    return ([x, y]) => {
      const u = x / piece.ppm - f.pw / 2, v = y / piece.ppm - f.ph / 2;
      return [f.cx + u * cos - v * sin, f.cy + u * sin + v * cos];
    };
  }

  /** Hachura a faixa das marcas do Studio na prévia (não vai pra impressão). */
  private hatchMarkZone(ctx: CanvasRenderingContext2D, wMm: number, hMm: number, scale: number): void {
    const m = this.sheetMargin() * scale;
    const W = wMm * scale, H = hMm * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(m, m, W - 2 * m, H - 2 * m);
    ctx.clip('evenodd');
    ctx.strokeStyle = 'rgba(120, 120, 140, 0.35)';
    ctx.lineWidth = 1;
    for (let x = -H; x < W; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + H, 0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(120, 120, 140, 0.6)';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(m + 0.5, m + 0.5, W - 2 * m - 1, H - 2 * m - 1);
    ctx.setLineDash([]);
  }

  private drawMarks(ctx: CanvasRenderingContext2D, wMm: number, hMm: number, scale: number): void {
    if (!this.regMarks()) return;
    ctx.fillStyle = '#000000';
    for (const r of registrationMarks(wMm, hMm)) ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
  }

  /** Todas as linhas de corte da folha, em mm. */
  private sheetCutsMm(placed: PlacedPiece[], quality: PieceQuality): CubicPath[] {
    const out: CubicPath[] = [];
    for (const p of placed) {
      const item = this.itemOf(p.id);
      if (!item) continue;
      const piece = this.pieceFor(item, quality);
      const map = this.toSheetMm(p, piece);
      out.push(...piece.cuts.map((c) => mapCubicPath(c, map)));
    }
    return out;
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

    if (this.machine() === 'silhouette') this.hatchMarkZone(ctx, wMm, hMm, scale);
    for (const p of placed) {
      const item = this.itemOf(p.id);
      if (!item) continue;
      this.drawPlaced(ctx, p, this.pieceFor(item), scale, true);
    }
    this.drawMarks(ctx, wMm, hMm, scale);
    const border = this.kissCut() ? this.sheetBorderMm(placed, wMm, hMm) : null;
    if (border) {
      ctx.save();
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      border.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    this.cutLengthMm.set(this.sheetCutsMm(placed, 'preview').reduce((sum, c) => sum + lineLength(flattenCubic(c, (q) => q, 6)), 0));
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

  // ---------- Silhouette (DXF) ----------

  private static readonly DXF_LAYERS: DxfLayer[] = [
    { name: 'CORTE', color: 1 }, { name: 'MEIO_CORTE', color: 1 }, { name: 'CORTE_TOTAL', color: 5 }, { name: 'PAGINA', color: 8 },
  ];

  exportCutDxf(): void {
    const sel = this.selected();
    if (!sel) return;
    const piece = this.pieceFor(sel, 'full');
    const hMm = piece.canvas.height / piece.ppm;
    const lines = piece.cuts.map((c) => ({ layer: 'CORTE', closed: true, points: cubicToPolyline(c, 1 / piece.ppm) }));
    const dxf = buildDxf(lines, ImageEditorPageComponent.DXF_LAYERS, hMm);
    this.downloadBlob(new Blob([dxf], { type: 'application/dxf' }), this.baseName(sel) + '-corte.dxf');
  }

  /** Folha de adesivos: o contorno da folha (corte total), em volta de todas
   * as peças com folga, dentro da área útil, com cantos arredondados. */
  private sheetBorderMm(placed: PlacedPiece[], wMm: number, hMm: number): Point[] | null {
    if (!placed.length) return null;
    const pad = 4, r = 3, m = this.sheetMargin();
    const x0 = Math.max(m, Math.min(...placed.map((p) => p.xMm)) - pad);
    const y0 = Math.max(m, Math.min(...placed.map((p) => p.yMm)) - pad);
    const x1 = Math.min(wMm - m, Math.max(...placed.map((p) => p.xMm + p.wMm)) + pad);
    const y1 = Math.min(hMm - m, Math.max(...placed.map((p) => p.yMm + p.hMm)) + pad);
    const pts: Point[] = [];
    const corner = (cx: number, cy: number, a0: number): void => {
      for (let i = 0; i <= 8; i++) {
        const a = a0 + (i / 8) * (Math.PI / 2);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    corner(x1 - r, y0 + r, -Math.PI / 2);
    corner(x1 - r, y1 - r, 0);
    corner(x0 + r, y1 - r, Math.PI / 2);
    corner(x0 + r, y0 + r, Math.PI);
    return pts;
  }

  /** Linhas de corte da folha pro DXF: peças (corte, ou meio-corte na folha de
   * adesivos) e o contorno da folha. */
  private sheetDxfLines(): { lines: DxfPolyline[]; wMm: number; hMm: number } | null {
    const { placed, wMm, hMm } = this.packCurrent();
    if (!placed.length) return null;
    const kiss = this.kissCut();
    const lines: DxfPolyline[] = this.sheetCutsMm(placed, 'full').map((c) => ({ layer: kiss ? 'MEIO_CORTE' : 'CORTE', closed: true, points: cubicToPolyline(c) }));
    const border = kiss ? this.sheetBorderMm(placed, wMm, hMm) : null;
    if (border) lines.push({ layer: 'CORTE_TOTAL', closed: true, points: border });
    return { lines, wMm, hMm };
  }

  private sheetDxfText(only?: string): string | null {
    const r = this.sheetDxfLines();
    if (!r) return null;
    const lines = only ? r.lines.filter((l) => l.layer === only) : r.lines;
    return buildDxf([pageFrame(r.wMm, r.hMm), ...lines], ImageEditorPageComponent.DXF_LAYERS, r.hMm);
  }

  exportSheetDxf(): void {
    const dxf = this.sheetDxfText();
    if (dxf) this.downloadBlob(new Blob([dxf], { type: 'application/dxf' }), `folha-${this.sheetSize()}-corte.dxf`);
  }

  /** Passo a passo do Studio, com o material escolhido. */
  private silhouetteGuide(title: string, wMm: number, hMm: number, cutFiles: string, extra: string[]): string {
    const mat = this.materials.describe(this.materials.selected());
    return [
      `${title} — Silhouette Studio`,
      '',
      `1. Design da página: tamanho ${this.sheetSize()}, orientação ${this.orientation()} (${this.fmtMm(wMm)} × ${this.fmtMm(hMm)} mm).`,
      `   Marcas de registro: ligadas, estilo Tipo 1. A área hachurada do Studio`,
      `   não pode cobrir desenho — o editor deixou ${this.sheetMargin()} mm livres em cada borda.`,
      '2. Arquivo > Mesclar: folha-impressao.png.',
      `   Selecione a imagem e, no painel Transformar, ponha L ${this.fmtMm(wMm)} mm,`,
      `   A ${this.fmtMm(hMm)} mm, X 0 e Y 0 (ela cobre a página inteira).`,
      `3. Arquivo > Mesclar: ${cutFiles}.`,
      '   Selecione tudo o que veio do DXF, agrupe e ponha X 0 e Y 0.',
      `   Confira a largura do grupo: tem de ser ${this.fmtMm(wMm)} mm (é o retângulo`,
      '   cinza da página). Se entrou em outra escala, ajuste proporcional até dar essa medida.',
      '   Desagrupe e apague o retângulo cinza da página — ele não é pra cortar.',
      '4. Imprima pelo Studio em tamanho real (100%).',
      `5. Enviar: ${mat ? `material ${mat}.` : 'escolha o material.'}`,
      ...extra,
      '   A máquina lê as marcas antes de começar.',
      '',
    ].join('\r\n');
  }

  /** Impressão (PNG da página inteira, sem marcas: quem imprime as marcas é o
   * Studio) + corte (DXF com a moldura da página) + o passo a passo. */
  async exportSilhouettePackage(): Promise<void> {
    const sheet = this.renderSheetHiRes(false);
    const dxf = this.sheetDxfText();
    if (!sheet || !dxf) return;
    const png = await new Promise<Blob | null>((r) => sheet.canvas.toBlob(r, 'image/png'));
    if (!png) return;
    const kiss = this.kissCut();
    const extra = kiss
      ? [
        '   Folha de adesivos: as peças são MEIO-CORTE (vermelho) e a borda da folha é',
        '   CORTE TOTAL (azul). No painel Enviar, use "Linha" (por cor) e dê a cada cor',
        '   o seu ajuste: o vermelho só corta o adesivo, o azul atravessa o papel.',
        '   Se as cores não vierem no DXF, corte em duas vezes: primeiro',
        '   folha-meio-corte.dxf, depois troque o ajuste e corte folha-corte-total.dxf',
        '   (sem tirar o papel da máquina).',
      ]
      : ['   Confira que só as linhas vermelhas vão cortar e mande cortar.'];
    const files: ZipEntry[] = [
      { name: 'COMO-USAR.txt', content: this.silhouetteGuide(`Folha ${this.sheetSize()} ${this.orientation()}`, sheet.wMm, sheet.hMm, 'folha-corte.dxf', extra) },
      { name: 'folha-impressao.png', content: new Uint8Array(await (await pngBlobWithDpi(png, EXPORT_DPI)).arrayBuffer()) },
      { name: 'folha-corte.dxf', content: dxf },
    ];
    if (kiss) {
      files.push({ name: 'folha-meio-corte.dxf', content: this.sheetDxfText('MEIO_CORTE')! });
      files.push({ name: 'folha-corte-total.dxf', content: this.sheetDxfText('CORTE_TOTAL')! });
    }
    this.downloadBlob(zipStore(files), `folha-${this.sheetSize()}-silhouette.zip`);
  }

  /** Folha de teste: quadrados impressos com um corte 1 mm maior em volta, nos
   * cantos da área útil e no meio. Borda branca igual dos quatro lados = impressão
   * e corte alinhados. */
  async exportAlignmentTest(): Promise<void> {
    const { wMm, hMm } = sheetDimensionsMm(this.sheetSize(), this.orientation());
    const m = this.sheetMargin() + 5, s = 10, c = 12;
    const centers: Point[] = [
      [m + c / 2, m + c / 2], [wMm - m - c / 2, m + c / 2], [m + c / 2, hMm - m - c / 2],
      [wMm - m - c / 2, hMm - m - c / 2], [wMm / 2, hMm / 2],
    ];
    const k = EXPORT_DPI / 25.4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(wMm * k);
    canvas.height = Math.round(hMm * k);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [x, y] of centers) {
      ctx.fillStyle = '#1d3557';
      ctx.fillRect((x - s / 2) * k, (y - s / 2) * k, s * k, s * k);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.3 * k;
      ctx.beginPath();
      ctx.moveTo((x - s / 2) * k, y * k); ctx.lineTo((x + s / 2) * k, y * k);
      ctx.moveTo(x * k, (y - s / 2) * k); ctx.lineTo(x * k, (y + s / 2) * k);
      ctx.stroke();
    }
    ctx.fillStyle = '#555555';
    ctx.font = `${3.5 * k}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Teste de alinhamento — a borda branca de cada quadrado deve ficar igual dos quatro lados', (wMm / 2) * k, (hMm / 2 + 14) * k);
    const squares: DxfPolyline[] = centers.map(([x, y]) => ({
      layer: 'CORTE', closed: true,
      points: [[x - c / 2, y - c / 2], [x + c / 2, y - c / 2], [x + c / 2, y + c / 2], [x - c / 2, y + c / 2]],
    }));
    const dxf = buildDxf([pageFrame(wMm, hMm), ...squares], ImageEditorPageComponent.DXF_LAYERS, hMm);
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!png) return;
    const guide = this.silhouetteGuide('Teste de alinhamento', wMm, hMm, 'teste-corte.dxf', [
      '   Depois de cortar: em cada quadrado a borda branca deve ter ~1 mm dos quatro lados.',
      '   Se ficar maior de um lado que do outro, rode a calibração de impressão e corte',
      '   do Studio (Preferências / Enviar > Calibração) e faça o teste de novo.',
    ]).replace(/folha-impressao\.png/g, 'teste-impressao.png');
    this.downloadBlob(zipStore([
      { name: 'COMO-USAR.txt', content: guide },
      { name: 'teste-impressao.png', content: new Uint8Array(await (await pngBlobWithDpi(png, EXPORT_DPI)).arrayBuffer()) },
      { name: 'teste-corte.dxf', content: dxf },
    ]), `teste-alinhamento-${this.sheetSize()}.zip`);
  }

  editingMaterials = signal(false);

  toggleMaterials(): void {
    this.editingMaterials.update((v) => !v);
    void this.materials.load();
  }

  private fmtMm(v: number): string {
    return (Math.round(v * 10) / 10).toString().replace('.', ',');
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

  private renderSheetHiRes(marks = true): { canvas: HTMLCanvasElement; wMm: number; hMm: number; placed: PlacedPiece[] } | null {
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
      this.drawPlaced(ctx, p, this.pieceFor(item, 'full'), scale, false);
    }
    if (marks && this.machine() !== 'silhouette') this.drawMarks(ctx, wMm, hMm, scale);
    return { canvas, wMm, hMm, placed };
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
    const svg = this.sheetSvgText();
    if (!svg) return;
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `folha-${this.sheetSize()}-corte.svg`);
  }

  /** Um PDF só: página 1 pra imprimir (com as marcas, se ligadas), página 2
   * com as linhas de corte em vetor, nas mesmas posições. */
  private async printCutPdf(): Promise<Blob | null> {
    const sheet = this.renderSheetHiRes();
    if (!sheet) return null;
    const cuts = this.sheetCutsMm(sheet.placed, 'full');
    const blob = await new Promise<Blob | null>((r) => sheet.canvas.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) return null;
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const marks = this.regMarks() ? `0 g\n${pdfRectOps(registrationMarks(sheet.wMm, sheet.hMm), sheet.hMm)}` : '';
    const border = this.kissCut() ? this.sheetBorderMm(sheet.placed, sheet.wMm, sheet.hMm) : null;
    const borderOps = border
      ? `0 0 1 RG\n${pdfPathOps([{ start: border[0], segments: border.slice(1).map((to) => ({ c1: null, c2: null, to })) }], sheet.hMm)}S\n`
      : '';
    const cutPage = `1 0 0 RG 0.57 w 1 J 1 j\n${pdfPathOps(cuts, sheet.hMm)}S\n${borderOps}${marks}`;
    return buildPdf([
      { wMm: sheet.wMm, hMm: sheet.hMm, content: '', image: { jpeg, pxW: sheet.canvas.width, pxH: sheet.canvas.height } },
      { wMm: sheet.wMm, hMm: sheet.hMm, content: cutPage },
    ]);
  }

  async exportPrintCutPdf(): Promise<void> {
    const pdf = await this.printCutPdf();
    if (pdf) this.downloadBlob(pdf, `folha-${this.sheetSize()}-impressao-e-corte.pdf`);
  }

  private sheetSvgText(): string | null {
    const { placed, wMm, hMm } = this.packCurrent();
    if (!placed.length) return null;
    const d = cubicPathsToData(this.sheetCutsMm(placed, 'full'));
    const border = this.kissCut() ? this.sheetBorderMm(placed, wMm, hMm) : null;
    const borderSvg = border
      ? `  <path d="M${border.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join('L')}Z" fill="none" stroke="#0000ff" stroke-width="0.2" />\n`
      : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wMm} ${hMm}">\n` +
      `  <path d="${d}" fill="none" stroke="#ff0000" stroke-width="0.2" />\n` + borderSvg +
      `</svg>\n`;
  }

  // ---------- pacote do cliente ----------

  packaging = signal(false);

  /** Tudo do projeto num ZIP: folha e peças do Print & Cut, molde, post e
   * ilustração, com um LEIAME. */
  async exportClientPackage(): Promise<void> {
    if (this.packaging()) return;
    this.packaging.set(true);
    this.projectStatus.set('Montando o pacote…');
    try {
      const sections: PackageSection[] = [];
      const cut = await this.printCutSection();
      if (cut) sections.push(cut);
      for (const make of [
        () => templateSection(this.templates, this.fonts),
        () => socialSection(this.social, this.fonts),
        () => illustrationSection(this.illustration),
      ]) {
        try {
          const sec = await make();
          if (sec) sections.push(sec);
        } catch { /* um modo que falhe não derruba o pacote */ }
      }
      if (!sections.length) {
        this.projectStatus.set('Nada pra empacotar ainda.');
        return;
      }
      const name = this.projectName().trim() || 'projeto';
      const files: ZipEntry[] = [{ name: 'LEIAME.txt', content: readme(name, sections) }, ...sections.flatMap((sec) => sec.files)];
      const safe = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'projeto';
      this.downloadBlob(zipStore(files), `${safe}-pacote.zip`);
      this.projectStatus.set(`Pacote com ${files.length} arquivo(s).`);
    } finally {
      this.packaging.set(false);
    }
  }

  private async printCutSection(): Promise<PackageSection | null> {
    const items = this.images();
    if (!items.length) return null;
    const files: ZipEntry[] = [];
    const pdf = await this.printCutPdf();
    if (pdf) files.push({ name: 'print-and-cut/folha-impressao-e-corte.pdf', content: new Uint8Array(await pdf.arrayBuffer()) });
    const svg = this.sheetSvgText();
    if (svg) files.push({ name: 'print-and-cut/folha-corte.svg', content: svg });
    const dxf = this.sheetDxfText();
    if (dxf) files.push({ name: 'print-and-cut/folha-corte.dxf', content: dxf });
    const names = uniqueNames(items.map((i) => this.baseName(i)));
    for (const [k, item] of items.entries()) {
      const piece = this.pieceFor(item, 'full');
      files.push({ name: `print-and-cut/pecas/${names[k]}-corte.svg`, content: this.pieceSvg(piece, null) });
      const png = await new Promise<Blob | null>((r) => piece.canvas.toBlob(r, 'image/png'));
      if (png) files.push({ name: `print-and-cut/pecas/${names[k]}.png`, content: new Uint8Array(await (await pngBlobWithDpi(png, Math.round(piece.ppm * 25.4))).arrayBuffer()) });
    }
    const { placed, overflow } = this.packCurrent();
    return {
      folder: 'print-and-cut',
      files,
      notes: [
        `Print & Cut — folha ${this.sheetSize()} ${this.orientation()}, ${placed.length} peça(s)${overflow.length ? ` (${overflow.length} não couberam)` : ''}${this.regMarks() ? ', com marcas de registro' : ''}.`,
        '  folha-impressao-e-corte.pdf: página 1 imprime, página 2 é o corte. folha-corte.svg/.dxf: o mesmo corte pra máquina.',
        '  pecas/: cada arte com a borda (PNG) e a linha de corte (SVG).',
      ],
    };
  }

  /** Quantas cópias da selecionada cabem na folha junto com o resto. */
  async fillSheet(): Promise<void> {
    const sel = this.selected();
    if (!sel) return;
    this.fillStatus.set('Calculando quantas cabem…');
    await new Promise((r) => setTimeout(r, 0));
    const fits = (n: number): boolean => {
      const items = this.images().map((i) => (i.id === sel.id ? { ...i, copies: n } : i));
      return this.packCurrent(items).overflow.length === 0;
    };
    if (!fits(1)) {
      this.fillStatus.set('Nem uma cópia cabe junto com as outras peças.');
      return;
    }
    let lo = 1, hi = 2;
    while (hi <= 512 && fits(hi)) { lo = hi; hi *= 2; }
    hi = Math.min(hi, 513);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    this.updateSelected({ copies: lo });
    this.fillStatus.set(`${lo} cópia(s) de "${sel.name}" na folha.`);
    this.setView('folha');
  }

  cutLengthLabel(): string {
    const mm = this.cutLengthMm();
    if (!mm) return '';
    const s = Math.round(mm / CUT_SPEED_MM_S);
    const tempo = s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
    return `${(mm / 1000).toFixed(2).replace('.', ',')} m de corte · ~${tempo} na máquina`;
  }

  /** Anima a lâmina percorrendo as linhas de corte da vista atual. */
  simulateCut(): void {
    if (this.simulating()) {
      this.stopSim?.();
      this.stopSim = null;
      this.simulating.set(false);
      this.scheduleRender();
      return;
    }
    let canvas: HTMLCanvasElement | undefined;
    let lines: SimLine[] = [];
    if (this.view() === 'folha') {
      canvas = this.sheetCanvas?.nativeElement;
      const { placed } = this.packCurrent();
      const scale = canvas ? canvas.width / sheetDimensionsMm(this.sheetSize(), this.orientation()).wMm : 1;
      lines = this.sheetCutsMm(placed, 'preview').map((c) => flattenCubic(c, ([x, y]) => [x * scale, y * scale]));
    } else {
      const sel = this.selected();
      canvas = this.previewCanvas?.nativeElement;
      if (sel) lines = this.pieceFor(sel).cuts.map((c) => flattenCubic(c, (q) => q));
    }
    if (!canvas || !lines.length) return;
    const lenPx = lines.reduce((s2, l) => s2 + lineLength(l), 0);
    this.simulating.set(true);
    this.stopSim = animateCut(canvas, lines, Math.min(12000, Math.max(2500, lenPx * 4)), Math.max(2, canvas.width / 300), () => {
      this.simulating.set(false);
      this.stopSim = null;
    });
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
      packMode: this.packMode(),
      rotate: this.allowRotate(),
      regMarks: this.regMarks(),
      machine: this.machine(),
      markZoneMm: this.markZoneMm(),
      kissCut: this.kissCut(),
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
        borderStyle: i.borderStyle,
        artShadow: i.artShadow,
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
      this.settleDraft();
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
      await this.applyProjectData(JSON.parse(dto.data) as ProjectData);
      this.projectId.set(dto.id);
      this.projectName.set(dto.name);
      this.projectCreatedAt = dto.createdAt;
      this.projectStatus.set(`Aberto: ${dto.name}`);
      this.settleDraft();
      this.draftOffer.set(null);
    } catch {
      this.projectStatus.set('Falha ao abrir o projeto.');
    }
  }

  /** Põe um projeto (do servidor ou do rascunho) nos quatro modos. */
  private async applyProjectData(data: ProjectData): Promise<void> {
    this.applyingProject = true;
    try {
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
      if (data.packMode) this.packMode.set(data.packMode);
      if (data.rotate !== undefined) this.allowRotate.set(data.rotate);
      if (data.regMarks !== undefined) this.regMarks.set(data.regMarks);
      if (data.machine) this.machine.set(data.machine);
      if (data.markZoneMm) this.markZoneMm.set(data.markZoneMm);
      if (data.kissCut !== undefined) this.kissCut.set(data.kissCut);

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
      this.resetPcHistory();
    } finally {
      // os effects rodam depois desta volta; só então mudanças contam como edição
      setTimeout(() => (this.applyingProject = false));
    }
  }

  private resetPcHistory(): void {
    this.pcHistory.reset();
    this.pcHistory.observe({ items: this.images(), selectedId: this.selectedId() });
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
    this.resetPcHistory();
    this.settleDraft();
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
