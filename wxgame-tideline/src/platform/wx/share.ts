export interface WxShareApi {
  shareAppMessage?: (options: { title: string; imageUrl?: string; query?: string }) => void;
}

/** 分享参与奖励，不判断是否真实发送；生命周期由运行时唯一监听器转交。 */
export class WxShareAdapter {
  private readonly api: WxShareApi;
  private pending?: { id: string; hidden: boolean };
  constructor(api: WxShareApi) { this.api = api; }
  get available(): boolean { return typeof this.api.shareAppMessage === 'function'; }
  begin(id: string): boolean {
    if (!this.available || this.pending) return false;
    this.pending = { id, hidden: false };
    try {
      this.api.shareAppMessage?.({ title: '挤上这班车！来潮汐线挑战早高峰', query: 'source=commute-supply' });
      return true;
    } catch { this.pending = undefined; return false; }
  }
  onHide(): void { if (this.pending) this.pending.hidden = true; }
  onShow(): string | undefined { return this.pending?.hidden ? this.pending.id : undefined; }
  complete(id: string): boolean {
    if (this.pending?.id !== id) return false;
    this.pending = undefined;
    return true;
  }
  cancel(): void { this.pending = undefined; }
}
