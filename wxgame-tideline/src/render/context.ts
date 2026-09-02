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
  worldBounds: Rect;
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

export const LOGICAL_VIEWPORT = { width: 360, height: 640 } as const;

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
  const worldScale = Math.max(
    0.05,
    Math.min(content.width / Math.max(worldBounds.width, 1), content.height / Math.max(worldBounds.height, 1)),
  );
  const worldOffset: Vec2 = {
    x: content.x + (content.width - worldBounds.width * worldScale) / 2 - worldBounds.x * worldScale,
    y: content.y + (content.height - worldBounds.height * worldScale) / 2 - worldBounds.y * worldScale,
  };
  const hudRect: Rect = {
    x: content.x + 12,
    y: content.y + 10,
    width: Math.max(0, content.width - 24),
    height: 58,
  };
  const resultRect: Rect = {
    x: content.x + Math.max(12, content.width * 0.08),
    y: content.y + Math.max(90, content.height * 0.15),
    width: Math.max(0, content.width - Math.max(24, content.width * 0.16)),
    height: Math.max(180, content.height * 0.56),
  };
  const pauseButtonRect: Rect = {
    x: hudRect.x + hudRect.width - 48,
    y: hudRect.y + hudRect.height + 8,
    width: 40,
    height: 30,
  };
  const resultButtonHeight = 38;
  const resultButtonGap = 8;
  const resultButtonWidth = Math.max(
    48,
    Math.min(112, (resultRect.width - 32 - resultButtonGap * 2) / 3),
  );
  const resultButtonY = resultRect.y + resultRect.height - 74;
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
    worldBounds: { ...worldBounds },
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
  const cardWidth = Math.min(300, Math.max(0, content.width - 32));
  const cardHeight = 112;
  const gap = 14;
  return {
    x: content.x + (content.width - cardWidth) / 2,
    y: content.y + 122 + safeIndex * (cardHeight + gap),
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
    return {
      x: this.layout.worldOffset.x + point.x * this.layout.worldScale,
      y: this.layout.worldOffset.y + point.y * this.layout.worldScale,
    };
  }

  screenToWorld(point: Vec2): Vec2 {
    return {
      x: (point.x - this.layout.worldOffset.x) / this.layout.worldScale,
      y: (point.y - this.layout.worldOffset.y) / this.layout.worldScale,
    };
  }

  withWorld(draw: () => void): void {
    const { ctx, layout } = this;
    ctx.save();
    ctx.translate(layout.worldOffset.x, layout.worldOffset.y);
    ctx.scale(layout.worldScale, layout.worldScale);
    draw();
    ctx.restore();
  }

  withScreen(draw: () => void): void {
    this.ctx.save();
    draw();
    this.ctx.restore();
  }

  clear(color = '#0c1220'): void {
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
  if (ctx.roundRect) {
    ctx.roundRect(x, y, width, height, safeRadius);
    return;
  }
  if (!ctx.quadraticCurveTo || safeRadius <= 0) {
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
  ctx.fillStyle = color;
  ctx.beginPath();
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.restore();
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
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.stroke();
  ctx.restore();
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
