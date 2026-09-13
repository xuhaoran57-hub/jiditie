import type { GameState, ItemId, ItemSaveState, ItemUseResult, LevelConfig } from './types.ts';
import { guideTargets } from './ability.ts';

export const ITEM_IDS: readonly ItemId[] = ['commute-horn', 'delay-ticket'];
export const ITEMS = {
  'commute-horn': { name: '通勤喇叭', shortName: '喇叭', description: '疏通前方最多 4 名乘客', hint: '观察人流后可用', color: '#63ead4' },
  'delay-ticket': { name: '延时车票', shortName: '车票', description: '关门倒计时增加 3 秒', hint: '上车倒计时开始后可用', color: '#ffd36a' },
} as const;
export const DELAY_SECONDS = 3;
export function isItemId(value: unknown): value is ItemId { return value === 'commute-horn' || value === 'delay-ticket'; }
export function emptyItemCounts(): Record<ItemId, number> { return { 'commute-horn': 0, 'delay-ticket': 0 }; }
export function emptyItemSave(): ItemSaveState {
  return { inventory: emptyItemCounts(), welcomeGiftStatus: 'ineligible', tutorialSeen: false, recentGrantedRequestIds: [], pendingUse: null };
}
export function itemPhaseAllowed(state: GameState, id: ItemId): boolean {
  return id === 'delay-ticket'
    ? (state.phase === 'boarding' || state.phase === 'warning') && state.doorRemaining > 0
    : ['positioning', 'exiting', 'boarding', 'warning'].includes(state.phase);
}
export function checkItemUse(state: GameState, level: LevelConfig, id: ItemId): ItemUseResult {
  if (!itemPhaseAllowed(state, id)) return { used: false, reason: 'phase' };
  if (state.itemUses[id] >= 1) return { used: false, reason: 'limit' };
  if (id === 'commute-horn' && guideTargets(state, level, true).length === 0) return { used: false, reason: 'no-target' };
  return { used: true };
}
