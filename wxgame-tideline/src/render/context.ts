import type { Rect, Vec2 } from '../core/types.ts';
import { clamp } from '../core/vector.ts';

export interface Canvas2DContextLike {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo?(cpx: number, cpy: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  ellipse?(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  fill(fillRule?: string): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  /** 图片绘制在低版本/测试 mock 中可能不存在，调用方必须保留几何回退。 */
  drawImage?(
    image: CanvasImageLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText?(text: string, x: number, y: number, maxWidth?: number): void;
  measureText?(text: string): { width: number };
  setLineDash?(segments: number[]): void;
  setTransform?(a: number, b: number, c: number, d: number, e: number, f: number): void;
  roundRect?(x: number, y: number, width: number, height: number, radii?: number | number[]): void;
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string | CanvasGradientLike;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  lineCap?: string;
  lineJoin?: string;
}

/** 最小渐变接口，避免把浏览器 DOM 类型带进规则/渲染公共接口。 */
export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext?(type: '2d'): Canvas2DContextLike | null;
}

export interface ViewportInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface ViewportMetrics {
  width: number;
  height: number;
  dpr: number;
  insets: Required<ViewportInsets>;
  contentRect: Rect;
}

export interface RenderLayout {
  viewport: ViewportMetrics;
  /** 当前画布方向；横屏使用独立的车厢上/站台下构图。 */
  orientation: WorldOrientation;
  worldBounds: Rect;
  /** 规则世界的包围盒（保留该字段供调试和外部布局读取）。 */
  displayWorldBounds: Rect;
  /** 世界在屏幕上的实际舞台区域。 */
  worldRect: Rect;
  /** 规则坐标到屏幕坐标的两个轴向缩放。横屏为有意的纵向压缩。 */
  worldScaleX: number;
  worldScaleY: number;
  /** 兼容旧调用方的缩放值；横屏取两个轴中较小者。 */
  worldScale: number;
  worldOffset: Vec2;
  hudRect: Rect;
  resultRect: Rect;
  /** 页面级命中区域与渲染共用，避免触摸坐标和视觉位置漂移。 */
  pauseButtonRect: Rect;
  resultRetryRect: Rect;
  resultNextRect: Rect;
  resultRouteRect: Rect;
  joystickCenter: Vec2;
  joystickRadius: number;
  guideButtonRect: Rect;
}

export type WorldOrientation = 'portrait' | 'landscape';

export const LOGICAL_VIEWPORT = { width: 360, height: 640 } as const;

function orientationFor(viewport: ViewportMetrics): WorldOrientation {
  return viewport.contentRect.width >= viewport.contentRect.height ? 'landscape' : 'portrait';
}

/** 不引入浏览器 DOM 类型的最小图片接口，兼容 wx.createImage 和 Node mock。 */
export interface CanvasImageLike {
  src?: string;
  width?: number;
  height?: number;
  complete?: boolean;
  onload?: () => void;
  onerror?: () => void;
}

export type CanvasImageFactory = () => CanvasImageLike;

function finiteScale(value: number | undefined, fallback = 1): number {
  return Number.isFinite(value) && value !== undefined && Math.abs(value) > 1e-8
    ? Math.abs(value)
    : fallback;
}

function normalizedDirection(x: number, y: number): Vec2 {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= 1e-8) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

/** 横屏不再旋转规则世界；车厢保持在规则坐标的上方，屏幕方向直观对应规则方向。 */
function worldToDisplay(point: Vec2): Vec2 {
  return { ...point };
}

function displayToWorld(point: Vec2): Vec2 {
  return { ...point };
}

/** 将规则层方向转换成屏幕方向，并补偿横屏舞台的轴向缩放。 */
export function worldDirectionToScreen(
  direction: Vec2,
  _orientation: WorldOrientation,
  scaleX = 1,
  scaleY = 1,
): Vec2 {
  return normalizedDirection(
    direction.x * finiteScale(scaleX),
    direction.y * finiteScale(scaleY),
  );
}

/** 将屏幕方向还原为规则层方向，供摇杆输入进入模拟前使用。 */
export function screenDirectionToWorld(
  direction: Vec2,
  _orientation: WorldOrientation,
  scaleX = 1,
  scaleY = 1,
): Vec2 {
  return normalizedDirection(
    direction.x / finiteScale(scaleX),
    direction.y / finiteScale(scaleY),
  );
}

export function createViewportMetrics(
  width: number,
  height: number,
  dpr = 1,
  insets: ViewportInsets = {},
): ViewportMetrics {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : LOGICAL_VIEWPORT.width);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : LOGICAL_VIEWPORT.height);
  const safeDpr = clamp(Number.isFinite(dpr) ? dpr : 1, 1, 4);
  const normalizedInsets = {
    top: Math.max(0, insets.top ?? 0),
    right: Math.max(0, insets.right ?? 0),
    bottom: Math.max(0, insets.bottom ?? 0),
    left: Math.max(0, insets.left ?? 0),
  };
  const contentRect: Rect = {
    x: normalizedInsets.left,
    y: normalizedInsets.top,
    width: Math.max(1, safeWidth - normalizedInsets.left - normalizedInsets.right),
    height: Math.max(1, safeHeight - normalizedInsets.top - normalizedInsets.bottom),
  };
  return { width: safeWidth, height: safeHeight, dpr: safeDpr, insets: normalizedInsets, contentRect };
}

