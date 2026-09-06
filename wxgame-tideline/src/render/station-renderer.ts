import type { CarriageTheme, DoorConfig, GameState, LevelConfig, Rect, Vec2 } from '../core/types.ts';
import { clamp } from '../core/vector.ts';
import { fillRoundRect, RenderContext } from './context.ts';
import { canvasFont, TIDELINE_TOKENS } from './design-tokens.ts';

/**
 * M8-A 视觉样板：潮汐线车辆采用可切换的主题外壳 + 潮汐灯带 + 浅灰蓝站台。
 * 这里不依赖图片、渐变或 clip，保证微信开发者工具和低版本 Canvas 都能绘制。
 */
export const STATION_COLORS = {
  sky: TIDELINE_TOKENS.color.sky,
  skyBand: '#4b82a1',
  platform: TIDELINE_TOKENS.color.platform,
  platformShadow: TIDELINE_TOKENS.color.platformShadow,
  platformEdge: TIDELINE_TOKENS.color.platformEdge,
  tactile: '#f4cb72',
  tile: TIDELINE_TOKENS.color.tile,
  tileLight: TIDELINE_TOKENS.color.tileLight,
  // 默认主题为后期站点的青绿色车厢；其他关卡通过 CARRIAGE_COLORS 覆盖这些字段。
  train: TIDELINE_TOKENS.color.train,
  trainShell: '#2d6b6a',
  trainShellLight: '#3f8f86',
  trainTrim: '#84dfc3',
  trainStripe: TIDELINE_TOKENS.color.trainStripe,
  window: TIDELINE_TOKENS.color.window,
  windowShade: '#4b9290',
  windowGlint: '#f0ffff',
  interior: '#16364b',
  interiorFloor: '#4f8991',
  seat: '#77b8a8',
  metal: '#d1eff0',
  doorOpen: TIDELINE_TOKENS.color.gold,
  doorClosed: TIDELINE_TOKENS.color.warning,
  safeZone: TIDELINE_TOKENS.color.safe,
  text: TIDELINE_TOKENS.color.text,
} as const;

export type StationColors = typeof STATION_COLORS;

/**
 * 车厢主题只覆盖车体相关颜色，站台材质、状态色和交互语义保持一致。
 * 这样三种外观可以共用同一套平面几何结构，也不会让颜色承担状态提示。
 */
export const CARRIAGE_COLORS = {
  pearl: {
    train: '#afc0c9',
    trainShell: '#e7edf0',
    trainShellLight: '#ffffff',
    trainTrim: '#78cfc2',
    trainStripe: '#50b9af',
    window: '#d7f0f1',
    windowShade: '#7094a3',
    windowGlint: '#ffffff',
    seat: '#89b9b5',
    metal: '#f8ffff',
  },
  yellow: {
    train: '#c5a661',
    trainShell: '#f1dda0',
    trainShellLight: '#fff0c2',
    trainTrim: '#79cdb8',
    trainStripe: '#56b9a5',
    window: '#dff4f1',
    windowShade: '#8da39e',
    windowGlint: '#ffffff',
    seat: '#b9a26b',
    metal: '#fff9df',
  },
  seafoam: {
    train: '#1e5057',
    trainShell: '#2d6b6a',
    trainShellLight: '#3f8f86',
    trainTrim: '#84dfc3',
    trainStripe: '#5bc6aa',
    window: '#b8edf0',
    windowShade: '#4b9290',
    windowGlint: '#f0ffff',
    seat: '#77b8a8',
    metal: '#d1eff0',
  },
} as const satisfies Record<CarriageTheme, Partial<Record<keyof StationColors, string>>>;

/** 未配置主题的自定义关卡沿用后期青绿色车厢，保证旧关卡配置继续可运行。 */
export const DEFAULT_CARRIAGE_THEME: CarriageTheme = 'seafoam';

export function stationColorsFor(theme?: CarriageTheme): StationColors {
  const overrides = theme ? CARRIAGE_COLORS[theme] : undefined;
  return {
    ...STATION_COLORS,
    ...(overrides ?? CARRIAGE_COLORS[DEFAULT_CARRIAGE_THEME]),
  } as StationColors;
}

