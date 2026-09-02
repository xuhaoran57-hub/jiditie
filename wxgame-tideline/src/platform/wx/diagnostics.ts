export type DiagnosticType = 'error' | 'unhandled-rejection';

export interface WxUnhandledRejectionLike {
  reason?: unknown;
}

export interface WxDiagnosticsApi {
  onError?: (listener: (error: unknown) => void) => void;
  onUnhandledRejection?: (listener: (event: WxUnhandledRejectionLike) => void) => void;
  offError?: (listener: (error: unknown) => void) => void;
  offUnhandledRejection?: (listener: (event: WxUnhandledRejectionLike) => void) => void;
}

export interface DiagnosticRecord {
  type: DiagnosticType;
  /** 仅保留错误类别，不保存原始 message/stack，避免泄漏路径或用户输入。 */
  label: string;
  at: number;
}

export interface DiagnosticsLogger {
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface WxDiagnosticsOptions {
  logger?: DiagnosticsLogger;
  now?: () => number;
  maxRecords?: number;
}

const DEFAULT_MAX_RECORDS = 20;

function safeLabel(value: unknown): string {
  if (value instanceof Error) {
    const name = value.name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 48);
    return name || 'Error';
  }
  if (typeof value === 'string') return 'StringError';
  if (value === null) return 'NullError';
  return `${typeof value}Error`;
}

/**
 * 微信全局错误事件的最小封装。默认不向 console 输出原始错误，生产环境只保留
 * 有限长度的错误类别记录；如需上报，应由调用方再接入经过脱敏的后端接口。
 */
export class WxDiagnostics {
  private readonly api: WxDiagnosticsApi;
  private readonly logger: DiagnosticsLogger;
  private readonly now: () => number;
  private readonly maxRecords: number;
  private readonly records: DiagnosticRecord[] = [];
  private _attached = false;

  private readonly errorListener = (error: unknown): void => {
    this.capture('error', error);
  };

  private readonly rejectionListener = (event: WxUnhandledRejectionLike): void => {
    this.capture('unhandled-rejection', event?.reason);
  };

  constructor(api: WxDiagnosticsApi, options: WxDiagnosticsOptions = {}) {
    this.api = api;
    this.logger = options.logger ?? {};
    this.now = options.now ?? (() => Date.now());
    const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.maxRecords = Number.isFinite(maxRecords) ? Math.max(1, Math.floor(maxRecords)) : DEFAULT_MAX_RECORDS;
  }

  get attached(): boolean {
    return this._attached;
  }

  attach(): void {
    if (this._attached) return;
    this.api.onError?.(this.errorListener);
    this.api.onUnhandledRejection?.(this.rejectionListener);
    this._attached = true;
  }

  detach(): void {
    if (!this._attached) return;
    this.api.offError?.(this.errorListener);
    this.api.offUnhandledRejection?.(this.rejectionListener);
    this._attached = false;
  }

  capture(type: DiagnosticType, value: unknown): DiagnosticRecord {
    const record: DiagnosticRecord = {
      type,
      label: safeLabel(value),
      at: this.now(),
    };
    this.records.push(record);
    while (this.records.length > this.maxRecords) this.records.shift();
    const message = `[tideline:${record.type}] ${record.label}`;
    try {
      if (type === 'error') this.logger.error?.(message);
      else this.logger.warn?.(message);
    } catch {
      // 日志实现本身失败时仍返回诊断记录，不让错误处理再次抛错。
    }
    return { ...record };
  }

  getRecent(): DiagnosticRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  clear(): void {
    this.records.length = 0;
  }
}

export function createWxDiagnostics(
  api: WxDiagnosticsApi,
  options: WxDiagnosticsOptions = {},
): WxDiagnostics {
  return new WxDiagnostics(api, options);
}
