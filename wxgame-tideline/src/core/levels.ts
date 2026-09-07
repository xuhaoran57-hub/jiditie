import type { DoorConfig, LevelConfig } from './types.ts';

const platform = () => ({ x: 0, y: 0, width: 320, height: 568 });
// 车厢底边仍与站台门线重合；增加上方高度，让横屏车厢内部有足够容纳角色的空间。
const CARRIAGE_HEIGHT = 300;
const train = () => ({ x: 0, y: -CARRIAGE_HEIGHT, width: 320, height: CARRIAGE_HEIGHT });

function door(
  id: string,
  label: string,
  x: number,
  width: number,
  recommended = false,
): DoorConfig {
  return {
    id,
    label,
    center: { x, y: 0 },
    width,
    // 安全区仅用于站台侧提示和门前疏导；结算判定使用车厢内部位置。
    safeZone: { x: x - width / 2 - 12, y: 12, width: width + 24, height: 52 },
    entryZone: { x: x - width / 2, y: -18, width, height: 52 },
    recommended,
  };
}

const baseGuide = {
  cost: 18,
  cooldown: 1,
  range: 92,
  coneDot: -0.2,
  maxTargets: 4,
  sideOffset: 18,
  effectDuration: 0.35,
};

const seaGate: LevelConfig = {
  id: 'sea-gate',
  name: '海风门',
  stationName: '海风门站',
  description: '单门低密度教学，雨伞流经过时先看清可用的横向空间。',
  carriageTheme: 'pearl',
  phaseDurations: { intro: 0.8, arriving: 1.1, positioning: 0.8, exiting: 2.4 },
  boardingDuration: 11.5,
  warningThreshold: 2,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 160, 72, true)],
  passenger: {
    count: 44,
    alightingCount: 14,
    baseSpeed: 35,
    spawnPadding: 24,
    exitMargin: 34,
    kindWeights: { regular: 6, slow: 2, fast: 1, luggage: 1 },
  },
  player: {
    spawn: { x: 160, y: 500 },
    radius: 12,
    speed: 120,
    maxStamina: 100,
    staminaRegen: 6,
  },
  carriageCapacity: 24,
  recommendedDoorId: 'a',
  guide: baseGuide,
  events: [
    {
      id: 'sea-gate-rain',
      kind: 'rain',
      at: 3.4,
      duration: 3.6,
      label: '伞流经过',
      description: '雨伞收拢了站台两侧的横向空间。',
      horizontalInset: 26,
    },
  ],
};

const cloudHarbor: LevelConfig = {
  id: 'cloud-harbor',
  name: '云港',
  stationName: '云港站',
  description: '单门错峰关，观察下车流和拥挤空隙后进入。',
  carriageTheme: 'yellow',
  phaseDurations: { intro: 0.8, arriving: 1.2, positioning: 0.9, exiting: 2.8 },
  boardingDuration: 11.3,
  warningThreshold: 2.2,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 160, 64, true)],
  passenger: {
    count: 58,
    alightingCount: 20,
    baseSpeed: 37,
    spawnPadding: 22,
    exitMargin: 36,
    kindWeights: { regular: 6, slow: 2, fast: 2, luggage: 2, phone: 1, group: 1 },
  },
  player: {
    spawn: { x: 160, y: 510 },
    radius: 12,
    speed: 124,
    maxStamina: 100,
    staminaRegen: 5,
  },
  carriageCapacity: 30,
  recommendedDoorId: 'a',
  guide: { ...baseGuide, range: 96, maxTargets: 2 },
  events: [{
    id: 'cloud-harbor-crowd-surge',
    kind: 'crowd-surge',
    at: 4.2,
    duration: 2.8,
    label: '站台人流',
    description: '单门前人流短时加快，留出下车通道再进入。',
    speedMultiplier: 1.12,
  }]
};

