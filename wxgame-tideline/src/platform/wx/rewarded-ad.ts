export interface RewardedAdLike {
  load(): Promise<unknown>;
  show(): Promise<unknown>;
  onClose(listener: (result?: { isEnded?: boolean }) => void): void;
  offClose(listener: (result?: { isEnded?: boolean }) => void): void;
  onError(listener: (error?: unknown) => void): void;
  offError(listener: (error?: unknown) => void): void;
  destroy?(): void;
}
export interface WxRewardedAdApi { createRewardedVideoAd?: (options: { adUnitId: string }) => RewardedAdLike }
export type AdResult = 'completed' | 'cancelled' | 'unavailable';

/** 每次展示独立监听闭包；晚到的旧回调不能完成新请求。 */
export class WxRewardedAdAdapter {
  private ad?: RewardedAdLike;
  private pending?: { finish: (result: AdResult) => void };
  private disposed = false;
  private readonly api: WxRewardedAdApi;
  private readonly adUnitId: string;
  private initialized = false;
  readonly unavailableReason: string;

  constructor(api: WxRewardedAdApi, adUnitId = '') {
    this.api = api;
    this.adUnitId = adUnitId.trim();
    this.unavailableReason = !adUnitId.trim() ? '视频补给暂未开放，可选择分享领取' : '当前暂无可用广告，可选择分享领取';
  }

  /** 首屏后预加载；用户先点击广告时也走同一个幂等入口。 */
  preload(): void {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    if (this.adUnitId && this.api.createRewardedVideoAd) {
      try {
        this.ad = this.api.createRewardedVideoAd({ adUnitId: this.adUnitId });
        void this.ad.load().catch(() => undefined);
      } catch { this.ad = undefined; }
    }
  }

  get available(): boolean {
    return !this.disposed && (this.initialized
      ? Boolean(this.ad)
      : Boolean(this.adUnitId && this.api.createRewardedVideoAd));
  }
  watch(): Promise<AdResult> {
    this.preload();
    const ad = this.ad;
    if (!ad || this.disposed || this.pending) return Promise.resolve('unavailable');
    return new Promise((resolve) => {
      const active = { finish: (result: AdResult): void => {
        if (this.pending !== active) return;
        this.pending = undefined;
        try { ad.offClose(close); } catch { /* 已释放 */ }
        try { ad.offError(error); } catch { /* 已释放 */ }
        resolve(result);
      } };
      const close = (result?: { isEnded?: boolean }): void => active.finish(result?.isEnded === true ? 'completed' : 'cancelled');
      // 加载失败交由 show/load 的 Promise 链重试；展示后错误及时退出。
      let shown = false;
      const error = (): void => { if (shown) active.finish('unavailable'); };
      this.pending = active;
      try {
        ad.onClose(close);
        ad.onError(error);
        void (async () => {
          try {
            try { await ad.show(); }
            catch {
              if (this.pending !== active) return;
              await ad.load();
              if (this.pending !== active) return;
              await ad.show();
            }
            shown = true;
          } catch { active.finish('unavailable'); }
        })();
      } catch { active.finish('unavailable'); }
    });
  }

  destroy(): void {
    this.disposed = true;
    this.pending?.finish('unavailable');
    try { this.ad?.destroy?.(); } catch { /* 释放失败不阻断退出 */ }
    this.ad = undefined;
  }
}
