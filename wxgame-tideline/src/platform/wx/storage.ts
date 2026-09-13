import type { SaveData } from '../../core/types.ts';
import {
  emptySave,
  parseSave,
  serializeSave,
  SAVE_VERSION,
} from '../../core/save-schema.ts';

export interface WxStorageApi {
  getStorageSync?: (key: string) => unknown;
  setStorageSync?: (key: string, value: unknown) => void;
  removeStorageSync?: (key: string) => void;
}

export const DEFAULT_SAVE_KEY = 'tideline.save.v1';
export type SaveLoadStatus = 'missing' | 'loaded' | 'corrupt' | 'unsupported' | 'unavailable';
export interface SaveLoadResult { save: SaveData; status: SaveLoadStatus }

/**
 * 存档适配器只处理序列化和异常回退，具体 schema 仍由 core/save-schema 负责。
 * 所有方法都将微信存储异常转换成可恢复的返回值，不让存档问题阻塞游戏启动。
 */
export class WxStorageAdapter {
  readonly key: string;
  private readonly api: WxStorageApi;

  constructor(api: WxStorageApi, key = DEFAULT_SAVE_KEY) {
    this.api = api;
    this.key = key;
  }

  load(): SaveData {
    return this.loadWithStatus().save;
  }

  loadWithStatus(): SaveLoadResult {
    if (!this.api.getStorageSync) return { save: emptySave(), status: 'unavailable' };
    try {
      const raw = this.api.getStorageSync(this.key);
      if (raw === undefined || raw === null || raw === '') return { save: emptySave(), status: 'missing' };
      let value: unknown;
      try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch { return { save: emptySave(), status: 'corrupt' }; }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { save: emptySave(), status: 'corrupt' };
      if (Number((value as Record<string, unknown>).version ?? 0) > SAVE_VERSION) return { save: emptySave(), status: 'unsupported' };
      return { save: parseSave(value), status: 'loaded' };
    } catch {
      return { save: emptySave(), status: 'unavailable' };
    }
  }

  save(value: SaveData): boolean {
    if (!this.api.setStorageSync) return false;
    try {
      this.api.setStorageSync(this.key, serializeSave(value));
      return true;
    } catch {
      return false;
    }
  }

  clear(): boolean {
    if (!this.api.removeStorageSync) return false;
    try {
      this.api.removeStorageSync(this.key);
      return true;
    } catch {
      return false;
    }
  }
}

export function createWxStorageAdapter(
  api: WxStorageApi,
  key = DEFAULT_SAVE_KEY,
): WxStorageAdapter {
  return new WxStorageAdapter(api, key);
}
