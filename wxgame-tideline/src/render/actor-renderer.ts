import type { GameState, LevelConfig, Passenger, PassengerKind, Vec2 } from '../core/types.ts';
import { distance, normalize, sub } from '../core/vector.ts';
import { RenderContext } from './context.ts';
import { TIDELINE_TOKENS } from './design-tokens.ts';

const PASSENGER_COLORS: Record<PassengerKind, string> = {
  regular: TIDELINE_TOKENS.color.passengerRegular,
  fast: TIDELINE_TOKENS.color.passengerFast,
  slow: TIDELINE_TOKENS.color.passengerSlow,
  luggage: TIDELINE_TOKENS.color.passengerLuggage,
  phone: TIDELINE_TOKENS.color.passengerPhone,
  group: TIDELINE_TOKENS.color.passengerGroup,
};

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

function drawPassenger(context: RenderContext, passenger: Passenger, now: number): void {
  const { ctx } = context;
  const alphaBefore = ctx.globalAlpha;
  if (passenger.role === 'inside') ctx.globalAlpha = 0.58;
  const color = PASSENGER_COLORS[passenger.kind];
  const guided = passenger.guidedUntil > now;
  if (guided) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    drawCircle(context, passenger.position, passenger.radius + 6, TIDELINE_TOKENS.color.safe);
    ctx.restore();
  }
  drawCircle(context, passenger.position, passenger.radius, color, TIDELINE_TOKENS.color.actorInk, 1.5);

  if (passenger.kind === 'luggage') {
    ctx.fillStyle = TIDELINE_TOKENS.color.luggageCart;
    ctx.fillRect(
      passenger.position.x + passenger.radius * 0.45,
      passenger.position.y - passenger.radius * 0.55,
      passenger.radius * 0.7,
      passenger.radius * 0.8,
    );
  } else if (passenger.kind === 'group') {
    ctx.strokeStyle = TIDELINE_TOKENS.color.groupHighlight;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(passenger.position.x, passenger.position.y, passenger.radius + 4, 0, Math.PI * 2);
    ctx.stroke();
  } else if (passenger.kind === 'phone') {
    ctx.fillStyle = TIDELINE_TOKENS.color.panelAlt;
    ctx.fillRect(passenger.position.x - 2, passenger.position.y - passenger.radius * 0.55, 4, 7);
  }

  if (passenger.role !== 'inside') {
    const direction = normalize(sub(passenger.target, passenger.position), { x: 0, y: 1 });
    ctx.strokeStyle = guided ? '#ecfff9' : '#d6e6f2';
    ctx.globalAlpha = guided ? 0.9 : 0.45;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(passenger.position.x, passenger.position.y);
    ctx.lineTo(
      passenger.position.x + direction.x * Math.min(10, distance(passenger.position, passenger.target)),
      passenger.position.y + direction.y * Math.min(10, distance(passenger.position, passenger.target)),
    );
    ctx.stroke();
  }
  ctx.globalAlpha = alphaBefore;
}

function drawPlayer(context: RenderContext, state: GameState): void {
  const { ctx } = context;
  const player = state.player;
  const direction = normalize(player.facing, { x: 0, y: -1 });
  ctx.save();
  if (player.inSafeZone) {
    ctx.globalAlpha = 0.22;
    drawCircle(context, player.position, player.radius + 9, TIDELINE_TOKENS.color.safe);
    ctx.globalAlpha = 1;
  }
  drawCircle(context, player.position, player.radius, TIDELINE_TOKENS.color.player, TIDELINE_TOKENS.color.outline, 2);
  ctx.strokeStyle = TIDELINE_TOKENS.color.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(player.position.x, player.position.y);
  ctx.lineTo(
    player.position.x + direction.x * (player.radius + 9),
    player.position.y + direction.y * (player.radius + 9),
  );
  ctx.stroke();
  ctx.restore();
}

export function renderActors(
  renderContext: RenderContext,
  state: GameState,
  _level: LevelConfig,
): void {
  renderContext.withWorld(() => {
    // 先绘制乘客，再绘制玩家，确保主角在拥挤区域仍可辨认。
    for (const passenger of state.passengers) {
      if (passenger.role !== 'exited') drawPassenger(renderContext, passenger, state.elapsed);
    }
    drawPlayer(renderContext, state);
  });
}

export function passengerColor(kind: PassengerKind): string {
  return PASSENGER_COLORS[kind];
}
