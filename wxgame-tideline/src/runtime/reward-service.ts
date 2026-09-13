import { migrateSave } from '../core/save-schema.ts';
import { ITEM_IDS } from '../core/items.ts';
import type { ItemId, SaveData } from '../core/types.ts';

export type RewardSource = 'rewarded-ad' | 'share-participation';
export interface RewardRequest { id: string; itemId: ItemId; source: RewardSource }

/** 保存成功才发布内存状态；调用者控制当前有效请求，存档再保护重复提交。 */
export class RewardService {
  private readonly read: () => SaveData;
  private readonly commit: (next: SaveData) => boolean;
  constructor(read: () => SaveData, commit: (next: SaveData) => boolean) {
    this.read = read;
    this.commit = commit;
  }

  grant(request: RewardRequest): boolean {
    const next = migrateSave(this.read());
    if (next.items.recentGrantedRequestIds.includes(request.id)) return true;
    if (next.items.inventory[request.itemId] >= Number.MAX_SAFE_INTEGER) return false;
    next.items.inventory[request.itemId] += 1;
    next.items.recentGrantedRequestIds = [...next.items.recentGrantedRequestIds, request.id].slice(-64);
    return this.commit(next);
  }

  welcome(): boolean {
    const next = migrateSave(this.read());
    if (next.items.welcomeGiftStatus !== 'eligible') return true;
    for (const id of ITEM_IDS) next.items.inventory[id] = Math.min(Number.MAX_SAFE_INTEGER, next.items.inventory[id] + 1);
    next.items.welcomeGiftStatus = 'granted';
    return this.commit(next);
  }

  recoverUse(): boolean {
    const next = migrateSave(this.read());
    if (!next.items.pendingUse) return true;
    const id = next.items.pendingUse.itemId;
    next.items.inventory[id] = Math.min(Number.MAX_SAFE_INTEGER, next.items.inventory[id] + 1);
    next.items.pendingUse = null;
    return this.commit(next);
  }

  reserveUse(itemId: ItemId, requestId: string, runId: string): boolean {
    const next = migrateSave(this.read());
    if (next.items.pendingUse || next.items.inventory[itemId] <= 0) return false;
    next.items.inventory[itemId] -= 1;
    next.items.pendingUse = { requestId, itemId, runId };
    return this.commit(next);
  }

  finishUse(requestId: string): boolean {
    const next = migrateSave(this.read());
    if (next.items.pendingUse?.requestId !== requestId) return false;
    next.items.pendingUse = null;
    return this.commit(next);
  }
}
