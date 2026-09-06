import type { SaveData, SaveSettings } from './types.ts';

export const SAVE_VERSION = 2;
export const CURRENT_SAVE_VERSION = SAVE_VERSION;
export const DEFAULT_FIRST_LEVEL = 'sea-gate';

function finiteInteger(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function scoreMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, rawScore] of Object.entries(value)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    const score = Number(rawScore);
    if (Number.isFinite(score)) result[key] = Math.round(Math.min(100, Math.max(0, score)));
  }
  return result;
}

function starsMap(value: unknown): Record<string, number> {
  const scores = scoreMap(value);
  for (const key of Object.keys(scores)) scores[key] = Math.min(3, scores[key]!);
  return scores;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

export function emptySave(): SaveData {
  return {
    version: SAVE_VERSION,
    unlockedLevelIds: [DEFAULT_FIRST_LEVEL],
    bestScores: {},
    bestStars: {},
    achievements: [],
    appearanceId: 'default',
    settings: {
      soundEnabled: true,
      musicEnabled: true,
      vibrationEnabled: true,
    },
    stats: {
      plays: 0,
      clears: 0,
      totalGuides: 0,
    },
  };
}

function sanitizeSettings(value: unknown): SaveSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    soundEnabled: source.soundEnabled !== false,
    musicEnabled: source.musicEnabled !== false,
    vibrationEnabled: source.vibrationEnabled !== false,
  };
}

function sanitize(value: Record<string, unknown>): SaveData {
  const fallback = emptySave();
  const unlocked = stringList(value.unlockedLevelIds ?? value.unlockedLevels);
  if (!unlocked.includes(DEFAULT_FIRST_LEVEL)) unlocked.unshift(DEFAULT_FIRST_LEVEL);
  const statsSource = value.stats && typeof value.stats === 'object' && !Array.isArray(value.stats)
    ? (value.stats as Record<string, unknown>)
    : {};
  return {
    version: SAVE_VERSION,
    unlockedLevelIds: unlocked,
    bestScores: scoreMap(value.bestScores ?? value.scores),
    bestStars: starsMap(value.bestStars),
    achievements: stringList(value.achievements),
    appearanceId: typeof value.appearanceId === 'string' && value.appearanceId.length > 0
      ? value.appearanceId
      : 'default',
    settings: sanitizeSettings(value.settings),
    stats: {
      plays: finiteInteger(statsSource.plays, fallback.stats.plays),
      clears: finiteInteger(statsSource.clears, fallback.stats.clears),
      totalGuides: finiteInteger(statsSource.totalGuides, fallback.stats.totalGuides),
    },
  };
}

/** 将旧版（缺少 version 或 version=0）的字段迁移到当前 schema。 */
export function migrateSave(value: unknown): SaveData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySave();
  const source = value as Record<string, unknown>;
  const rawVersion = Number(source.version ?? 0);
  if (Number.isFinite(rawVersion) && rawVersion > SAVE_VERSION) return emptySave();
  const version = finiteInteger(rawVersion, 0, 0, SAVE_VERSION);
  if (version > SAVE_VERSION) return emptySave();
  return sanitize(source);
}

export function parseSave(raw: unknown): SaveData {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return emptySave();
    }
  }
  return migrateSave(value);
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify(migrateSave(save));
}

export function updateBestScore(save: SaveData, levelId: string, score: number): SaveData {
  const next = migrateSave(save);
  if (!levelId) return next;
  const safeScore = Math.round(Math.min(100, Math.max(0, Number.isFinite(score) ? score : 0)));
  next.bestScores[levelId] = Math.max(next.bestScores[levelId] ?? 0, safeScore);
  return next;
}

export function updateBestStars(save: SaveData, levelId: string, stars: number): SaveData {
  const next = migrateSave(save);
  if (!levelId) return next;
  const safeStars = Math.min(3, Math.max(0, Math.floor(Number.isFinite(stars) ? stars : 0)));
  next.bestStars[levelId] = Math.max(next.bestStars[levelId] ?? 0, safeStars);
  return next;
}

export function setAppearance(save: SaveData, appearanceId: string): SaveData {
  const next = migrateSave(save);
  next.appearanceId = typeof appearanceId === 'string' && appearanceId.length > 0 ? appearanceId : 'default';
  return next;
}

export function unlockLevel(save: SaveData, levelId: string): SaveData {
  const next = migrateSave(save);
  if (levelId && !next.unlockedLevelIds.includes(levelId)) next.unlockedLevelIds.push(levelId);
  return next;
}
