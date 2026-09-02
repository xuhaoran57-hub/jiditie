/**
 * 潮汐线 M6 视觉 tokens。只使用系统字体和项目自定义色彩，不依赖外部
 * CSS、字体 CDN 或现实运营方的品牌规范。
 */
export const TIDELINE_TOKENS = {
  color: {
    ink: '#0b1627',
    sky: '#1e466b',
    panel: '#274965',
    panelAlt: '#35647d',
    platform: '#527a92',
    platformEdge: '#a9d9dc',
    tile: '#6a92a5',
    train: '#2a5d79',
    trainStripe: '#63ead4',
    window: '#b8edf0',
    text: '#fbffff',
    muted: '#d0e2eb',
    accent: '#63ead4',
    safe: '#7ff0c8',
    warning: '#ef6b78',
    gold: '#ffd36a',
    silver: '#d7e8ef',
    bronze: '#e7a16e',
    player: '#f6f8ff',
    outline: '#15263c',
    actorInk: '#101827',
    groupHighlight: '#ffe6f1',
    rain: '#5e8fb3',
    luggageCart: '#8c5b3f',
    luggageCartText: '#fff1d1',
    passengerRegular: '#b8ddec',
    passengerFast: '#ffb36b',
    passengerSlow: '#c7b9ee',
    passengerLuggage: '#e8ca82',
    passengerPhone: '#82dce7',
    passengerGroup: '#ee9fc5',
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