const starRing: LevelConfig = {
  id: 'star-ring',
  name: '星环城',
  stationName: '星环城站',
  description: '高密度短倒计时，绕开行李车并把握疏导时机。',
  carriageTheme: 'seafoam',
  phaseDurations: { intro: 0.6, arriving: 0.9, positioning: 0.6, exiting: 2.1 },
  boardingDuration: 10.9,
  warningThreshold: 1.8,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 70, 60), door('b', 'B 门', 250, 60, true)],
  passenger: {
    count: 76,
    alightingCount: 28,
    baseSpeed: 40,
    spawnPadding: 20,
    exitMargin: 38,
    kindWeights: { regular: 7, slow: 2, fast: 4, luggage: 2, phone: 2, group: 3 },
  },
  player: {
    spawn: { x: 160, y: 520 },
    radius: 12,
    speed: 130,
    maxStamina: 100,
    staminaRegen: 4,
  },
  carriageCapacity: 42,
  recommendedDoorId: 'b',
  guide: { ...baseGuide, cost: 20, cooldown: 1, range: 88, maxTargets: 2 },
  events: [
    {
      id: 'star-ring-luggage-cart',
      kind: 'luggage-cart',
      at: 3.8,
      duration: 3,
      label: '行李车经过',
      description: '行李车从左侧驶过中央通道，注意从后方绕行。',
      zone: { x: 0, y: 180, width: 68, height: 112 },
    },
  ],
};

const lighthouseBay: LevelConfig = {
  id: 'lighthouse-bay',
  name: '灯塔湾',
  stationName: '灯塔湾站',
  description: '先看清下车流，再从两侧绕行进入候车区。',
  carriageTheme: 'pearl',
  phaseDurations: { intro: 0.8, arriving: 1.1, positioning: 0.8, exiting: 2.5 },
  boardingDuration: 11.4,
  warningThreshold: 2,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 160, 68, true)],
  passenger: {
    count: 48,
    alightingCount: 16,
    baseSpeed: 35,
    spawnPadding: 23,
    exitMargin: 35,
    kindWeights: { regular: 6, slow: 2, fast: 1, luggage: 1 },
  },
  player: { spawn: { x: 160, y: 500 }, radius: 12, speed: 120, maxStamina: 100, staminaRegen: 5.8 },
  carriageCapacity: 26,
  recommendedDoorId: 'a',
  guide: { ...baseGuide, range: 90 },
  events: [{
    id: 'lighthouse-bay-rain', kind: 'rain', at: 3.2, duration: 3.2,
    label: '雨幕经过', description: '伞面让横向空间变窄，先给下车客留出通道。', horizontalInset: 22,
  }],
};

const tangBridge: LevelConfig = {
  id: 'tang-bridge',
  name: '棠桥',
  stationName: '棠桥站',
  description: '单门高密度关，先处理下车流再寻找进入空隙。',
  carriageTheme: 'yellow',
  phaseDurations: { intro: 0.8, arriving: 1.1, positioning: 0.8, exiting: 2.5 },
  boardingDuration: 11.2,
  warningThreshold: 2,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 160, 62, true)],
  passenger: {
    count: 52,
    alightingCount: 18,
    baseSpeed: 36,
    spawnPadding: 22,
    exitMargin: 35,
    kindWeights: { regular: 6, slow: 2, fast: 2, luggage: 1, phone: 1 },
  },
  player: { spawn: { x: 160, y: 505 }, radius: 12, speed: 122, maxStamina: 100, staminaRegen: 5.4 },
  carriageCapacity: 28,
  recommendedDoorId: 'a',
  guide: { ...baseGuide, range: 94 },
  events: [{
    id: 'tang-bridge-gap', kind: 'crowd-surge', at: 3.8, duration: 2.2,
    label: '桥上人流', description: '桥上人流短时加快，门口拥挤需要耐心穿行。', speedMultiplier: 1.14,
  }],
};

const northIslet: LevelConfig = {
  id: 'north-islet',
  name: '北屿',
  stationName: '北屿站',
  description: '单门关遇到行李车横穿，绕开占用区再进入。',
  carriageTheme: 'seafoam',
  phaseDurations: { intro: 0.7, arriving: 1, positioning: 0.7, exiting: 2.4 },
  boardingDuration: 11.1,
  warningThreshold: 1.9,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 160, 60, true)],
  passenger: {
    count: 64,
    alightingCount: 24,
    baseSpeed: 38,
    spawnPadding: 21,
    exitMargin: 36,
    kindWeights: { regular: 6, slow: 2, fast: 2, luggage: 3, phone: 1, group: 1 },
  },
  player: { spawn: { x: 160, y: 510 }, radius: 12, speed: 126, maxStamina: 100, staminaRegen: 5 },
  carriageCapacity: 34,
  recommendedDoorId: 'a',
  guide: { ...baseGuide, range: 94, maxTargets: 2 },
  events: [{
    id: 'north-islet-cart', kind: 'luggage-cart', at: 3.2, duration: 2.8,
    label: '行李车经过', description: '行李车横穿站台，从侧边绕行。', zone: { x: 0, y: 176, width: 76, height: 122 },
  }],
};

