import type { DoorConfig, GameState, LevelConfig, Rect } from '../core/types.ts';
import { clamp } from '../core/vector.ts';
import {
  fillRoundRect,
  RenderContext,
} from './context.ts';
import { canvasFont, TIDELINE_TOKENS } from './design-tokens.ts';

export const STATION_COLORS = {
  sky: TIDELINE_TOKENS.color.sky,
  platform: TIDELINE_TOKENS.color.platform,
  platformEdge: TIDELINE_TOKENS.color.platformEdge,
  tile: TIDELINE_TOKENS.color.tile,
  train: TIDELINE_TOKENS.color.train,
  trainStripe: TIDELINE_TOKENS.color.trainStripe,
  window: TIDELINE_TOKENS.color.window,
  doorOpen: TIDELINE_TOKENS.color.gold,
  doorClosed: TIDELINE_TOKENS.color.warning,
  safeZone: TIDELINE_TOKENS.color.safe,
  text: TIDELINE_TOKENS.color.text,
} as const;

function drawTrack(context: RenderContext, train: Rect): void {
  const { ctx } = context;
  ctx.fillStyle = '#0b111e';
  ctx.fillRect(train.x, train.y, train.width, train.height);
  ctx.fillStyle = STATION_COLORS.train;
  ctx.fillRect(train.x + 8, train.y + 12, train.width - 16, train.height - 20);

  ctx.fillStyle = STATION_COLORS.trainStripe;
  ctx.fillRect(train.x + 8, train.y + train.height - 34, train.width - 16, 8);
  ctx.fillStyle = '#d9f8f2';
  for (let x = train.x + 24; x < train.x + train.width - 20; x += 48) {
    fillRoundRect(ctx, x, train.y + 28, 30, 42, 8, STATION_COLORS.window);
  }
}

function drawPlatform(context: RenderContext, platform: Rect): void {
  const { ctx } = context;
  ctx.fillStyle = STATION_COLORS.platform;
  ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
  ctx.fillStyle = STATION_COLORS.tile;
  for (let y = platform.y + 20; y < platform.y + platform.height; y += 36) {
    ctx.fillRect(platform.x, y, platform.width, 1);
  }
  for (let x = platform.x + 20; x < platform.x + platform.width; x += 40) {
    ctx.fillRect(x, platform.y, 1, platform.height);
  }
  ctx.fillStyle = STATION_COLORS.platformEdge;
  ctx.fillRect(platform.x, platform.y, platform.width, 5);
  ctx.fillStyle = '#f4bd63';
  ctx.fillRect(platform.x, platform.y + 8, platform.width, 3);
}

function drawDoor(
  context: RenderContext,
  door: DoorConfig,
  open: boolean,
  selected: boolean,
  blocked = false,
): void {
  const { ctx } = context;
  const half = door.width / 2;
  const frameColor = blocked
    ? '#ef6b78'
    : selected
      ? '#ffffff'
      : open
        ? STATION_COLORS.doorOpen
        : STATION_COLORS.doorClosed;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = STATION_COLORS.safeZone;
  ctx.fillRect(door.safeZone.x, door.safeZone.y, door.safeZone.width, door.safeZone.height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = open ? '#0b1119' : '#6e2e45';
  ctx.fillRect(door.center.x - half, door.center.y - 4, door.width, 12);
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.strokeRect(door.center.x - half, door.center.y - 7, door.width, 20);
  ctx.fillStyle = frameColor;
  ctx.fillRect(door.center.x - half, door.center.y - 8, door.width, 4);
  ctx.restore();

  // 门前短箭头让安全区在低饱和度背景上仍然可读。
  ctx.save();
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(door.center.x, door.center.y + 20);
  ctx.lineTo(door.center.x, door.center.y + 34);
  ctx.moveTo(door.center.x, door.center.y + 34);
  ctx.lineTo(door.center.x - 5, door.center.y + 28);
  ctx.moveTo(door.center.x, door.center.y + 34);
  ctx.lineTo(door.center.x + 5, door.center.y + 28);
  ctx.stroke();
  ctx.restore();
}

function drawEventOverlay(context: RenderContext, state: GameState, platform: Rect): void {
  const active = state.activeEvent;
  if (!active) return;
  const { ctx } = context;
  if (active.kind === 'rain') {
    const inset = Math.max(0, active.horizontalInset ?? 0);
    ctx.save();
    ctx.globalAlpha = 0.2;
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
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = TIDELINE_TOKENS.color.luggageCart;
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
    ctx.strokeStyle = '#f1bd73';
    ctx.lineWidth = 2;
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
    ctx.fillStyle = TIDELINE_TOKENS.color.luggageCartText;
    ctx.font = canvasFont(400, 11);
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
    ctx.fillStyle = STATION_COLORS.sky;
    ctx.fillRect(world.x, world.y, world.width, world.height);
    drawTrack(renderContext, level.trainBounds);
    drawPlatform(renderContext, level.platformBounds);

    for (const door of level.doors) {
      const runtime = state.doors.find((item) => item.id === door.id);
      drawDoor(
        renderContext,
        door,
        (runtime?.open ?? false) && !(runtime?.blocked ?? false),
        state.player.selectedDoorId === door.id,
        runtime?.blocked ?? false,
      );
      if (runtime && runtime.occupancy > 0) {
        const occupancyRatio = clamp(runtime.occupancy / Math.max(1, level.carriageCapacity), 0, 1);
        ctx.fillStyle = '#172238';
        ctx.fillRect(door.center.x - door.width / 2, door.center.y - 24, door.width, 4);
        ctx.fillStyle = occupancyRatio > 0.85 ? '#ed7b83' : STATION_COLORS.safeZone;
        ctx.fillRect(door.center.x - door.width / 2, door.center.y - 24, door.width * occupancyRatio, 4);
      }
    }

    // 站台两侧的几何标记，保持虚构线路的独立视觉语言。
    ctx.fillStyle = '#3a4b69';
    ctx.fillRect(level.platformBounds.x + 12, level.platformBounds.y + 74, 4, level.platformBounds.height - 96);
    ctx.fillRect(
      level.platformBounds.x + level.platformBounds.width - 16,
      level.platformBounds.y + 74,
      4,
      level.platformBounds.height - 96,
    );
    drawEventOverlay(renderContext, state, level.platformBounds);
  });
}
