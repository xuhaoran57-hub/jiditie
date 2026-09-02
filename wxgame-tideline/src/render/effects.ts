import type { GameState, LevelConfig, Passenger } from '../core/types.ts';
import { clamp } from '../core/vector.ts';
import { RenderContext } from './context.ts';
import { TIDELINE_TOKENS } from './design-tokens.ts';

function eventAge(now: number, at: number): number {
  return Math.max(0, now - at);
}

function findPassenger(state: GameState, id: string): Passenger | undefined {
  return state.passengers.find((passenger) => passenger.id === id);
}

function drawGuideEffect(context: RenderContext, passenger: Passenger, age: number): void {
  const { ctx } = context;
  const life = 0.55;
  const alpha = clamp(1 - age / life, 0, 1);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = TIDELINE_TOKENS.color.safe;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(passenger.position.x, passenger.position.y, passenger.radius + 8 + age * 14, 0, Math.PI * 2);
  ctx.stroke();
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
        for (const id of event.detail.split(',').filter(Boolean)) {
          const passenger = findPassenger(state, id);
          if (passenger) drawGuideEffect(renderContext, passenger, age);
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
