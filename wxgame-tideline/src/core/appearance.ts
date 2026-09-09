import type { SaveData } from './types.ts';

export interface AppearanceOption {
  id: string;
  label: string;
  condition: string;
}

export const APPEARANCE_OPTIONS: readonly AppearanceOption[] = [
  { id: 'endless5', label: '无尽五回合', condition: '无尽模式达到 5 轮' },
  { id: 'endless10', label: '无尽十回合', condition: '无尽模式达到 10 轮' },
  { id: 'endless15', label: '无尽十五回合', condition: '无尽模式达到 15 轮' },
  { id: 'endless20', label: '无尽二十回合', condition: '无尽模式达到 20 轮' },
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
    case 'endless5': return save.endlessBestWave >= 5;
    case 'endless10': return save.endlessBestWave >= 10;
    case 'endless15': return save.endlessBestWave >= 15;
    case 'endless20': return save.endlessBestWave >= 20;
    default: return false;
  }
}

export function unlockedAppearanceIds(save: SaveData): string[] {
  return APPEARANCE_OPTIONS.filter((option) => isAppearanceUnlocked(save, option.id)).map((option) => option.id);
}
