import type { SaveData } from './types.ts';

export interface AppearanceOption {
  id: string;
  label: string;
  condition: string;
}

export const APPEARANCE_OPTIONS: readonly AppearanceOption[] = [
  { id: 'default', label: '基础通勤装', condition: '默认开放' },
  { id: 'seafoam', label: '海风薄荷', condition: '通关海风门' },
  { id: 'sunset', label: '晚霞橙', condition: '累计获得 6 颗星' },
  { id: 'night', label: '夜行蓝', condition: '完成 12 站战役' },
];

function clearCount(save: SaveData): number {
  return save.achievements.filter((achievement) => achievement.startsWith('clear:')).length;
}

function starCount(save: SaveData): number {
  return Object.values(save.bestStars).reduce((total, stars) => total + Math.min(3, Math.max(0, Math.floor(stars))), 0);
}

export function isAppearanceUnlocked(save: SaveData, appearanceId: string): boolean {
  switch (appearanceId) {
    case 'default': return true;
    case 'seafoam': return save.achievements.includes('clear:sea-gate');
    case 'sunset': return starCount(save) >= 6;
    case 'night': return clearCount(save) >= 12;
    default: return false;
  }
}

export function unlockedAppearanceIds(save: SaveData): string[] {
  return APPEARANCE_OPTIONS.filter((option) => isAppearanceUnlocked(save, option.id)).map((option) => option.id);
}
