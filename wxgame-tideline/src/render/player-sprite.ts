import type { CanvasImageFactory, CanvasImageLike } from './context.ts';
import { artAssetPath } from './asset-registry.ts';

export interface PlayerSpriteFrame {
  sx: number;
  sy: number;
  width: number;
  height: number;
}

export interface PlayerSpriteAsset {
  readonly image: CanvasImageLike;
  readonly frames: readonly PlayerSpriteFrame[];
  readonly frameDuration: number;
  /** Accessories already composited into this atlas; prevents a second overlay. */
  readonly accessoryId?: string;
  ready: boolean;
  failed: boolean;
}

/** 64px 帧宽的 Q 版玩家图集；动作由渲染时间选择帧，不改规则状态。 */
export const PLAYER_SPRITE_FRAMES: readonly PlayerSpriteFrame[] = [
  { sx: 0, sy: 0, width: 64, height: 64 },
  { sx: 64, sy: 0, width: 64, height: 64 },
  { sx: 128, sy: 0, width: 64, height: 64 },
  { sx: 192, sy: 0, width: 64, height: 64 },
];

function imageLooksReady(image: CanvasImageLike): boolean {
  return image.complete === true
    || ((image.width ?? 0) > 0 && (image.height ?? 0) > 0);
}

/**
 * 异步加载图片但不阻塞首帧。微信图片解码失败时返回的 asset 会保持 failed，
 * actor-renderer 会自动使用几何角色回退。
 */
export function loadPlayerSprite(
  factory?: CanvasImageFactory,
): PlayerSpriteAsset | undefined {
  if (!factory) return undefined;
  let image: CanvasImageLike;
  try {
    image = factory();
  } catch {
    return undefined;
  }
  if (!image || typeof image !== 'object') return undefined;
  const asset: PlayerSpriteAsset = {
    image,
    frames: PLAYER_SPRITE_FRAMES,
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
    image.src = artAssetPath('playerSprite');
  } catch {
    markFailed();
  }
  if (imageLooksReady(image)) markReady();
  return asset;
}
