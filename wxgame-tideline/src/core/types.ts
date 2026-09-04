/**
 * M2 规则层的所有数据结构。
 *
 * 这里刻意不引用微信 API、DOM、Canvas 或任何渲染对象。渲染层只应读取
 * GameState 快照，平台层负责把触摸/计时/存档转换成核心层能理解的数据。
 */

export const PHASE_ORDER = [
  'intro',
  'arriving',
  'positioning',
  'exiting',
  'boarding',
  'warning',
  'result',
] as const;

export type Phase = (typeof PHASE_ORDER)[number];

export const PASSENGER_KINDS = [
  'regular',
  'fast',
  'slow',
  'luggage',
  'phone',
  'group',
] as const;

export type PassengerKind = (typeof PASSENGER_KINDS)[number];

/** 关卡阶段对应的车厢外观主题。渲染层只依赖这个稳定的语义值。 */
export const CARRIAGE_THEMES = ['pearl', 'yellow', 'seafoam'] as const;

export type CarriageTheme = (typeof CARRIAGE_THEMES)[number];

/**
 * M5 内容事件只描述规则参数，不携带任何 Canvas/微信对象。
 * 事件按关卡配置的数据驱动，便于后续扩展而不改状态机接口。
 */
export const LEVEL_EVENT_KINDS = ['rain', 'door-change', 'luggage-cart'] as const;

export type LevelEventKind = (typeof LEVEL_EVENT_KINDS)[number];

export type PassengerRole =
  | 'alighting'
  | 'waiting'
  | 'boarding'
  | 'inside'
  | 'exited';

export type Emotion = 'calm' | 'hurried' | 'hesitant' | 'relieved';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhaseDurations {
  intro: number;
  arriving: number;
  positioning: number;
  exiting: number;
}

export interface DoorConfig {
  id: string;
  label: string;
  center: Vec2;
  width: number;
  safeZone: Rect;
  entryZone: Rect;
  recommended?: boolean;
}

export interface LevelEventConfig {
  /** 在本局 elapsed（秒）达到该值后触发。 */
  id: string;
  kind: LevelEventKind;
  at: number;
  duration: number;
  label: string;
  description: string;
  /** 雨天事件把站台左右各收窄多少逻辑像素。 */
  horizontalInset?: number;
  /** 临时换门事件的旧门与新推荐门。旧门会暂时不可用。 */
  fromDoorId?: string;
  toDoorId?: string;
  /** 行李车事件占用的站台区域。 */
  zone?: Rect;
}

export interface ActiveEvent {
  id: string;
  kind: LevelEventKind;
  label: string;
  description: string;
  startedAt: number;
  endsAt: number;
  remaining: number;
  horizontalInset?: number;
  fromDoorId?: string;
  toDoorId?: string;
  zone?: Rect;
}

export interface GuideConfig {
  cost: number;
  cooldown: number;
  range: number;
  coneDot: number;
  maxTargets: number;
  sideOffset: number;
  effectDuration: number;
}

export interface PassengerConfig {
  count: number;
  alightingCount: number;
  baseSpeed: number;
  spawnPadding: number;
  exitMargin: number;
  kindWeights: Partial<Record<PassengerKind, number>>;
}

export interface PlayerConfig {
  spawn: Vec2;
  radius: number;
  speed: number;
  maxStamina: number;
  staminaRegen: number;
}

export interface LevelConfig {
  id: string;
  name: string;
  stationName: string;
  description: string;
  /** 车厢配色主题；自定义关卡未填写时由渲染层回退到 seafoam。 */
  carriageTheme?: CarriageTheme;
  phaseDurations: PhaseDurations;
  boardingDuration: number;
  warningThreshold: number;
  platformBounds: Rect;
  trainBounds: Rect;
  doors: DoorConfig[];
  passenger: PassengerConfig;
  player: PlayerConfig;
  carriageCapacity: number;
  recommendedDoorId: string;
  guide: GuideConfig;
  /** 一关最多放置一个主要事件；规则层仍支持多个按时间顺序触发。 */
  events?: readonly LevelEventConfig[];
}

