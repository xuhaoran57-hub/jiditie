import type {
  CollisionActor,
  DoorConfig,
  DoorState,
  LevelConfig,
  Passenger,
  PassengerKind,
  PassengerRole,
  PassengerUpdateContext,
  PassengerUpdateResult,
  Rect,
  Vec2,
} from './types.ts';
import { PASSENGER_KINDS } from './types.ts';
import type { RandomSource } from './rng.ts';
import {
  add,
  clamp,
  clampPointToRect,
  distance,
  dot,
  finiteVec,
  length,
  moveTowards,
  scale,
  sub,
  vec,
} from './vector.ts';

// 上车是一个短暂的过渡状态，速度略高于站台排队速度，避免整段关门倒计时
// 都消耗在“走到门口”上；数值不影响容量和安全区判定。
const BOARDING_SPEED_MULTIPLIER = 1.8;
const TRAIN_INTERIOR_TOP_OFFSET = 108;
const TRAIN_INTERIOR_ROW_GAP = 16;

/** 均匀网格，用于碰撞 broad-phase；规则层不依赖渲染坐标系。 */
export class SpatialHash<T extends { position: Vec2 }> {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, T[]>();

  constructor(cellSize = 32) {
    this.cellSize = Math.max(1, cellSize);
  }

  clear(): void {
    this.buckets.clear();
  }

  insert(item: T): void {
    const key = this.key(item.position);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(item);
    else this.buckets.set(key, [item]);
  }

  queryCircle(center: Vec2, radius: number): T[] {
    const result: T[] = [];
    const minX = Math.floor((center.x - radius) / this.cellSize);
    const maxX = Math.floor((center.x + radius) / this.cellSize);
    const minY = Math.floor((center.y - radius) / this.cellSize);
    const maxY = Math.floor((center.y + radius) / this.cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const bucket = this.buckets.get(`${x}:${y}`);
        if (bucket) result.push(...bucket);
      }
    }
    return result;
  }

  get size(): number {
    let count = 0;
    for (const bucket of this.buckets.values()) count += bucket.length;
    return count;
  }

  private key(position: Vec2): string {
    return `${Math.floor(position.x / this.cellSize)}:${Math.floor(position.y / this.cellSize)}`;
  }
}