const BASE_CARRIAGE_HEIGHT = 160;

function carriageVerticalScale(height: number): number {
  return Math.max(0.5, Math.abs(height) / BASE_CARRIAGE_HEIGHT);
}

function fillPolygon(ctx: RenderContext['ctx'], points: readonly Vec2[], color: string): void {
  if (points.length < 3) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function strokeLine(
  ctx: RenderContext['ctx'],
  points: readonly Vec2[],
  color: string,
  lineWidth = 1,
): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.stroke();
  ctx.restore();
}

/** 横屏舞台纵向压缩世界层，状态文字需要恢复屏幕字号才能保持可读。 */
function drawWorldText(
  context: RenderContext,
  text: string,
  position: Vec2,
  font: string,
  color: string,
): void {
  const { ctx, layout } = context;
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (layout.orientation === 'landscape') {
    const scaleX = Number.isFinite(layout.worldScaleX) ? Math.abs(layout.worldScaleX) : layout.worldScale;
    const scaleY = Number.isFinite(layout.worldScaleY) ? Math.abs(layout.worldScaleY) : layout.worldScale;
    if (scaleX > 1e-8 && scaleY > 1e-8) {
      ctx.translate(position.x, position.y);
      ctx.scale(1, scaleX / scaleY);
      ctx.fillText(text, 0, 0);
      ctx.restore();
      return;
    }
  }
  ctx.fillText(text, position.x, position.y);
  ctx.restore();
}

