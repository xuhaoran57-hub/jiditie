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

// 上车路线包含“走到门口”和“穿过门洞”两个连续阶段，适度加速避免整段
// 关门倒计时都消耗在接近门口上；数值不改变容量规则。
// 原作的人流会以稳定步速向门口汇聚，而不是瞬间冲刺；保留快步类型的
// 速度差异，但把整体速度压到能观察、绕行和制造空隙的范围。
const BOARDING_SPEED_MULTIPLIER = 1.35;
// 下车客和上车客统一使用 1.35 倍步速，开门后保持同一节奏交汇，
// 让门口拥挤来自真实的两股人流，而不是某一侧突然冲刺。
const ALIGHTING_SPEED_MULTIPLIER = 1.35;
const TRAIN_INTERIOR_TOP_OFFSET = 108;
// 车厢加高只扩展门线以上的空间；上车角色仍应在门后较近的地板区域就位，
// 避免目标点随车厢顶部一起后移，导致倒计时内走不完。
const TRAIN_INTERIOR_MAX_DEPTH = 132;
const TRAIN_INTERIOR_ROW_GAP = 16;
const TRAIN_ALIGHTING_DOOR_PADDING = 26;

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
  onCollision?: (first: CollisionActor, second: CollisionActor) => void,
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
        // 门前排队的 NPC 不应彼此重新堆成墙，但仍要和玩家发生碰撞，
        // 这样后方人流可以继续给玩家提供真实的前后推挤反馈。
        if (
          actor.id !== 'player'
          && other.id !== 'player'
          && (actor.playerOnly || other.playerOnly)
        ) continue;
        const delta = sub(actor.position, other.position);
        const actualDistance = length(delta);
        const minimumDistance = Math.max(0, actor.radius) + Math.max(0, other.radius);
        if (actualDistance >= minimumDistance - 1e-7) continue;

        const pairKey = `${actor.id}|${other.id}`;
        if (!collisionPairs.has(pairKey)) {
          collisionPairs.add(pairKey);
          onCollision?.(actor, other);
        }
        const normal =
          actualDistance > 1e-7 ? scale(delta, 1 / actualDistance) : deterministicNormal(actor.id, other.id);
        const overlap = Math.max(0.001, minimumDistance - actualDistance);
        const playerOnlyPair =
          (actor.id === 'player' && other.playerOnly)
          || (other.id === 'player' && actor.playerOnly);
        // 门前 NPC 与玩家碰撞时只移动玩家；NPC 自身保持排队航线，
        // 这样它仍能推挤玩家，但不会因为玩家站在安全区而无法切换 boarding。
        const inverseA = playerOnlyPair && actor.id !== 'player'
          ? 0
          : actor.movable === false ? 0 : 1 / Math.max(0.01, actor.weight);
        const inverseB = playerOnlyPair && other.id !== 'player'
          ? 0
          : other.movable === false ? 0 : 1 / Math.max(0.01, other.weight);
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
          // 降低碰撞后的反向回弹，避免连续帧在同一对角色之间左右震荡。
          // 门前 waiting NPC 仍需推挤玩家，但不应把较慢的玩家锁死在门线外。
          // 只降低玩家-NPC 的反向回弹，NPC-NPC/其他碰撞保持原有反馈。
          const impulse = normalSpeed * (playerOnlyPair ? 0.2 : 0.55);
          if (playerOnlyPair) {
            if (actor.id === 'player') actor.velocity = sub(actor.velocity, scale(normal, impulse));
            else if (other.id === 'player') other.velocity = add(other.velocity, scale(normal, impulse));
          } else {
            if (actor.movable !== false) actor.velocity = sub(actor.velocity, scale(normal, impulse));
            if (other.movable !== false) other.velocity = add(other.velocity, scale(normal, impulse));
          }
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

