import type { DoorConfig, LevelConfig, Rect } from '../core/types.ts';
import { configureCanvas, RenderContext, type CanvasFactory, type CanvasLike, type RenderLayout } from './context.ts';
import { renderStationBackground } from './station-renderer.ts';

function sameRect(first: Rect, second: Rect): boolean {
  return first.x === second.x && first.y === second.y
    && first.width === second.width && first.height === second.height;
}

type DoorGeometry = Pick<DoorConfig, 'id' | 'center' | 'width'>;

function sameDoors(first: readonly DoorGeometry[], second: readonly DoorGeometry[]): boolean {
  return first.length === second.length && first.every((door, index) => {
    const other = second[index];
    return door.id === other.id && door.width === other.width
      && door.center.x === other.center.x && door.center.y === other.center.y;
  });
}

/** 最多保留一张当前视口大小的底图，切关/调整尺寸时复用画布。 */
export class StationBackgroundCache {
  private canvas?: CanvasLike;
  private layout?: RenderLayout;
  private level?: Pick<LevelConfig, 'id' | 'carriageTheme' | 'trainBounds' | 'platformBounds'>
    & { doors: DoorGeometry[] };
  private unavailable = false;
  private readonly factory?: CanvasFactory;
  private readonly screenCanvas?: CanvasLike;

  constructor(factory?: CanvasFactory, screenCanvas?: CanvasLike) {
    this.factory = factory;
    this.screenCanvas = screenCanvas;
  }

  draw(target: RenderContext, level: LevelConfig): boolean {
    if (this.unavailable || !this.factory || !target.ctx.drawImage) return false;
    try {
      if (!this.canvas) {
        const candidate = this.factory();
        if (candidate === this.screenCanvas || candidate.getContext?.('2d') === target.ctx) {
          throw new Error('background cache requires a separate canvas');
        }
        this.canvas = candidate;
      }
      const canvas = this.canvas;
      const viewport = target.layout.viewport;
      if (this.layout !== target.layout || !this.level
        || this.level.id !== level.id || this.level.carriageTheme !== level.carriageTheme
        || !sameRect(this.level.trainBounds, level.trainBounds)
        || !sameRect(this.level.platformBounds, level.platformBounds)
        || !sameDoors(this.level.doors, level.doors)
        || canvas.width !== Math.round(viewport.width * viewport.dpr)
        || canvas.height !== Math.round(viewport.height * viewport.dpr)) {
        const ctx = canvas.getContext?.('2d');
        if (!ctx) throw new Error('background cache requires a 2d context');
        configureCanvas(canvas, ctx, viewport);
        const background = new RenderContext(ctx, viewport, target.layout.worldBounds);
        background.clear('#0b1627');
        renderStationBackground(background, level);
        this.layout = target.layout;
        this.level = { id: level.id, carriageTheme: level.carriageTheme,
          trainBounds: { ...level.trainBounds }, platformBounds: { ...level.platformBounds },
          doors: level.doors.map(({ id, center, width }) => ({ id, center: { ...center }, width })) };
      }
      // 物理尺寸取整后仍保持像素 1:1；小数 DPR 下按逻辑宽高回贴会产生二次缩放。
      // 底图已包含底色，先完整清空再回贴，避免边缘半透明像素重复叠加。
      target.ctx.clearRect(0, 0, canvas.width / viewport.dpr, canvas.height / viewport.dpr);
      target.ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height,
        0, 0, canvas.width / viewport.dpr, canvas.height / viewport.dpr);
      return true;
    } catch {
      // 不支持离屏绘制/合成时，本帧立即回退；后续不再每帧尝试失败的能力。
      this.unavailable = true;
      this.destroy();
      return false;
    }
  }

  destroy(): void {
    if (this.canvas) {
      try { this.canvas.width = 1; this.canvas.height = 1; } catch { /* 宿主可能已释放画布。 */ }
    }
    this.canvas = undefined;
    this.layout = undefined;
    this.level = undefined;
  }
}
