import type { GameState, LevelConfig, Passenger, PassengerKind, Vec2 } from '../core/types.ts';
import { clamp, normalize } from '../core/vector.ts';
import { fillRoundRect, RenderContext, strokeRoundRect } from './context.ts';
import { TIDELINE_TOKENS } from './design-tokens.ts';
import type { PlayerSpriteAsset } from './player-sprite.ts';
import type { PassengerSpriteAsset } from './passenger-sprite.ts';

interface CharacterPalette {
  shirt: string;
  shirtShadow: string;
  pants: string;
  hair: string;
  skin: string;
  accent: string;
}

const PASSENGER_PALETTES: Record<PassengerKind, CharacterPalette> = {
  regular: {
    shirt: '#b8ddec',
    shirtShadow: '#7599b5',
    pants: '#314d6b',
    hair: '#3a4155',
    skin: '#ffd0aa',
    accent: '#f1ffff',
  },
  fast: {
    shirt: '#ffb36b',
    shirtShadow: '#c8734c',
    pants: '#3d536e',
    hair: '#563a43',
    skin: '#ffd2a6',
    accent: '#fff0bc',
  },
  slow: {
    shirt: '#c7b9ee',
    shirtShadow: '#8979ba',
    pants: '#4c4a79',
    hair: '#4c3c60',
    skin: '#f4c8aa',
    accent: '#fbf4ff',
  },
  luggage: {
    shirt: '#e8ca82',
    shirtShadow: '#b28d4d',
    pants: '#4b4650',
    hair: '#50382f',
    skin: '#ffd0a7',
    accent: '#fff1bd',
  },
  phone: {
    shirt: '#82dce7',
    shirtShadow: '#4e9eaf',
    pants: '#2f5068',
    hair: '#293d52',
    skin: '#ffd0a8',
    accent: '#dcffff',
  },
  group: {
    shirt: '#ee9fc5',
    shirtShadow: '#bd6f9b',
    pants: '#59405b',
    hair: '#50354e',
    skin: '#ffd1aa',
    accent: '#fff0f8',
  },
};

const PASSENGER_COLORS: Record<PassengerKind, string> = Object.fromEntries(
  (Object.entries(PASSENGER_PALETTES) as Array<[PassengerKind, CharacterPalette]>).map(([kind, palette]) => [kind, palette.shirt]),
) as Record<PassengerKind, string>;

export type NpcSilhouette = 'regular' | 'runner' | 'cardigan' | 'traveler' | 'hoodie' | 'duo';

export interface NpcVisualProfile {
  silhouette: NpcSilhouette;
  bodyWidth: number;
  bodyHeight: number;
  bodyY: number;
  headY: number;
  headRadius: number;
  legSpread: number;
  strideAmplitude: number;
}

/** 每类 NPC 都有独立的轮廓参数；颜色只是辅助识别，不再是唯一差异。 */
export const NPC_VISUAL_PROFILES: Readonly<Record<PassengerKind, NpcVisualProfile>> = {
  regular: {
    silhouette: 'regular',
    bodyWidth: 10.6,
    bodyHeight: 9.5,
    bodyY: -2.4,
    headY: -7.3,
    headRadius: 4.7,
    legSpread: 2.7,
    strideAmplitude: 1.8,
  },
  fast: {
    silhouette: 'runner',
    bodyWidth: 9.4,
    bodyHeight: 11.2,
    bodyY: -3,
    headY: -8.1,
    headRadius: 4.35,
    legSpread: 2.35,
    strideAmplitude: 2.8,
  },
  slow: {
    silhouette: 'cardigan',
    bodyWidth: 13.2,
    bodyHeight: 10.2,
    bodyY: -1.5,
    headY: -7,
    headRadius: 5.1,
    legSpread: 3.1,
    strideAmplitude: 1.05,
  },
  luggage: {
    silhouette: 'traveler',
    bodyWidth: 11.6,
    bodyHeight: 10.4,
    bodyY: -2,
    headY: -7.5,
    headRadius: 4.8,
    legSpread: 2.9,
    strideAmplitude: 1.6,
  },
  phone: {
    silhouette: 'hoodie',
    bodyWidth: 11.2,
    bodyHeight: 10.8,
    bodyY: -2.5,
    headY: -7.8,
    headRadius: 4.65,
    legSpread: 2.8,
    strideAmplitude: 1.55,
  },
  group: {
    silhouette: 'duo',
    bodyWidth: 11.8,
    bodyHeight: 10.1,
    bodyY: -2,
    headY: -7.4,
    headRadius: 4.75,
    legSpread: 2.9,
    strideAmplitude: 1.45,
  },
};

// 横屏舞台会把规则世界压到较薄的纵向区域。角色补回纵向比例后，
// 仍需用更小的统一视觉尺寸，才能和横屏车门/车厢的实际像素高度匹配。
const LANDSCAPE_ACTOR_SCALE = 0.48;

function actorVisualScale(context: RenderContext, baseScale: number): number {
  return context.layout.orientation === 'landscape'
    ? baseScale * LANDSCAPE_ACTOR_SCALE
    : baseScale;
}

