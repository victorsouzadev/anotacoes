import { Component, HostListener, OnDestroy, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';

type Shape = 'round' | 'square';

interface Flavor {
  id: string;
  label: string;
  color: string;
}

interface Frosting {
  id: string;
  label: string;
  color: string;
}

interface FaceView {
  width: number;
  transform: string;
  filter: string;
}

interface TierView {
  index: number;
  height: number;
  faces: FaceView[];
  capSize: number;
  capRadius: string;
  capTransform: string;
  faceBackground: string;
  isTop: boolean;
}

interface Sprinkle {
  left: number;
  top: number;
  rotate: number;
  color: string;
}

interface Cherry {
  left: number;
  top: number;
}

interface Candle {
  index: number;
  left: number;
  top: number;
  color: string;
}

interface Topper {
  id: string;
  src: string;
  naturalRatio: number;
  xCm: number;
  yCm: number;
  widthCm: number;
}

const FLAVORS: Flavor[] = [
  { id: 'chocolate', label: 'Chocolate', color: '#6b4226' },
  { id: 'baunilha', label: 'Baunilha', color: '#f3dfb0' },
  { id: 'morango', label: 'Morango', color: '#f2a3b5' },
  { id: 'red-velvet', label: 'Red Velvet', color: '#9c1f3d' },
  { id: 'limao', label: 'Limão', color: '#eee9a0' },
  { id: 'cenoura', label: 'Cenoura', color: '#e8933a' },
];

const FROSTINGS: Frosting[] = [
  { id: 'branco', label: 'Chantilly', color: '#fffaf3' },
  { id: 'ganache', label: 'Ganache', color: '#5a3524' },
  { id: 'rosa', label: 'Rosa', color: '#f6b8cc' },
  { id: 'lilas', label: 'Lilás', color: '#cdb8f0' },
  { id: 'azul', label: 'Azul Bebê', color: '#b9d9f6' },
  { id: 'verde', label: 'Pistache', color: '#c3dba6' },
];

const CANDLE_COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa', '#ff9f43'];
const SPRINKLE_COLORS = ['#ff6b6b', '#ffd93d', '#4ecdc4', '#a78bfa', '#ff9f43', '#ffffff'];

const CAKE_BOX = 360;
const MAX_TIERS = 3;
const MINIMAP_CAKE_PX = 200;
const MINIMAP_RULER_PX = 18;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 999.7) * 43758.5453;
  return x - Math.floor(x);
}

