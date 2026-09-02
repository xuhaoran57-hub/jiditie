import type { DoorConfig, GameState, LevelConfig, Rect, Vec2 } from '../core/types.ts';
import { clamp } from '../core/vector.ts';
import { fillRoundRect, RenderContext } from './context.ts';
import { canvasFont, TIDELINE_TOKENS } from './design-tokens.ts';

/**
 * M8-A 视觉样板：潮汐线车辆采用“深海外壳 + 潮汐灯带 + 暖色站台”的独立语言。
 * 这里不依赖图片、渐变或 clip，保证微信开发者工具和低版本 Canvas 都能绘制。
 */
export const STATION_COLORS = {
  sky: TIDELINE_TOKENS.color.sky,
  skyBand: '#4b82a1',
  platform: TIDELINE_TOKENS.color.platform,
  platformShadow: '#375d77',
  platformEdge: TIDELINE_TOKENS.color.platformEdge,
  tactile: '#f4cb72',
  tile: TIDELINE_TOKENS.color.tile,
  tileLight: '#8db5c1',
  train: TIDELINE_TOKENS.color.train,
  trainShell: '#3b7890',
  trainShellLight: '#5f9bad',
  trainTrim: '#72f1d8',
  trainStripe: TIDELINE_TOKENS.color.trainStripe,
  window: TIDELINE_TOKENS.color.window,
  windowShade: '#6ca7bc',
  windowGlint: '#f0ffff',
  interior: '#16364b',
  interiorFloor: '#4f8991',
  seat: '#77afb0',
  metal: '#d1eff0',
  doorOpen: TIDELINE_TOKENS.color.gold,
  doorClosed: TIDELINE_TOKENS.color.warning,
  safeZone: TIDELINE_TOKENS.color.safe,
  text: TIDELINE_TOKENS.color.text,
} as const;

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

