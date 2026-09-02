import type { Rect, Vec2 } from './types.ts';

export const EPSILON = 1e-8;

export function vec(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function cloneVec(value: Vec2): Vec2 {
  return { x: value.x, y: value.y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, amount: number): Vec2 {
  return { x: a.x * amount, y: a.y * amount };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function length(a: Vec2): number {
  return Math.sqrt(lengthSq(a));
}

export function normalize(a: Vec2, fallback: Vec2 = { x: 0, y: -1 }): Vec2 {
  const magnitude = length(a);
  if (!Number.isFinite(magnitude) || magnitude < EPSILON) {
    return cloneVec(fallback);
  }
  return { x: a.x / magnitude, y: a.y / magnitude };
}

export function distance(a: Vec2, b: Vec2): number {
  return length(sub(a, b));
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampMagnitude(a: Vec2, maxLength: number): Vec2 {
  const magnitude = length(a);
  if (magnitude <= maxLength || magnitude < EPSILON) return cloneVec(a);
  return scale(a, maxLength / magnitude);
}

export function clampPointToRect(point: Vec2, bounds: Rect, padding = 0): Vec2 {
  const minX = bounds.x + Math.max(0, padding);
  const maxX = bounds.x + bounds.width - Math.max(0, padding);
  const minY = bounds.y + Math.max(0, padding);
  const maxY = bounds.y + bounds.height - Math.max(0, padding);
  const safeMinX = Math.min(minX, maxX);
  const safeMaxX = Math.max(minX, maxX);
  const safeMinY = Math.min(minY, maxY);
  const safeMaxY = Math.max(minY, maxY);
  return {
    x: clamp(point.x, safeMinX, safeMaxX),
    y: clamp(point.y, safeMinY, safeMaxY),
  };
}

export function rectContains(rect: Rect, point: Vec2): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function rectCenter(rect: Rect): Vec2 {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function moveTowards(current: Vec2, target: Vec2, maxDistance: number): Vec2 {
  const delta = sub(target, current);
  const amount = length(delta);
  if (amount <= maxDistance || amount < EPSILON) return cloneVec(target);
  return add(current, scale(delta, maxDistance / amount));
}

export function perpendicular(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

export function finiteVec(value: Vec2 | null | undefined, fallback: Vec2 = { x: 0, y: 0 }): Vec2 {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return cloneVec(fallback);
  return cloneVec(value);
}