@Component({
  selector: 'app-cake-simulator-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="page">
      <header class="top-bar">
        <div class="brand">
          <a class="hub-link" routerLink="/" title="Voltar ao início"><app-icon name="grid" [size]="16" /></a>
          <h1><span class="brand-mark"><app-icon name="cake" [size]="14" /></span> Simulador de Bolo 3D</h1>
        </div>
        <div class="top-bar-actions">
          <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()"><app-icon [name]="themeIconName()" [size]="16" /></button>
          <span class="user-email">{{ auth.user()?.email }}</span>
          <button class="logout" (click)="auth.logout()"><app-icon name="logout" [size]="14" /> Sair</button>
        </div>
      </header>

      <main class="content">
        <div class="stage-wrap">
          <div
            class="stage"
            (pointerdown)="onPointerDown($event)"
            (pointermove)="onPointerMove($event)"
            (pointerup)="onPointerUp($event)"
            (pointercancel)="onPointerUp($event)"
          >
            <div class="ground-shadow"></div>
            <div class="scene" [style.transform]="'rotateX(' + tiltDeg() + 'deg)'">
              <div class="cake" [style.transform]="'rotateY(' + spinDeg() + 'deg)'">
                @for (tier of tiers(); track tier.index) {
                  @for (face of tier.faces; track $index) {
                    <div
                      class="face"
                      [style.width.px]="face.width"
                      [style.height.px]="tier.height"
                      [style.margin-left.px]="-face.width / 2"
                      [style.margin-top.px]="-tier.height / 2"
                      [style.transform]="face.transform"
                      [style.background]="tier.faceBackground"
                      [style.filter]="face.filter"
                    ></div>
                  }
                  <div
                    class="cap"
                    [style.width.px]="tier.capSize"
                    [style.height.px]="tier.capSize"
                    [style.margin-left.px]="-tier.capSize / 2"
                    [style.margin-top.px]="-tier.capSize / 2"
                    [style.transform]="tier.capTransform"
                    [style.border-radius]="tier.capRadius"
                    [style.background]="frostingColor()"
                  >
                    @if (tier.isTop) {
                      @if (showDrizzle()) {
                        <div class="drizzle"></div>
                      }
                      @if (showSprinkles()) {
                        @for (s of sprinkles(); track $index) {
                          <div
                            class="sprinkle"
                            [style.left.%]="s.left"
                            [style.top.%]="s.top"
                            [style.background]="s.color"
                            [style.transform]="'translateZ(2px) rotate(' + s.rotate + 'deg)'"
                          ></div>
                        }
                      }
                      @if (showCherries()) {
                        @for (c of cherries(); track $index) {
                          <div class="cherry" [style.left.%]="c.left" [style.top.%]="c.top">
                            <div class="cherry-stem"></div>
                          </div>
                        }
                      }
                      @for (candle of candles(); track candle.index) {
                        <div class="candle" [style.left.%]="candle.left" [style.top.%]="candle.top">
                          <div class="candle-body" [style.background]="candle.color"></div>
                          <button
                            type="button"
                            class="flame"
                            [class.lit]="isLit(candle.index)"
                            (click)="toggleCandle(candle.index)"
                            [title]="isLit(candle.index) ? 'Assoprar' : 'Acender'"
                          ></button>
                        </div>
                      }
                      @for (t of toppers(); track t.id) {
                        <img
                          class="topper-img"
                          [class.selected]="selectedTopperId() === t.id"
                          [src]="t.src"
                          alt="Imagem colada no topo do bolo"
                          [style.left.px]="tier.capSize / 2 + t.xCm * pxPerCm()"
                          [style.top.px]="tier.capSize / 2 + t.yCm * pxPerCm()"
                          [style.width.px]="t.widthCm * pxPerCm()"
                          [style.height.px]="t.widthCm * t.naturalRatio * pxPerCm()"
                          (click)="selectTopper(t.id)"
                        />
                      }
                    }
                  </div>
                }
              </div>
            </div>
          </div>
          <p class="stage-hint">Arraste para girar o bolo &middot; clique nas velas para acender/assoprar</p>
        </div>

        <aside class="controls">
          <section class="panel">
            <h2>Formato</h2>
            <div class="row">
              <button class="chip" [class.active]="shape() === 'round'" (click)="shape.set('round')">Redondo</button>
              <button class="chip" [class.active]="shape() === 'square'" (click)="shape.set('square')">Quadrado</button>
            </div>
          </section>

          <section class="panel">
            <h2>Camadas</h2>
            <div class="stepper">
              <button (click)="setLayerCount(layerCount() - 1)" [disabled]="layerCount() <= 1">&minus;</button>
              <span>{{ layerCount() }}</span>
              <button (click)="setLayerCount(layerCount() + 1)" [disabled]="layerCount() >= maxTiers">+</button>
            </div>
          </section>

          <section class="panel">
            <h2>Topo do bolo</h2>
            <label class="field-row">
              <span>Diâmetro do topo</span>
              <span class="field-input">
                <input
                  type="number"
                  step="0.5"
                  min="5"
                  max="40"
                  [value]="topDiameterCm()"
                  (input)="setTopDiameter($any($event.target).value)"
                />
                cm
              </span>
            </label>
            <p class="hint">Copie uma imagem e pressione Ctrl+V para colar no topo do bolo.</p>

            <div class="minimap-wrap">
              <div class="minimap-ruler-top" [style.left.px]="minimapRulerPx">
                @for (m of rulerMarksCm(); track m) {
                  <span class="ruler-mark" [style.left.px]="m * widgetPxPerCm()">{{ m }}</span>
                }
              </div>
              <div class="minimap-row">
                <div class="minimap-ruler-left">
                  @for (m of rulerMarksCm(); track m) {
                    <span class="ruler-mark" [style.top.px]="m * widgetPxPerCm()">{{ m }}</span>
                  }
                </div>
                <div
                  class="minimap-cake"
                  [style.width.px]="minimapCakePx"
                  [style.height.px]="minimapCakePx"
                  [style.border-radius]="shape() === 'round' ? '50%' : '6%'"
                  [style.background-size.px]="widgetPxPerCm()"
                >
                  @for (t of toppers(); track t.id) {
                    <div
                      class="minimap-topper"
                      [class.selected]="selectedTopperId() === t.id"
                      [style.left.px]="minimapCakePx / 2 + t.xCm * widgetPxPerCm()"
                      [style.top.px]="minimapCakePx / 2 + t.yCm * widgetPxPerCm()"
                      [style.width.px]="t.widthCm * widgetPxPerCm()"
                      [style.height.px]="t.widthCm * t.naturalRatio * widgetPxPerCm()"
                      (pointerdown)="onMinimapDragStart($event, t.id)"
                      (pointermove)="onMinimapDragMove($event)"
                      (pointerup)="onMinimapDragEnd($event)"
                      (pointercancel)="onMinimapDragEnd($event)"
                    >
                      <img [src]="t.src" alt="" />
                      <div
                        class="resize-handle"
                        (pointerdown)="onMinimapResizeStart($event, t.id)"
                        (pointermove)="onMinimapResizeMove($event)"
                        (pointerup)="onMinimapDragEnd($event)"
                        (pointercancel)="onMinimapDragEnd($event)"
                      ></div>
                    </div>
                  }
                </div>
              </div>
            </div>

            @if (selectedTopper(); as sel) {
              <div class="topper-fields">
                <label>
                  X (cm)
                  <input type="number" step="0.1" [value]="sel.xCm" (input)="updateTopper(sel.id, { xCm: +$any($event.target).value })" />
                </label>
                <label>
                  Y (cm)
                  <input type="number" step="0.1" [value]="sel.yCm" (input)="updateTopper(sel.id, { yCm: +$any($event.target).value })" />
                </label>
                <label>
                  Largura (cm)
                  <input type="number" step="0.1" min="0.5" [value]="sel.widthCm" (input)="updateTopper(sel.id, { widthCm: +$any($event.target).value })" />
                </label>
                <p class="size-readout">{{ sizeLabel(sel) }}</p>
                <button class="link-btn danger" (click)="removeTopper(sel.id)">Remover imagem</button>
              </div>
            } @else if (toppers().length === 0) {
              <p class="empty-hint">Nenhuma imagem colada ainda.</p>
            }
          </section>

          <section class="panel">
            <h2>Sabor de cada camada</h2>
            @for (i of tierIndexes(); track i) {
              <div class="tier-flavor">
                <span class="tier-label">Camada {{ i + 1 }}</span>
                <div class="swatches">
                  @for (flavor of flavors; track flavor.id) {
                    <button
                      class="swatch"
                      [class.active]="tierFlavors()[i] === flavor.id"
                      [style.background]="flavor.color"
                      [title]="flavor.label"
                      (click)="setTierFlavor(i, flavor.id)"
                    ></button>
                  }
                </div>
              </div>
            }
          </section>

          <section class="panel">
            <h2>Cobertura</h2>
            <div class="swatches">
              @for (f of frostings; track f.id) {
                <button
                  class="swatch"
                  [class.active]="frostingId() === f.id"
                  [style.background]="f.color"
                  [title]="f.label"
                  (click)="frostingId.set(f.id)"
                ></button>
              }
            </div>
          </section>

          <section class="panel">
            <h2>Decoração</h2>
            <label class="toggle">
              <input type="checkbox" [checked]="showCherries()" (change)="showCherries.set(!showCherries())" />
              Cerejas
            </label>
            <label class="toggle">
              <input type="checkbox" [checked]="showSprinkles()" (change)="showSprinkles.set(!showSprinkles())" />
              Granulado
            </label>
            <label class="toggle">
              <input type="checkbox" [checked]="showDrizzle()" (change)="showDrizzle.set(!showDrizzle())" />
              Calda de chocolate
            </label>
          </section>

          <section class="panel">
            <h2>Velas</h2>
            <div class="stepper">
              <button (click)="setCandleCount(candleCount() - 1)" [disabled]="candleCount() <= 0">&minus;</button>
              <span>{{ candleCount() }}</span>
              <button (click)="setCandleCount(candleCount() + 1)" [disabled]="candleCount() >= 12">+</button>
            </div>
            <button class="link-btn" (click)="acenderTodas()">Acender todas</button>
            <button class="link-btn" (click)="assoprarTodas()">Assoprar todas</button>
          </section>

          <section class="panel actions">
            <label class="toggle">
              <input type="checkbox" [checked]="autoRotate()" (change)="autoRotate.set(!autoRotate())" />
              Girar automaticamente
            </label>
            <button class="primary-btn" (click)="surpreenda()">Surpreenda-me</button>
            <button class="secondary-btn" (click)="reset()">Recomeçar</button>
          </section>
        </aside>
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }
    .top-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 14px 28px; background: var(--surface); border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .hub-link {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      color: var(--text-muted); text-decoration: none;
    }
    .hub-link:hover { border-color: var(--accent); color: var(--accent); }
    .top-bar h1 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
    .brand-mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 8px; background: var(--accent); color: #fff; flex-shrink: 0;
    }
    .top-bar-actions { display: flex; align-items: center; gap: 14px; }
    .theme-toggle {
      border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius-sm);
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
      color: var(--text-muted); flex-shrink: 0;
    }
    .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }
    .user-email { font-size: 12px; color: var(--text-muted); }
    .logout { display: flex; align-items: center; gap: 5px; border: none; background: none; color: var(--text-muted); font-size: 12px; font-weight: 600; }
    .logout:hover { color: var(--danger, #d9534f); }

    .content {
      max-width: 1180px; margin: 0 auto; padding: 32px 28px 64px;
      display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start;
    }

    .stage-wrap {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm); padding: 16px;
    }
    .stage {
      position: relative; height: 460px; display: flex; align-items: center; justify-content: center;
      perspective: 1100px; perspective-origin: 50% 42%; touch-action: none; cursor: grab; user-select: none;
      overflow: hidden; border-radius: var(--radius);
      background: radial-gradient(circle at 50% 30%, var(--accent-soft), transparent 65%);
    }
    .stage:active { cursor: grabbing; }
    .ground-shadow {
      position: absolute; left: 50%; bottom: 62px; width: 260px; height: 40px; transform: translateX(-50%);
      background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.28), transparent 70%);
      filter: blur(4px); pointer-events: none;
    }
    .scene { transform-style: preserve-3d; }
    .cake {
      position: relative; width: ${CAKE_BOX}px; height: ${CAKE_BOX}px; transform-style: preserve-3d;
    }
    .face { position: absolute; left: 50%; top: 50%; border-radius: 3px; }
    .cap { position: absolute; left: 50%; top: 50%; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.04) inset; }

    .sprinkle { position: absolute; width: 7px; height: 2.6px; border-radius: 2px; margin-left: -3.5px; margin-top: -1.3px; }
    .cherry {
      position: absolute; width: 16px; height: 16px; margin-left: -8px; margin-top: -8px;
      border-radius: 50%; transform: translateZ(4px);
      background: radial-gradient(circle at 35% 30%, #ff7a8a, #b3122a 70%);
      box-shadow: 0 2px 3px rgba(0, 0, 0, 0.25);
    }
    .cherry-stem {
      position: absolute; left: 50%; top: -6px; width: 2px; height: 7px; background: #4a7c33;
      transform: rotate(-18deg); transform-origin: bottom center;
    }
    .drizzle {
      position: absolute; inset: 6%; border-radius: inherit; transform: translateZ(1px);
      background-image:
        radial-gradient(ellipse 22px 10px at 20% 30%, #3a2214 60%, transparent 62%),
        radial-gradient(ellipse 18px 26px at 55% 55%, #3a2214 55%, transparent 58%),
        radial-gradient(ellipse 26px 12px at 80% 25%, #3a2214 60%, transparent 62%),
        radial-gradient(ellipse 16px 22px at 35% 75%, #3a2214 55%, transparent 58%),
        radial-gradient(ellipse 20px 12px at 75% 70%, #3a2214 60%, transparent 62%);
      opacity: 0.85;
    }
    .candle {
      position: absolute; width: 8px; margin-left: -4px; margin-top: -40px; transform: translateZ(6px);
      display: flex; flex-direction: column; align-items: center;
    }
    .candle-body {
      width: 8px; height: 32px; border-radius: 2px;
      background-image: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.5) 0 4px, transparent 4px 8px);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }
    .flame {
      width: 13px; height: 18px; margin-top: -5px; border: none; padding: 0; cursor: pointer;
      border-radius: 50% 50% 50% 50% / 65% 65% 35% 35%;
      background: radial-gradient(circle at 50% 65%, #fff6cf, #ffd23f 45%, #f2841a 75%, #c8380f);
      box-shadow: 0 0 10px 3px rgba(255, 170, 40, 0.55);
      opacity: 0; transform: scale(0.4); transition: opacity 0.15s, transform 0.15s;
    }
    .flame.lit { opacity: 1; transform: scale(1); animation: flicker 1.1s ease-in-out infinite; }
    @keyframes flicker {
      0%, 100% { transform: scale(1) rotate(-2deg); }
      50% { transform: scale(0.92, 1.06) rotate(2deg); }
    }

    .stage-hint { text-align: center; font-size: 12px; color: var(--text-muted); margin: 10px 0 2px; }

    .controls { display: flex; flex-direction: column; gap: 14px; }
    .panel {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 14px 16px; box-shadow: var(--shadow-sm);
    }
    .panel h2 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin: 0 0 10px; }
    .row { display: flex; gap: 8px; }
    .chip {
      flex: 1; padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--bg); color: var(--text); font-size: 13px; font-weight: 600;
    }
    .chip.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-dark); }

    .stepper { display: flex; align-items: center; gap: 12px; }
    .stepper button {
      width: 30px; height: 30px; border-radius: var(--radius-sm); border: 1px solid var(--border);
      background: var(--bg); color: var(--text); font-size: 16px; line-height: 1; font-weight: 700;
    }
    .stepper button:disabled { opacity: 0.4; }
    .stepper span { min-width: 20px; text-align: center; font-weight: 700; font-size: 14px; }

    .tier-flavor { margin-bottom: 10px; }
    .tier-flavor:last-child { margin-bottom: 0; }
    .tier-label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
    .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
    .swatch {
      width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--surface);
      box-shadow: 0 0 0 1px var(--border);
    }
    .swatch.active { box-shadow: 0 0 0 2px var(--accent); }

    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 8px; color: var(--text); }
    .toggle:last-child { margin-bottom: 0; }
    .toggle input { accent-color: var(--accent); }

    .link-btn {
      display: block; width: 100%; text-align: left; border: none; background: none;
      color: var(--accent-dark); font-size: 12px; font-weight: 600; padding: 4px 0;
    }
    .link-btn:hover { text-decoration: underline; }
    .link-btn.danger { color: var(--danger, #d9534f); margin-top: 6px; }

    .field-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; margin-bottom: 8px; }
    .field-input { display: flex; align-items: center; gap: 6px; }
    .field-input input {
      width: 60px; padding: 5px 6px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--bg); color: var(--text); font-size: 13px;
    }
    .hint { font-size: 12px; color: var(--text-muted); margin: 0 0 10px; line-height: 1.4; }
    .empty-hint { font-size: 12px; color: var(--text-muted); margin: 8px 0 0; }

    .minimap-wrap { display: inline-block; user-select: none; }
    .minimap-ruler-top {
      position: relative; height: ${MINIMAP_RULER_PX}px; margin-bottom: 2px;
    }
    .minimap-row { display: flex; }
    .minimap-ruler-left {
      position: relative; width: ${MINIMAP_RULER_PX}px; flex-shrink: 0; margin-right: 2px;
    }
    .ruler-mark {
      position: absolute; font-size: 8px; color: var(--text-muted); transform: translateX(-50%);
    }
    .minimap-ruler-left .ruler-mark { transform: translateY(-50%); }
    .minimap-cake {
      position: relative; overflow: visible; background: var(--accent-soft);
      border: 1px solid var(--border);
      background-image:
        linear-gradient(to right, rgba(120, 120, 140, 0.16) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(120, 120, 140, 0.16) 1px, transparent 1px);
      background-position: center;
    }
    .minimap-topper {
      position: absolute; transform: translate(-50%, -50%); cursor: move;
      outline: 1px dashed transparent;
    }
    .minimap-topper.selected { outline-color: var(--accent); }
    .minimap-topper img { width: 100%; height: 100%; display: block; pointer-events: none; }
    .resize-handle {
      position: absolute; right: -5px; bottom: -5px; width: 10px; height: 10px;
      background: var(--accent); border: 2px solid var(--surface); border-radius: 50%; cursor: nwse-resize;
    }

    .topper-img { position: absolute; transform: translate(-50%, -50%) translateZ(3px); cursor: pointer; }
    .topper-img.selected { outline: 2px dashed rgba(255, 255, 255, 0.85); outline-offset: 2px; }

    .topper-fields { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
    .topper-fields label { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-muted); }
    .topper-fields input {
      width: 70px; padding: 5px 6px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--bg); color: var(--text); font-size: 13px;
    }
    .size-readout { font-size: 12px; color: var(--text); font-weight: 600; margin: 2px 0 0; }

    .actions { display: flex; flex-direction: column; gap: 10px; }
    .primary-btn {
      border: none; border-radius: var(--radius-sm); padding: 10px; background: var(--accent);
      color: #fff; font-weight: 700; font-size: 13px;
    }
    .primary-btn:hover { background: var(--accent-dark); }
    .secondary-btn {
      border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px;
      background: var(--bg); color: var(--text); font-weight: 600; font-size: 13px;
    }
    .secondary-btn:hover { border-color: var(--accent); color: var(--accent); }

    @media (max-width: 900px) {
      .content { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .top-bar { padding: 12px 16px; }
      .user-email { display: none; }
      .content { padding: 20px 16px 48px; }
      .stage { height: 380px; }
    }
  `],
})
export class CakeSimulatorPageComponent implements OnDestroy {
  flavors = FLAVORS;
  frostings = FROSTINGS;
  maxTiers = MAX_TIERS;
  minimapCakePx = MINIMAP_CAKE_PX;
  minimapRulerPx = MINIMAP_RULER_PX;

  topDiameterCm = signal(15);
  toppers = signal<Topper[]>([]);
  selectedTopperId = signal<string | null>(null);

  shape = signal<Shape>('round');
  layerCount = signal(3);
  tierFlavors = signal<string[]>(['chocolate', 'baunilha', 'morango']);
  frostingId = signal('branco');

  showCherries = signal(true);
  showSprinkles = signal(true);
  showDrizzle = signal(false);
  candleCount = signal(5);
  litCandleIndexes = signal<Set<number>>(new Set([0, 1, 2, 3, 4]));

  spinDeg = signal(-28);
  tiltDeg = signal(-28);
  autoRotate = signal(true);

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private autoRotateTimer: ReturnType<typeof setInterval> | undefined;

  private minimapDragId: string | null = null;
  private minimapResizeId: string | null = null;
  private minimapLastX = 0;
  private minimapLastY = 0;

  tierIndexes = computed(() => Array.from({ length: this.layerCount() }, (_, i) => i));

  frostingColor = computed(() => this.frostings.find((f) => f.id === this.frostingId())?.color ?? '#fffaf3');

  tiers = computed<TierView[]>(() => {
    const count = this.layerCount();
    const sides = this.shape() === 'round' ? 28 : 4;
    const flavorIds = this.tierFlavors();
    const frosting = this.frostingColor();
    const tiers: TierView[] = [];
    let stackTop = 0;
    const totalHeight = count * 60;

    for (let i = 0; i < count; i++) {
      const apothem = Math.max(46, 118 - i * 24);
      const height = 60;
      const flavor = this.flavors.find((f) => f.id === flavorIds[i]) ?? this.flavors[0];
      const groupY = stackTop + height / 2 - totalHeight * 0.62;

      const faces: FaceView[] = [];
      for (let s = 0; s < sides; s++) {
        const angleDeg = (360 / sides) * s;
        const angleRad = (angleDeg * Math.PI) / 180;
        const width = 2 * apothem * Math.tan(Math.PI / sides);
        const brightness = 0.6 + 0.5 * (0.5 + 0.5 * Math.cos(angleRad));
        faces.push({
          width,
          transform: `translateY(${-groupY}px) rotateY(${angleDeg}deg) translateZ(${apothem}px)`,
          filter: `brightness(${brightness.toFixed(3)})`,
        });
      }

      const capSize = this.shape() === 'round'
        ? (apothem / Math.cos(Math.PI / sides)) * 2
        : 2 * apothem * Math.tan(Math.PI / sides);

      tiers.push({
        index: i,
        height,
        faces,
        capSize,
        capRadius: this.shape() === 'round' ? '50%' : '12%',
        capTransform: `translateY(${-groupY}px) rotateX(90deg) translateZ(${height / 2}px)`,
        faceBackground: `linear-gradient(to top, ${flavor.color} 0%, ${flavor.color} 74%, ${frosting} 78%, ${frosting} 100%)`,
        isTop: i === count - 1,
      });
      stackTop += height;
    }
    return tiers;
  });

  sprinkles = computed<Sprinkle[]>(() => {
    const count = 42;
    const out: Sprinkle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = seededRandom(i * 3 + 1) * Math.PI * 2;
      const radiusFrac = 0.1 + seededRandom(i * 3 + 2) * 0.72;
      out.push({
        left: 50 + Math.cos(angle) * radiusFrac * 46,
        top: 50 + Math.sin(angle) * radiusFrac * 46,
        rotate: seededRandom(i * 3 + 3) * 360,
        color: SPRINKLE_COLORS[i % SPRINKLE_COLORS.length],
      });
    }
    return out;
  });

  cherries = computed<Cherry[]>(() => {
    const count = 7;
    const out: Cherry[] = [];
    for (let i = 0; i < count; i++) {
      const jitter = (seededRandom(i * 5 + 9) - 0.5) * 10;
      const angle = (360 / count) * i + jitter;
      const angleRad = (angle * Math.PI) / 180;
      out.push({
        left: 50 + Math.cos(angleRad) * 34,
        top: 50 + Math.sin(angleRad) * 34,
      });
    }
    return out;
  });

  candles = computed<Candle[]>(() => {
    const count = this.candleCount();
    const out: Candle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (360 / Math.max(count, 1)) * i - 90;
      const angleRad = (angle * Math.PI) / 180;
      const ringRadius = count <= 1 ? 0 : Math.min(26, 12 + count * 1.6);
      out.push({
        index: i,
        left: 50 + Math.cos(angleRad) * ringRadius,
        top: 50 + Math.sin(angleRad) * ringRadius,
        color: CANDLE_COLORS[i % CANDLE_COLORS.length],
      });
    }
    return out;
  });

  topCapSize = computed(() => {
    const tiers = this.tiers();
    return tiers[tiers.length - 1]?.capSize ?? 0;
  });

  pxPerCm = computed(() => this.topCapSize() / this.topDiameterCm());

  widgetPxPerCm = computed(() => MINIMAP_CAKE_PX / this.topDiameterCm());

  rulerMarksCm = computed(() => Array.from({ length: Math.floor(this.topDiameterCm()) + 1 }, (_, i) => i));

  selectedTopper = computed(() => this.toppers().find((t) => t.id === this.selectedTopperId()) ?? null);

  constructor(public auth: AuthService, public theme: ThemeService) {
    this.autoRotateTimer = setInterval(() => {
      if (this.autoRotate() && !this.dragging) {
        this.spinDeg.update((v) => v + 0.25);
      }
    }, 16);
  }

  ngOnDestroy(): void {
    if (this.autoRotateTimer) clearInterval(this.autoRotateTimer);
  }

  onPointerDown(event: PointerEvent): void {
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.spinDeg.update((v) => v + dx * 0.4);
    this.tiltDeg.update((v) => Math.min(-5, Math.max(-75, v + dy * 0.3)));
  }

  onPointerUp(event: PointerEvent): void {
    this.dragging = false;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  setLayerCount(value: number): void {
    this.layerCount.set(Math.min(this.maxTiers, Math.max(1, value)));
  }

  setTierFlavor(index: number, flavorId: string): void {
    this.tierFlavors.update((arr) => {
      const next = [...arr];
      next[index] = flavorId;
      return next;
    });
  }

  setCandleCount(value: number): void {
    const next = Math.min(12, Math.max(0, value));
    this.candleCount.set(next);
    this.litCandleIndexes.update((set) => {
      const filtered = new Set([...set].filter((i) => i < next));
      return filtered;
    });
  }

  isLit(index: number): boolean {
    return this.litCandleIndexes().has(index);
  }

  toggleCandle(index: number): void {
    this.litCandleIndexes.update((set) => {
      const next = new Set(set);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  acenderTodas(): void {
    this.litCandleIndexes.set(new Set(Array.from({ length: this.candleCount() }, (_, i) => i)));
  }

  assoprarTodas(): void {
    this.litCandleIndexes.set(new Set());
  }

  surpreenda(): void {
    const randomOf = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    this.shape.set(Math.random() > 0.5 ? 'round' : 'square');
    const count = 1 + Math.floor(Math.random() * this.maxTiers);
    this.layerCount.set(count);
    this.tierFlavors.set(Array.from({ length: this.maxTiers }, () => randomOf(this.flavors).id));
    this.frostingId.set(randomOf(this.frostings).id);
    this.showCherries.set(Math.random() > 0.4);
    this.showSprinkles.set(Math.random() > 0.4);
    this.showDrizzle.set(Math.random() > 0.5);
    this.setCandleCount(Math.floor(Math.random() * 9));
    this.acenderTodas();
  }

  reset(): void {
    this.shape.set('round');
    this.layerCount.set(3);
    this.tierFlavors.set(['chocolate', 'baunilha', 'morango']);
    this.frostingId.set('branco');
    this.showCherries.set(true);
    this.showSprinkles.set(true);
    this.showDrizzle.set(false);
    this.setCandleCount(5);
    this.acenderTodas();
    this.spinDeg.set(-28);
    this.tiltDeg.set(-28);
    this.autoRotate.set(true);
    this.toppers.set([]);
    this.selectedTopperId.set(null);
  }

  setTopDiameter(value: string): void {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    this.topDiameterCm.set(Math.min(40, Math.max(5, n)));
  }

  @HostListener('document:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      event.preventDefault();
      this.addTopperFromFile(file);
      break;
    }
  }

  private addTopperFromFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const naturalRatio = img.naturalHeight / img.naturalWidth || 1;
        const widthCm = Math.min(this.topDiameterCm() * 0.5, 6);
        const topper: Topper = { id: uid(), src, naturalRatio, xCm: 0, yCm: 0, widthCm };
        this.toppers.update((arr) => [...arr, topper]);
        this.selectedTopperId.set(topper.id);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  selectTopper(id: string): void {
    this.selectedTopperId.set(id);
  }

  updateTopper(id: string, changes: Partial<Pick<Topper, 'xCm' | 'yCm' | 'widthCm'>>): void {
    this.toppers.update((arr) =>
      arr.map((t) => (t.id === id ? { ...t, ...changes, widthCm: Math.max(0.5, changes.widthCm ?? t.widthCm) } : t)),
    );
  }

  removeTopper(id: string): void {
    this.toppers.update((arr) => arr.filter((t) => t.id !== id));
    if (this.selectedTopperId() === id) this.selectedTopperId.set(null);
  }

  sizeLabel(t: Topper): string {
    const heightCm = t.widthCm * t.naturalRatio;
    const fmt = (cm: number) => `${cm.toFixed(1)} cm (${Math.round(cm * 10)} mm)`;
    return `${fmt(t.widthCm)} × ${fmt(heightCm)}`;
  }

  onMinimapDragStart(event: PointerEvent, id: string): void {
    event.stopPropagation();
    this.minimapDragId = id;
    this.selectedTopperId.set(id);
    this.minimapLastX = event.clientX;
    this.minimapLastY = event.clientY;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onMinimapDragMove(event: PointerEvent): void {
    if (!this.minimapDragId) return;
    const dxCm = (event.clientX - this.minimapLastX) / this.widgetPxPerCm();
    const dyCm = (event.clientY - this.minimapLastY) / this.widgetPxPerCm();
    this.minimapLastX = event.clientX;
    this.minimapLastY = event.clientY;
    const id = this.minimapDragId;
    const current = this.toppers().find((t) => t.id === id);
    if (!current) return;
    this.updateTopper(id, { xCm: current.xCm + dxCm, yCm: current.yCm + dyCm });
  }

  onMinimapResizeStart(event: PointerEvent, id: string): void {
    event.stopPropagation();
    this.minimapResizeId = id;
    this.selectedTopperId.set(id);
    this.minimapLastX = event.clientX;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onMinimapResizeMove(event: PointerEvent): void {
    if (!this.minimapResizeId) return;
    const dxCm = (event.clientX - this.minimapLastX) / this.widgetPxPerCm();
    this.minimapLastX = event.clientX;
    const id = this.minimapResizeId;
    const current = this.toppers().find((t) => t.id === id);
    if (!current) return;
    this.updateTopper(id, { widthCm: current.widthCm + dxCm * 2 });
  }

  onMinimapDragEnd(event: PointerEvent): void {
    this.minimapDragId = null;
    this.minimapResizeId = null;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
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