const estuaryNewCity: LevelConfig = {
  id: 'estuary-new-city',
  name: '河口新城',
  stationName: '河口新城站',
  description: '单门关迎来散场人流，控制疏导节奏，不要一次耗尽体力。',
  carriageTheme: 'pearl',
  phaseDurations: { intro: 0.7, arriving: 1, positioning: 0.7, exiting: 2.3 },
  boardingDuration: 11,
  warningThreshold: 1.8,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 160, 60, true)],
  passenger: {
    count: 70,
    alightingCount: 26,
    baseSpeed: 39,
    spawnPadding: 20,
    exitMargin: 37,
    kindWeights: { regular: 6, slow: 2, fast: 3, luggage: 2, phone: 2, group: 2 },
  },
  player: { spawn: { x: 160, y: 515 }, radius: 12, speed: 128, maxStamina: 100, staminaRegen: 4.8 },
  carriageCapacity: 38,
  recommendedDoorId: 'a',
  guide: { ...baseGuide, cost: 19, cooldown: 1, range: 92, maxTargets: 2 },
  events: [{
    id: 'estuary-crowd-surge', kind: 'crowd-surge', at: 3.4, duration: 2.6,
    label: '散场人流', description: '展馆散场，人流短时加快，提前让出通道。', speedMultiplier: 1.22,
  }],
};

const qixiaGarden: LevelConfig = {
  id: 'qixia-garden',
  name: '栖霞园',
  stationName: '栖霞园站',
  description: '同行小组保持相邻，寻找侧面入口，不要从中间硬挤。',
  carriageTheme: 'yellow',
  phaseDurations: { intro: 0.7, arriving: 0.9, positioning: 0.7, exiting: 2.3 },
  boardingDuration: 10.8,
  warningThreshold: 1.8,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 88, 60), door('b', 'B 门', 232, 60, true)],
  passenger: {
    count: 72,
    alightingCount: 26,
    baseSpeed: 39,
    spawnPadding: 20,
    exitMargin: 37,
    kindWeights: { regular: 5, slow: 2, fast: 3, luggage: 2, phone: 2, group: 4 },
  },
  player: { spawn: { x: 160, y: 515 }, radius: 12, speed: 130, maxStamina: 100, staminaRegen: 4.6 },
  carriageCapacity: 40,
  recommendedDoorId: 'b',
  guide: { ...baseGuide, cost: 19, cooldown: 1, range: 90, maxTargets: 2 },
  events: [{
      id: 'qixia-group-window', kind: 'door-close', at: 3.5, duration: 2.4, warningDuration: 3,
    label: 'B 门提前关闭', description: 'B 门提前关闭，同行小组改从 A 门进入。', fromDoorId: 'b', toDoorId: 'a',
  }],
};

const tidewatch: LevelConfig = {
  id: 'tidewatch',
  name: '望潮台',
  stationName: '望潮台站',
  description: '双门窄站台，先避开边缘收窄区，再决定进入方向。',
  carriageTheme: 'seafoam',
  phaseDurations: { intro: 0.6, arriving: 0.9, positioning: 0.6, exiting: 2.2 },
  boardingDuration: 10.7,
  warningThreshold: 1.7,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 92, 56), door('b', 'B 门', 228, 56, true)],
  passenger: {
    count: 82,
    alightingCount: 30,
    baseSpeed: 40,
    spawnPadding: 19,
    exitMargin: 38,
    kindWeights: { regular: 6, slow: 2, fast: 4, luggage: 2, phone: 2, group: 3 },
  },
  player: { spawn: { x: 160, y: 520 }, radius: 12, speed: 132, maxStamina: 100, staminaRegen: 4.4 },
  carriageCapacity: 46,
  recommendedDoorId: 'b',
  guide: { ...baseGuide, cost: 20, cooldown: 1, range: 88, maxTargets: 2 },
  events: [{
    id: 'tidewatch-rain', kind: 'rain', at: 3.1, duration: 2.6,
    label: '窄站台雨幕', description: '两侧空间收窄，中央路线更容易保持通畅。', horizontalInset: 34,
  }],
};