export function configureCanvas(
  canvas: CanvasLike,
  context: Canvas2DContextLike,
  metrics: ViewportMetrics,
): void {
  canvas.width = Math.max(1, Math.round(metrics.width * metrics.dpr));
  canvas.height = Math.max(1, Math.round(metrics.height * metrics.dpr));
  context.setTransform?.(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
}

export function createRenderLayout(
  viewport: ViewportMetrics,
  worldBounds: Rect,
): RenderLayout {
  const content = viewport.contentRect;
  const orientation = orientationFor(viewport);
  const displayWorldBounds = { ...worldBounds };
  let worldRect: Rect;
  let worldScaleX: number;
  let worldScaleY: number;
  let worldScale: number;

  if (orientation === 'landscape') {
    // 横屏使用独立舞台：HUD 改为左侧悬浮卡片，顶部空间交给车厢，
    // 底部仍留给操作区，规则世界不旋转，因而车厢自然位于站台上方。
    // 横向拉伸让 320 逻辑宽度真正利用横屏空间，
    // 角色绘制层会用同一屏幕尺度补偿纵向压缩。
    const sideMargin = clamp(content.width * 0.025, 12, 24);
    const topInset = clamp(content.height * 0.05, 16, 24);
    const bottomInset = clamp(content.height * 0.035, 10, 14);
    worldRect = {
      x: content.x + sideMargin,
      y: content.y + topInset,
      width: Math.max(1, content.width - sideMargin * 2),
      height: Math.max(1, content.height - topInset - bottomInset),
    };
    worldScaleX = Math.max(0.05, worldRect.width / Math.max(worldBounds.width, 1));
    worldScaleY = Math.max(0.05, worldRect.height / Math.max(worldBounds.height, 1));
    worldScale = Math.min(worldScaleX, worldScaleY);
  } else {
    worldScale = Math.max(
      0.05,
      Math.min(content.width / Math.max(worldBounds.width, 1), content.height / Math.max(worldBounds.height, 1)),
    );
    worldScaleX = worldScale;
    worldScaleY = worldScale;
    worldRect = {
      x: content.x + (content.width - worldBounds.width * worldScale) / 2,
      y: content.y + (content.height - worldBounds.height * worldScale) / 2,
      width: worldBounds.width * worldScale,
      height: worldBounds.height * worldScale,
    };
  }

  const worldOffset: Vec2 = {
    x: worldRect.x - worldBounds.x * worldScaleX,
    y: worldRect.y - worldBounds.y * worldScaleY,
  };
  const hudRect: Rect = {
    x: orientation === 'landscape' ? content.x + 10 : content.x + 12,
    y: content.y + 10,
    width: orientation === 'landscape'
      ? clamp(content.width * 0.16, 96, 112)
      : Math.max(0, content.width - 24),
    height: orientation === 'landscape'
      ? clamp(content.height * 0.34, 112, 136)
      : 58,
  };
  const resultMargin = orientation === 'landscape'
    ? Math.max(14, content.width * 0.06)
    : Math.max(12, content.width * 0.08);
  const resultY = orientation === 'landscape'
    ? content.y + Math.min(86, Math.max(70, content.height * 0.18))
    : content.y + Math.max(90, content.height * 0.15);
  const resultRect: Rect = {
    x: content.x + resultMargin,
    y: resultY,
    width: Math.max(1, content.width - resultMargin * 2),
    height: orientation === 'landscape'
      ? Math.max(160, content.y + content.height - resultY - 12)
      : Math.max(180, content.height * 0.56),
  };
  const pauseButtonRect: Rect = {
    x: orientation === 'landscape'
      ? hudRect.x + hudRect.width - 46
      : hudRect.x + hudRect.width - 48,
    y: orientation === 'landscape'
      ? hudRect.y + 6
      : hudRect.y + hudRect.height + 8,
    width: orientation === 'landscape' ? 40 : 40,
    height: orientation === 'landscape' ? 30 : 30,
  };
  const resultButtonHeight = 38;
  const resultButtonGap = orientation === 'landscape' ? 10 : 8;
  const resultButtonWidth = Math.max(
    48,
    Math.min(orientation === 'landscape' ? 132 : 112, (resultRect.width - 32 - resultButtonGap * 2) / 3),
  );
  const resultButtonY = resultRect.y + resultRect.height - (orientation === 'landscape' ? 62 : 74);
  const resultButtonStartX = resultRect.x + (resultRect.width - resultButtonWidth * 3 - resultButtonGap * 2) / 2;
  const resultRetryRect: Rect = {
    x: resultButtonStartX,
    y: resultButtonY,
    width: resultButtonWidth,
    height: resultButtonHeight,
  };
  const resultNextRect: Rect = {
    x: resultButtonStartX + resultButtonWidth + resultButtonGap,
    y: resultButtonY,
    width: resultButtonWidth,
    height: resultButtonHeight,
  };
  const resultRouteRect: Rect = {
    x: resultButtonStartX + (resultButtonWidth + resultButtonGap) * 2,
    y: resultButtonY,
    width: resultButtonWidth,
    height: resultButtonHeight,
  };
  const joystickRadius = clamp(Math.min(content.width, content.height) * 0.105, 34, 52);
  const joystickCenter = {
    x: content.x + joystickRadius + 22,
    y: content.y + content.height - joystickRadius - 24,
  };
  const guideButtonSize = clamp(Math.min(content.width, content.height) * 0.16, 58, 82);
  const guideButtonRect = {
    x: content.x + content.width - guideButtonSize - 20,
    y: content.y + content.height - guideButtonSize - 20,
    width: guideButtonSize,
    height: guideButtonSize,
  };
  return {
    viewport,
    orientation,
    worldBounds: { ...worldBounds },
    displayWorldBounds,
    worldRect,
    worldScaleX,
    worldScaleY,
    worldScale,
    worldOffset,
    hudRect,
    resultRect,
    pauseButtonRect,
    resultRetryRect,
    resultNextRect,
    resultRouteRect,
    joystickCenter,
    joystickRadius,
    guideButtonRect,
  };
}

/**
 * 路线页卡片的几何定义。canvas-ui 和微信触摸适配器都调用同一个函数，
 * 这样安全区、窄屏和 DPR 变化时不会出现“看得到但点不到”。
 */
export function routeCardRect(viewport: ViewportMetrics, index: number): Rect {
  const content = viewport.contentRect;
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const landscape = content.width >= content.height;
  const gap = landscape ? clamp(content.width * 0.018, 10, 14) : 14;
  const columns = landscape
    ? (content.width >= 560 ? 3 : content.width >= 300 ? 2 : 1)
    : 1;
  const top = landscape
    ? content.y + clamp(content.height * 0.24, 88, 104)
    : content.y + 122;
  const maxRows = Math.ceil(3 / columns);
  const availableHeight = content.height - (top - content.y) - 24 - gap * Math.max(0, maxRows - 1);
  const cardHeight = landscape
    ? Math.max(1, Math.min(104, availableHeight / maxRows))
    : 112;
  const cardWidth = landscape
    ? Math.min(300, Math.max(0, (content.width - 32 - gap * (columns - 1)) / columns))
    : Math.min(300, Math.max(0, content.width - 32));
  const row = Math.floor(safeIndex / columns);
  const column = safeIndex % columns;
  const totalWidth = cardWidth * columns + gap * (columns - 1);
  return {
    x: content.x + (content.width - totalWidth) / 2 + column * (cardWidth + gap),
    y: top + row * (cardHeight + gap),
    width: cardWidth,
    height: cardHeight,
  };
}

export class RenderContext {
  readonly ctx: Canvas2DContextLike;
  layout: RenderLayout;

  constructor(ctx: Canvas2DContextLike, viewport: ViewportMetrics, worldBounds: Rect) {
    this.ctx = ctx;
    this.layout = createRenderLayout(viewport, worldBounds);
  }

  resize(viewport: ViewportMetrics, worldBounds = this.layout.worldBounds): void {
    this.layout = createRenderLayout(viewport, worldBounds);
  }

  worldToScreen(point: Vec2): Vec2 {
    const displayPoint = worldToDisplay(point);
    return {
      x: this.layout.worldOffset.x + displayPoint.x * finiteScale(this.layout.worldScaleX, this.layout.worldScale),
      y: this.layout.worldOffset.y + displayPoint.y * finiteScale(this.layout.worldScaleY, this.layout.worldScale),
    };
  }

  screenToWorld(point: Vec2): Vec2 {
    const displayPoint = {
      x: (point.x - this.layout.worldOffset.x) / finiteScale(this.layout.worldScaleX, this.layout.worldScale),
      y: (point.y - this.layout.worldOffset.y) / finiteScale(this.layout.worldScaleY, this.layout.worldScale),
    };
    return displayToWorld(displayPoint);
  }

  withWorld(draw: () => void): void {
    const { ctx, layout } = this;
    ctx.save();
    ctx.translate(layout.worldOffset.x, layout.worldOffset.y);
    ctx.scale(
      finiteScale(layout.worldScaleX, layout.worldScale),
      finiteScale(layout.worldScaleY, layout.worldScale),
    );
    draw();
    ctx.restore();
  }

  withScreen(draw: () => void): void {
    this.ctx.save();
    draw();
    this.ctx.restore();
  }

  clear(color = '#0b1627'): void {
    const { viewport } = this.layout;
    const { ctx } = this;
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
  }
}

export function roundRectPath(
  ctx: Canvas2DContextLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
  // 部分微信开发者工具/基础库会暴露 roundRect，但调用时仍抛出
  // “not supported/illegal invocation”。先尝试原生实现，失败后重新开路
  // 径并走兼容路径，避免路线页在第一张卡片处中断整帧绘制。
  if (typeof ctx.roundRect === 'function') {
    try {
      ctx.roundRect(x, y, width, height, safeRadius);
      return;
    } catch {
      ctx.beginPath();
    }
  }
  if (typeof ctx.quadraticCurveTo !== 'function' || safeRadius <= 0) {
    ctx.rect(x, y, width, height);
    return;
  }
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

export function fillRoundRect(
  ctx: Canvas2DContextLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
): void {
  ctx.save();
  try {
    ctx.fillStyle = color;
    try {
      ctx.beginPath();
      roundRectPath(ctx, x, y, width, height, radius);
      ctx.fill();
    } catch {
      // 低版本 Canvas 可能缺少路径填充；矩形仍应保持可见和可交互。
      ctx.fillRect(x, y, width, height);
    }
  } finally {
    ctx.restore();
  }
}

export function strokeRoundRect(
  ctx: Canvas2DContextLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
  lineWidth = 1,
): void {
  ctx.save();
  try {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    try {
      ctx.beginPath();
      roundRectPath(ctx, x, y, width, height, radius);
      ctx.stroke();
    } catch {
      ctx.strokeRect(x, y, width, height);
    }
  } finally {
    ctx.restore();
  }
}

export function drawCenteredText(
  ctx: Canvas2DContextLike,
  text: string,
  center: Vec2,
  font: string,
  color: string,
): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, center.x, center.y);
  ctx.restore();
}