function drawCircle(
  context: RenderContext,
  center: Vec2,
  radius: number,
  fill: string,
  stroke?: string,
  lineWidth = 1,
): void {
  const { ctx } = context;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawEllipse(
  context: RenderContext,
  center: Vec2,
  radiusX: number,
  radiusY: number,
  fill: string,
  stroke?: string,
  lineWidth = 1,
): void {
  const { ctx } = context;
  ctx.save();
  let usedNativeEllipse = false;
  if (typeof ctx.ellipse === 'function') {
    try {
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2);
      usedNativeEllipse = true;
    } catch {
      // 部分基础库会暴露 ellipse 名称，但调用时仍抛出异常；下面走缩放圆回退。
      usedNativeEllipse = false;
    }
  }
  if (!usedNativeEllipse) {
    ctx.beginPath();
    ctx.translate(center.x, center.y);
    ctx.scale(radiusX, radiusY);
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function actorSeed(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

const GUIDE_ACTION_LIFE = 0.8;

function latestGuideAge(state: GameState): number {
  let latest = -Infinity;
  for (const event of state.events) {
    if (event.type !== 'guide' || !Number.isFinite(event.at) || event.at > state.elapsed + 1e-8) continue;
    latest = Math.max(latest, event.at);
  }
  return latest === -Infinity ? -1 : Math.max(0, state.elapsed - latest);
}

function guideActionStrength(state: GameState): number {
  const age = latestGuideAge(state);
  return age >= 0 && age < GUIDE_ACTION_LIFE
    ? clamp(1 - age / GUIDE_ACTION_LIFE, 0, 1)
    : 0;
}

function drawPlayerSprite(
  context: RenderContext,
  sprite: PlayerSpriteAsset,
  frameIndex: number,
  size: number,
): boolean {
  const { ctx } = context;
  if (!sprite.ready || sprite.failed || typeof ctx.drawImage !== 'function') return false;
  const frame = sprite.frames[frameIndex % sprite.frames.length];
  if (!frame) return false;
  try {
    ctx.drawImage(
      sprite.image,
      frame.sx,
      frame.sy,
      frame.width,
      frame.height,
      -size / 2,
      -size / 2,
      size,
      size,
    );
    return true;
  } catch {
    // 图片解码或低版本 Canvas 不支持时，调用方继续绘制几何角色。
    return false;
  }
}

function drawPassengerSprite(
  context: RenderContext,
  sprite: PassengerSpriteAsset,
  frameIndex: number,
  size: number,
  baseScale: number,
): boolean {
  const { ctx } = context;
  if (!sprite.ready || sprite.failed || typeof ctx.drawImage !== 'function') return false;
  const frame = sprite.frames[frameIndex % sprite.frames.length];
  if (!frame) return false;
  ctx.save();
  try {
    // 与几何角色使用同一套横屏纵向补偿和基础尺寸，避免图像 Sprite
    // 在横屏压缩后变扁，或因像素尺寸不同而显得明显偏大。
    compensateLandscapeScale(context);
    const visualScale = actorVisualScale(context, baseScale);
    ctx.scale(visualScale, visualScale);
    ctx.drawImage(
      sprite.image,
      frame.sx,
      frame.sy,
      frame.width,
      frame.height,
      -size / 2,
      -size / 2,
      size,
      size,
    );
    ctx.restore();
    return true;
  } catch {
    ctx.restore();
    return false;
  }
}

/**
 * 横屏舞台会把规则世界纵向压缩，以便同时容纳车厢和站台。
 * 角色是屏幕上的信息载体，绘制时补回纵向比例，保持接近等比的轮廓。
 */
function compensateLandscapeScale(context: RenderContext): void {
  const { layout, ctx } = context;
  if (layout.orientation !== 'landscape') return;
  const scaleX = Number.isFinite(layout.worldScaleX) ? Math.abs(layout.worldScaleX) : layout.worldScale;
  const scaleY = Number.isFinite(layout.worldScaleY) ? Math.abs(layout.worldScaleY) : layout.worldScale;
  if (scaleX <= 1e-8 || scaleY <= 1e-8) return;
  ctx.scale(1, scaleX / scaleY);
}

function drawShadow(context: RenderContext, position: Vec2, radius: number, alpha = 0.42): void {
  const shadow = { x: position.x, y: position.y + radius * 0.78 };
  const { ctx } = context;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(shadow.x, shadow.y);
  compensateLandscapeScale(context);
  drawEllipse(context, { x: 0, y: 0 }, radius * 0.78, radius * 0.28, '#102b3a');
  ctx.restore();
}

function drawMiniCompanion(context: RenderContext, palette: CharacterPalette, offset: Vec2, alpha: number): void {
  const { ctx } = context;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(offset.x, offset.y);
  compensateLandscapeScale(context);
  const scale = actorVisualScale(context, 0.7);
  ctx.scale(scale, scale);
  drawEllipse(context, { x: 0, y: 5 }, 7, 3, '#173348');
  ctx.fillStyle = palette.pants;
  ctx.fillRect(-4, 1, 8, 9);
  ctx.fillStyle = palette.shirt;
  ctx.fillRect(-5, -4, 10, 8);
  drawCircle(context, { x: 0, y: -8 }, 4.2, palette.skin, '#f4fff8', 1.25);
  ctx.fillStyle = palette.hair;
  ctx.beginPath();
  ctx.arc(0, -9, 4.2, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function fillPolygon(
  context: RenderContext,
  points: readonly Vec2[],
  fill: string,
  stroke?: string,
  lineWidth = 1,
): void {
  if (points.length < 3) return;
  const { ctx } = context;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function drawNpcBackDetails(
  context: RenderContext,
  palette: CharacterPalette,
  profile: NpcVisualProfile,
  kind: PassengerKind,
  walkPhase: number,
): void {
  const { ctx } = context;
  const outline = TIDELINE_TOKENS.color.actorInk;
  switch (kind) {
    case 'regular':
      // 常规通勤客背着小挎包，轮廓比其他类型更朴素。
      fillRoundRect(ctx, -profile.bodyWidth / 2 - 2.8, 0, 4.2, 8, 1.5, '#6b8da2');
      strokeRoundRect(ctx, -profile.bodyWidth / 2 - 2.8, 0, 4.2, 8, 1.5, outline, 0.8);
      break;
    case 'fast': {
      // 快步客的围巾向后飘，摆幅和步幅形成同一视觉节奏。
      const flutter = Math.sin(walkPhase * 0.8) * 1.4;
      fillPolygon(context, [
        { x: -3.8, y: -2.5 },
        { x: -8, y: -1 + flutter },
        { x: -12, y: 2 + flutter },
        { x: -6, y: 1.5 },
      ], palette.accent, outline, 0.8);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-5.5, -1.5);
      ctx.lineTo(-10, -0.5 + flutter);
      ctx.stroke();
      break;
    }
    case 'slow':
      // 慢行客的披肩从肩线向后展开，增加宽肩轮廓。
      drawEllipse(context, { x: 0, y: 1.5 }, profile.bodyWidth * 0.68, 5.6, palette.shirtShadow, outline, 0.8);
      break;
    case 'luggage': {
      const suitcaseX = profile.bodyWidth / 2 + 1.2;
      fillRoundRect(ctx, suitcaseX, -1, 8.5, 13, 2.8, '#79523d');
      strokeRoundRect(ctx, suitcaseX, -1, 8.5, 13, 2.8, '#e6c18b', 1);
      ctx.strokeStyle = '#efcf9a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(suitcaseX + 2, -1);
      ctx.lineTo(suitcaseX + 2, -5);
      ctx.lineTo(suitcaseX + 6.5, -5);
      ctx.lineTo(suitcaseX + 6.5, -1);
      ctx.stroke();
      drawCircle(context, { x: suitcaseX + 2.2, y: 12.8 }, 1.35, '#4a3540', '#e6c18b', 0.7);
      drawCircle(context, { x: suitcaseX + 6.4, y: 12.8 }, 1.35, '#4a3540', '#e6c18b', 0.7);
      break;
    }
    case 'phone':
      // 手机客的轻薄背包和耳机线形成独立的侧面识别点。
      fillRoundRect(ctx, -profile.bodyWidth / 2 - 2.3, 0, 3.8, 7.5, 1.4, '#3d8390');
      strokeRoundRect(ctx, -profile.bodyWidth / 2 - 2.3, 0, 3.8, 7.5, 1.4, outline, 0.8);
      ctx.strokeStyle = '#b9fbff';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(0, profile.headY + 1.2, profile.headRadius + 0.8, 0.15, 1.25);
      ctx.stroke();
      break;
    case 'group':
      // 同行组用短缎带连接主角色和陪伴者。
      ctx.strokeStyle = TIDELINE_TOKENS.color.groupHighlight;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-profile.bodyWidth / 2, 3);
      ctx.lineTo(-profile.bodyWidth / 2 - 4, 5);
      ctx.lineTo(-profile.bodyWidth / 2 - 7, 3.5);
      ctx.stroke();
      break;
  }
}

function drawNpcLegs(
  context: RenderContext,
  palette: CharacterPalette,
  profile: NpcVisualProfile,
  stride: number,
): void {
  const { ctx } = context;
  const leftX = -profile.legSpread + stride;
  const rightX = profile.legSpread - stride;
  ctx.strokeStyle = palette.pants;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(-profile.legSpread * 0.72, 6.5);
  ctx.lineTo(leftX, 12);
  ctx.moveTo(profile.legSpread * 0.72, 6.5);
  ctx.lineTo(rightX, 12);
  ctx.stroke();
  ctx.strokeStyle = '#101827';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(leftX, 12);
  ctx.lineTo(leftX - 2.1, 12);
  ctx.moveTo(rightX, 12);
  ctx.lineTo(rightX + 2.1, 12);
  ctx.stroke();
}

function drawNpcTorso(
  context: RenderContext,
  palette: CharacterPalette,
  profile: NpcVisualProfile,
  kind: PassengerKind,
  inside: boolean,
): void {
  const { ctx } = context;
  const outline = inside ? '#f4fff8' : TIDELINE_TOKENS.color.actorInk;
  const x = -profile.bodyWidth / 2;
  const y = profile.bodyY;
  switch (profile.silhouette) {
    case 'runner':
      fillPolygon(context, [
        { x: x + 1, y },
        { x: x + profile.bodyWidth - 1.3, y: y + 0.5 },
        { x: x + profile.bodyWidth, y: y + profile.bodyHeight - 1.2 },
        { x: x + 1.8, y: y + profile.bodyHeight },
      ], palette.shirtShadow, outline, inside ? 1.25 : 1);
      fillPolygon(context, [
        { x: x + 1.8, y: y - 1.1 },
        { x: x + profile.bodyWidth - 1.8, y: y - 0.6 },
        { x: x + profile.bodyWidth - 0.8, y: y + profile.bodyHeight - 2 },
        { x: x + 2.5, y: y + profile.bodyHeight - 1.1 },
      ], palette.shirt, undefined);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x + 1.5, y + 2.5);
      ctx.lineTo(x + profile.bodyWidth - 1.5, y + 5.8);
      ctx.stroke();
      break;
    case 'cardigan':
      drawEllipse(context, { x: 0, y: y + profile.bodyHeight * 0.48 }, profile.bodyWidth * 0.68, profile.bodyHeight * 0.62, palette.shirtShadow, outline, inside ? 1.25 : 1);
      fillRoundRect(ctx, x + 1, y + 0.5, profile.bodyWidth - 2, profile.bodyHeight - 2, 4.5, palette.shirt);
      ctx.strokeStyle = palette.shirtShadow;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(0, y + profile.bodyHeight - 1);
      ctx.stroke();
      break;
    case 'traveler':
      fillRoundRect(ctx, x, y, profile.bodyWidth, profile.bodyHeight, 4.2, palette.shirtShadow);
      fillRoundRect(ctx, x + 1, y - 1, profile.bodyWidth - 2, profile.bodyHeight - 2, 3.5, palette.shirt);
      fillPolygon(context, [
        { x: -1.5, y: y - 0.5 },
        { x: 4.5, y: y - 0.5 },
        { x: 3.5, y: y + profile.bodyHeight - 1 },
        { x: -0.5, y: y + profile.bodyHeight - 1 },
      ], '#f4dda0', undefined);
      strokeRoundRect(ctx, x, y, profile.bodyWidth, profile.bodyHeight, 4.2, outline, inside ? 1.25 : 1);
      break;
    case 'hoodie':
      fillRoundRect(ctx, x, y, profile.bodyWidth, profile.bodyHeight, 4.8, palette.shirtShadow);
      fillRoundRect(ctx, x + 1, y - 1, profile.bodyWidth - 2, profile.bodyHeight - 2, 4, palette.shirt);
      ctx.strokeStyle = outline;
      ctx.lineWidth = inside ? 1.25 : 1;
      ctx.beginPath();
      ctx.arc(0, y + 1, profile.bodyWidth * 0.48, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-2, y + 1);
      ctx.lineTo(-2, y + 5);
      ctx.moveTo(2, y + 1);
      ctx.lineTo(2, y + 5);
      ctx.stroke();
      break;
    case 'duo':
      fillRoundRect(ctx, x, y, profile.bodyWidth, profile.bodyHeight, 4.2, palette.shirtShadow);
      fillRoundRect(ctx, x + 1, y - 1, profile.bodyWidth - 2, profile.bodyHeight - 2, 3.6, palette.shirt);
      fillPolygon(context, [
        { x: 0, y: y - 0.5 },
        { x: 4.3, y: y - 0.5 },
        { x: 4.3, y: y + profile.bodyHeight - 1 },
        { x: 0, y: y + profile.bodyHeight - 1 },
      ], '#f7c0d9', undefined);
      strokeRoundRect(ctx, x, y, profile.bodyWidth, profile.bodyHeight, 4.2, outline, inside ? 1.25 : 1);
      break;
    case 'regular':
    default:
      fillRoundRect(ctx, x, y, profile.bodyWidth, profile.bodyHeight, 4, palette.shirtShadow);
      fillRoundRect(ctx, x + 0.7, y - 1.2, profile.bodyWidth - 1.4, profile.bodyHeight - 1, 3.5, palette.shirt);
      strokeRoundRect(ctx, x, y, profile.bodyWidth, profile.bodyHeight, 4, outline, inside ? 1.25 : 1);
      break;
  }

  // 衣服中心高光与领口，保留统一的 Q 版可读性。
  ctx.fillStyle = palette.accent;
  ctx.globalAlpha = 0.52;
  ctx.fillRect(-1, y + 0.5, 2, Math.max(3, profile.bodyHeight - 3));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = palette.shirtShadow;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-profile.bodyWidth * 0.28, y + 0.3);
  ctx.lineTo(0, y + 2.8);
  ctx.lineTo(profile.bodyWidth * 0.28, y + 0.3);
  ctx.stroke();
}

function drawNpcArms(
  context: RenderContext,
  palette: CharacterPalette,
  profile: NpcVisualProfile,
  kind: PassengerKind,
  stride: number,
): void {
  const { ctx } = context;
  const shoulder = profile.bodyWidth / 2 - 0.5;
  ctx.strokeStyle = palette.skin;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  switch (kind) {
    case 'fast':
      ctx.moveTo(-shoulder, -0.2);
      ctx.lineTo(-shoulder - 3.6 - stride * 0.45, 4.4);
      ctx.moveTo(shoulder, -0.4);
      ctx.lineTo(shoulder + 3.8 + stride * 0.42, 1.2);
      break;
    case 'slow':
      ctx.moveTo(-shoulder, 0.5);
      ctx.lineTo(-shoulder - 1.5, 3.5);
      ctx.moveTo(shoulder, 0.5);
      ctx.lineTo(shoulder + 1.5, 3.5);
      break;
    case 'luggage':
      ctx.moveTo(-shoulder, 0);
      ctx.lineTo(-shoulder - 3.5 - stride * 0.25, 4.2);
      ctx.moveTo(shoulder, 0);
      ctx.lineTo(shoulder + 2.5, -1.5);
      break;
    case 'phone':
      ctx.moveTo(-shoulder, 0.2);
      ctx.lineTo(-shoulder - 3.3 - stride * 0.2, 4.2);
      ctx.moveTo(shoulder, -0.2);
      ctx.lineTo(shoulder + 4.5, -4.5);
      break;
    case 'group':
      ctx.moveTo(-shoulder, 0.2);
      ctx.lineTo(-shoulder - 3.2 - stride * 0.2, 4.2);
      ctx.moveTo(shoulder, 0.2);
      ctx.lineTo(shoulder + 4.5, 3.1);
      break;
    case 'regular':
    default:
      ctx.moveTo(-shoulder, 0);
      ctx.lineTo(-shoulder - 2.2 - stride * 0.55, 4);
      ctx.moveTo(shoulder, 0);
      ctx.lineTo(shoulder + 2.2 + stride * 0.55, 4);
      break;
  }
  ctx.stroke();
}

function drawNpcHead(
  context: RenderContext,
  palette: CharacterPalette,
  profile: NpcVisualProfile,
  kind: PassengerKind,
  inside: boolean,
): void {
  const { ctx } = context;
  const outline = inside ? '#f4fff8' : TIDELINE_TOKENS.color.actorInk;
  const headY = profile.headY;
  drawCircle(context, { x: 0, y: headY }, profile.headRadius, palette.skin, outline, inside ? 1.7 : 1.5);
  switch (kind) {
    case 'fast':
      fillPolygon(context, [
        { x: -profile.headRadius - 0.5, y: headY - 0.5 },
        { x: -3.5, y: headY - 5.7 },
        { x: -1.8, y: headY - 9 },
        { x: 0, y: headY - 5.7 },
        { x: 2.4, y: headY - 9 },
        { x: 4.4, y: headY - 5.5 },
        { x: profile.headRadius + 0.5, y: headY - 0.2 },
      ], palette.hair, outline, 0.9);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-profile.headRadius - 0.4, headY - 1.2);
      ctx.lineTo(profile.headRadius + 0.4, headY - 1.2);
      ctx.stroke();
      break;
    case 'slow':
      fillRoundRect(ctx, -profile.headRadius - 1.8, headY - 5.6, profile.headRadius * 2 + 3.6, 2.1, 1, '#76566b');
      strokeRoundRect(ctx, -profile.headRadius - 1.8, headY - 5.6, profile.headRadius * 2 + 3.6, 2.1, 1, outline, 0.8);
      fillRoundRect(ctx, -profile.headRadius * 0.72, headY - 8, profile.headRadius * 1.44, 3.5, 1.5, '#8f6a78');
      strokeRoundRect(ctx, -profile.headRadius * 0.72, headY - 8, profile.headRadius * 1.44, 3.5, 1.5, outline, 0.8);
      ctx.strokeStyle = '#6c5366';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-3.6, headY + 0.3);
      ctx.lineTo(-0.5, headY + 0.3);
      ctx.moveTo(0.5, headY + 0.3);
      ctx.lineTo(3.6, headY + 0.3);
      ctx.stroke();
      break;
    case 'luggage':
      ctx.fillStyle = '#6b4a4b';
      ctx.beginPath();
      ctx.arc(0, headY - 1.2, profile.headRadius + 0.3, Math.PI * 1.05, Math.PI * 1.98);
      ctx.fill();
      fillRoundRect(ctx, -profile.headRadius - 0.8, headY - 1.6, profile.headRadius * 2 + 1.6, 1.6, 0.8, '#d8b56f');
      break;
    case 'phone':
      ctx.strokeStyle = palette.hair;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, headY, profile.headRadius + 0.4, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      drawCircle(context, { x: -profile.headRadius - 0.4, y: headY + 0.8 }, 0.9, '#b9fbff');
      drawCircle(context, { x: profile.headRadius + 0.4, y: headY + 0.8 }, 0.9, '#b9fbff');
      break;
    case 'group':
      ctx.fillStyle = palette.hair;
      ctx.beginPath();
      ctx.arc(0, headY - 0.8, profile.headRadius + 0.2, Math.PI * 1.05, Math.PI * 1.98);
      ctx.fill();
      fillPolygon(context, [
        { x: profile.headRadius - 0.5, y: headY - 4.2 },
        { x: profile.headRadius + 2.8, y: headY - 5.4 },
        { x: profile.headRadius + 1.4, y: headY - 1.8 },
      ], '#f48bb9', outline, 0.7);
      break;
    case 'regular':
    default:
      ctx.fillStyle = palette.hair;
      ctx.beginPath();
      ctx.arc(0, headY - 1, profile.headRadius + 0.1, Math.PI * 1.05, Math.PI * 1.98);
      ctx.lineTo(profile.headRadius - 0.8, headY - 0.8);
      ctx.lineTo(2.2, headY + 2.1);
      ctx.lineTo(-profile.headRadius + 0.8, headY + 1.8);
      ctx.closePath();
      ctx.fill();
      fillRoundRect(ctx, -profile.headRadius, headY - 4.8, profile.headRadius * 2, 1.5, 0.7, palette.hair);
      break;
  }

  // 小眼睛让六种头部轮廓都保持同一套 Q 版表情语言。
  drawCircle(context, { x: -1.7, y: headY + 1.1 }, 0.65, palette.hair);
  drawCircle(context, { x: 1.7, y: headY + 1.1 }, 0.65, palette.hair);
}

