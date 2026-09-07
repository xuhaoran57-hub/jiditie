import type { CanvasFactory } from './context.ts';
import type { PlayerSpriteAsset } from './player-sprite.ts';

const PALETTES = {
  default: { shirt: '#36c8bb', shadow: '#167c83', highlight: '#d9fff5' },
  seafoam: { shirt: '#8aefb8', shadow: '#39986c', highlight: '#e4fff0' },
  sunset: { shirt: '#ff9a58', shadow: '#b65b36', highlight: '#fff0d5' },
  night: { shirt: '#7799ff', shadow: '#3a5199', highlight: '#e6edff' },
} as const;

export function playerAppearancePalette(id: string) {
  return Object.prototype.hasOwnProperty.call(PALETTES, id) ? PALETTES[id as keyof typeof PALETTES] : PALETTES.default;
}

/** 只替换衣服/配件的青色像素，保留肤色、头发、轮廓、透明度和四帧坐标。 */
export function recolorPlayerPixels(data: Uint8ClampedArray, appearanceId: string): void {
  if (appearanceId === 'default' || !Object.prototype.hasOwnProperty.call(PALETTES, appearanceId)) return;
  const palette = playerAppearancePalette(appearanceId);
  const rgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const target = rgb(palette.shirt);
  const targetLightness = (Math.max(...target) + Math.min(...target)) / 2;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    // 青绿衣服；排除低饱和反光条和蓝黑色头发/裤子。
    if (g - r < 18 || b - r < 12 || g < b * 0.9 || g > b * 1.8) continue;
    const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    const ratio = lightness / targetLightness;
    for (let c = 0; c < 3; c++) {
      data[i + c] = ratio <= 1
        ? target[c]! * ratio
        : target[c]! + (255 - target[c]!) * (lightness - targetLightness) / (255 - targetLightness);
    }
  }
}

/** 每套外观只在原图加载完成后生成一次，不在每帧读取像素。 */
export class PlayerAppearanceSprites {
  private readonly cache = new Map<string, PlayerSpriteAsset | undefined>();
  private readonly canvasFactory?: CanvasFactory;

  constructor(canvasFactory?: CanvasFactory) {
    this.canvasFactory = canvasFactory;
  }

  get(source: PlayerSpriteAsset | undefined, appearanceId: string): PlayerSpriteAsset | undefined {
    if (appearanceId === 'default' || !Object.prototype.hasOwnProperty.call(PALETTES, appearanceId)) return source;
    if (!source?.ready || source.failed) return undefined;
    if (this.cache.has(appearanceId)) return this.cache.get(appearanceId);
    let result: PlayerSpriteAsset | undefined;
    try {
      const canvas = this.canvasFactory?.();
      if (canvas) {
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext?.('2d');
        if (ctx?.drawImage && ctx.getImageData && ctx.putImageData) {
          ctx.drawImage(source.image, 0, 0, 256, 64, 0, 0, 256, 64);
          const pixels = ctx.getImageData(0, 0, 256, 64);
          recolorPlayerPixels(pixels.data, appearanceId);
          ctx.putImageData(pixels, 0, 0);
          result = { ...source, image: canvas };
        }
      }
    } catch {
      // 旧版 Canvas 不支持像素接口时，使用同配色几何角色。
    }
    this.cache.set(appearanceId, result);
    return result;
  }
}
