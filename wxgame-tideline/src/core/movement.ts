import type { Rect, Vec2 } from './types.ts';
import { add, clampPointToRect, normalize, scale, vec } from './vector.ts';

export interface MovementResult {
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
}

/** 无平台依赖的圆形角色移动与边界约束。 */
export function moveWithinBounds(
  position: Vec2,
  direction: Vec2,
  dt: number,
  speed: number,
  bounds: Rect,
  radius: number,
  previousFacing: Vec2 = { x: 0, y: -1 },
): MovementResult {
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const safeDirection =
    Number.isFinite(direction?.x) && Number.isFinite(direction?.y) ? direction : vec();
  const hasInput = Math.abs(safeDirection.x) > 1e-8 || Math.abs(safeDirection.y) > 1e-8;
  if (!hasInput) return { position: clampPointToRect(position, bounds, radius), velocity: vec(), facing: normalize(previousFacing) };
  const facing = normalize(safeDirection, previousFacing);
  const velocity = scale(facing, Math.max(0, speed));
  return {
    position: clampPointToRect(add(position, scale(velocity, safeDt)), bounds, radius),
    velocity,
    facing,
  };
}

export const movePlayerWithinBounds = moveWithinBounds;
