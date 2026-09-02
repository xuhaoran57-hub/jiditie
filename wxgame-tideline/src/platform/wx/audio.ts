import { clamp } from '../../core/vector.ts';

export interface WxInnerAudioContextLike {
  src: string;
  loop: boolean;
  volume: number;
  obeyMuteSwitch?: boolean;
  play(): unknown;
  stop(): unknown;
  destroy?: () => unknown;
}

export interface WxAudioApi {
  createInnerAudioContext(): WxInnerAudioContextLike;
}

export interface AudioSettings {
  soundEnabled: boolean;
  musicEnabled: boolean;
  masterVolume: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  soundEnabled: true,
  musicEnabled: true,
  masterVolume: 1,
};

function safeInvokePlay(context: WxInnerAudioContextLike): boolean {
  try {
    const result = context.play();
    if (result && typeof result === 'object' && 'catch' in result) {
      const catchMethod = (result as { catch?: (handler: () => void) => unknown }).catch;
      if (typeof catchMethod === 'function') {
        void catchMethod.call(result, () => undefined);
      }
    }
    return true;
  } catch {
    return false;
  }
}

function safeInvokeStop(context: WxInnerAudioContextLike): void {
  try {
    context.stop();
  } catch {
    // 音频停止失败不应阻塞场景切换或退出流程。
  }
}

function setMuteSwitch(context: WxInnerAudioContextLike): void {
  try {
    context.obeyMuteSwitch = true;
  } catch {
    // 老版本或只读 mock 没有该属性时继续播放。
  }
}

/**
 * 微信 InnerAudioContext 的最小封装。首次用户触摸/点击后调用
 * `markUserGesture()`，随后才允许播放，避免部分设备的自动播放限制。
 */
export class WxAudioAdapter {
  private readonly api: WxAudioApi;
  private readonly effects = new Map<string, WxInnerAudioContextLike>();
  private musicContext: WxInnerAudioContextLike | undefined;
  private _unlocked = false;
  private _settings: AudioSettings;

  constructor(api: WxAudioApi, settings: Partial<AudioSettings> = {}) {
    this.api = api;
    this._settings = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...settings,
      masterVolume: clamp(settings.masterVolume ?? DEFAULT_AUDIO_SETTINGS.masterVolume, 0, 1),
    };
  }

  get unlocked(): boolean {
    return this._unlocked;
  }

  get settings(): AudioSettings {
    return { ...this._settings };
  }

  markUserGesture(): void {
    this._unlocked = true;
  }

  unlock(): void {
    this.markUserGesture();
  }

  setSettings(settings: Partial<AudioSettings>): void {
    this._settings = {
      ...this._settings,
      ...settings,
      masterVolume: clamp(settings.masterVolume ?? this._settings.masterVolume, 0, 1),
    };
    if (!this._settings.musicEnabled) this.stopMusic();
    if (!this._settings.soundEnabled) this.stopEffects();
  }

  setSoundEnabled(enabled: boolean): void {
    this.setSettings({ soundEnabled: enabled });
  }

  setMusicEnabled(enabled: boolean): void {
    this.setSettings({ musicEnabled: enabled });
  }

  playEffect(source: string, volume = 1): boolean {
    if (!source || !this._unlocked || !this._settings.soundEnabled) return false;
    const context = this.getEffectContext(source);
    if (!context) return false;
    return this.configureAndPlay(
      context,
      source,
      false,
      clamp(volume, 0, 1) * this._settings.masterVolume,
    );
  }

  playMusic(source: string, volume = 1): boolean {
    if (!source || !this._unlocked || !this._settings.musicEnabled) return false;
    if (!this.musicContext) {
      try {
        this.musicContext = this.api.createInnerAudioContext();
      } catch {
        return false;
      }
    }
    return this.configureAndPlay(
      this.musicContext,
      source,
      true,
      clamp(volume, 0, 1) * this._settings.masterVolume,
    );
  }

  stopMusic(): void {
    if (this.musicContext) safeInvokeStop(this.musicContext);
  }

  stopEffects(): void {
    for (const context of this.effects.values()) safeInvokeStop(context);
  }

  destroy(): void {
    this.stopMusic();
    this.stopEffects();
    const contexts = [...this.effects.values(), ...(this.musicContext ? [this.musicContext] : [])];
    for (const context of contexts) {
      try {
        context.destroy?.();
      } catch {
        // 释放失败时继续释放其余音频上下文。
      }
    }
    this.effects.clear();
    this.musicContext = undefined;
  }

  private getEffectContext(source: string): WxInnerAudioContextLike | undefined {
    const existing = this.effects.get(source);
    if (existing) return existing;
    try {
      const context = this.api.createInnerAudioContext();
      if (!context) return undefined;
      setMuteSwitch(context);
      this.effects.set(source, context);
      return context;
    } catch {
      return undefined;
    }
  }

  private configureAndPlay(
    context: WxInnerAudioContextLike,
    source: string,
    loop: boolean,
    volume: number,
  ): boolean {
    try {
      context.src = source;
      context.loop = loop;
      context.volume = clamp(volume, 0, 1);
      setMuteSwitch(context);
    } catch {
      return false;
    }
    return safeInvokePlay(context);
  }
}

export function createWxAudioAdapter(
  api: WxAudioApi,
  settings: Partial<AudioSettings> = {},
): WxAudioAdapter {
  return new WxAudioAdapter(api, settings);
}
