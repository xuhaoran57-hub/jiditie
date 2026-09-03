import type { GameState, LevelConfig, Passenger } from '../core/types.ts';
import { clamp, normalize } from '../core/vector.ts';
import { RenderContext } from './context.ts';
import { TIDELINE_TOKENS } from './design-tokens.ts';

function eventAge(now: number, at: number): number {
  return Math.max(0, now - at);
}

function findPassenger(state: GameState, id: string): Passenger | undefined {
  return state.passengers.find((passenger) => passenger.id === id);
}

const GUIDE_EFFECT_LIFE = 0.8;

function drawGuideWave(context: RenderContext, state: GameState, age: number): void {
  if (age < 0 || age >= GUIDE_EFFECT_LIFE) return;
  const { ctx } = context;
  const progress = clamp(age / 0.55, 0, 1);
  const alpha = clamp(0.58 * (1 - age / GUIDE_EFFECT_LIFE), 0, 0.58);
  const facing = normalize(state.player.facing, { x: 0, y: -1 });
  const angle = Math.atan2(facing.y, facing.x);
  const radius = state.player.radius + 10 + progress * 30;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = TIDELINE_TOKENS.color.safe;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(state.player.position.x, state.player.position.y, radius, angle - 0.55, angle + 0.55);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.7;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(
    state.player.position.x + facing.x * (state.player.radius + 5),
    state.player.position.y + facing.y * (state.player.radius + 5),
  );
  ctx.lineTo(
    state.player.position.x + Math.cos(angle - 0.55) * radius,
    state.player.position.y + Math.sin(angle - 0.55) * radius,
  );
  ctx.moveTo(
    state.player.position.x + facing.x * (state.player.radius + 5),
    state.player.position.y + facing.y * (state.player.radius + 5),
  );
  ctx.lineTo(
    state.player.position.x + Math.cos(angle + 0.55) * radius,
    state.player.position.y + Math.sin(angle + 0.55) * radius,
  );
  ctx.stroke();
  ctx.restore();
}

function drawGuideBeam(
  context: RenderContext,
  state: GameState,
  passenger: Passenger,
  age: number,
  index: number,
): void {
  if (age < 0 || age >= GUIDE_EFFECT_LIFE) return;
  const { ctx } = context;
  const progress = clamp(age / 0.32, 0, 1);
  const eased = 1 - (1 - progress) ** 3;
  const facing = normalize(state.player.facing, { x: 0, y: -1 });
  const start = {
    x: state.player.position.x + facing.x * (state.player.radius + 5),
    y: state.player.position.y + facing.y * (state.player.radius + 5),
  };
  const head = {
    x: start.x + (passenger.position.x - start.x) * eased,
    y: start.y + (passenger.position.y - start.y) * eased,
  };
  const side = index % 2 === 0 ? 1 : -1;
  ctx.save();
  ctx.globalAlpha = clamp(0.72 * (1 - age / GUIDE_EFFECT_LIFE), 0, 0.72);
  ctx.strokeStyle = TIDELINE_TOKENS.color.safe;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(head.x, head.y);
  ctx.stroke();
  ctx.fillStyle = TIDELINE_TOKENS.color.gold;
  ctx.beginPath();
  ctx.arc(
    head.x + side * Math.sin(age * 16 + index) * 2,
    head.y - 2,
    2.4 + (1 - eased) * 1.6,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

function drawGuideEffect(context: RenderContext, passenger: Passenger, age: number): void {
  const { ctx } = context;
  const life = GUIDE_EFFECT_LIFE;
  const alpha = clamp(1 - age / life, 0, 1);
  if (alpha <= 0) return;
  const progress = clamp(age / life, 0, 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = TIDELINE_TOKENS.color.safe;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(passenger.position.x, passenger.position.y, passenger.radius + 8 + progress * 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = TIDELINE_TOKENS.color.gold;
  for (let index = 0; index < 3; index += 1) {
    const angle = index * (Math.PI * 2 / 3) + age * 4;
    const distance = passenger.radius + 10 + progress * 10;
    ctx.beginPath();
    ctx.arc(
      passenger.position.x + Math.cos(angle) * distance,
      passenger.position.y + Math.sin(angle) * distance,
      1.6,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawCollisionFlash(context: RenderContext, state: GameState, age: number): void {
  const { ctx } = context;
  const alpha = clamp(0.25 - age * 0.45, 0, 0.25);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = TIDELINE_TOKENS.color.warning;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(state.player.position.x, state.player.position.y, state.player.radius + 12 + age * 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSafeZonePulse(context: RenderContext, level: LevelConfig, state: GameState): void {
  const door = level.doors.find((item) => item.id === state.player.selectedDoorId);
  if (!door || !state.player.inSafeZone) return;
  const { ctx } = context;
  const pulse = 1 + (Math.sin(state.elapsed * 5) + 1) * 0.08;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = TIDELINE_TOKENS.color.safe;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(
    door.safeZone.x - pulse,
    door.safeZone.y - pulse,
    door.safeZone.width + pulse * 2,
    door.safeZone.height + pulse * 2,
  );
  ctx.stroke();
  ctx.restore();
}

export function renderEffects(
  renderContext: RenderContext,
  level: LevelConfig,
  state: GameState,
): void {
  renderContext.withWorld(() => {
    drawSafeZonePulse(renderContext, level, state);
    for (const event of state.events) {
      const age = eventAge(state.elapsed, event.at);
      if (event.type === 'guide' && event.detail) {
        drawGuideWave(renderContext, state, age);
        for (const [index, id] of event.detail.split(',').filter(Boolean).entries()) {
          const passenger = findPassenger(state, id);
          if (passenger) {
            drawGuideBeam(renderContext, state, passenger, age, index);
            drawGuideEffect(renderContext, passenger, age);
          }
        }
      } else if (event.type === 'collision') {
        drawCollisionFlash(renderContext, state, age);
      }
    }
  });

  if (state.phase === 'warning') {
    const { ctx, layout } = renderContext;
    const warningAlpha = 0.08 + (Math.sin(state.elapsed * 10) + 1) * 0.04;
    renderContext.withScreen(() => {
      ctx.globalAlpha = warningAlpha;
      ctx.fillStyle = TIDELINE_TOKENS.color.warning;
      ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    });
  }
}
