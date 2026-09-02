import { useGuideAbility } from './ability.ts';
import {
  activePassengers,
  createPassengers,
  keepOutsideRects,
  resolveCollisions,
  updatePassengers,
} from './crowd.ts';
import { getLevelConfig } from './levels.ts';
import { PhaseMachine } from './phase-machine.ts';
import type { SeededRandom } from './rng.ts';
import { SeededRandom as SeededRandomImpl } from './rng.ts';
import { calculateScore } from './score.ts';
import type {
  ActiveEvent,
  CollisionActor,
  DoorConfig,
  DoorState,
  GameState,
  GuideResult,
  LevelEventConfig,
  LevelConfig,
  Passenger,
  Rect,
  SimulationInput,
  Vec2,
} from './types.ts';
import {
  add,
  clamp,
  clampPointToRect,
  finiteVec,
  normalize,
  scale,
  vec,
} from './vector.ts';

const STEP_QUANTUM = 1 / 30;
const PLAYABLE_PHASES = new Set(['positioning', 'exiting', 'boarding', 'warning']);

function numericSeed(seed: number | string): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  return new SeededRandomImpl(seed).snapshot();
}

function cloneDoorStates(level: LevelConfig): DoorState[] {
  return level.doors.map((door) => ({ id: door.id, occupancy: 0, open: false, blocked: false }));
}

function initialMetrics(level: LevelConfig) {
  return {
    collisions: 0,
    courtesyPoints: 0,
    alightingTotal: Math.min(level.passenger.alightingCount, level.passenger.count),
    alightingExited: 0,
    boardingTotal: Math.max(0, level.passenger.count - level.passenger.alightingCount),
    boarded: 0,
    guideUses: 0,
    doorSwitches: 0,
    staminaSpent: 0,
    lateBoardingAttempts: 0,
    doorRemainingAtFinish: 0,
  };
}

function copyVec(value: Vec2): Vec2 {
  return { x: value.x, y: value.y };
}

function finiteRect(value: Rect | undefined): Rect | undefined {
  if (!value) return undefined;
  if (![value.x, value.y, value.width, value.height].every(Number.isFinite)) return undefined;
  return {
    x: value.x,
    y: value.y,
    width: Math.max(0, value.width),
    height: Math.max(0, value.height),
  };
}

function findDoor(level: LevelConfig, id: string): DoorConfig | undefined {
  return level.doors.find((door) => door.id === id);
}

