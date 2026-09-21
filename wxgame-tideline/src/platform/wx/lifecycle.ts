export type WxShowListener = (options?: unknown) => void;
export type WxHideListener = () => void;

export interface WxLifecycleApi {
  onShow?: (listener: WxShowListener) => void;
  onHide?: (listener: WxHideListener) => void;
  offShow?: (listener: WxShowListener) => void;
  offHide?: (listener: WxHideListener) => void;
}

export interface LifecycleHandlers {
  onPause?: () => void;
  onResume?: () => void;
  /** Called for every show event, including show events that have no matching hide. */
  onShow?: (options?: unknown) => void;
}

/**
 * 将微信前后台事件转换成幂等的暂停/恢复回调。
 * 适配器不直接操作模拟器，调用方应在 onPause/onResume 中暂停固定步长循环。
 */
export class WxLifecycleAdapter {
  private readonly api: WxLifecycleApi;
  private readonly handlers: LifecycleHandlers;
  private _attached = false;
  private _paused = false;

  private readonly showListener: WxShowListener = (options) => {
    if (!this._attached) return;
    // Some share surfaces emit onShow without a preceding onHide. Keep the
    // transition callback idempotent, but still notify the runtime so it can
    // redraw a canvas whose backing surface was discarded by the host.
    const wasPaused = this._paused;
    this.resume();
    if (!wasPaused) this.handlers.onShow?.(options);
  };
  private readonly hideListener: WxHideListener = () => {
    if (this._attached) this.pause();
  };

  constructor(api: WxLifecycleApi, handlers: LifecycleHandlers = {}) {
    this.api = api;
    this.handlers = handlers;
  }

  get attached(): boolean {
    return this._attached;
  }

  get paused(): boolean {
    return this._paused;
  }

  attach(): void {
    if (this._attached) return;
    this.api.onShow?.(this.showListener);
    this.api.onHide?.(this.hideListener);
    this._attached = true;
  }

  detach(): void {
    if (!this._attached) return;
    this.api.offShow?.(this.showListener);
    this.api.offHide?.(this.hideListener);
    this._attached = false;
  }

  pause(): boolean {
    if (this._paused) return false;
    this._paused = true;
    this.handlers.onPause?.();
    return true;
  }

  resume(): boolean {
    if (!this._paused) return false;
    this._paused = false;
    this.handlers.onResume?.();
    return true;
  }
}

export function createWxLifecycleAdapter(
  api: WxLifecycleApi,
  handlers: LifecycleHandlers = {},
): WxLifecycleAdapter {
  return new WxLifecycleAdapter(api, handlers);
}