export interface Passenger {
  id: string;
  kind: PassengerKind;
  role: PassengerRole;
  emotion: Emotion;
  position: Vec2;
  velocity: Vec2;
  target: Vec2;
  radius: number;
  weight: number;
  speed: number;
  desiredDoorId: string;
  doorId?: string;
  groupId?: string;
  /** 0 表示尚未走完下车门口这个航点，1 表示已朝站台出口移动。 */
  routeProgress: number;
  guidedUntil: number;
}

export interface PlayerState {
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  radius: number;
  speed: number;
  stamina: number;
  maxStamina: number;
  abilityCooldown: number;
  selectedDoorId: string;
  /** 玩家圆心已经完全越过门槛并进入车厢内部。 */
  inCarriage: boolean;
  /** 玩家当前位于所选车门外侧的候车安全区。 */
  inSafeZone: boolean;
  guideUses: number;
}

export interface DoorState {
  id: string;
  occupancy: number;
  open: boolean;
  blocked: boolean;
}

// 便于平台层和策划文档使用的简短别名；底层仍只有一份数据结构。
export type Player = PlayerState;
export type Door = DoorState;

export interface SimulationMetrics {
  collisions: number;
  courtesyPoints: number;
  alightingTotal: number;
  alightingExited: number;
  boardingTotal: number;
  boarded: number;
  guideUses: number;
  doorSwitches: number;
  staminaSpent: number;
  lateBoardingAttempts: number;
  /** 结算瞬间尚未消耗的开门时间；失败时通常为 0。 */
  doorRemainingAtFinish: number;
}

export type GameOutcome = 'success' | 'failure';

export interface EventRecord {
  type: string;
  at: number;
  detail?: string;
}

export interface ScoreResult {
  success: boolean;
  efficiency: number;
  courtesy: number;
  stamina: number;
  route: number;
  total: number;
  medal: 'none' | 'bronze' | 'silver' | 'gold';
}

export interface GameState {
  levelId: string;
  seed: number;
  phase: Phase;
  phaseElapsed: number;
  elapsed: number;
  doorRemaining: number;
  player: PlayerState;
  passengers: Passenger[];
  doors: DoorState[];
  metrics: SimulationMetrics;
  outcome: GameOutcome | null;
  score: ScoreResult | null;
  events: EventRecord[];
  /** 当前生效的推荐入口；临时换门事件期间会切换。 */
  recommendedDoorId: string;
  /** 当前正在影响规则的内容事件；没有事件时为 null。 */
  activeEvent: ActiveEvent | null;
  rngState: number;
}

export interface SimulationInput {
  move?: Vec2;
  selectDoorId?: string;
  useGuide?: boolean;
}

export interface GuideResult {
  used: boolean;
  reason?: 'phase' | 'cooldown' | 'stamina' | 'no-target';
  affectedPassengerIds: string[];
}

export interface CollisionActor {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  weight: number;
  movable?: boolean;
}

export interface PassengerUpdateContext {
  dt: number;
  now: number;
  platformBounds: Rect;
  /** 事件收窄后的可行走区域；缺省时等于 platformBounds。 */
  walkableBounds?: Rect;
  /** 事件暂时占用的站台区域。 */
  blockedZones?: readonly Rect[];
  trainBounds: Rect;
  doors: DoorConfig[];
  doorStates: DoorState[];
  carriageCapacity: number;
  boardingOpen: boolean;
  alightingOpen: boolean;
}

export interface PassengerUpdateResult {
  /** 本帧真正走到车厢内目标点并完成上车的乘客数。 */
  boarded: number;
  alightingExited: number;
  collisionCount: number;
  blockedAttempts: number;
}

export interface SaveSettings {
  soundEnabled: boolean;
  musicEnabled: boolean;
  vibrationEnabled: boolean;
}

export interface SaveData {
  version: number;
  unlockedLevelIds: string[];
  bestScores: Record<string, number>;
  achievements: string[];
  settings: SaveSettings;
  stats: {
    plays: number;
    clears: number;
    totalGuides: number;
  };
}
