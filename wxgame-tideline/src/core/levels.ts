import type { DoorConfig, LevelConfig } from './types.ts';

const platform = () => ({ x: 0, y: 0, width: 320, height: 568 });
const train = () => ({ x: 0, y: -160, width: 320, height: 160 });

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
  cooldown: 1.2,
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
  phaseDurations: { intro: 0.8, arriving: 1.1, positioning: 0.8, exiting: 2.4 },
  boardingDuration: 7.5,
  warningThreshold: 2,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 160, 72, true)],
  passenger: {
    count: 8,
    alightingCount: 2,
    baseSpeed: 42,
    spawnPadding: 24,
    exitMargin: 34,
    kindWeights: { regular: 6, slow: 2, fast: 1, luggage: 1 },
  },
  player: {
    spawn: { x: 160, y: 500 },
    radius: 12,
    speed: 150,
    maxStamina: 100,
    staminaRegen: 6,
  },
  carriageCapacity: 8,
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
  description: '双门换位关，临时换门时要观察并切换入口。',
  phaseDurations: { intro: 0.8, arriving: 1.2, positioning: 0.9, exiting: 2.8 },
  boardingDuration: 8.2,
  warningThreshold: 2.2,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 92, 64), door('b', 'B 门', 228, 64, true)],
  passenger: {
    count: 14,
    alightingCount: 4,
    baseSpeed: 45,
    spawnPadding: 22,
    exitMargin: 36,
    kindWeights: { regular: 6, slow: 2, fast: 2, luggage: 2, phone: 1, group: 1 },
  },
  player: {
    spawn: { x: 160, y: 510 },
    radius: 12,
    speed: 155,
    maxStamina: 100,
    staminaRegen: 5,
  },
  carriageCapacity: 12,
  recommendedDoorId: 'b',
  guide: { ...baseGuide, range: 96, maxTargets: 4 },
  events: [
    {
      id: 'cloud-harbor-door-change',
      kind: 'door-change',
      at: 4.2,
      duration: 2.8,
      label: '临时换门',
      description: 'B 门临时疏导，A 门成为本轮推荐入口。',
      fromDoorId: 'b',
      toDoorId: 'a',
    },
  ],
};

const starRing: LevelConfig = {
  id: 'star-ring',
  name: '星环城',
  stationName: '星环城站',
  description: '高密度短倒计时，绕开行李车并把握疏导时机。',
  phaseDurations: { intro: 0.6, arriving: 0.9, positioning: 0.6, exiting: 2.1 },
  boardingDuration: 5.6,
  warningThreshold: 1.8,
  platformBounds: platform(),
  trainBounds: train(),
  doors: [door('a', 'A 门', 70, 60), door('b', 'B 门', 250, 60, true)],
  passenger: {
    count: 24,
    alightingCount: 6,
    baseSpeed: 49,
    spawnPadding: 20,
    exitMargin: 38,
    kindWeights: { regular: 7, slow: 2, fast: 4, luggage: 2, phone: 2, group: 3 },
  },
  player: {
    spawn: { x: 160, y: 520 },
    radius: 12,
    speed: 165,
    maxStamina: 100,
    staminaRegen: 4,
  },
  carriageCapacity: 14,
  recommendedDoorId: 'b',
  guide: { ...baseGuide, cost: 20, cooldown: 1.35, range: 88, maxTargets: 5 },
  events: [
    {
      id: 'star-ring-luggage-cart',
      kind: 'luggage-cart',
      at: 3.8,
      duration: 3,
      label: '行李车经过',
      description: '行李车占用中央通道，请从侧面绕行。',
      zone: { x: 126, y: 180, width: 68, height: 112 },
    },
  ],
};

export const MVP_LEVELS: readonly LevelConfig[] = [seaGate, cloudHarbor, starRing];

export const LEVELS_BY_ID: Readonly<Record<string, LevelConfig>> = Object.fromEntries(
  MVP_LEVELS.map((level) => [level.id, level]),
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