const weavingCloud: LevelConfig = {
  id: 'weaving-cloud',
  name: '织云路',
  stationName: '织云路站',
  description: '两扇门分时提前关闭，观察仍开放的入口。',
  carriageTheme: 'pearl',
  phaseDurations: { intro: 0.6, arriving: 0.9, positioning: 0.6, exiting: 2.1 },
  boardingDuration: 10.6,
  warningThreshold: 1.6,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 92, 56), door('b', 'B 门', 228, 56, true)],
  passenger: {
    count: 86,
    alightingCount: 32,
    baseSpeed: 41,
    spawnPadding: 19,
    exitMargin: 38,
    kindWeights: { regular: 5, slow: 2, fast: 4, luggage: 2, phone: 3, group: 3 },
  },
  player: { spawn: { x: 160, y: 520 }, radius: 12, speed: 134, maxStamina: 100, staminaRegen: 4.2 },
  carriageCapacity: 50,
  recommendedDoorId: 'b',
  guide: { ...baseGuide, cost: 20, cooldown: 1, range: 88, maxTargets: 2 },
  events: [
    { id: 'weaving-cloud-close', kind: 'door-close', at: 2.8, duration: 1.8, warningDuration: 3, label: 'B 门提前关闭', description: 'B 门提前关闭，A 门保持开放。', fromDoorId: 'b', toDoorId: 'a' },
    { id: 'weaving-cloud-cart', kind: 'luggage-cart', at: 6.1, duration: 1.1, label: '行李车横穿', description: '行李车从左侧驶向右侧，利用门侧空隙绕行。', zone: { x: 0, y: 170, width: 68, height: 116 } },
  ],
};

const farSail: LevelConfig = {
  id: 'far-sail',
  name: '远帆中心',
  stationName: '远帆中心站',
  description: '高峰连续事件，先避开散场人流，再绕过行李车。',
  carriageTheme: 'yellow',
  phaseDurations: { intro: 0.6, arriving: 0.8, positioning: 0.6, exiting: 2 },
  boardingDuration: 10.5,
  warningThreshold: 1.5,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 92, 56), door('b', 'B 门', 228, 56, true)],
  passenger: {
    count: 94,
    alightingCount: 36,
    baseSpeed: 42,
    spawnPadding: 18,
    exitMargin: 39,
    kindWeights: { regular: 5, slow: 2, fast: 5, luggage: 3, phone: 3, group: 4 },
  },
  player: { spawn: { x: 160, y: 522 }, radius: 12, speed: 136, maxStamina: 100, staminaRegen: 4 },
  carriageCapacity: 56,
  recommendedDoorId: 'b',
  guide: { ...baseGuide, cost: 21, cooldown: 1, range: 86, maxTargets: 2 },
  events: [
    { id: 'far-sail-surge', kind: 'crowd-surge', at: 2.6, duration: 1.8, label: '展馆散场', description: '快步人流从中央穿过，站位要更果断。', speedMultiplier: 1.2 },
    { id: 'far-sail-cart', kind: 'luggage-cart', at: 4.5, duration: 1.1, label: '行李车横穿', description: '行李车从左侧驶向右侧，及时转向侧门。', zone: { x: 0, y: 170, width: 68, height: 116 } },
  ],
};

const morningLight: LevelConfig = {
  id: 'morning-light',
  name: '晨光港',
  stationName: '晨光港站',
  description: '最终综合关：双门、高密度、快步潮和提前关门同时考验判断。',
  carriageTheme: 'seafoam',
  phaseDurations: { intro: 0.5, arriving: 0.8, positioning: 0.5, exiting: 1.9 },
  boardingDuration: 10.4,
  warningThreshold: 1.4,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 92, 54), door('b', 'B 门', 228, 54, true)],
  passenger: {
    count: 100,
    alightingCount: 38,
    baseSpeed: 43,
    spawnPadding: 18,
    exitMargin: 40,
    kindWeights: { regular: 4, slow: 2, fast: 6, luggage: 3, phone: 3, group: 5 },
  },
  player: { spawn: { x: 160, y: 524 }, radius: 12, speed: 138, maxStamina: 100, staminaRegen: 3.8 },
  carriageCapacity: 60,
  recommendedDoorId: 'b',
  guide: { ...baseGuide, cost: 22, cooldown: 1, range: 84, maxTargets: 2 },
  events: [
    { id: 'morning-light-surge', kind: 'crowd-surge', at: 2.3, duration: 1.5, label: '终点快步潮', description: '快步客集中出现，提前占位比临时冲刺更有效。', speedMultiplier: 1.18 },
    { id: 'morning-light-close', kind: 'door-close', at: 3.9, duration: 1, warningDuration: 3, label: 'B 门提前关闭', description: 'B 门提前关闭，最后窗口从 A 门进入。', fromDoorId: 'b', toDoorId: 'a' },
    { id: 'morning-light-cart', kind: 'luggage-cart', at: 5.4, duration: 1.1, label: '行李车横穿', description: '行李车从左侧驶向右侧，最后窗口需要缓慢绕行。', zone: { x: 0, y: 168, width: 68, height: 118 } },
  ],
};

