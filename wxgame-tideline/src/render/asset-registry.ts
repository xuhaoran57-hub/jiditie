/**
 * M6 自有矢量资源登记。运行时目前使用 Canvas 几何回退，矢量资源路径集中
 * 在这里，后续接入 wx.createImage 时不需要散落字符串；音频路径由 runtime
 * 的 DEFAULT_RUNTIME_AUDIO_SOURCES 集中管理。
 */
export const ART_ASSET_PATHS = {
  sprite: 'assets/generated/tideline-sprite.svg',
  playerSprite: 'assets/generated/tideline-player-sprite.png',
} as const;

export type ArtAssetId = keyof typeof ART_ASSET_PATHS;

export function artAssetPath(id: ArtAssetId): string {
  return ART_ASSET_PATHS[id];
}
