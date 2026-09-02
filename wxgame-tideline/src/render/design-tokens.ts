/**
 * 潮汐线 M6 视觉 tokens。只使用系统字体和项目自定义色彩，不依赖外部
 * CSS、字体 CDN 或现实运营方的品牌规范。
 */
export const TIDELINE_TOKENS = {
  color: {
    ink: '#0c1220',
    sky: '#101a2d',
    panel: '#172238',
    panelAlt: '#22314d',
    platform: '#202d45',
    platformEdge: '#52617a',
    tile: '#2b3a55',
    train: '#182234',
    trainStripe: '#42d6c5',
    window: '#89b7d9',
    text: '#eef7ff',
    muted: '#9fb2ca',
    accent: '#42d6c5',
    safe: '#67e0be',
    warning: '#ef6b78',
    gold: '#f5cb66',
    silver: '#bfd2df',
    bronze: '#d89963',
    player: '#f6f8ff',
    outline: '#15263c',
    actorInk: '#101827',
    groupHighlight: '#ffe6f1',
    rain: '#5e8fb3',
    luggageCart: '#8c5b3f',
    luggageCartText: '#fff1d1',
    passengerRegular: '#a9c4da',
    passengerFast: '#f3a65a',
    passengerSlow: '#b7a6e6',
    passengerLuggage: '#d6bd7b',
    passengerPhone: '#7bc7d5',
    passengerGroup: '#e58eb6',
  },
  typography: {
    family: '"PingFang SC", "Microsoft YaHei", sans-serif',
    monospace: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
    titleSize: 28,
    headingSize: 24,
    bodySize: 13,
    captionSize: 11,
  },
  spacing: {
    page: 12,
    cardGap: 14,
    radiusSmall: 9,
    radiusMedium: 16,
    radiusLarge: 22,
  },
  motion: {
    guideRippleSeconds: 0.35,
    touchFeedbackSeconds: 0.12,
    eventBannerSeconds: 0.2,
  },
} as const;

export type TidelineTokens = typeof TIDELINE_TOKENS;

export function canvasFont(
  weight: number | string,
  size: number,
  family: string = TIDELINE_TOKENS.typography.family,
): string {
  const safeWeight = String(weight).trim() || '400';
  const safeSize = Number.isFinite(size) && size > 0 ? size : TIDELINE_TOKENS.typography.bodySize;
  return `${safeWeight} ${safeSize}px ${family}`;
}

export function canvasMonoFont(
  weight: number | string,
  size: number,
): string {
  return canvasFont(weight, size, TIDELINE_TOKENS.typography.monospace);
}