function drawBackdrop(
  context: RenderContext,
  world: Rect,
  colors: StationColors = STATION_COLORS,
): void {
  const { ctx } = context;
  ctx.fillStyle = colors.sky;
  ctx.fillRect(world.x, world.y, world.width, world.height);

  // 不同深度的横向色带让狭长画面不再像一张纯色底图。
  for (let y = world.y; y < world.y + world.height; y += 24) {
    const band = Math.floor((y - world.y) / 24) % 2 === 0;
    ctx.globalAlpha = band ? 0.18 : 0.08;
    ctx.fillStyle = colors.skyBand;
    ctx.fillRect(world.x, y, world.width, 12);
  }
  ctx.globalAlpha = 1;

  // 侧边的潮汐线标记是抽象装饰，不对应现实站点标志。
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = colors.trainTrim;
  ctx.lineWidth = 2;
  for (let side = 0; side < 2; side += 1) {
    const x = side === 0 ? world.x + 7 : world.x + world.width - 7;
    ctx.beginPath();
    ctx.moveTo(x, world.y + 180);
    ctx.lineTo(x + (side === 0 ? 5 : -5), world.y + 220);
    ctx.lineTo(x, world.y + 260);
    ctx.lineTo(x + (side === 0 ? 5 : -5), world.y + 300);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWindow(
  ctx: RenderContext['ctx'],
  x: number,
  y: number,
  width: number,
  height: number,
  colors: StationColors = STATION_COLORS,
): void {
  fillRoundRect(ctx, x, y, width, height, 7, colors.windowShade);
  fillRoundRect(ctx, x + 3, y + 3, width - 6, height - 6, 5, colors.window);
  ctx.save();
  ctx.globalAlpha = 0.6;
  fillPolygon(ctx, [
    { x: x + 5, y: y + height - 5 },
    { x: x + width * 0.52, y: y + 4 },
    { x: x + width * 0.69, y: y + 4 },
    { x: x + width * 0.18, y: y + height - 5 },
  ], colors.windowGlint);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#e8ffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 7, y + 8);
  ctx.lineTo(x + width - 8, y + 8);
  ctx.stroke();
  ctx.restore();
}

function drawTrain(
  context: RenderContext,
  train: Rect,
  colors: StationColors = STATION_COLORS,
): void {
  const { ctx } = context;
  const x = train.x;
  const y = train.y;
  const width = train.width;
  const height = train.height;
  const verticalScale = carriageVerticalScale(height);
  const yAt = (offset: number): number => y + offset * verticalScale;
  const h = (size: number): number => size * verticalScale;

  // 车体投影、圆角外壳和顶部压边，先建立体积再画细节。
  ctx.save();
  ctx.globalAlpha = 0.52;
  fillRoundRect(ctx, x - 6, yAt(6), width + 12, height + h(14), 17, '#0e2434');
  ctx.restore();
  fillRoundRect(ctx, x - 2, yAt(-3), width + 4, height + h(8), 15, colors.train);
  fillRoundRect(ctx, x + 5, yAt(5), width - 10, height - h(12), 10, colors.trainShell);

  // 顶部车顶与两道金属反光。
  fillPolygon(ctx, [
    { x: x + 12, y: yAt(5) },
    { x: x + width - 12, y: yAt(5) },
    { x: x + width - 20, y: yAt(17) },
    { x: x + 20, y: yAt(17) },
  ], colors.trainShellLight);
  ctx.fillStyle = colors.metal;
  ctx.globalAlpha = 0.34;
  ctx.fillRect(x + 20, yAt(12), width - 40, h(2));
  ctx.fillRect(x + 32, yAt(16), width - 64, h(1));
  ctx.globalAlpha = 1;

  // 连续窗带：每块窗有内框、反光和竖向车体骨架。
  const windowY = yAt(26);
  const windowHeight = h(44);
  for (let windowX = x + 14; windowX < x + width - 20; windowX += 47) {
    drawWindow(ctx, windowX, windowY, Math.min(36, x + width - 14 - windowX), windowHeight, colors);
  }
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = colors.trainShellLight;
  for (let ribX = x + 9; ribX < x + width; ribX += 47) {
    ctx.fillRect(ribX, yAt(22), 3, height - h(48));
  }
  ctx.restore();

  // 窗下的抽象潮汐灯带和车厢下裙边。
  ctx.fillStyle = '#24556b';
  ctx.fillRect(x + 8, yAt(76), width - 16, h(48));
  ctx.fillStyle = colors.trainStripe;
  ctx.fillRect(x + 9, yAt(79), width - 18, h(6));
  ctx.save();
  ctx.globalAlpha = 0.52;
  ctx.fillStyle = '#b9fff1';
  ctx.fillRect(x + 14, yAt(80), width - 28, h(1));
  ctx.restore();

  // 内饰地板和座椅轮廓会从开启的门洞里露出。
  ctx.fillStyle = colors.interior;
  ctx.fillRect(x + 10, yAt(82), width - 20, Math.max(0, height - h(94)));
  ctx.fillStyle = '#2d6678';
  ctx.fillRect(x + 13, yAt(87), width - 26, h(7));
  ctx.fillStyle = colors.interiorFloor;
  ctx.fillRect(x + 13, yAt(94), width - 26, Math.max(0, height - h(108)));
  ctx.fillStyle = '#b8fff0';
  ctx.globalAlpha = 0.72;
  ctx.fillRect(x + 20, yAt(89), width - 40, h(2));
  ctx.globalAlpha = 1;
  for (let lightX = x + 34; lightX < x + width - 24; lightX += 54) {
    fillRoundRect(ctx, lightX, yAt(86), 18, h(4), 2, '#d8fff3');
  }
  for (let seatX = x + 20; seatX < x + width - 24; seatX += 42) {
    fillRoundRect(ctx, seatX, yAt(101), 22, h(13), 4, colors.seat);
    ctx.fillStyle = '#d8f6ee';
    ctx.globalAlpha = 0.62;
    ctx.fillRect(seatX + 4, yAt(115), 14, h(2));
    ctx.globalAlpha = 1;
  }
  for (let floorX = x + 18; floorX < x + width - 18; floorX += 22) {
    strokeLine(ctx, [
      { x: floorX, y: yAt(121) },
      { x: floorX + (floorX - (x + width / 2)) * 0.1, y: y + height - h(4) },
    ], '#72afb0', 1);
  }

  // 车厢底部护板与门槛阴影。
  ctx.fillStyle = '#173348';
  ctx.fillRect(x + 6, y + height - h(21), width - 12, h(17));
  ctx.fillStyle = colors.trainShellLight;
  ctx.fillRect(x + 12, y + height - h(18), width - 24, h(4));
  ctx.fillStyle = colors.trainTrim;
  ctx.globalAlpha = 0.46;
  ctx.fillRect(x + 20, y + height - h(12), width - 40, h(2));
  ctx.globalAlpha = 1;
}

function drawPlatform(
  context: RenderContext,
  platform: Rect,
  colors: StationColors = STATION_COLORS,
): void {
  const { ctx } = context;
  ctx.fillStyle = colors.platformShadow;
  ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
  ctx.fillStyle = colors.platform;
  ctx.fillRect(platform.x + 7, platform.y + 5, platform.width - 14, platform.height - 5);

  // 大块地砖和错位缝，形成可感知的地面尺度。
  for (let y = platform.y + 26; y < platform.y + platform.height; y += 34) {
    ctx.fillStyle = colors.tile;
    ctx.globalAlpha = 0.58;
    ctx.fillRect(platform.x + 8, y, platform.width - 16, 1);
    ctx.globalAlpha = 1;
    const offset = Math.floor((y - platform.y) / 34) % 2 === 0 ? 18 : 38;
    for (let x = platform.x + offset; x < platform.x + platform.width - 8; x += 40) {
      ctx.fillStyle = colors.tileLight;
      ctx.globalAlpha = 0.46;
      ctx.fillRect(x, y + 1, 1, 33);
      ctx.globalAlpha = 1;
    }
  }

  // 两侧排水槽和站台内缘阴影。
  ctx.fillStyle = '#2b5068';
  ctx.fillRect(platform.x + 8, platform.y + 70, 4, platform.height - 78);
  ctx.fillRect(platform.x + platform.width - 12, platform.y + 70, 4, platform.height - 78);
  ctx.fillStyle = '#78a6b5';
  ctx.globalAlpha = 0.58;
  ctx.fillRect(platform.x + 12, platform.y + 72, 1, platform.height - 82);
  ctx.fillRect(platform.x + platform.width - 14, platform.y + 72, 1, platform.height - 82);
  ctx.globalAlpha = 1;

  // 车门侧的盲道点阵与金属边缘。
  ctx.fillStyle = colors.tactile;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(platform.x + 8, platform.y + 9, platform.width - 16, 9);
  ctx.globalAlpha = 1;
  for (let x = platform.x + 15; x < platform.x + platform.width - 8; x += 15) {
    ctx.beginPath();
    ctx.arc(x, platform.y + 13.5, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#f4d58a';
    ctx.fill();
  }
  ctx.fillStyle = colors.platformEdge;
  ctx.fillRect(platform.x, platform.y, platform.width, 5);
  ctx.fillStyle = '#d6f2ef';
  ctx.globalAlpha = 0.65;
  ctx.fillRect(platform.x + 10, platform.y + 1, platform.width - 20, 2);
  ctx.globalAlpha = 1;

  // 贯穿站台的潮汐导向线，强化“路线”而不是现实地铁品牌。
  // 使用短的非定向装饰块保留线路识别度，不绘制容易被误解为乘客路径的长线。
  ctx.fillStyle = colors.trainTrim;
  ctx.globalAlpha = 0.5;
  for (let x = platform.x + 28; x < platform.x + platform.width - 28; x += 56) {
    fillRoundRect(ctx, x, platform.y + platform.height - 28, 26, 4, 2, colors.trainTrim);
  }
  ctx.globalAlpha = 1;
}

function drawDoor(
  context: RenderContext,
  train: Rect,
  door: DoorConfig,
  open: boolean,
  selected: boolean,
  blocked = false,
  now = 0,
  colors: StationColors = STATION_COLORS,
  warning = false,
): void {
  const { ctx } = context;
  const half = door.width / 2;
  const left = door.center.x - half;
  const top = train.y + 52 * carriageVerticalScale(train.height);
  const bottom = door.center.y + 5;
  const height = bottom - top;
  const frameColor = warning
    ? '#ffb347'
    : blocked
    ? '#ef6b78'
    : selected
      ? '#f7ffff'
      : open
        ? colors.doorOpen
        : colors.doorClosed;

  // 门洞内的黑位、地板和顶灯先画出来，开门时形成真正的空间深度。
  ctx.save();
  ctx.fillStyle = '#1b465c';
  ctx.fillRect(left, top, door.width, height);
  ctx.fillStyle = '#4d8d91';
  ctx.fillRect(left + 5, top + height * 0.34, door.width - 10, height * 0.66);
  ctx.globalAlpha = open ? 0.8 : 0.22;
  ctx.fillStyle = open ? '#e1fff6' : '#3b2740';
  ctx.fillRect(left + 7, top + 9, door.width - 14, 4);
  ctx.globalAlpha = 1;
  if (open) {
    ctx.fillStyle = '#2b6376';
    ctx.globalAlpha = 0.72;
    for (let panel = 0; panel < 3; panel += 1) {
      ctx.fillRect(left + 9 + panel * 14, top + height * 0.46, 8, height * 0.4);
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#b8fff0';
    ctx.fillRect(left + 7, bottom - 10, door.width - 14, 5);
    ctx.globalAlpha = 1;
  } else {
    // 关闭时两扇门板向中心合拢，并保留中缝和观察窗。
    fillPolygon(ctx, [
      { x: left + 2, y: top + 2 },
      { x: left + door.width / 2 - 2, y: top + 10 },
      { x: left + door.width / 2 - 2, y: bottom - 4 },
      { x: left + 2, y: bottom - 1 },
    ], '#51283b');
    fillPolygon(ctx, [
      { x: left + door.width - 2, y: top + 2 },
      { x: left + door.width / 2 + 2, y: top + 10 },
      { x: left + door.width / 2 + 2, y: bottom - 4 },
      { x: left + door.width - 2, y: bottom - 1 },
    ], '#632f45');
    fillRoundRect(ctx, left + 8, top + 20, door.width - 16, 22, 4, '#74425a');
    ctx.fillStyle = '#a76a76';
    ctx.globalAlpha = 0.45;
    ctx.fillRect(left + 12, top + 24, door.width - 24, 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#351b2c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(door.center.x, top + 6);
    ctx.lineTo(door.center.x, bottom - 2);
    ctx.stroke();
  }
  ctx.restore();

  // 门框、顶部状态灯和门槛。
  ctx.save();
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.strokeRect(left, top, door.width, height);
  ctx.fillStyle = frameColor;
  ctx.fillRect(left - 2, top - 5, door.width + 4, 5);
  ctx.globalAlpha = 0.7;
  ctx.fillRect(left + 4, bottom - 2, door.width - 8, 4);
  ctx.globalAlpha = 1;
  ctx.fillStyle = selected ? colors.trainTrim : frameColor;
  ctx.fillRect(left + 8, top + 4, door.width - 16, 3);
  ctx.restore();

  if (warning) {
    ctx.save();
    const blink = 0.28 + (Math.sin(now * Math.PI * 4) + 1) * 0.28;
    ctx.globalAlpha = blink;
    ctx.strokeStyle = '#ffd36e';
    ctx.lineWidth = 4;
    ctx.strokeRect(left - 5, top - 5, door.width + 10, height + 10);
    ctx.restore();
  }

  // 保留参数以兼容旧渲染调用；运行时不再传入选中门，避免产生选中/非选中玩法。
  if (selected) {
    ctx.save();
    ctx.globalAlpha = 0.28 + (Math.sin(now * 6 + door.center.x * 0.08) + 1) * 0.04;
    ctx.strokeStyle = colors.trainTrim;
    ctx.lineWidth = 5;
    ctx.strokeRect(left - 4, top - 4, door.width + 8, height + 8);
    ctx.restore();
  }

  // 站台侧安全区采用低饱和底色，提示所有开放门都可进入。
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = colors.safeZone;
  ctx.fillRect(door.safeZone.x, door.safeZone.y, door.safeZone.width, door.safeZone.height);
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = colors.safeZone;
  ctx.lineWidth = 1;
  ctx.strokeRect(door.safeZone.x, door.safeZone.y, door.safeZone.width, door.safeZone.height);
  ctx.restore();

  // 门前方向箭头和状态短标签，强化交互意图。
  ctx.save();
  ctx.fillStyle = frameColor;
  ctx.beginPath();
  ctx.arc(door.center.x, door.safeZone.y + door.safeZone.height - 8, 3, 0, Math.PI * 2);
  ctx.fill();
  drawWorldText(
    context,
    warning ? '即将关闭' : blocked ? '避让' : open ? '可进' : '等待',
    { x: door.center.x, y: door.safeZone.y + 8 },
    canvasFont(700, 9),
    frameColor,
  );
  ctx.restore();
}

function drawEventOverlay(context: RenderContext, state: GameState, platform: Rect): void {
  const active = state.activeEvent;
  if (!active) return;
  const { ctx } = context;
  if (active.kind === 'rain') {
    const inset = Math.max(0, active.horizontalInset ?? 0);
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#5e8fb3';
    ctx.fillRect(platform.x, platform.y, inset, platform.height);
    ctx.fillRect(platform.x + platform.width - inset, platform.y, inset, platform.height);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#a8d9ef';
    ctx.lineWidth = 1;
    for (let x = platform.x + 8; x < platform.x + platform.width; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, platform.y + 20);
      ctx.lineTo(x - 8, platform.y + 34);
      ctx.stroke();
    }
    ctx.restore();
  } else if (active.kind === 'luggage-cart' && active.zone) {
    const zone = active.zone;
    ctx.save();
    ctx.globalAlpha = 0.88;
    fillRoundRect(ctx, zone.x, zone.y, zone.width, zone.height, 10, TIDELINE_TOKENS.color.luggageCart);
    ctx.strokeStyle = '#f1bd73';
    ctx.lineWidth = 2;
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
    ctx.fillStyle = '#f1bd73';
    ctx.fillRect(zone.x + 9, zone.y + 12, zone.width - 18, 5);
    ctx.fillRect(zone.x + 9, zone.y + zone.height - 17, zone.width - 18, 5);
    drawWorldText(
      context,
      '行李车',
      { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 },
      canvasFont(700, 11),
      TIDELINE_TOKENS.color.luggageCartText,
    );
    ctx.restore();
  } else if (active.kind === 'crowd-surge') {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = '#ffb36b';
    ctx.lineWidth = 2;
    for (let y = platform.y + 28; y < platform.y + platform.height - 18; y += 34) {
      ctx.beginPath();
      ctx.moveTo(platform.x + 16, y);
      ctx.lineTo(platform.x + 40, y);
      ctx.moveTo(platform.x + platform.width - 16, y + 10);
      ctx.lineTo(platform.x + platform.width - 40, y + 10);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function renderStation(
  renderContext: RenderContext,
  level: LevelConfig,
  state: GameState,
): void {
  const { ctx } = renderContext;
  const colors = stationColorsFor(level.carriageTheme);
  renderContext.withWorld(() => {
    const world = renderContext.layout.worldBounds;
    drawBackdrop(renderContext, world, colors);
    drawTrain(renderContext, level.trainBounds, colors);
    drawPlatform(renderContext, level.platformBounds, colors);

    for (const door of level.doors) {
      const runtime = state.doors.find((item) => item.id === door.id);
      drawDoor(
        renderContext,
        level.trainBounds,
        door,
        (runtime?.open ?? false) && !(runtime?.blocked ?? false),
        false,
        runtime?.blocked ?? false,
        state.elapsed,
        colors,
        state.activeEvent?.kind === 'door-close'
          && state.activeEvent.phase === 'warning'
          && state.activeEvent.fromDoorId === door.id,
      );
      if (runtime && runtime.occupancy > 0) {
        const occupancyRatio = clamp(runtime.occupancy / Math.max(1, level.carriageCapacity), 0, 1);
        const barX = door.center.x - door.width / 2;
        const barY = door.safeZone.y + door.safeZone.height + 5;
        ctx.fillStyle = '#23465d';
        ctx.fillRect(barX, barY, door.width, 4);
        ctx.fillStyle = occupancyRatio > 0.85 ? '#ed7b83' : colors.safeZone;
        ctx.fillRect(barX, barY, door.width * occupancyRatio, 4);
      }
    }

    drawEventOverlay(renderContext, state, level.platformBounds);
  });
}
