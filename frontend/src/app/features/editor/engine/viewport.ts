import { Point } from '../../../data/models';

/** Transforma coordenadas mundo <-> tela. offset é o ponto do mundo na origem da tela, scale é o zoom. */
export class Viewport {
  offsetX = 0;
  offsetY = 0;
  scale = 1;

  screenToWorld(p: Point): Point {
    return { x: p.x / this.scale + this.offsetX, y: p.y / this.scale + this.offsetY };
  }

  worldToScreen(p: Point): Point {
    return { x: (p.x - this.offsetX) * this.scale, y: (p.y - this.offsetY) * this.scale };
  }

  zoomAt(screenPoint: Point, factor: number): void {
    const worldBefore = this.screenToWorld(screenPoint);
    this.scale = Math.min(8, Math.max(0.1, this.scale * factor));
    const worldAfter = this.screenToWorld(screenPoint);
    this.offsetX += worldBefore.x - worldAfter.x;
    this.offsetY += worldBefore.y - worldAfter.y;
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.offsetX -= dxScreen / this.scale;
    this.offsetY -= dyScreen / this.scale;
  }

  fitToScreen(bbox: { minX: number; minY: number; maxX: number; maxY: number }, canvasW: number, canvasH: number): void {
    const w = Math.max(1, bbox.maxX - bbox.minX);
    const h = Math.max(1, bbox.maxY - bbox.minY);
    const padding = 0.9;
    this.scale = Math.min((canvasW / w) * padding, (canvasH / h) * padding, 4);
    this.offsetX = bbox.minX - (canvasW / this.scale - w) / 2;
    this.offsetY = bbox.minY - (canvasH / this.scale - h) / 2;
  }

  reset(): void {
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;
  }
}
