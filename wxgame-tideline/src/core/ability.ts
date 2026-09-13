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
  horn = false,
): GuideResult {
  const empty: GuideResult = { used: false, affectedPassengerIds: [] };
  if (!ACTIVE_PHASES.has(state.phase)) return { ...empty, reason: 'phase' };
  if (!horn && state.player.abilityCooldown > 1e-8) return { ...empty, reason: 'cooldown' };
  if (!horn && state.player.stamina + 1e-8 < level.guide.cost) return { ...empty, reason: 'stamina' };

  const facing = normalize(state.player.facing, { x: 0, y: -1 });
  const candidates = guideTargets(state, level, horn);

  if (candidates.length === 0) return { ...empty, reason: 'no-target' };

  const side = perpendicular(facing);
  const affectedPassengerIds: string[] = [];
  candidates.forEach((passenger, index) => {
    const door = level.doors.find((item) => item.id === passenger.desiredDoorId) ?? level.doors[0];
    const sign = index % 2 === 0 ? 1 : -1;
    const offset = scale(side, sign * level.guide.sideOffset * (horn ? 1.5 : 1));
    const beforeDoorDistance = door ? Math.abs(passenger.position.x - door.center.x) : 0;
    const afterDoorDistance = door ? Math.abs(passenger.position.x + offset.x - door.center.x) : beforeDoorDistance;
    const advancesFlow = afterDoorDistance < beforeDoorDistance - 0.5;
    const before = passenger.position;
    passenger.position = add(before, offset);
    if (horn) {
      // 侧移不能将乘客从封闭车门或车体直接送到另一侧。
      const threshold = level.doors[0]?.center.y ?? 0;
      if ((before.y < threshold) !== (passenger.position.y < threshold)) {
        const passage = level.doors.some((entry) => {
          const runtime = state.doors.find((doorState) => doorState.id === entry.id);
          const half = Math.max(0, entry.width / 2 - passenger.radius);
          return runtime?.open && !runtime.blocked
            && Math.abs(before.x - entry.center.x) <= half
            && Math.abs(passenger.position.x - entry.center.x) <= half;
        });
        if (!passage) passenger.position.y = before.y;
      }
    }
    passenger.target = add(passenger.target, offset);
    passenger.guidedUntil = now + (horn ? 0.5 : Math.max(0, level.guide.effectDuration));
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

  if (!horn) {
    state.player.stamina = clamp(state.player.stamina - level.guide.cost, 0, state.player.maxStamina);
    state.player.abilityCooldown = GUIDE_COOLDOWN;
    state.metrics.staminaSpent += level.guide.cost;
  }
  state.player.guideUses += 1;
  state.metrics.guideUses += 1;
  state.events.push({ type: horn ? 'item-horn' : 'guide', at: now, detail: affectedPassengerIds.join(',') });

  return { used: true, affectedPassengerIds };
}

export function guideTargets(state: GameState, level: LevelConfig, horn = false): Passenger[] {
  const facing = normalize(state.player.facing, { x: 0, y: -1 });
  return activePassengers(state.passengers)
    .map((passenger) => ({ passenger, distance: distance(passenger.position, state.player.position),
      front: dot(normalize(sub(passenger.position, state.player.position), facing), facing) >= level.guide.coneDot }))
    .filter((entry) => entry.front && entry.distance <= level.guide.range * (horn ? 1.25 : 1))
    .sort((a, b) => a.distance - b.distance || a.passenger.id.localeCompare(b.passenger.id))
    .slice(0, horn ? 4 : Math.min(GUIDE_MAX_TARGETS, Math.max(0, Math.floor(level.guide.maxTargets))))
    .map((entry) => entry.passenger);
}

export const useGuide = useGuideAbility;
