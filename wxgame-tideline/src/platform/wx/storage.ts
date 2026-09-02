import type { SaveData } from '../../core/types.ts';
import {
  emptySave,
  parseSave,
  serializeSave,
} from '../../core/save-schema.ts';

export interface WxStorageApi {
  getStorageSync?: (key: string) => unknown;
  setStorageSync?: (key: string, value: unknown) => void;
  removeStorageSync?: (key: string) => void;
}

export const DEFAULT_SAVE_KEY = 'tideline.save.v1';

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
    if (!this.api.getStorageSync) return emptySave();
    try {
      return parseSave(this.api.getStorageSync(this.key));
    } catch {
      return emptySave();
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