function drawNpcFrontDetails(
  context: RenderContext,
  palette: CharacterPalette,
  profile: NpcVisualProfile,
  kind: PassengerKind,
): void {
  const { ctx } = context;
  const y = profile.bodyY;
  switch (kind) {
    case 'slow':
      ctx.strokeStyle = '#d9d2ba';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(profile.bodyWidth / 2 + 1, y + 1.5);
      ctx.lineTo(profile.bodyWidth / 2 + 3.5, y + profile.bodyHeight + 4);
      ctx.lineTo(profile.bodyWidth / 2 + 2.5, y + profile.bodyHeight + 5);
      ctx.stroke();
      break;
    case 'luggage':
      ctx.strokeStyle = '#f1d49a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(profile.bodyWidth / 2 - 1, y + 1);
      ctx.lineTo(profile.bodyWidth / 2 + 2, y + 5);
      ctx.stroke();
      drawCircle(context, { x: profile.bodyWidth / 2 + 2, y: y + 5 }, 1.2, '#ffd36a', '#79523d', 0.6);
      break;
    case 'phone':
      fillRoundRect(ctx, profile.bodyWidth / 2 + 1.8, y - 1, 3.4, 6.2, 1, '#15263b');
      ctx.fillStyle = '#b9fbff';
      ctx.globalAlpha = 0.95;
      ctx.fillRect(profile.bodyWidth / 2 + 2.6, y + 0.1, 1.8, 3.1);
      ctx.fillStyle = '#6bd7e1';
      ctx.fillRect(profile.bodyWidth / 2 + 3.1, y + 4, 0.8, 0.8);
      ctx.globalAlpha = 1;
      break;
    case 'fast':
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(profile.bodyWidth / 2 + 2, y + 3);
      ctx.lineTo(profile.bodyWidth / 2 + 6, y + 3);
      ctx.moveTo(profile.bodyWidth / 2 + 3, y + 5);
      ctx.lineTo(profile.bodyWidth / 2 + 7, y + 5);
      ctx.stroke();
      break;
    case 'group':
      ctx.fillStyle = '#fff2f8';
      ctx.beginPath();
      ctx.arc(1.8, y + 3, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'regular':
    default:
      ctx.fillStyle = palette.accent;
      ctx.fillRect(-2, y + 2.1, 4, 2);
      break;
  }
}

function drawCharacterBody(
  context: RenderContext,
  palette: CharacterPalette,
  radius: number,
  walkPhase: number,
  kind: PassengerKind,
  inside = false,
): void {
  const { ctx } = context;
  const profile = NPC_VISUAL_PROFILES[kind] ?? NPC_VISUAL_PROFILES.regular;
  const scale = Math.max(0.76, Math.min(1.65, (radius / 9) * (inside ? 1.1 : 1)));
  const stride = Math.sin(walkPhase) * profile.strideAmplitude;

  ctx.save();
  compensateLandscapeScale(context);
  const visualScale = actorVisualScale(context, scale);
  ctx.scale(visualScale, visualScale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawNpcBackDetails(context, palette, profile, kind, walkPhase);
  drawNpcLegs(context, palette, profile, stride);
  drawNpcTorso(context, palette, profile, kind, inside);
  drawNpcArms(context, palette, profile, kind, stride);
  drawNpcHead(context, palette, profile, kind, inside);
  drawNpcFrontDetails(context, palette, profile, kind);
  ctx.restore();
}

function drawPassenger(
  context: RenderContext,
  passenger: Passenger,
  now: number,
  passengerSprite?: PassengerSpriteAsset,
): void {
  const { ctx } = context;
  const palette = PASSENGER_PALETTES[passenger.kind];
  const inside = passenger.role === 'inside';
  const boarding = passenger.role === 'boarding';
  const phase = actorSeed(passenger.id) * Math.PI * 2;
  const walkPhase = now * (passenger.kind === 'fast' ? 11 : passenger.kind === 'slow' ? 4.5 : 7) + phase;
  const moving = passenger.role !== 'waiting' && passenger.role !== 'inside';
  const guideRemaining = Math.max(0, passenger.guidedUntil - now);
  const guideStrength = clamp(guideRemaining / 0.7, 0, 1);
  const guideBob = guideStrength > 0
    ? Math.sin(now * 18 + phase) * 1.2 * guideStrength
    : 0;
  const alphaBefore = ctx.globalAlpha;
  if (inside || boarding) {
    // 车内角色使用地板反光和高对比轮廓，明确表示已经越过门槛。
    ctx.save();
    ctx.globalAlpha *= inside ? 0.28 : 0.18;
    drawEllipse(
      context,
      { x: passenger.position.x, y: passenger.position.y + passenger.radius * 0.72 },
      passenger.radius * 1.02,
      passenger.radius * 0.34,
      '#b5fff0',
    );
    ctx.restore();
  }
  if (passenger.kind === 'group') {
    drawMiniCompanion(context, palette, { x: passenger.position.x - passenger.radius * 0.85, y: passenger.position.y + passenger.radius * 0.18 }, 0.9);
  }
  drawShadow(context, passenger.position, passenger.radius, inside ? 0.22 : 0.42);
  // 身体几何以角色位置为局部原点；没有这次平移时，头/身体会落在世界原点，
  // 乘客虽然在规则层移动，画面里却看起来像没有跟着走。
  ctx.save();
  ctx.translate(passenger.position.x, passenger.position.y - Math.abs(guideBob) * 0.25);
  if (guideStrength > 0) {
    const squash = 1 + Math.sin(now * 18 + phase) * 0.035 * guideStrength;
    ctx.scale(squash, 1 - (squash - 1));
  }
  // 角色始终以屏幕上方为头部方向；行走状态只改变步伐，不旋转人物轮廓。
  const frameDuration = Number.isFinite(passengerSprite?.frameDuration) && (passengerSprite?.frameDuration ?? 0) > 0
    ? passengerSprite!.frameDuration
    : 0.12;
  const spriteFrame = guideStrength > 0
    ? 3
    : moving
      ? 1 + (Math.floor(now / frameDuration) % 2)
      : 0;
  const spriteBaseScale = Math.max(0.76, Math.min(1.65, (passenger.radius / 9) * (inside || boarding ? 1.1 : 1)));
  const spriteSize = 32;
  const spriteDrawn = passenger.kind === 'regular' && passengerSprite
    ? drawPassengerSprite(context, passengerSprite, spriteFrame, spriteSize, spriteBaseScale)
    : false;
  if (!spriteDrawn) {
    drawCharacterBody(context, palette, passenger.radius, moving ? walkPhase : phase, passenger.kind, inside || boarding);
  }
  ctx.restore();
  if (guideStrength > 0) {
    ctx.save();
    ctx.globalAlpha = 0.32 + guideStrength * 0.46;
    ctx.strokeStyle = TIDELINE_TOKENS.color.safe;
    ctx.lineWidth = 1.5;
    const sparkle = passenger.radius + 5 + (1 - guideStrength) * 4;
    ctx.beginPath();
    ctx.moveTo(passenger.position.x - sparkle, passenger.position.y - sparkle * 0.25);
    ctx.lineTo(passenger.position.x - sparkle + 3, passenger.position.y - sparkle * 0.25);
    ctx.moveTo(passenger.position.x + sparkle, passenger.position.y - sparkle * 0.25);
    ctx.lineTo(passenger.position.x + sparkle - 3, passenger.position.y - sparkle * 0.25);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = alphaBefore;
}

function drawPlayer(
  context: RenderContext,
  state: GameState,
  playerSprite?: PlayerSpriteAsset,
): void {
  const { ctx } = context;
  const player = state.player;
  const direction = normalize(player.facing, { x: 0, y: -1 });
  const phase = state.elapsed * 8;
  const stride = Math.sin(phase) * 1.8;
  const moving = Math.hypot(player.velocity.x, player.velocity.y) > 1e-3;
  const guideAge = latestGuideAge(state);
  const guideStrength = guideActionStrength(state);
  const bob = moving
    ? Math.abs(Math.sin(state.elapsed * 12)) * 1.2
    : Math.sin(state.elapsed * 3.2) * 0.55;

  drawShadow(context, player.position, player.radius, 0.52);
  ctx.save();
  if (player.inSafeZone) {
    ctx.globalAlpha = 0.2;
    drawCircle(context, player.position, player.radius + 11 + Math.sin(state.elapsed * 6) * 1.5, TIDELINE_TOKENS.color.safe);
    ctx.globalAlpha = 1;
  }
  ctx.translate(player.position.x, player.position.y - bob * 0.22);
  compensateLandscapeScale(context);
  const scale = Math.max(0.78, Math.min(1.55, player.radius / 10));
  const visualScale = actorVisualScale(context, scale);
  const squash = moving
    ? 1 + Math.sin(state.elapsed * 12) * 0.035
    : 1 + Math.sin(state.elapsed * 3.2) * 0.02;
  ctx.scale(visualScale * squash, visualScale * (1 - (squash - 1)));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const frameDuration = Number.isFinite(playerSprite?.frameDuration) && (playerSprite?.frameDuration ?? 0) > 0
    ? playerSprite!.frameDuration
    : 0.1;
  const spriteFrame = guideStrength > 0
    ? (guideAge < 0.16 || Math.floor(guideAge * 12) % 2 === 0 ? 3 : 0)
    : moving
      ? 1 + (Math.floor(state.elapsed / frameDuration) % 2)
      : 0;
  const spriteSize = Math.max(30, Math.min(46, player.radius * 3.5));
  const spriteDrawn = playerSprite
    ? drawPlayerSprite(context, playerSprite, spriteFrame, spriteSize)
    : false;

  if (!spriteDrawn) {
  // 玩家专属背包、靴子和潮汐青外套。
  fillRoundRect(ctx, -8, -1, 5, 12, 2, '#28445a');
  ctx.strokeStyle = '#67d8d0';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-6, 1);
  ctx.lineTo(-6, 8);
  ctx.stroke();
  ctx.strokeStyle = '#162638';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-2.8, 7);
  ctx.lineTo(-3.1 + stride, 13);
  ctx.moveTo(2.8, 7);
  ctx.lineTo(3.1 - stride, 13);
  ctx.stroke();
  ctx.strokeStyle = '#07121e';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-3.1 + stride, 13);
  ctx.lineTo(-5.8 + stride, 13);
  ctx.moveTo(3.1 - stride, 13);
  ctx.lineTo(5.8 - stride, 13);
  ctx.stroke();
  fillRoundRect(ctx, -6.4, -1, 12.8, 12, 4.2, '#167c83');
  fillRoundRect(ctx, -5.3, -2.8, 10.6, 10, 3.5, '#36c8bb');
  ctx.fillStyle = '#d9fff5';
  ctx.globalAlpha = 0.78;
  ctx.fillRect(-1, -1, 2, 7);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#0b5e6a';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-3.2, -1);
  ctx.lineTo(0, 2);
  ctx.lineTo(3.2, -1);
  ctx.stroke();
  const guideLift = guideStrength > 0
    ? 2 + Math.sin(state.elapsed * 18) * 1.5
    : 0;
  ctx.strokeStyle = '#f2c7a5';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-5.2, 0);
  ctx.lineTo(-7.8, 4 - stride * 0.45 - guideLift);
  ctx.moveTo(5.2, 0);
  ctx.lineTo(7.8, 4 + stride * 0.45 - guideLift);
  ctx.stroke();
  drawCircle(context, { x: 0, y: -7.8 }, 5, '#f3c5a2', TIDELINE_TOKENS.color.outline, 1.7);
  ctx.fillStyle = '#152c44';
  ctx.beginPath();
  ctx.arc(0, -9.1, 5.2, Math.PI * 1.02, Math.PI * 1.98);
  ctx.lineTo(4.2, -8.5);
  ctx.lineTo(-4.2, -8.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8df0df';
  ctx.fillRect(-4.8, -8.5, 9.6, 1.5);
  fillRoundRect(ctx, 2.7, 0.5, 4.3, 5.2, 1, '#f5cb66');
  ctx.fillStyle = '#fff4c6';
  ctx.fillRect(3.5, 1.3, 2.7, 1.2);
  }
  ctx.restore();

  // 朝向箭头从身体外伸出，安全区时再叠一圈柔和的反馈。
  ctx.save();
  ctx.strokeStyle = TIDELINE_TOKENS.color.accent;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  const tip = {
    x: player.position.x + direction.x * (player.radius + 12),
    y: player.position.y + direction.y * (player.radius + 12),
  };
  ctx.beginPath();
  ctx.moveTo(player.position.x + direction.x * 4, player.position.y + direction.y * 4);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - direction.x * 5 - direction.y * 3, tip.y - direction.y * 5 + direction.x * 3);
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - direction.x * 5 + direction.y * 3, tip.y - direction.y * 5 - direction.x * 3);
  ctx.stroke();
  ctx.restore();
}