function chooseDoor(doors: DoorConfig[], random: RandomSource): DoorConfig {
  if (doors.length === 0) throw new Error('a level must contain at least one door');
  // 双门关卡不再把推荐门当成人流偏置。推荐门只服务于玩家 UI，
  // 乘客每次独立抽取目标门，让左右客流在不同种子下自然变化。
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
    const selectedDoor = chooseDoor(level.doors, random);
    // 下车客从对应车门内侧的窄区域生成，形成开门瞬间的拥挤门口。
    // 多门关卡会按各自目标门分组，避免人流横跨整节车厢。
    const alightingWidth = Math.min(train.width, Math.max(selectedDoor.width * 1.8, 76));
    const alightingBounds: Rect = {
      x: clamp(selectedDoor.center.x - alightingWidth / 2, train.x, train.x + train.width - alightingWidth),
      y: train.y + train.height - 84,
      width: alightingWidth,
      height: 58,
    };
    const position = isAlighting
      ? spawnWithoutOverlap(
          alightingBounds,
          Math.max(level.passenger.spawnPadding / 2, style.radius + 6),
          random,
          occupied,
          style.radius * 2.1,
          // 参考原作，车内乘客集中在靠近门的下半段，而不是散布到车厢顶端。
          // 这样一部分乘客能在窗口内走到站台外侧，剩余乘客会在门口形成阻挡。
          // 下车客集中在车门内侧，开门后立刻形成第一道拥挤层。
          train.y + train.height - 84,
          train.y + train.height - TRAIN_ALIGHTING_DOOR_PADDING,
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
      ? { x: selectedDoor.center.x, y: train.y + TRAIN_ALIGHTING_DOOR_PADDING }
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

/** 行李车等移动障碍使用有限推力，避免进入占用区后瞬移到边缘。 */
export function softPushOutsideRects(
  position: Vec2,
  radius: number,
  zones: readonly Rect[],
  dt: number,
  maxSpeed = 72,
): Vec2 {
  let next = finiteVec(position, vec());
  const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const maxStep = Math.max(0, maxSpeed) * safeDt;
  if (maxStep <= 0) return next;
  for (const zone of zones) {
    const safeRadius = Math.max(0, Number.isFinite(radius) ? radius : 0);
    const left = Math.min(zone.x, zone.x + zone.width) - safeRadius;
    const right = Math.max(zone.x, zone.x + zone.width) + safeRadius;
    const top = Math.min(zone.y, zone.y + zone.height) - safeRadius;
    const bottom = Math.max(zone.y, zone.y + zone.height) + safeRadius;
    if (next.x < left || next.x > right || next.y < top || next.y > bottom) continue;
    const distances = [
      { side: 'left', value: Math.abs(next.x - left) },
      { side: 'right', value: Math.abs(right - next.x) },
      { side: 'top', value: Math.abs(next.y - top) },
      { side: 'bottom', value: Math.abs(bottom - next.y) },
    ] as const;
    const nearest = distances.reduce((best, item) => (item.value < best.value ? item : best), distances[0]!);
    const step = Math.min(maxStep, nearest.value + 0.01);
    if (nearest.side === 'left') next.x -= step;
    else if (nearest.side === 'right') next.x += step;
    else if (nearest.side === 'top') next.y -= step;
    else next.y += step;
  }
  return next;
}

function enterTrainPoint(train: Rect, door: DoorConfig, index: number): Vec2 {
  // 车内目标避开窗带和 HUD 覆盖区，落在门洞后方的地板上。
  // 目标以所选车门为中心，先直穿门洞，再在车内形成三列小队。
  const laneOffset = ((index % 3) - 1) * 18;
  const x = clamp(door.center.x + laneOffset, train.x + 16, train.x + train.width - 16);
  const interiorOffset = Math.max(24, Math.min(train.height - 24, TRAIN_INTERIOR_TOP_OFFSET));
  const topBasedY = train.y + interiorOffset;
  const depthLimitedY = train.y + train.height - TRAIN_INTERIOR_MAX_DEPTH;
  const interiorY = Math.max(topBasedY, depthLimitedY);
  const y = interiorY + Math.floor(index / 3) * TRAIN_INTERIOR_ROW_GAP;
  return clampPointToRect({ x, y }, train, 14);
}

function hasReachedBoardingPoint(passenger: Passenger, door: DoorConfig): boolean {
  // 候车区只是排队/疏导区域；必须走到门前航点，才允许切换成 boarding。
  // 切换时保留当前位置，后续再连续穿过门洞，避免瞬移到车内。
  const tolerance = Math.max(3, passenger.radius * 0.55);
  const halfWidth = Math.max(0, door.width / 2 - passenger.radius * 0.4);
  return Math.abs(passenger.position.x - door.center.x) <= halfWidth
    && distance(passenger.position, passenger.target) <= tolerance;
}

/** 更新非玩家人群，并处理下车航点、上车容量和角色状态。 */
export function updatePassengers(
  passengers: Passenger[],
  context: PassengerUpdateContext,
): PassengerUpdateResult {
  const dt = Math.max(0, Number.isFinite(context.dt) ? context.dt : 0);
  const speedMultiplier = clamp(
    Number.isFinite(context.speedMultiplier) ? context.speedMultiplier ?? 1 : 1,
    0.5,
    1.8,
  );
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
    const moveSpeed = passenger.speed * speedMultiplier;
    if (passenger.role !== 'exited' && passenger.role !== 'inside') {
      passenger.position = softPushOutsideRects(passenger.position, passenger.radius, blockedZones, dt);
    }
    // 提前关门时，已经预留旧门车位但尚未完全进车的 NPC 也必须撤回，
    // 否则 boarding 分支会继续沿用旧门目标，出现“避让门仍有人上车”。
    if (
      passenger.role === 'boarding'
      && passenger.doorId === context.blockedDoorId
      && context.rerouteDoorId
    ) {
      const reservedDoor = doorStateById(context.doorStates, context.blockedDoorId!);
      if (reservedDoor) reservedDoor.occupancy = Math.max(0, reservedDoor.occupancy - 1);
      passenger.role = 'waiting';
      passenger.doorId = undefined;
      passenger.desiredDoorId = context.rerouteDoorId;
      passenger.target = {
        x: clamp(
          context.doors.find((item) => item.id === context.rerouteDoorId)?.center.x ?? passenger.position.x,
          walkableBounds.x + passenger.radius,
          walkableBounds.x + walkableBounds.width - passenger.radius,
        ),
        y: walkableBounds.y + 24,
      };
      passenger.position = clampPointToRect(passenger.position, walkableBounds, passenger.radius);
      passenger.velocity = vec();
    }
    if (passenger.role === 'exited' || passenger.role === 'inside') {
      passenger.velocity = vec();
      continue;
    }
    const door = doorConfigById(context.doors, passenger.desiredDoorId) ?? context.doors[0];
    if (!door) continue;

    if (passenger.role === 'alighting') {
      const doorState = doorStateById(context.doorStates, door.id);
      // 下车流只能在车门真正打开后开始；在进站、停靠和关门前的阶段，
      // 乘客保持在车厢内部，避免一开局就出现在站台等候区。
      // blocked 门虽然可能仍带有 open 状态，也不能让乘客穿过；渲染层同样
      // 会隐藏这扇门内的角色，规则层和画面保持一致。
      // 尚未越过门槛的下车乘客受原门状态约束；已经越过门洞的角色继续
      // 作为站台下车流向外行走，并保留碰撞影响，直到走出站台边界。
      const stillInsideCarriage = passenger.routeProgress < 1;
      if (stillInsideCarriage && (!context.alightingOpen || !doorState?.open || doorState.blocked)) {
        passenger.velocity = vec();
        continue;
      }
      if (passenger.routeProgress < 1) {
        passenger.target = {
          x: clamp(door.center.x, walkableBounds.x + passenger.radius, walkableBounds.x + walkableBounds.width - passenger.radius),
          y: walkableBounds.y + 26,
        };
        advancePassenger(
          passenger,
          passenger.target,
          moveSpeed * ALIGHTING_SPEED_MULTIPLIER * dt,
          dt,
        );
        passenger.position = softPushOutsideRects(passenger.position, passenger.radius, blockedZones, dt);
        if (distance(passenger.position, passenger.target) <= passenger.radius + 5) {
          // 角色圆心已经越过门洞，立即计为顺利下车；仍保留为 alighting
          // 角色，继续向站台外侧移动并参与碰撞，避免下车流突然消失。
          passenger.routeProgress = 1;
          passenger.target = {
            x: passenger.position.x,
            y: context.platformBounds.y + context.platformBounds.height
              + Math.max(0, context.exitMargin ?? 0) + passenger.radius,
          };
          alightingExited += 1;
        }
      } else {
        advancePassenger(
          passenger,
          passenger.target,
          moveSpeed * ALIGHTING_SPEED_MULTIPLIER * dt,
          dt,
        );
        if (distance(passenger.position, passenger.target) <= 0.001) {
          passenger.role = 'exited';
          passenger.velocity = vec();
        }
      }
      continue;
    }

    if (passenger.role === 'waiting') {
      if (!context.boardingOpen) {
        passenger.velocity = vec();
        // 等待时仍可在站台内做很小的避让，但不穿过门线。
        passenger.position = clampPointToRect(passenger.position, walkableBounds, passenger.radius);
        passenger.position = softPushOutsideRects(passenger.position, passenger.radius, blockedZones, dt);
        continue;
      }
      passenger.target = {
        x: clamp(door.center.x, walkableBounds.x + passenger.radius, walkableBounds.x + walkableBounds.width - passenger.radius),
        y: walkableBounds.y + 24,
      };
      const atBoardingPoint = hasReachedBoardingPoint(passenger, door);
      const state = doorStateById(context.doorStates, door.id);
      const totalOccupancy = context.doorStates.reduce((sum, item) => sum + item.occupancy, 0);
      if (atBoardingPoint && state && state.open && !state.blocked && totalOccupancy < context.carriageCapacity) {
        passenger.role = 'boarding';
        passenger.doorId = door.id;
        // 只预留车位，不改写当前位置；下一帧从门前航点继续走入车厢。
        passenger.target = enterTrainPoint(context.trainBounds, door, state.occupancy);
        state.occupancy += 1; // 先预留座位，避免同一帧多个角色超卖容量。
      } else {
        if (atBoardingPoint && context.boardingOpen) blockedAttempts += 1;
        // 接近门前航点也使用短暂加速，给角色留出完整的“走到门口→穿过门洞→进车厢”时间。
        advancePassenger(passenger, passenger.target, moveSpeed * BOARDING_SPEED_MULTIPLIER * dt, dt);
        passenger.position = clampPointToRect(passenger.position, walkableBounds, passenger.radius);
        passenger.position = softPushOutsideRects(passenger.position, passenger.radius, blockedZones, dt);
      }
      continue;
    }

    if (passenger.role === 'boarding') {
      const index = doorIndex.get(passenger.doorId ?? door.id) ?? 0;
      const boardingDoor = doorConfigById(context.doors, passenger.doorId ?? door.id) ?? door;
      const boardingState = doorStateById(context.doorStates, boardingDoor.id);
      if (!boardingState?.open || boardingState.blocked) {
        // 提前关门事件已经把旧门封闭；没有可用的新门时也要原地暂停，
        // 不能让 boarding 角色绕过门状态继续向车厢内部移动。
        passenger.velocity = vec();
        continue;
      }
      // target 已在转为 boarding 时固定；缺失时重新生成一个确定位置。
      if (!Number.isFinite(passenger.target.x) || !Number.isFinite(passenger.target.y)) {
        passenger.target = enterTrainPoint(context.trainBounds, boardingDoor, index);
      }
      advancePassenger(
        passenger,
        passenger.target,
        moveSpeed * BOARDING_SPEED_MULTIPLIER * dt,
        dt,
      );
      if (distance(passenger.position, passenger.target) <= 0.001) {
        passenger.role = 'inside';
        passenger.velocity = vec();
        boarded += 1;
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
