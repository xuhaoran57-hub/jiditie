import type { PassengerKind } from '../core/types.ts';
import type { CanvasImageFactory, CanvasImageLike } from './context.ts';
import { artAssetPath } from './asset-registry.ts';

export interface PassengerSpriteFrame {
  sx: number;
  sy: number;
  width: number;
  height: number;
}

export interface PassengerSpriteAsset {
  readonly image: CanvasImageLike;
  readonly frames: readonly PassengerSpriteFrame[];
  /** 独立角色 PNG 只有一行；共享 atlas 才按角色类型偏移到对应行。 */
  readonly atlasRows: number;
  readonly frameDuration: number;
  ready: boolean;
  failed: boolean;
}

/** 六类 NPC 在统一 256×384 图集中的行号；每行包含待机、左右行走和疏导四帧。 */
export const PASSENGER_SPRITE_ROWS: Readonly<Record<PassengerKind, number>> = {
  regular: 0,
  fast: 1,
  slow: 2,
  luggage: 3,
  phone: 4,
  group: 5,
};

export function passengerSpriteFrame(
  sprite: PassengerSpriteAsset,
  kind: PassengerKind,
  frameIndex: number,
): PassengerSpriteFrame | undefined {
  const frame = sprite.frames[frameIndex % sprite.frames.length];
  if (!frame) return undefined;
  const row = sprite.atlasRows > 1 ? PASSENGER_SPRITE_ROWS[kind] ?? 0 : 0;
  return { ...frame, sy: frame.sy + row * frame.height };
}

/** NPC 4 帧图集：待机、左右行走和疏导挥手。 */
export const PASSENGER_REGULAR_SPRITE_FRAMES: readonly PassengerSpriteFrame[] = [
  { sx: 0, sy: 0, width: 64, height: 64 },
  { sx: 64, sy: 0, width: 64, height: 64 },
  { sx: 128, sy: 0, width: 64, height: 64 },
  { sx: 192, sy: 0, width: 64, height: 64 },
];

function imageLooksReady(image: CanvasImageLike): boolean {
  return image.complete === true
    || ((image.width ?? 0) > 0 && (image.height ?? 0) > 0);
}

function loadPassengerSprite(
  factory: CanvasImageFactory | undefined,
  assetPath: 'passengerRegularSprite' | 'passengerFastSprite' | 'passengerAtlas',
): PassengerSpriteAsset | undefined {
  if (!factory) return undefined;
  let image: CanvasImageLike;
  try {
    image = factory();
  } catch {
    return undefined;
  }
  if (!image || typeof image !== 'object') return undefined;
  const asset: PassengerSpriteAsset = {
    image,
    frames: PASSENGER_REGULAR_SPRITE_FRAMES,
    atlasRows: assetPath === 'passengerAtlas' ? 6 : 1,
    frameDuration: 0.1,
    ready: false,
    failed: false,
  };
  const markReady = () => { asset.ready = true; };
  const markFailed = () => { asset.failed = true; };
  try {
    image.onload = markReady;
    image.onerror = markFailed;
    image.src = artAssetPath(assetPath);
  } catch {
    markFailed();
  }
  if (imageLooksReady(image)) markReady();
  return asset;
}

/** 优先加载 PNG 普通 NPC 图集，兼容不支持 SVG 的微信基础库。 */
export function loadPassengerRegularSprite(
  factory?: CanvasImageFactory,
): PassengerSpriteAsset | undefined {
  return loadPassengerSprite(factory, 'passengerRegularSprite');
}

/** 加载高细节快步乘客 PNG 四帧图集。 */
export function loadPassengerFastSprite(
  factory?: CanvasImageFactory,
): PassengerSpriteAsset | undefined {
  return loadPassengerSprite(factory, 'passengerFastSprite');
}

/** 加载六类 NPC 的 PNG 图集；失败时由 actor-renderer 回退 SVG/几何造型。 */
export function loadPassengerAtlasSprite(
  factory?: CanvasImageFactory,
): PassengerSpriteAsset | undefined {
  return loadPassengerSprite(factory, 'passengerAtlas');
}