function deterministicNormal(a: string, b: string): Vec2 {
  let hash = 0;
  const text = `${a}|${b}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  const angle = ((hash >>> 0) % 360) * (Math.PI / 180);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * 迭代式圆形碰撞分离。weight 越大，角色被推开的距离越小；movable=false
 * 可用于把场景障碍当作静态角色。返回检测到的碰撞对数量。
 */
export function resolveCollisions(
  actors: CollisionActor[],
  iterations = 4,
  cellSize = 36,
): number {
  const hash = new SpatialHash<CollisionActor>(cellSize);
  const collisionPairs = new Set<string>();
  const rounds = Math.max(1, Math.floor(iterations));

  for (let round = 0; round < rounds; round += 1) {
    hash.clear();
    for (const actor of actors) {
      actor.position = finiteVec(actor.position);
      actor.radius = Number.isFinite(actor.radius) ? Math.max(0, actor.radius) : 0;
      actor.weight = Number.isFinite(actor.weight) ? Math.max(0.01, actor.weight) : 1;
      hash.insert(actor);
    }
    const maxRadius = actors.reduce((max, actor) => Math.max(max, actor.radius), 0);

    for (const actor of actors) {
      const candidates = hash.queryCircle(actor.position, actor.radius + maxRadius + 1);
      for (const other of candidates) {
        if (actor.id >= other.id) continue;
        const delta = sub(actor.position, other.position);
        const actualDistance = length(delta);
        const minimumDistance = Math.max(0, actor.radius) + Math.max(0, other.radius);
        if (actualDistance >= minimumDistance - 1e-7) continue;

        collisionPairs.add(`${actor.id}|${other.id}`);
        const normal =
          actualDistance > 1e-7 ? scale(delta, 1 / actualDistance) : deterministicNormal(actor.id, other.id);
        const overlap = Math.max(0.001, minimumDistance - actualDistance);
        const inverseA = actor.movable === false ? 0 : 1 / Math.max(0.01, actor.weight);
        const inverseB = other.movable === false ? 0 : 1 / Math.max(0.01, other.weight);
        const inverseTotal = inverseA + inverseB;
        if (inverseTotal <= 0) continue;

        const moveA = (overlap * inverseA) / inverseTotal;
        const moveB = (overlap * inverseB) / inverseTotal;
        actor.position = add(actor.position, scale(normal, moveA));
        other.position = sub(other.position, scale(normal, moveB));

        // 只消除朝向碰撞法线的速度分量，避免角色被分离后无限抖动。
        const relative = sub(actor.velocity, other.velocity);
        const normalSpeed = dot(relative, normal);
        if (normalSpeed < 0) {
          const impulse = normalSpeed * 0.35;
          if (actor.movable !== false) actor.velocity = sub(actor.velocity, scale(normal, impulse));
          if (other.movable !== false) other.velocity = add(other.velocity, scale(normal, impulse));
        }
      }
    }
  }
  return collisionPairs.size;
}

function profile(kind: PassengerKind): { speed: number; radius: number; weight: number; emotion: Passenger['emotion'] } {
  switch (kind) {
    case 'fast':
      return { speed: 1.35, radius: 10, weight: 0.9, emotion: 'hurried' };
    case 'slow':
      return { speed: 0.68, radius: 12, weight: 1.1, emotion: 'hesitant' };
    case 'luggage':
      return { speed: 0.78, radius: 15, weight: 1.8, emotion: 'calm' };
    case 'phone':
      return { speed: 0.92, radius: 10, weight: 0.85, emotion: 'hesitant' };
    case 'group':
      return { speed: 0.86, radius: 12, weight: 1.25, emotion: 'calm' };
    default:
      return { speed: 1, radius: 11, weight: 1, emotion: 'calm' };
  }
}

function weightedKind(weights: Partial<Record<PassengerKind, number>>, random: RandomSource): PassengerKind {
  const entries = PASSENGER_KINDS
    .map((kind) => ({ kind, weight: Math.max(0, weights[kind] ?? 0) }))
    .filter((entry) => entry.weight > 0);
  if (entries.length === 0) return 'regular';
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random.next() * total;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.kind;
  }
  return entries[entries.length - 1]!.kind;
}

function randomPoint(bounds: Rect, padding: number, random: RandomSource, yMin = bounds.y, yMax = bounds.y + bounds.height): Vec2 {
  const rawMinX = bounds.x + Math.max(0, padding);
  const rawMaxX = bounds.x + bounds.width - Math.max(0, padding);
  const rawMinY = Math.max(bounds.y + Math.max(0, padding), yMin);
  const rawMaxY = Math.min(bounds.y + bounds.height - Math.max(0, padding), yMax);
  const minX = Math.min(rawMinX, rawMaxX);
  const maxX = Math.max(rawMinX, rawMaxX);
  const minY = Math.min(rawMinY, rawMaxY);
  const maxY = Math.max(rawMinY, rawMaxY);
  return {
    x: minX + (maxX - minX) * random.next(),
    y: minY + (maxY - minY) * random.next(),
  };
}

function spawnWithoutOverlap(
  bounds: Rect,
  padding: number,
  random: RandomSource,
  existing: Vec2[],
  minDistance: number,
  yMin = bounds.y,
  yMax = bounds.y + bounds.height,
): Vec2 {
  let candidate = randomPoint(bounds, padding, random, yMin, yMax);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    if (existing.every((point) => distance(point, candidate) >= minDistance)) return candidate;
    candidate = randomPoint(bounds, padding, random, yMin, yMax);
  }
  return candidate;
}

function chooseDoor(doors: DoorConfig[], random: RandomSource, preferred?: string): DoorConfig {
  if (doors.length === 0) throw new Error('a level must contain at least one door');
  if (preferred && random.next() < 0.55) {
    const found = doors.find((item) => item.id === preferred);
    if (found) return found;
  }
  return doors[random.int(0, doors.length - 1)]!;
}

/** 根据关卡配置和种子生成初始人群。生成顺序是回放协议的一部分。 */
export function createPassengers(level: LevelConfig, random: RandomSource): Passenger[] {
  const count = Math.max(0, Math.floor(level.passenger.count));
  const alightingCount = clamp(Math.floor(level.passenger.alightingCount), 0, count);
  const passengers: Passenger[] = [];
  const occupied: Vec2[] = [];
  const train = level.trainBounds;
  const platform = level.platformBounds;

  for (let index = 0; index < count; index += 1) {
    const isAlighting = index < alightingCount;
    const kind = weightedKind(level.passenger.kindWeights, random);
    const style = profile(kind);
    const selectedDoor = chooseDoor(level.doors, random, level.recommendedDoorId);
    const position = isAlighting
      ? spawnWithoutOverlap(
          train,
          level.passenger.spawnPadding / 2,
          random,
          occupied,
          style.radius * 2.1,
          train.y + style.radius,
          train.y + train.height - style.radius,
        )
      : spawnWithoutOverlap(
          platform,
          level.passenger.spawnPadding,
          random,
          occupied,
          style.radius * 2.1,
          platform.y + platform.height * 0.52,
          platform.y + platform.height - level.passenger.spawnPadding,
        );
    occupied.push(position);
    const groupId = kind === 'group' ? `group-${Math.floor(index / 2)}` : undefined;
    const target = isAlighting
      ? { x: selectedDoor.center.x, y: platform.y + 26 }
      : { x: selectedDoor.center.x, y: platform.y + 26 };
    passengers.push({
      id: `passenger-${String(index + 1).padStart(3, '0')}`,
      kind,
      role: isAlighting ? 'alighting' : 'waiting',
      emotion: style.emotion,
      position,
      velocity: vec(),
      target,
      radius: style.radius,
      weight: style.weight,
      speed: level.passenger.baseSpeed * style.speed,
      desiredDoorId: selectedDoor.id,
      routeProgress: 0,
      guidedUntil: 0,
      ...(groupId ? { groupId } : {}),
    });
  }
  return passengers;
}

function doorStateById(states: DoorState[], id: string): DoorState | undefined {
  return states.find((state) => state.id === id);
}

function doorConfigById(doors: DoorConfig[], id: string): DoorConfig | undefined {
  return doors.find((door) => door.id === id);
}

function advancePassenger(passenger: Passenger, target: Vec2, distanceAllowed: number, dt: number): void {
  const previous = passenger.position;
  const next = moveTowards(previous, target, distanceAllowed);
  passenger.position = finiteVec(next, previous);
  passenger.velocity = dt > 0 ? scale(sub(passenger.position, previous), 1 / dt) : vec();
  if (distance(passenger.position, target) < 0.001) passenger.velocity = vec();
}

/** 将圆形角色从内容事件暂时占用的矩形区域推出。 */
export function keepOutsideRect(position: Vec2, radius: number, zone: Rect): Vec2 {
  const safeRadius = Math.max(0, Number.isFinite(radius) ? radius : 0);
  const left = Math.min(zone.x, zone.x + zone.width) - safeRadius;
  const right = Math.max(zone.x, zone.x + zone.width) + safeRadius;
  const top = Math.min(zone.y, zone.y + zone.height) - safeRadius;
  const bottom = Math.max(zone.y, zone.y + zone.height) + safeRadius;
  if (position.x < left || position.x > right || position.y < top || position.y > bottom) return position;

  const distances = [
    { side: 'left', value: Math.abs(position.x - left) },
    { side: 'right', value: Math.abs(right - position.x) },
    { side: 'top', value: Math.abs(position.y - top) },
    { side: 'bottom', value: Math.abs(bottom - position.y) },
  ] as const;
  const nearest = distances.reduce(
    (best, item) => (item.value < best.value ? item : best),
    distances[0]!,
  );
  switch (nearest.side) {
    case 'left':
      return { x: left - 0.01, y: position.y };
    case 'right':
      return { x: right + 0.01, y: position.y };
    case 'top':
      return { x: position.x, y: top - 0.01 };
    default:
      return { x: position.x, y: bottom + 0.01 };
  }
}

export function keepOutsideRects(position: Vec2, radius: number, zones: readonly Rect[]): Vec2 {
  let next = position;
  for (const zone of zones) next = keepOutsideRect(next, radius, zone);
  return next;
}

function enterTrainPoint(train: Rect, door: DoorConfig, index: number): Vec2 {
  // 车内目标避开窗带和 HUD 覆盖区，落在门洞后方的地板上。
  // 目标以所选车门为中心，先直穿门洞，再在车内形成三列小队。
  const laneOffset = ((index % 3) - 1) * 18;
  const x = clamp(door.center.x + laneOffset, train.x + 16, train.x + train.width - 16);
  const interiorTop = train.y + Math.max(24, Math.min(train.height - 24, TRAIN_INTERIOR_TOP_OFFSET));
  const y = interiorTop + Math.floor(index / 3) * TRAIN_INTERIOR_ROW_GAP;
  return clampPointToRect({ x, y }, train, 14);
}

function isDoorApproach(position: Vec2, radius: number, door: DoorConfig): boolean {
  // 将站台安全区向门口延伸一小段，避免玩家站在安全区时把排队角色
  // 推回去；真正的容量、开门和阻塞判定仍在 updatePassengers 中执行。
  const padding = Math.max(8, radius * 1.5);
  const left = door.center.x - door.width / 2 - padding;
  const right = door.center.x + door.width / 2 + padding;
  const top = Math.min(door.entryZone.y, door.safeZone.y);
  const bottom = Math.max(
    door.entryZone.y + door.entryZone.height,
    door.safeZone.y + door.safeZone.height + padding,
  );
  return position.x >= left && position.x <= right && position.y >= top && position.y <= bottom;
}

/** 更新非玩家人群，并处理下车航点、上车容量和角色状态。 */
export function updatePassengers(
  passengers: Passenger[],
  context: PassengerUpdateContext,
): PassengerUpdateResult {
  const dt = Math.max(0, Number.isFinite(context.dt) ? context.dt : 0);
  const walkableBounds = context.walkableBounds ?? context.platformBounds;
  const blockedZones = context.blockedZones ?? [];
  let boarded = 0;
  let alightingExited = 0;
  let blockedAttempts = 0;
  const doorIndex = new Map<string, number>();
  for (let index = 0; index < context.doors.length; index += 1) {
    const configuredDoor = context.doors[index];
    if (configuredDoor) doorIndex.set(configuredDoor.id, index);
  }

  for (const passenger of passengers) {
    passenger.position = finiteVec(passenger.position);
    passenger.target = finiteVec(passenger.target, passenger.position);
    passenger.radius = Number.isFinite(passenger.radius) ? Math.max(0, passenger.radius) : 0;
    passenger.weight = Number.isFinite(passenger.weight) ? Math.max(0.01, passenger.weight) : 1;
    passenger.speed = Number.isFinite(passenger.speed) ? Math.max(0, passenger.speed) : 0;
    if (passenger.role !== 'exited' && passenger.role !== 'inside') {
      passenger.position = keepOutsideRects(passenger.position, passenger.radius, blockedZones);
    }
    if (passenger.role === 'exited' || passenger.role === 'inside') {
      passenger.velocity = vec();
      continue;
    }
    const door = doorConfigById(context.doors, passenger.desiredDoorId) ?? context.doors[0];
    if (!door) continue;

    if (passenger.role === 'alighting') {
      if (!context.alightingOpen) {
        passenger.velocity = vec();
        continue;
      }
      if (passenger.routeProgress < 1) {
        passenger.target = {
          x: clamp(door.center.x, walkableBounds.x + passenger.radius, walkableBounds.x + walkableBounds.width - passenger.radius),
          y: walkableBounds.y + 26,
        };
        advancePassenger(passenger, passenger.target, passenger.speed * dt, dt);
        passenger.position = keepOutsideRects(passenger.position, passenger.radius, blockedZones);
        if (distance(passenger.position, passenger.target) <= passenger.radius + 5) {
          passenger.routeProgress = 1;
          passenger.target = {
            x: clamp(door.center.x, walkableBounds.x + passenger.radius, walkableBounds.x + walkableBounds.width - passenger.radius),
            y: context.platformBounds.y + context.platformBounds.height + passenger.radius + 18,
          };
        }
      } else {
        advancePassenger(passenger, passenger.target, passenger.speed * dt, dt);
        if (
          passenger.position.y >= context.platformBounds.y + context.platformBounds.height - passenger.radius ||
          distance(passenger.position, passenger.target) <= 0.001
        ) {
          passenger.role = 'exited';
          passenger.velocity = vec();
          alightingExited += 1;
        }
      }
      continue;
    }

    if (passenger.role === 'waiting') {
      if (!context.boardingOpen) {
        passenger.velocity = vec();
        // 等待时仍可在站台内做很小的避让，但不穿过门线。
        passenger.position = clampPointToRect(passenger.position, walkableBounds, passenger.radius);
        passenger.position = keepOutsideRects(passenger.position, passenger.radius, blockedZones);
        continue;
      }
      passenger.target = {
        x: clamp(door.center.x, walkableBounds.x + passenger.radius, walkableBounds.x + walkableBounds.width - passenger.radius),
        y: walkableBounds.y + 24,
      };
      const insideEntry = isDoorApproach(passenger.position, passenger.radius, door);
      const state = doorStateById(context.doorStates, door.id);
      const totalOccupancy = context.doorStates.reduce((sum, item) => sum + item.occupancy, 0);
      if (insideEntry && state && state.open && !state.blocked && totalOccupancy < context.carriageCapacity) {
        passenger.role = 'boarding';
        passenger.doorId = door.id;
        // 预约成功即跨过门槛内沿，随后再沿车内航点移动；这样“上车”不会
        // 视觉上停留在站台等候区，也不会被门槛碰撞卡住。
        passenger.position = {
          x: door.center.x,
          y: Math.min(passenger.position.y, door.center.y - Math.max(2, passenger.radius * 0.45)),
        };
        passenger.target = enterTrainPoint(context.trainBounds, door, state.occupancy);
        state.occupancy += 1; // 先预留座位，避免同一帧多个角色超卖容量。
        boarded += 1;
      } else {
        if (insideEntry && context.boardingOpen) blockedAttempts += 1;
        advancePassenger(passenger, passenger.target, passenger.speed * dt, dt);
        passenger.position = clampPointToRect(passenger.position, walkableBounds, passenger.radius);
        passenger.position = keepOutsideRects(passenger.position, passenger.radius, blockedZones);
      }
      continue;
    }

    if (passenger.role === 'boarding') {
      const index = doorIndex.get(passenger.doorId ?? door.id) ?? 0;
      const boardingDoor = doorConfigById(context.doors, passenger.doorId ?? door.id) ?? door;
      // target 已在转为 boarding 时固定；缺失时重新生成一个确定位置。
      if (!Number.isFinite(passenger.target.x) || !Number.isFinite(passenger.target.y)) {
        passenger.target = enterTrainPoint(context.trainBounds, boardingDoor, index);
      }
      advancePassenger(
        passenger,
        passenger.target,
        passenger.speed * BOARDING_SPEED_MULTIPLIER * dt,
        dt,
      );
      if (distance(passenger.position, passenger.target) <= 0.001) {
        passenger.role = 'inside';
        passenger.velocity = vec();
      }
    }
  }

  return { boarded, alightingExited, collisionCount: 0, blockedAttempts };
}

export function activePassengers(passengers: readonly Passenger[]): Passenger[] {
  return passengers.filter((passenger) => passenger.role !== 'exited' && passenger.role !== 'inside');
}

export function passengerRoleCount(passengers: readonly Passenger[], role: PassengerRole): number {
  return passengers.reduce((count, passenger) => count + (passenger.role === role ? 1 : 0), 0);
}