function isPassengerVisible(
  passenger: Passenger,
  state: GameState,
): boolean {
  if (passenger.role === 'exited') return false;
  if (passenger.role !== 'inside' && passenger.role !== 'boarding' && passenger.role !== 'alighting') {
    return true;
  }

  // 车厢先于角色绘制；关门时直接跳过车内角色，避免没有 clip API 时
  // 仍能从车门/车窗上看到乘客。下车流的移动也由规则层的同一开门状态驱动。
  const doorId = passenger.doorId ?? passenger.desiredDoorId;
  const door = state.doors.find((item) => item.id === doorId);
  return Boolean(door?.open && !door.blocked);
}

export function renderActors(
  renderContext: RenderContext,
  state: GameState,
  _level: LevelConfig,
  playerSprite?: PlayerSpriteAsset,
  passengerSprite?: PassengerSpriteAsset,
): void {
  renderContext.withWorld(() => {
    // 关门时不绘制车内/下车中的角色；开门后才让他们从门洞中出现。
    const passengers = state.passengers
      .filter((passenger) => isPassengerVisible(passenger, state))
      .slice()
      .sort((left, right) => {
        if (left.role === 'inside' && right.role !== 'inside') return -1;
        if (left.role !== 'inside' && right.role === 'inside') return 1;
        return left.position.y - right.position.y;
      });
    for (const passenger of passengers) drawPassenger(renderContext, passenger, state.elapsed, passengerSprite);
    drawPlayer(renderContext, state, playerSprite);
  });
}

export function passengerColor(kind: PassengerKind): string {
  return PASSENGER_COLORS[kind];
}