function drawBackdrop(context: RenderContext, world: Rect): void {
  const { ctx } = context;
  ctx.fillStyle = STATION_COLORS.sky;
  ctx.fillRect(world.x, world.y, world.width, world.height);

  // 不同深度的横向色带让狭长画面不再像一张纯色底图。
  for (let y = world.y; y < world.y + world.height; y += 24) {
    const band = Math.floor((y - world.y) / 24) % 2 === 0;
    ctx.globalAlpha = band ? 0.18 : 0.08;
    ctx.fillStyle = STATION_COLORS.skyBand;
    ctx.fillRect(world.x, y, world.width, 12);
  }
  ctx.globalAlpha = 1;

  // 侧边的潮汐线标记是抽象装饰，不对应现实站点标志。
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = STATION_COLORS.trainTrim;
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

function drawWindow(ctx: RenderContext['ctx'], x: number, y: number, width: number, height: number): void {
  fillRoundRect(ctx, x, y, width, height, 7, STATION_COLORS.windowShade);
  fillRoundRect(ctx, x + 3, y + 3, width - 6, height - 6, 5, STATION_COLORS.window);
  ctx.save();
  ctx.globalAlpha = 0.6;
  fillPolygon(ctx, [
    { x: x + 5, y: y + height - 5 },
    { x: x + width * 0.52, y: y + 4 },
    { x: x + width * 0.69, y: y + 4 },
    { x: x + width * 0.18, y: y + height - 5 },
  ], STATION_COLORS.windowGlint);
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

function drawTrain(context: RenderContext, train: Rect): void {
  const { ctx } = context;
  const x = train.x;
  const y = train.y;
  const width = train.width;
  const height = train.height;

  // 车体投影、圆角外壳和顶部压边，先建立体积再画细节。
  ctx.save();
  ctx.globalAlpha = 0.52;
  fillRoundRect(ctx, x - 6, y + 6, width + 12, height + 14, 17, '#0e2434');
  ctx.restore();
  fillRoundRect(ctx, x - 2, y - 3, width + 4, height + 8, 15, STATION_COLORS.train);
  fillRoundRect(ctx, x + 5, y + 5, width - 10, height - 12, 10, STATION_COLORS.trainShell);

  // 顶部车顶与两道金属反光。
  fillPolygon(ctx, [
    { x: x + 12, y: y + 5 },
    { x: x + width - 12, y: y + 5 },
    { x: x + width - 20, y: y + 17 },
    { x: x + 20, y: y + 17 },
  ], STATION_COLORS.trainShellLight);
  ctx.fillStyle = STATION_COLORS.metal;
  ctx.globalAlpha = 0.34;
  ctx.fillRect(x + 20, y + 12, width - 40, 2);
  ctx.fillRect(x + 32, y + 16, width - 64, 1);
  ctx.globalAlpha = 1;

  // 连续窗带：每块窗有内框、反光和竖向车体骨架。
  const windowY = y + 26;
  const windowHeight = 44;
  for (let windowX = x + 14; windowX < x + width - 20; windowX += 47) {
    drawWindow(ctx, windowX, windowY, Math.min(36, x + width - 14 - windowX), windowHeight);
  }
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = STATION_COLORS.trainShellLight;
  for (let ribX = x + 9; ribX < x + width; ribX += 47) {
    ctx.fillRect(ribX, y + 22, 3, height - 48);
  }
  ctx.restore();

  // 窗下的抽象潮汐灯带和车厢下裙边。
  ctx.fillStyle = '#24556b';
  ctx.fillRect(x + 8, y + 76, width - 16, 48);
  ctx.fillStyle = STATION_COLORS.trainStripe;
  ctx.fillRect(x + 9, y + 79, width - 18, 6);
  ctx.save();
  ctx.globalAlpha = 0.52;
  ctx.fillStyle = '#b9fff1';
  ctx.fillRect(x + 14, y + 80, width - 28, 1);
  ctx.restore();

  // 内饰地板和座椅轮廓会从开启的门洞里露出。
  ctx.fillStyle = STATION_COLORS.interior;
  ctx.fillRect(x + 10, y + 82, width - 20, Math.max(0, height - 94));
  ctx.fillStyle = '#2d6678';
  ctx.fillRect(x + 13, y + 87, width - 26, 7);
  ctx.fillStyle = STATION_COLORS.interiorFloor;
  ctx.fillRect(x + 13, y + 94, width - 26, Math.max(0, height - 108));
  ctx.fillStyle = '#b8fff0';
  ctx.globalAlpha = 0.72;
  ctx.fillRect(x + 20, y + 89, width - 40, 2);
  ctx.globalAlpha = 1;
  for (let lightX = x + 34; lightX < x + width - 24; lightX += 54) {
    fillRoundRect(ctx, lightX, y + 86, 18, 4, 2, '#d8fff3');
  }
  for (let seatX = x + 20; seatX < x + width - 24; seatX += 42) {
    fillRoundRect(ctx, seatX, y + 101, 22, 13, 4, STATION_COLORS.seat);
    ctx.fillStyle = '#d8f6ee';
    ctx.globalAlpha = 0.62;
    ctx.fillRect(seatX + 4, y + 115, 14, 2);
    ctx.globalAlpha = 1;
  }
  for (let floorX = x + 18; floorX < x + width - 18; floorX += 22) {
    strokeLine(ctx, [
      { x: floorX, y: y + 121 },
      { x: floorX + (floorX - (x + width / 2)) * 0.1, y: y + height - 4 },
    ], '#72afb0', 1);
  }

  // 车厢底部护板与门槛阴影。
  ctx.fillStyle = '#173348';
  ctx.fillRect(x + 6, y + height - 21, width - 12, 17);
  ctx.fillStyle = STATION_COLORS.trainShellLight;
  ctx.fillRect(x + 12, y + height - 18, width - 24, 4);
  ctx.fillStyle = STATION_COLORS.trainTrim;
  ctx.globalAlpha = 0.46;
  ctx.fillRect(x + 20, y + height - 12, width - 40, 2);
  ctx.globalAlpha = 1;
}

function drawPlatform(context: RenderContext, platform: Rect): void {
  const { ctx } = context;
  ctx.fillStyle = STATION_COLORS.platformShadow;
  ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
  ctx.fillStyle = STATION_COLORS.platform;
  ctx.fillRect(platform.x + 7, platform.y + 5, platform.width - 14, platform.height - 5);

  // 大块地砖和错位缝，形成可感知的地面尺度。
  for (let y = platform.y + 26; y < platform.y + platform.height; y += 34) {
    ctx.fillStyle = STATION_COLORS.tile;
    ctx.globalAlpha = 0.58;
    ctx.fillRect(platform.x + 8, y, platform.width - 16, 1);
    ctx.globalAlpha = 1;
    const offset = Math.floor((y - platform.y) / 34) % 2 === 0 ? 18 : 38;
    for (let x = platform.x + offset; x < platform.x + platform.width - 8; x += 40) {
      ctx.fillStyle = STATION_COLORS.tileLight;
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
  ctx.fillStyle = STATION_COLORS.tactile;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(platform.x + 8, platform.y + 9, platform.width - 16, 9);
  ctx.globalAlpha = 1;
  for (let x = platform.x + 15; x < platform.x + platform.width - 8; x += 15) {
    ctx.beginPath();
    ctx.arc(x, platform.y + 13.5, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#f4d58a';
    ctx.fill();
  }
  ctx.fillStyle = STATION_COLORS.platformEdge;
  ctx.fillRect(platform.x, platform.y, platform.width, 5);
  ctx.fillStyle = '#d6f2ef';
  ctx.globalAlpha = 0.65;
  ctx.fillRect(platform.x + 10, platform.y + 1, platform.width - 20, 2);
  ctx.globalAlpha = 1;

  // 贯穿站台的潮汐导向线，强化“路线”而不是现实地铁品牌。
  // 使用短的非定向装饰块保留线路识别度，不绘制容易被误解为乘客路径的长线。
  ctx.fillStyle = STATION_COLORS.trainTrim;
  ctx.globalAlpha = 0.5;
  for (let x = platform.x + 28; x < platform.x + platform.width - 28; x += 56) {
    fillRoundRect(ctx, x, platform.y + platform.height - 28, 26, 4, 2, STATION_COLORS.trainTrim);
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
): void {
  const { ctx } = context;
  const half = door.width / 2;
  const left = door.center.x - half;
  const top = train.y + 52;
  const bottom = door.center.y + 5;
  const height = bottom - top;
  const frameColor = blocked
    ? '#ef6b78'
    : selected
      ? '#f7ffff'
      : open
        ? STATION_COLORS.doorOpen
        : STATION_COLORS.doorClosed;

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
  ctx.fillStyle = selected ? STATION_COLORS.trainTrim : frameColor;
  ctx.fillRect(left + 8, top + 4, door.width - 16, 3);
  ctx.restore();

  // 选中门的双层呼吸框，避免只靠单一颜色传达状态。
  if (selected) {
    ctx.save();
    ctx.globalAlpha = 0.28 + (Math.sin(now * 6 + door.center.x * 0.08) + 1) * 0.04;
    ctx.strokeStyle = STATION_COLORS.trainTrim;
    ctx.lineWidth = 5;
    ctx.strokeRect(left - 4, top - 4, door.width + 8, height + 8);
    ctx.restore();
  }

  // 站台侧安全区采用低饱和底色，仍保留触控识别度。
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = STATION_COLORS.safeZone;
  ctx.fillRect(door.safeZone.x, door.safeZone.y, door.safeZone.width, door.safeZone.height);
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = STATION_COLORS.safeZone;
  ctx.lineWidth = 1;
  ctx.strokeRect(door.safeZone.x, door.safeZone.y, door.safeZone.width, door.safeZone.height);
  ctx.restore();

  // 门前方向箭头和状态短标签，强化交互意图。
  ctx.save();
  ctx.fillStyle = frameColor;
  ctx.beginPath();
  ctx.arc(door.center.x, door.safeZone.y + door.safeZone.height - 8, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = canvasFont(700, 9);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = frameColor;
  ctx.fillText(blocked ? '避让' : open ? '可进' : '等待', door.center.x, door.safeZone.y + 8);
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
    ctx.fillStyle = TIDELINE_TOKENS.color.luggageCartText;
    ctx.font = canvasFont(700, 11);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('行李车', zone.x + zone.width / 2, zone.y + zone.height / 2);
    ctx.restore();
  }
}

export function renderStation(
  renderContext: RenderContext,
  level: LevelConfig,
  state: GameState,
): void {
  const { ctx } = renderContext;
  renderContext.withWorld(() => {
    const world = renderContext.layout.worldBounds;
    drawBackdrop(renderContext, world);
    drawTrain(renderContext, level.trainBounds);
    drawPlatform(renderContext, level.platformBounds);

    for (const door of level.doors) {
      const runtime = state.doors.find((item) => item.id === door.id);
      drawDoor(
        renderContext,
        level.trainBounds,
        door,
        (runtime?.open ?? false) && !(runtime?.blocked ?? false),
        state.player.selectedDoorId === door.id,
        runtime?.blocked ?? false,
        state.elapsed,
      );
      if (runtime && runtime.occupancy > 0) {
        const occupancyRatio = clamp(runtime.occupancy / Math.max(1, level.carriageCapacity), 0, 1);
        const barX = door.center.x - door.width / 2;
        const barY = door.safeZone.y + door.safeZone.height + 5;
        ctx.fillStyle = '#23465d';
        ctx.fillRect(barX, barY, door.width, 4);
        ctx.fillStyle = occupancyRatio > 0.85 ? '#ed7b83' : STATION_COLORS.safeZone;
        ctx.fillRect(barX, barY, door.width * occupancyRatio, 4);
      }
    }

    drawEventOverlay(renderContext, state, level.platformBounds);
  });
}