function boardingBounds(level: LevelConfig): Rect {
  const left = Math.min(level.platformBounds.x, level.trainBounds.x);
  const top = Math.min(level.platformBounds.y, level.trainBounds.y);
  const right = Math.max(
    level.platformBounds.x + level.platformBounds.width,
    level.trainBounds.x + level.trainBounds.width,
  );
  const bottom = Math.max(
    level.platformBounds.y + level.platformBounds.height,
    level.trainBounds.y + level.trainBounds.height,
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function isInsideRectWithRadius(position: Vec2, bounds: Rect, radius: number): boolean {
  const safeRadius = Math.max(0, Number.isFinite(radius) ? radius : 0);
  return position.x >= bounds.x + safeRadius
    && position.x <= bounds.x + bounds.width - safeRadius
    && position.y >= bounds.y + safeRadius
    && position.y <= bounds.y + bounds.height - safeRadius;
}

function isInDoorPassage(position: Vec2, door: DoorConfig, radius: number): boolean {
  const safeRadius = Math.max(0, Number.isFinite(radius) ? radius : 0);
  const halfWidth = Math.max(0, door.width / 2 - safeRadius * 0.65);
  const top = Math.min(door.entryZone.y, door.safeZone.y) - safeRadius;
  const bottom = Math.max(
    door.entryZone.y + door.entryZone.height,
    door.safeZone.y + door.safeZone.height,
  ) + safeRadius;
  return position.x >= door.center.x - halfWidth
    && position.x <= door.center.x + halfWidth
    && position.y >= top
    && position.y <= bottom;
}

function clampPassenger(passenger: Passenger, level: LevelConfig): void {
  // boarding/alighting 是穿过门槛的过渡状态，必须允许坐标跨过 y=0；旧逻辑先把它
  // 夹进 trainBounds，随后又夹回 platformBounds，结果角色永远卡在门口。
  passenger.position = clampPointToRect(passenger.position, boardingBounds(level), passenger.radius);
  if (passenger.role === 'waiting') {
    passenger.position = clampPointToRect(passenger.position, level.platformBounds, passenger.radius);
  } else if (passenger.role === 'inside') {
    passenger.position = clampPointToRect(passenger.position, level.trainBounds, passenger.radius);
  }
}

function isDoorApproach(passenger: Passenger, level: LevelConfig, states: DoorState[]): boolean {
  if (passenger.role !== 'waiting') return false;
  const door = findDoor(level, passenger.desiredDoorId) ?? level.doors[0];
  if (!door) return false;
  const runtime = states.find((state) => state.id === door.id);
  if (!runtime?.open || runtime.blocked) return false;
  const padding = Math.max(8, passenger.radius * 1.5);
  const left = door.center.x - door.width / 2 - padding;
  const right = door.center.x + door.width / 2 + padding;
  const top = Math.min(door.entryZone.y, door.safeZone.y);
  const bottom = Math.max(
    door.entryZone.y + door.entryZone.height,
    door.safeZone.y + door.safeZone.height + padding,
  );
  return passenger.position.x >= left && passenger.position.x <= right
    && passenger.position.y >= top && passenger.position.y <= bottom;
}

function makeCollisionActors(state: GameState, level: LevelConfig): { actors: CollisionActor[]; passengers: Passenger[] } {
  const actors: CollisionActor[] = [
    {
      id: 'player',
      position: copyVec(state.player.position),
      velocity: copyVec(state.player.velocity),
      radius: state.player.radius,
      weight: 1.5,
      movable: true,
    },
  ];
  // 已经到达门前并预留车位的角色进入单向 boarding 通道，不再和站在
  // 安全区的玩家互相推挤；否则玩家为了完成进车判定会把乘客堵在门口。
  const passengers = activePassengers(state.passengers);
  const collisionPassengers = passengers.filter((passenger) =>
    passenger.role !== 'boarding' && !isDoorApproach(passenger, level, state.doors),
  );
  for (const passenger of collisionPassengers) {
    actors.push({
      id: passenger.id,
      position: copyVec(passenger.position),
      velocity: copyVec(passenger.velocity),
      radius: passenger.radius,
      weight: passenger.weight,
      movable: true,
    });
  }
  return { actors, passengers };
}

export class GameSimulation {
  readonly level: LevelConfig;
  private random: SeededRandom;
  private machine: PhaseMachine;
  private state: GameState;
  private startedEventIds = new Set<string>();

  constructor(level: LevelConfig | string = 'sea-gate', seed: number | string = 1) {
    this.level = typeof level === 'string' ? getLevelConfig(level) : level;
    this.random = new SeededRandomImpl(seed);
    this.machine = new PhaseMachine({
      phaseDurations: this.level.phaseDurations,
      boardingDuration: this.level.boardingDuration,
      warningThreshold: this.level.warningThreshold,
    });
    this.state = this.createInitialState(numericSeed(seed));
  }

  getState(): GameState {
    return this.state;
  }

  snapshot(): GameState {
    return JSON.parse(JSON.stringify(this.state)) as GameState;
  }

  get phase(): GameState['phase'] {
    return this.state.phase;
  }

  selectDoor(doorId: string): boolean {
    if (!findDoor(this.level, doorId) || this.state.phase === 'result') return false;
    if (this.state.player.selectedDoorId !== doorId) {
      this.state.metrics.doorSwitches += 1;
      this.state.events.push({ type: 'door-select', at: this.state.elapsed, detail: doorId });
    }
    this.state.player.selectedDoorId = doorId;
    this.updatePlayerZones();
    return true;
  }

  movePlayer(direction: Vec2, dt: number): void {
    if (this.state.phase === 'result') return;
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const input = finiteVec(direction, vec());
    const normalized = normalize(input, vec());
    if (Math.abs(input.x) < 1e-8 && Math.abs(input.y) < 1e-8) {
      this.state.player.velocity = vec();
      this.state.player.position = this.constrainPlayerPosition(
        this.state.player.position,
        this.state.player.position,
      );
      this.updatePlayerZones();
      return;
    }
    this.state.player.facing = normalized;
    this.state.player.velocity = scale(normalized, this.state.player.speed);
    const previous = copyVec(this.state.player.position);
    const candidate = add(previous, scale(this.state.player.velocity, safeDt));
    this.state.player.position = this.constrainPlayerPosition(candidate, previous);
    this.state.player.position = keepOutsideRects(
      this.state.player.position,
      this.state.player.radius,
      this.blockedZones(),
    );
    this.updatePlayerZones();
  }

  useGuide(): GuideResult {
    return useGuideAbility(this.state, this.level, this.state.elapsed);
  }

  step(dt: number, input: SimulationInput = {}): GameState {
    if (this.state.phase === 'result') return this.state;
    if (!Number.isFinite(dt) || dt <= 0) return this.state;

    if (input.selectDoorId) this.selectDoor(input.selectDoorId);
    if (input.useGuide) this.useGuide();
    this.updateEventState();

    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-8 && !this.machine.isTerminal && guard < 20000) {
      guard += 1;
      const quantum = Math.min(remaining, STEP_QUANTUM);
      this.updateEventState();
      const phaseBefore = this.state.phase;

      this.state.player.abilityCooldown = Math.max(0, this.state.player.abilityCooldown - quantum);
      this.state.player.stamina = clamp(
        this.state.player.stamina + this.level.player.staminaRegen * quantum,
        0,
        this.state.player.maxStamina,
      );

      this.syncDoorStates();
      if (PLAYABLE_PHASES.has(phaseBefore)) this.movePlayer(input.move ?? vec(), quantum);
      else this.state.player.velocity = vec();
      this.updatePlayerZones();

      const crowdResult = updatePassengers(this.state.passengers, {
        dt: quantum,
        now: this.state.elapsed,
        platformBounds: this.level.platformBounds,
        walkableBounds: this.walkableBounds(),
        blockedZones: this.blockedZones(),
        trainBounds: this.level.trainBounds,
        doors: this.level.doors,
        doorStates: this.state.doors,
        carriageCapacity: this.level.carriageCapacity,
        boardingOpen: phaseBefore === 'boarding' || phaseBefore === 'warning',
        alightingOpen:
          phaseBefore === 'exiting' || phaseBefore === 'boarding' || phaseBefore === 'warning',
      });
      this.state.metrics.boarded += crowdResult.boarded;
      this.state.metrics.alightingExited += crowdResult.alightingExited;
      this.state.metrics.lateBoardingAttempts += crowdResult.blockedAttempts;
      if (crowdResult.boarded > 0) this.state.events.push({ type: 'board', at: this.state.elapsed });
      if (crowdResult.alightingExited > 0) this.state.events.push({ type: 'alighting-clear', at: this.state.elapsed });

      this.resolveFrameCollisions();
      this.updatePlayerZones();

      const doorBefore = this.state.doorRemaining;
      if (this.state.player.inCarriage && (phaseBefore === 'boarding' || phaseBefore === 'warning')) {
        // 记录玩家最早进入车厢时还剩多少时间，供效率分使用；不要等到
        // machine 把倒计时归零后才记录，否则所有成功局都会得到同一分数。
        this.state.metrics.doorRemainingAtFinish = Math.max(
          this.state.metrics.doorRemainingAtFinish,
          doorBefore,
        );
      }
      const transitions = this.machine.update(quantum, this.state.player.inCarriage);
      const resultTransition = transitions.find((transition) => transition.to === 'result');
      const consumed = resultTransition
        ? Math.max(0, Math.min(quantum, resultTransition.elapsedInUpdate))
        : quantum;
      this.state.elapsed += consumed;
      this.syncFromMachine();
      this.updateEventState();
      if (resultTransition && (phaseBefore === 'boarding' || phaseBefore === 'warning')) {
        this.state.metrics.doorRemainingAtFinish = Math.max(
          this.state.metrics.doorRemainingAtFinish,
          Math.max(0, doorBefore - consumed),
        );
      }

      for (const transition of transitions) {
        this.state.events.push({
          type: 'phase',
          at: this.state.elapsed,
          detail: `${transition.from}->${transition.to}`,
        });
      }

      if (this.machine.isTerminal) {
        this.state.score = calculateScore(this.state, this.level);
        // 先计算分数再清理事件，保证临时换门在结算瞬间仍影响路线分。
        this.endActiveEvent(false);
        this.state.events.push({ type: this.state.outcome ?? 'failure', at: this.state.elapsed });
        break;
      }

      remaining -= quantum;
      this.state.rngState = this.random.snapshot();
    }
    this.state.rngState = this.random.snapshot();
    return this.state;
  }

  update(dt: number, input: SimulationInput = {}): GameState {
    return this.step(dt, input);
  }

  runUntilResult(maxSeconds = 60, input: SimulationInput = {}): GameState {
    const limit = Math.max(0, Number.isFinite(maxSeconds) ? maxSeconds : 0);
    let elapsed = 0;
    while (this.state.phase !== 'result' && elapsed < limit) {
      const step = Math.min(STEP_QUANTUM, limit - elapsed);
      this.step(step, input);
      elapsed += step;
    }
    return this.state;
  }

  reset(seed: number | string = this.state.seed): GameState {
    this.random = new SeededRandomImpl(seed);
    this.machine.reset();
    this.startedEventIds.clear();
    this.state = this.createInitialState(numericSeed(seed));
    return this.state;
  }

  /** 按 elapsed 触发/结束内容事件；事件本身不改变 PhaseMachine 的时间轴。 */
  private updateEventState(): void {
    const active = this.state.activeEvent;
    if (active) {
      if (this.state.elapsed + 1e-8 >= active.endsAt) {
        this.endActiveEvent();
      } else {
        active.remaining = Math.max(0, active.endsAt - this.state.elapsed);
        return;
      }
    }

    const configured = [...(this.level.events ?? [])].sort((first, second) => {
      const firstAt = Number.isFinite(first.at) ? first.at : 0;
      const secondAt = Number.isFinite(second.at) ? second.at : 0;
      return firstAt - secondAt || first.id.localeCompare(second.id);
    });
    for (const event of configured) {
      if (this.startedEventIds.has(event.id)) continue;
      const at = Number.isFinite(event.at) ? Math.max(0, event.at) : 0;
      const duration = Number.isFinite(event.duration) ? Math.max(0, event.duration) : 0;
      if (duration <= 0) {
        this.startedEventIds.add(event.id);
        this.state.events.push({ type: 'event-skip', at: this.state.elapsed, detail: event.id });
        continue;
      }
      if (this.state.elapsed + 1e-8 < at) break;
      if (this.state.elapsed >= at + duration - 1e-8) {
        this.startedEventIds.add(event.id);
        this.state.events.push({ type: 'event-skip', at: this.state.elapsed, detail: event.id });
        continue;
      }
      this.activateEvent(event, at, duration);
      return;
    }
  }

  private activateEvent(event: LevelEventConfig, at: number, duration: number): void {
    const zone = finiteRect(event.zone);
    const active: ActiveEvent = {
      id: event.id,
      kind: event.kind,
      label: event.label,
      description: event.description,
      startedAt: this.state.elapsed,
      endsAt: at + duration,
      remaining: Math.max(0, at + duration - this.state.elapsed),
      ...(Number.isFinite(event.horizontalInset)
        ? { horizontalInset: Math.max(0, event.horizontalInset ?? 0) }
        : {}),
      ...(event.fromDoorId ? { fromDoorId: event.fromDoorId } : {}),
      ...(event.toDoorId ? { toDoorId: event.toDoorId } : {}),
      ...(zone ? { zone } : {}),
    };
    this.state.activeEvent = active;
    this.startedEventIds.add(event.id);
    this.state.events.push({ type: 'event-start', at: this.state.elapsed, detail: `${event.kind}:${event.id}` });

    if (event.kind === 'door-change') {
      const fromDoorId = event.fromDoorId ?? this.state.recommendedDoorId;
      const toDoorId = event.toDoorId ?? this.level.doors.find((door) => door.id !== fromDoorId)?.id;
      const fromDoor = findDoor(this.level, fromDoorId);
      const toDoor = toDoorId ? findDoor(this.level, toDoorId) : undefined;
      if (fromDoor && toDoor && fromDoor.id !== toDoor.id) {
        active.fromDoorId = fromDoor.id;
        active.toDoorId = toDoor.id;
        this.state.recommendedDoorId = toDoor.id;
        for (const passenger of this.state.passengers) {
          if (passenger.role !== 'waiting' || passenger.desiredDoorId !== fromDoor.id) continue;
          passenger.desiredDoorId = toDoor.id;
          passenger.target = { x: toDoor.center.x, y: this.level.platformBounds.y + 24 };
        }
        this.state.events.push({
          type: 'event-door-change',
          at: this.state.elapsed,
          detail: `${fromDoor.id}->${toDoor.id}`,
        });
      }
    }
    this.syncDoorStates();
  }

  private endActiveEvent(restoreRecommendation = true): void {
    const active = this.state.activeEvent;
    if (!active) return;
    this.state.events.push({ type: 'event-end', at: this.state.elapsed, detail: active.id });
    this.state.activeEvent = null;
    if (restoreRecommendation) this.state.recommendedDoorId = this.level.recommendedDoorId;
    this.syncDoorStates();
  }

  private walkableBounds(): Rect {
    const bounds = this.level.platformBounds;
    const active = this.state.activeEvent;
    if (!active || active.kind !== 'rain') return { ...bounds };
    const inset = clamp(
      Number.isFinite(active.horizontalInset) ? active.horizontalInset ?? 0 : 0,
      0,
      Math.max(0, (bounds.width - 2) / 2),
    );
    return {
      x: bounds.x + inset,
      y: bounds.y,
      width: Math.max(2, bounds.width - inset * 2),
      height: bounds.height,
    };
  }

  private blockedZones(): readonly Rect[] {
    const active = this.state.activeEvent;
    if (!active || active.kind !== 'luggage-cart' || !active.zone) return [];
    return [active.zone];
  }

  private createInitialState(seed: number): GameState {
    const passengers = createPassengers(this.level, this.random);
    const selectedDoorId =
      findDoor(this.level, this.level.recommendedDoorId)?.id ?? this.level.doors[0]?.id ?? '';
    const state: GameState = {
      levelId: this.level.id,
      seed,
      phase: this.machine.phase,
      phaseElapsed: this.machine.phaseElapsed,
      elapsed: 0,
      doorRemaining: this.machine.doorRemaining,
      player: {
        position: copyVec(this.level.player.spawn),
        velocity: vec(),
        facing: { x: 0, y: -1 },
        radius: this.level.player.radius,
        speed: this.level.player.speed,
        stamina: this.level.player.maxStamina,
        maxStamina: this.level.player.maxStamina,
        abilityCooldown: 0,
        selectedDoorId,
        inCarriage: false,
        inSafeZone: false,
        guideUses: 0,
      },
      passengers,
      doors: cloneDoorStates(this.level),
      metrics: initialMetrics(this.level),
      outcome: null,
      score: null,
      events: [{ type: 'start', at: 0, detail: this.level.id }],
      recommendedDoorId: this.level.recommendedDoorId,
      activeEvent: null,
      rngState: this.random.snapshot(),
    };
    return state;
  }

  private syncFromMachine(): void {
    const snapshot = this.machine.snapshot();
    this.state.phase = snapshot.phase;
    this.state.phaseElapsed = snapshot.phaseElapsed;
    this.state.doorRemaining = snapshot.doorRemaining;
    this.state.outcome = snapshot.outcome;
    this.syncDoorStates();
  }

  private syncDoorStates(): void {
    // 下车阶段也必须显示并使用真实的开门状态；下车流只有在这里打开后
    // 才能从车厢内部穿过门洞到站台。
    const open = this.state.phase === 'exiting'
      || this.state.phase === 'boarding'
      || this.state.phase === 'warning';
    const occupied = this.state.doors.reduce((sum, door) => sum + door.occupancy, 0);
    const eventBlockedDoor = this.state.activeEvent?.kind === 'door-change'
      ? this.state.activeEvent.fromDoorId
      : undefined;
    for (const door of this.state.doors) {
      door.open = open;
      door.blocked = occupied >= this.level.carriageCapacity || door.id === eventBlockedDoor;
    }
  }

  private updatePlayerZones(): void {
    const door = findDoor(this.level, this.state.player.selectedDoorId);
    const doorState = this.state.doors.find((item) => item.id === this.state.player.selectedDoorId);
    this.state.player.inCarriage = isInsideRectWithRadius(
      this.state.player.position,
      this.level.trainBounds,
      this.state.player.radius,
    );
    this.state.player.inSafeZone = Boolean(
      door &&
        !doorState?.blocked &&
        this.state.player.position.x >= door.safeZone.x &&
        this.state.player.position.x <= door.safeZone.x + door.safeZone.width &&
        this.state.player.position.y >= door.safeZone.y &&
        this.state.player.position.y <= door.safeZone.y + door.safeZone.height,
    );
  }

  private resolveFrameCollisions(): void {
    const { actors, passengers } = makeCollisionActors(this.state, this.level);
    const collisionCount = resolveCollisions(actors, 3, 36);
    this.state.metrics.collisions += collisionCount;
    if (collisionCount > 0) {
      this.state.metrics.courtesyPoints -= collisionCount * 0.15;
    }

    const playerActor = actors.find((actor) => actor.id === 'player');
    if (playerActor) {
      this.state.player.position = this.constrainPlayerPosition(
        finiteVec(playerActor.position, this.state.player.position),
        this.state.player.position,
      );
      this.state.player.position = keepOutsideRects(
        this.state.player.position,
        this.state.player.radius,
        this.blockedZones(),
      );
      this.state.player.velocity = finiteVec(playerActor.velocity, vec());
    }
    for (const passenger of passengers) {
      const actor = actors.find((item) => item.id === passenger.id);
      if (!actor) continue;
      passenger.position = finiteVec(actor.position, passenger.position);
      passenger.velocity = finiteVec(actor.velocity, vec());
      clampPassenger(passenger, this.level);
      if (passenger.role === 'waiting' || (passenger.role === 'alighting' && passenger.routeProgress >= 1)) {
        passenger.position = clampPointToRect(passenger.position, this.walkableBounds(), passenger.radius);
        passenger.position = keepOutsideRects(passenger.position, passenger.radius, this.blockedZones());
      } else if (passenger.role === 'alighting' || passenger.role === 'boarding') {
        // 上车中的角色可以暂时位于门槛两侧；只有进入车厢后才锁定到
        // trainBounds，避免碰撞收尾把它拉回站台等候区。下车中的角色
        // 在 routeProgress=0 时也必须留在车内，等待开门后再跨过门槛。
        passenger.position = clampPointToRect(passenger.position, boardingBounds(this.level), passenger.radius);
        passenger.position = keepOutsideRects(passenger.position, passenger.radius, this.blockedZones());
      }
    }
  }

  /**
   * 限制玩家只能在站台和车厢两个连续空间内移动，并且只有从打开的
   * 选中车门穿过门洞才能跨越 y=0。这样车厢内部不再是一个仅供渲染的
   * 背景矩形，玩家位置也可以直接用于上车结算。
   */
  private constrainPlayerPosition(candidate: Vec2, previous: Vec2): Vec2 {
    const radius = this.state.player.radius;
    const train = this.level.trainBounds;
    const platform = this.walkableBounds();
    const union = boardingBounds(this.level);
    const next = finiteVec(candidate, previous);
    const prior = finiteVec(previous, this.state.player.position);
    const nextInside = isInsideRectWithRadius(next, train, radius);
    const priorInside = isInsideRectWithRadius(prior, train, radius);
    const canTraverse = this.canTraverseSelectedDoor(prior, next);

    if (nextInside) {
      if (priorInside || canTraverse) return clampPointToRect(next, train, radius);
      return clampPointToRect(next, platform, radius);
    }

    // 保留门洞中间的过渡位置，避免从站台侧一步被夹回去，导致看起来
    // 永远只能站在安全区而无法真正走进车厢。
    if (canTraverse) {
      return clampPointToRect(next, union, radius);
    }

    if (priorInside) {
      return clampPointToRect(prior, train, radius);
    }

    return clampPointToRect(next, platform, radius);
  }

  private canTraverseSelectedDoor(previous: Vec2, next: Vec2): boolean {
    const door = findDoor(this.level, this.state.player.selectedDoorId);
    const state = this.state.doors.find((item) => item.id === this.state.player.selectedDoorId);
    if (!door || !state?.open || state.blocked) return false;

    // 固定步长通常不会一次跨很远，但手动调试/恢复可能传入大 dt；
    // 检查穿越门线时的插值 x，避免角色从门侧“穿墙”。
    const boundary = door.center.y;
    const crossedDoorLine = previous.y !== next.y
      && (previous.y - boundary) * (next.y - boundary) <= 0;
    if (crossedDoorLine) {
      const ratio = (boundary - previous.y) / (next.y - previous.y);
      const crossing = {
        x: previous.x + (next.x - previous.x) * ratio,
        y: boundary,
      };
      return isInDoorPassage(crossing, door, this.state.player.radius);
    }

    // 已经位于门洞过渡区时，允许继续向车内/站台移动；但不能把“某一端
    // 碰到门洞”当成整条路径都合法，避免大步长从门侧斜穿车厢边界。
    const previousInPassage = isInDoorPassage(previous, door, this.state.player.radius);
    const nextInPassage = isInDoorPassage(next, door, this.state.player.radius);
    const previousInside = isInsideRectWithRadius(previous, this.level.trainBounds, this.state.player.radius);
    const nextInside = isInsideRectWithRadius(next, this.level.trainBounds, this.state.player.radius);
    return (previousInside && nextInPassage)
      || (nextInside && previousInPassage)
      || (previousInPassage && nextInPassage);
  }
}

export function createGameSimulation(level: LevelConfig | string = 'sea-gate', seed: number | string = 1): GameSimulation {
  return new GameSimulation(level, seed);
}

export function createGameState(level: LevelConfig | string = 'sea-gate', seed: number | string = 1): GameState {
  return new GameSimulation(level, seed).snapshot();
}

export const createGame = createGameSimulation;
