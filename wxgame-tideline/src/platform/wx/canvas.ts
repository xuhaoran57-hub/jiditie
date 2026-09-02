import type {
  Canvas2DContextLike,
  CanvasLike,
  ViewportInsets,
  ViewportMetrics,
} from '../../render/context.ts';
import {
  configureCanvas,
  createViewportMetrics,
} from '../../render/context.ts';

export interface WxSafeAreaLike {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
}

export interface WxWindowInfoLike {
  windowWidth?: number;
  windowHeight?: number;
  pixelRatio?: number;
  safeArea?: WxSafeAreaLike;
}

/** 只声明本适配器实际使用的微信能力，便于 Node mock 和版本兼容。 */
export interface WxCanvasApi {
  createCanvas(): CanvasLike;
  getWindowInfo?: () => WxWindowInfoLike;
  getSystemInfoSync?: () => WxWindowInfoLike;
}

export interface WxCanvasAdapterOptions {
  fallbackWidth?: number;
  fallbackHeight?: number;
  maxDpr?: number;
}

export const DEFAULT_CANVAS_OPTIONS: Required<WxCanvasAdapterOptions> = {
  fallbackWidth: 375,
  fallbackHeight: 667,
  maxDpr: 2,
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveFinite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function readInfo(api: WxCanvasApi): WxWindowInfoLike {
  let primary: WxWindowInfoLike | undefined;
  try {
    primary = api.getWindowInfo?.();
  } catch {
    primary = undefined;
  }

  let fallback: WxWindowInfoLike | undefined;
  if (!primary || !positiveFinite(primary.windowWidth) || !positiveFinite(primary.windowHeight)) {
    try {
      fallback = api.getSystemInfoSync?.();
    } catch {
      fallback = undefined;
    }
  }
  return { ...(fallback ?? {}), ...(primary ?? {}) };
}

function safeAreaInsets(
  safeArea: WxSafeAreaLike | undefined,
  width: number,
  height: number,
): ViewportInsets {
  if (!safeArea) return {};
  const left = finiteOr(safeArea.left, 0);
  const top = finiteOr(safeArea.top, 0);
  const rightEdge = finiteOr(
    safeArea.right,
    Number.isFinite(safeArea.width) ? left + Number(safeArea.width) : width,
  );
  const bottomEdge = finiteOr(
    safeArea.bottom,
    Number.isFinite(safeArea.height) ? top + Number(safeArea.height) : height,
  );
  return {
    left,
    top,
    right: Math.max(0, width - rightEdge),
    bottom: Math.max(0, height - bottomEdge),
  };
}

export function viewportFromWxInfo(
  info: WxWindowInfoLike,
  options: WxCanvasAdapterOptions = {},
): ViewportMetrics {
  const resolved = { ...DEFAULT_CANVAS_OPTIONS, ...options };
  const width = finiteOr(info.windowWidth, resolved.fallbackWidth);
  const height = finiteOr(info.windowHeight, resolved.fallbackHeight);
  const dpr = Math.min(Math.max(1, finiteOr(info.pixelRatio, 1)), Math.max(1, resolved.maxDpr));
  return createViewportMetrics(
    width,
    height,
    dpr,
    safeAreaInsets(info.safeArea, width, height),
  );
}

export class WxCanvasAdapter {
  readonly canvas: CanvasLike;
  readonly context: Canvas2DContextLike;
  private readonly api: WxCanvasApi;
  private readonly options: Required<WxCanvasAdapterOptions>;
  private _viewport: ViewportMetrics;

  constructor(api: WxCanvasApi, options: WxCanvasAdapterOptions = {}) {
    this.api = api;
    this.options = { ...DEFAULT_CANVAS_OPTIONS, ...options };
    this.canvas = api.createCanvas();
    const context = this.canvas.getContext?.('2d');
    if (!context) throw new Error('a 2d canvas context is required');
    this.context = context;
    this._viewport = this.resize();
  }

  get viewport(): ViewportMetrics {
    return this._viewport;
  }

  /** 重新读取窗口/安全区信息并同步 Canvas 物理像素尺寸。 */
  resize(): ViewportMetrics {
    this._viewport = viewportFromWxInfo(readInfo(this.api), this.options);
    configureCanvas(this.canvas, this.context, this._viewport);
    return this._viewport;
  }

  refresh(): ViewportMetrics {
    return this.resize();
  }
}

export function createWxCanvasAdapter(
  api: WxCanvasApi,
  options: WxCanvasAdapterOptions = {},
): WxCanvasAdapter {
  return new WxCanvasAdapter(api, options);
}
