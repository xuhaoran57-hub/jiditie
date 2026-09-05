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
  readonly frameDuration: number;
  ready: boolean;
  failed: boolean;
}

/** 普通通勤客 4 帧图集：待机、左右行走和疏导挥手。 */
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

/** 异步加载普通 NPC Sprite；解码失败时由 actor-renderer 回退到几何造型。 */
export function loadPassengerRegularSprite(
  factory?: CanvasImageFactory,
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
    frameDuration: 0.1,
    ready: false,
    failed: false,
  };
  const markReady = () => {
    asset.ready = true;
  };
  const markFailed = () => {
    asset.failed = true;
  };
  try {
    image.onload = markReady;
    image.onerror = markFailed;
  } catch {
    markFailed();
    return asset;
  }
  try {
    image.src = artAssetPath('passengerRegularSprite');
  } catch {
    markFailed();
  }
  if (imageLooksReady(image)) markReady();
  return asset;
}
