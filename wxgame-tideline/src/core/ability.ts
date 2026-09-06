import type { GameState, GuideResult, LevelConfig, Passenger } from './types.ts';
import { activePassengers } from './crowd.ts';
import {
  add,
  clamp,
  distance,
  dot,
  normalize,
  perpendicular,
  scale,
  sub,
} from './vector.ts';

const ACTIVE_PHASES = new Set(['positioning', 'exiting', 'boarding', 'warning']);
const GUIDE_MAX_TARGETS = 2;
const GUIDE_COOLDOWN = 1;

function clampGuidedPosition(passenger: Passenger, level: LevelConfig): void {
  const minX = level.platformBounds.x + passenger.radius;
  const maxX = level.platformBounds.x + level.platformBounds.width - passenger.radius;
  const minY = level.trainBounds.y + passenger.radius;
  const maxY = level.platformBounds.y + level.platformBounds.height - passenger.radius;
  passenger.position.x = clamp(passenger.position.x, minX, maxX);
  passenger.position.y = clamp(passenger.position.y, minY, maxY);
}

/**
 * 执行一次“疏导”。目标只取玩家前方扇形内最近的若干角色，并沿侧向偏移，
 * 不造成伤害；实际重叠修复由 crowd.resolveCollisions 在本帧稍后完成。
 */
export function useGuideAbility(
  state: GameState,
  level: LevelConfig,
  now = state.elapsed,
): GuideResult {
  const empty: GuideResult = { used: false, affectedPassengerIds: [] };
  if (!ACTIVE_PHASES.has(state.phase)) return { ...empty, reason: 'phase' };
  if (state.player.abilityCooldown > 1e-8) return { ...empty, reason: 'cooldown' };
  if (state.player.stamina + 1e-8 < level.guide.cost) return { ...empty, reason: 'stamina' };

  const facing = normalize(state.player.facing, { x: 0, y: -1 });
  const candidates = activePassengers(state.passengers)
    .map((passenger) => {
      const offset = sub(passenger.position, state.player.position);
      const distanceToPlayer = distance(passenger.position, state.player.position);
      const direction = normalize(offset, facing);
      return { passenger, distanceToPlayer, front: dot(direction, facing) >= level.guide.coneDot };
    })
    .filter((item) => item.distanceToPlayer <= level.guide.range && item.front)
    .sort((a, b) => a.distanceToPlayer - b.distanceToPlayer || a.passenger.id.localeCompare(b.passenger.id))
    .slice(0, Math.min(GUIDE_MAX_TARGETS, Math.max(0, Math.floor(level.guide.maxTargets))));

  if (candidates.length === 0) return { ...empty, reason: 'no-target' };

  const side = perpendicular(facing);
  const affectedPassengerIds: string[] = [];
  candidates.forEach(({ passenger }, index) => {
    const door = level.doors.find((item) => item.id === passenger.desiredDoorId) ?? level.doors[0];
    const sign = index % 2 === 0 ? 1 : -1;
    const offset = scale(side, sign * level.guide.sideOffset);
    const beforeDoorDistance = door ? Math.abs(passenger.position.x - door.center.x) : 0;
    const afterDoorDistance = door ? Math.abs(passenger.position.x + offset.x - door.center.x) : beforeDoorDistance;
    const advancesFlow = afterDoorDistance < beforeDoorDistance - 0.5;
    passenger.position = add(passenger.position, offset);
    passenger.target = add(passenger.target, offset);
    passenger.guidedUntil = now + Math.max(0, level.guide.effectDuration);
    passenger.emotion = 'relieved';
    clampGuidedPosition(passenger, level);
    affectedPassengerIds.push(passenger.id);
    const baseCourtesy = advancesFlow
      ? (passenger.role === 'alighting' ? 2 : 1)
      : (passenger.role === 'alighting' ? -2 : -1);
    // group 代表老人/儿童同行的敏感人流，主动拨动这类乘客会额外降低礼让值。
    const sensitivePenalty = passenger.kind === 'group' ? -3 : 0;
    state.metrics.courtesyPoints += baseCourtesy + sensitivePenalty;
  });

  state.player.stamina = clamp(state.player.stamina - level.guide.cost, 0, state.player.maxStamina);
  state.player.abilityCooldown = GUIDE_COOLDOWN;
  state.player.guideUses += 1;
  state.metrics.guideUses += 1;
  state.metrics.staminaSpent += level.guide.cost;
  state.events.push({ type: 'guide', at: now, detail: affectedPassengerIds.join(',') });

  return { used: true, affectedPassengerIds };
}

export const useGuide = useGuideAbility;