const OBJECTIVES_BY_LEVEL: Readonly<Record<string, LevelConfig['objectives']>> = {
  'sea-gate': [
    { id: 'alighting-rate', label: '让 60% 下车乘客顺利离开', minRatio: 0.6 },
    { id: 'finish-time', label: '提前 2 秒进入车厢', minRemaining: 2 },
    { id: 'courtesy-score', label: '礼让值达到 60', minScore: 60 },
  ],
  'lighthouse-bay': [
    { id: 'finish-time', label: '提前 1 秒进入车厢', minRemaining: 1 },
    { id: 'alighting-rate', label: '让 70% 下车乘客顺利离开', minRatio: 0.7 },
    { id: 'stamina', label: '结束时保留 45% 体力', minRatio: 0.45 },
  ],
  'tang-bridge': [
    { id: 'finish-time', label: '提前 1.5 秒进入车厢', minRemaining: 1.5 },
    { id: 'courtesy-score', label: '礼让值达到 60', minScore: 60 },
    { id: 'alighting-rate', label: '让 65% 下车乘客顺利离开', minRatio: 0.65 },
  ],
  'cloud-harbor': [
    { id: 'alighting-rate', label: '让 75% 下车乘客顺利离开', minRatio: 0.75 },
    { id: 'finish-time', label: '提前 1.5 秒进入车厢', minRemaining: 1.5 },
    { id: 'stamina', label: '结束时保留 40% 体力', minRatio: 0.4 },
  ],
};

function attachObjectives(level: LevelConfig): LevelConfig {
  const objectives = OBJECTIVES_BY_LEVEL[level.id] ?? [
    { id: 'courtesy-score', label: '礼让值达到 60', minScore: 60 },
    { id: 'alighting-rate', label: '让 70% 下车乘客顺利离开', minRatio: 0.7 },
    { id: 'finish-time', label: '提前 1 秒进入车厢', minRemaining: 1 },
  ];
  return { ...level, objectives };
}

const CAMPAIGN_LEVEL_BASE: readonly LevelConfig[] = [
  seaGate,
  lighthouseBay,
  tangBridge,
  cloudHarbor,
  northIslet,
  estuaryNewCity,
  starRing,
  qixiaGarden,
  tidewatch,
  weavingCloud,
  farSail,
  morningLight,
];

/** 保留三关 MVP 别名，旧测试和外部调试工具继续使用。 */
export const MVP_LEVELS: readonly LevelConfig[] = [seaGate, cloudHarbor, starRing].map(attachObjectives);

/** 正式 12 站战役；运行时默认使用该列表。 */
export const CAMPAIGN_LEVELS: readonly LevelConfig[] = CAMPAIGN_LEVEL_BASE.map(attachObjectives);

export const LEVELS_BY_ID: Readonly<Record<string, LevelConfig>> = Object.fromEntries(
  CAMPAIGN_LEVELS.map((level) => [level.id, level]),
);

export function getLevelConfig(levelId: string): LevelConfig {
  const level = LEVELS_BY_ID[levelId];
  if (!level) throw new Error(`unknown level: ${levelId}`);
  return level;
}

export function cloneLevelConfig(level: LevelConfig): LevelConfig {
  return {
    ...level,
    phaseDurations: { ...level.phaseDurations },
    platformBounds: { ...level.platformBounds },
    trainBounds: { ...level.trainBounds },
    doors: level.doors.map((item) => ({
      ...item,
      center: { ...item.center },
      safeZone: { ...item.safeZone },
      entryZone: { ...item.entryZone },
    })),
    passenger: { ...level.passenger, kindWeights: { ...level.passenger.kindWeights } },
    player: { ...level.player, spawn: { ...level.player.spawn } },
    guide: { ...level.guide },
    ...(level.objectives ? { objectives: level.objectives.map((objective) => ({ ...objective })) } : {}),
    ...(level.events
      ? {
          events: level.events.map((event) => ({
            ...event,
            ...(event.zone ? { zone: { ...event.zone } } : {}),
          })),
        }
      : {}),
  };
}
