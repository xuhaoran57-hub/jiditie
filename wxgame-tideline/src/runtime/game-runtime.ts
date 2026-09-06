import {
  GameSimulation,
  CAMPAIGN_LEVELS,
  migrateSave,
  unlockedAppearanceIds,
  isAppearanceUnlocked,
  setAppearance,
  unlockLevel,
  updateBestScore,
  updateBestStars,
} from '../core/index.ts';
import type {
  EventRecord,
  GameState,
  LevelConfig,
  SaveSettings,
  SaveData,
  SimulationInput,
} from '../core/types.ts';
import { FixedTimestepLoop } from '../platform/debug/fixed-loop.ts';
import {
  createWxAudioAdapter,
  createWxCanvasAdapter,
  createWxDiagnostics,
  createWxLifecycleAdapter,
  createWxStorageAdapter,
  WxAudioAdapter,
  WxCanvasAdapter,
  WxDiagnostics,
  WxLifecycleAdapter,
  WxStorageAdapter,
  WxTouchInputAdapter,
} from '../platform/wx/index.ts';
import type {
  DiagnosticsLogger,
  WxAudioApi,
  WxCanvasApi,
  WxDiagnosticsApi,
  WxInnerAudioContextLike,
  WxLifecycleApi,
  WxStorageApi,
  WxTouchApi,
  WxTouchInputOptions,
  TouchControlsLayout,
} from '../platform/wx/index.ts';
import {
  GameRenderer,
  menuButtonRect,
  pageBackRect,
  routeCardRect,
  routeListRect,
  routeListCardRect,
  routeDropdownRect,
  screenDirectionToWorld,
} from '../render/index.ts';
import type { RenderOptions } from '../render/index.ts';

/**
 * game.js 只需把微信全局对象注入这里。接口故意只声明本运行时实际用到的
 * 能力，因而可以在 Node 集成测试中用很小的 mock 替代微信 SDK。
 */
export interface WxGameApi
  extends WxCanvasApi,
    WxTouchApi,
    WxStorageApi,
    WxLifecycleApi,
    WxDiagnosticsApi {
  createInnerAudioContext?: () => WxInnerAudioContextLike;
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

export type RuntimeScreen = 'home' | 'route' | 'briefing' | 'game' | 'result' | 'achievements' | 'appearance' | 'settings';

export interface RuntimeScheduler {
  request(callback: (timestamp: number) => void): unknown;
  cancel(handle: unknown): void;
}

export interface RuntimeAudioSources {
  music?: string;
  guide?: string;
  success?: string;
  failure?: string;
  eventStart?: string;
}

/** M6 随包提供的自有音效；调用方可用 `audioSources` 覆盖或置空单项。 */
export const DEFAULT_RUNTIME_AUDIO_SOURCES: Required<RuntimeAudioSources> = {
  music: 'assets/audio/tideline-loop.wav',
  guide: 'assets/audio/ui-guide.wav',
  success: 'assets/audio/ui-success.wav',
  failure: 'assets/audio/ui-failure.wav',
  eventStart: 'assets/audio/event-alert.wav',
};

export interface GameRuntimeOptions {
  api?: WxGameApi;
  /** `wx` 是面向入口调用的别名，和 api 二选一即可。 */
  wx?: WxGameApi;
  levels?: readonly LevelConfig[];
  seed?: number | string;
  initialLevelId?: string;
  fixedDelta?: number;
  maxFrameDelta?: number;
  scheduler?: RuntimeScheduler;
  now?: () => number;
  canvasAdapter?: WxCanvasAdapter;
  renderer?: GameRenderer;
  inputAdapter?: WxTouchInputAdapter;
  storageAdapter?: WxStorageAdapter;
  audioAdapter?: WxAudioAdapter;
  lifecycleAdapter?: WxLifecycleAdapter;
  diagnostics?: WxDiagnostics;
  diagnosticsLogger?: DiagnosticsLogger;
  audioSources?: RuntimeAudioSources;
  /** 构造完成后是否立即 attach 并启动 ticker；默认 false，入口通常显式调用 start。 */
  autoStart?: boolean;
}

export interface RuntimeSnapshot {
  screen: RuntimeScreen;
  selectedLevelIndex: number;
  selectedLevelId: string;
  unlockedLevelIds: string[];
  bestScores: Record<string, number>;
  bestStars: Record<string, number>;
  achievements: string[];
  appearanceId: string;
  unlockedAppearanceIds: string[];
  routeMenuExpanded: boolean;
  routeScrollOffset: number;
  paused: boolean;
  running: boolean;
  state: GameState | null;
}

const DEFAULT_SEED: number | string = 1;

function isWxApi(value: GameRuntimeOptions | WxGameApi): value is WxGameApi {
  return typeof (value as WxGameApi).createCanvas === 'function';
}

function copyState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function silentAudioApi(): WxAudioApi {
  return {
    createInnerAudioContext: () => ({
      src: '',
      loop: false,
      volume: 0,
      play: () => undefined,
      stop: () => undefined,
    }),
  };
}

function defaultScheduler(api: WxGameApi | undefined, now: () => number): RuntimeScheduler {
  if (api?.requestAnimationFrame) {
    const request = api.requestAnimationFrame.bind(api);
    const cancel = api.cancelAnimationFrame?.bind(api);
    return {
      request: (callback) => request(callback),
      cancel: (handle) => {
        if (cancel) cancel(handle as number);
      },
    };
  }

  return {
    request: (callback) => {
      const handle = setTimeout(() => callback(now()), 16);
      return handle;
    },
    cancel: (handle) => {
      clearTimeout(handle as number);
    },
  };
}

function safeIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(value)));
}

export class GameRuntime {
  readonly levels: readonly LevelConfig[];
  readonly loop: FixedTimestepLoop;
  readonly renderer: GameRenderer;
  readonly canvasAdapter?: WxCanvasAdapter;
  readonly input: WxTouchInputAdapter;
  readonly storage: WxStorageAdapter;
  readonly audio: WxAudioAdapter;
  readonly lifecycle: WxLifecycleAdapter;
  readonly diagnostics: WxDiagnostics;

  private readonly scheduler: RuntimeScheduler;
  private readonly now: () => number;
  private readonly baseSeed: number | string;
  private readonly audioSources: RuntimeAudioSources;
  private screenValue: RuntimeScreen = 'home';
  private selectedLevelIndexValue = 0;
  private routeMenuExpanded = false;
  private routeScrollOffset = 0;
  private saveValue: SaveData;
  private simulation?: GameSimulation;
  private currentSeed: number | string;
  private previewState: GameState;
  private userPaused = false;
  private lifecyclePaused = false;
  private runningValue = false;
  private frameHandle: unknown = null;
  private lastFrameTimestamp: number | undefined;
  private scheduleToken = 0;
  private resultRecorded = false;
  private musicStarted = false;
  private audioEventCursor = 0;

  private handleFrame(timestamp: number, token: number): void {
    if (token !== this.scheduleToken) return;
    this.frameHandle = null;
    if (!this.runningValue) return;
    const current = Number.isFinite(timestamp) ? timestamp : this.now();
    if (this.lastFrameTimestamp === undefined) {
      this.lastFrameTimestamp = current;
    } else {
      const delta = Math.max(0, (current - this.lastFrameTimestamp) / 1000);
      this.lastFrameTimestamp = current;
      this.tick(delta);
    }
    this.scheduleFrame();
  }

  constructor(options: GameRuntimeOptions);
  constructor(api: WxGameApi, options?: Omit<GameRuntimeOptions, 'api'>);
  constructor(
    first: GameRuntimeOptions | WxGameApi,
    second: Omit<GameRuntimeOptions, 'api'> = {},
  ) {
    const options: GameRuntimeOptions = isWxApi(first)
      ? { ...second, api: first }
      : first;
    const api = options.api ?? options.wx;
    this.levels = options.levels && options.levels.length > 0 ? options.levels : CAMPAIGN_LEVELS;
    this.baseSeed = options.seed ?? DEFAULT_SEED;
    this.now = options.now ?? (() => Date.now());
    this.audioSources = {
      ...DEFAULT_RUNTIME_AUDIO_SOURCES,
      ...(options.audioSources ?? {}),
    };

    const canvasAdapter = options.canvasAdapter
      ?? (options.renderer ? undefined : this.createCanvasAdapter(api));
    this.canvasAdapter = canvasAdapter;

    if (options.renderer) {
      this.renderer = options.renderer;
    } else if (canvasAdapter) {
      this.renderer = GameRenderer.fromCanvas(
        canvasAdapter.canvas,
        canvasAdapter.viewport.width,
        canvasAdapter.viewport.height,
        canvasAdapter.viewport.dpr,
        canvasAdapter.viewport.insets,
        this.levels[0],
        { imageFactory: canvasAdapter.imageFactory },
      );
    } else {
      throw new Error('GameRuntime requires a renderer or canvasAdapter');
    }

    this.storage = options.storageAdapter ?? createWxStorageAdapter(api ?? {});
    this.saveValue = this.normalizeSave(this.storage.load());

    const audioApi: WxAudioApi = api?.createInnerAudioContext
      ? { createInnerAudioContext: api.createInnerAudioContext.bind(api) }
      : silentAudioApi();
    this.audio = options.audioAdapter ?? createWxAudioAdapter(audioApi, {
      soundEnabled: this.saveValue.settings.soundEnabled,
      musicEnabled: this.saveValue.settings.musicEnabled,
    });
    // 注入的音频适配器也要遵守存档中的静音设置。
    this.audio.setSettings({
      soundEnabled: this.saveValue.settings.soundEnabled,
      musicEnabled: this.saveValue.settings.musicEnabled,
    });

    this.loop = new FixedTimestepLoop(options.fixedDelta, options.maxFrameDelta);
    this.input = options.inputAdapter ?? new WxTouchInputAdapter(
      api ?? {},
      this.emptyTouchLayout(),
      {
        onUserGesture: () => this.markUserGesture(),
      } satisfies WxTouchInputOptions,
    );

    this.lifecycle = options.lifecycleAdapter ?? createWxLifecycleAdapter(
      api ?? {},
      {
        onPause: () => this.handleLifecyclePause(),
        onResume: () => this.handleLifecycleResume(),
      },
    );
    this.diagnostics = options.diagnostics ?? createWxDiagnostics(
      api ?? {},
      { logger: options.diagnosticsLogger, now: this.now },
    );
    this.scheduler = options.scheduler ?? defaultScheduler(api, this.now);
    this.lifecyclePaused = this.lifecycle.paused;

    const initialIndex = this.resolveInitialIndex(options.initialLevelId);
    this.selectedLevelIndexValue = initialIndex;
    this.currentSeed = this.seedForLevel(this.currentLevel.id);
    this.previewState = new GameSimulation(this.currentLevel, this.currentSeed).snapshot();
    this.updateInputLayout();
    this.syncLoopPause();

    if (options.autoStart) this.start();
  }

  get screen(): RuntimeScreen {
    return this.screenValue;
  }

  get selectedLevelIndex(): number {
    return this.selectedLevelIndexValue;
  }

  get selectedLevelId(): string {
    return this.currentLevel.id;
  }

  get currentLevel(): LevelConfig {
    const level = this.levels[this.selectedLevelIndexValue] ?? this.levels[0];
    if (!level) throw new Error('GameRuntime requires at least one level');
    return level;
  }

  get state(): GameState | null {
    return this.simulation?.getState() ?? null;
  }

  getState(): GameState | null {
    return this.state;
  }

  get saveData(): SaveData {
    return copyState(this.saveValue);
  }

  getSaveData(): SaveData {
    return this.saveData;
  }

  get paused(): boolean {
    return this.userPaused || this.lifecyclePaused;
  }

  get running(): boolean {
    return this.runningValue;
  }

  /** 启动输入、生命周期监听和唯一 ticker；重复调用不会创建第二条循环。 */
  start(): boolean {
    if (this.runningValue) return false;
    // 上一次 stop 可能发生在后台；重新启动时清掉适配器残留的后台标记，
    // 但保留运行时自己的用户暂停状态。
    if (this.lifecycle.paused) this.lifecycle.resume();
    this.runningValue = true;
    this.scheduleToken += 1;
    this.lastFrameTimestamp = undefined;
    this.input.attach();
    this.lifecycle.attach();
    this.diagnostics.attach();
    this.syncLoopPause();
    this.render();
    this.scheduleFrame();
    return true;
  }

  stop(): boolean {
    if (!this.runningValue) return false;
    this.runningValue = false;
    this.scheduleToken += 1;
    this.lastFrameTimestamp = undefined;
    if (this.frameHandle !== null) {
      try {
        this.scheduler.cancel(this.frameHandle);
      } catch {
        // 调度器释放失败不应阻止输入和生命周期解绑。
      }
      this.frameHandle = null;
    }
    this.input.detach();
    this.lifecycle.detach();
    this.diagnostics.detach();
    return true;
  }

  destroy(): void {
    this.stop();
    this.audio.destroy();
  }

  /** 手动推进一帧，测试和桌面调试可直接调用；frameDelta 单位为秒。 */
  tick(frameDelta: number): number {
    this.syncExternalLifecycleState();
    const flowChanged = this.processCommands();
    this.syncExternalLifecycleState();

    let steps = 0;
    if (!flowChanged && this.screenValue === 'game' && this.simulation && !this.paused) {
      this.syncLoopPause();
      steps = this.loop.advance(frameDelta, this.simulation, () => this.sampleSimulationInput());
      this.detectResult();
    }
    this.render();
    return steps;
  }

  advance(frameDelta: number): number {
    return this.tick(frameDelta);
  }

  update(frameDelta: number): number {
    return this.tick(frameDelta);
  }

  runFrame(frameDelta: number): number {
    return this.tick(frameDelta);
  }

  resize(): void {
    const viewport = this.canvasAdapter?.refresh() ?? this.renderer.context.layout.viewport;
    this.renderer.resize(viewport.width, viewport.height, viewport.dpr, viewport.insets);
    this.updateInputLayout();
    this.render();
  }

  /** 选择一个已解锁关卡，先展示三星目标，确认后才开始。 */
  selectLevel(levelOrIndex: string | number): boolean {
    const index = this.resolveLevelIndex(levelOrIndex);
    if (index < 0 || !this.isUnlocked(this.levels[index]?.id)) return false;
    this.selectedLevelIndexValue = index;
    this.screenValue = 'briefing';
    this.simulation = undefined;
    this.previewState = new GameSimulation(this.currentLevel, this.seedForLevel(this.currentLevel.id)).snapshot();
    this.updateInputLayout();
    this.render();
    return true;
  }

  confirmStart(): boolean {
    if (this.screenValue !== 'briefing') return false;
    return this.startLevelAt(this.selectedLevelIndexValue);
  }

  startLevel(levelOrIndex: string | number = this.selectedLevelIndexValue): boolean {
    return this.selectLevel(levelOrIndex);
  }

  startGame(levelOrIndex: string | number = this.selectedLevelIndexValue): boolean {
    return this.startLevel(levelOrIndex);
  }

  retry(): boolean {
    if (!this.simulation) return false;
    return this.startLevelAt(this.selectedLevelIndexValue);
  }

  restart(): boolean {
    return this.retry();
  }

  nextLevel(): boolean {
    if (this.screenValue !== 'result' || this.state?.outcome !== 'success') return false;
    const nextIndex = this.selectedLevelIndexValue + 1;
    if (nextIndex >= this.levels.length) return false;
    const nextId = this.levels[nextIndex]?.id;
    if (!nextId || !this.isUnlocked(nextId)) return false;
    return this.selectLevel(nextIndex);
  }

  backToRoute(): void {
    this.screenValue = 'route';
    this.routeMenuExpanded = false;
    this.routeScrollOffset = 0;
    this.simulation = undefined;
    this.audioEventCursor = 0;
    this.resultRecorded = false;
    this.userPaused = false;
    this.input.reset();
    this.loop.reset();
    this.previewState = new GameSimulation(this.currentLevel, this.seedForLevel(this.currentLevel.id)).snapshot();
    this.syncLoopPause();
    this.updateInputLayout();
    this.render();
  }

  backToHome(): void {
    this.screenValue = 'home';
    this.routeMenuExpanded = false;
    this.simulation = undefined;
    this.audioEventCursor = 0;
    this.resultRecorded = false;
    this.userPaused = false;
    this.input.reset();
    this.loop.reset();
    this.previewState = new GameSimulation(this.currentLevel, this.seedForLevel(this.currentLevel.id)).snapshot();
    this.syncLoopPause();
    this.updateInputLayout();
    this.render();
  }

  openRoute(): void {
    this.screenValue = 'route';
    this.routeMenuExpanded = false;
    this.routeScrollOffset = 0;
    this.updateInputLayout();
    this.render();
  }

  openAchievements(): void {
    this.screenValue = 'achievements';
    this.updateInputLayout();
    this.render();
  }

  openAppearance(): void {
    this.screenValue = 'appearance';
    this.updateInputLayout();
    this.render();
  }

  openSettings(): void {
    this.screenValue = 'settings';
    this.updateInputLayout();
    this.render();
  }

  toggleRouteMenu(): boolean {
    if (this.screenValue !== 'route') return false;
    this.routeMenuExpanded = !this.routeMenuExpanded;
    this.updateInputLayout();
    this.render();
    return this.routeMenuExpanded;
  }

  setAppearance(appearanceId: string): boolean {
    if (this.screenValue !== 'appearance') return false;
    if (!isAppearanceUnlocked(this.saveValue, appearanceId)) return false;
    this.saveValue = setAppearance(this.saveValue, appearanceId);
    this.storage.save(this.saveValue);
    this.render();
    return true;
  }

  toggleSetting(setting: 'sound' | 'music' | 'vibration'): boolean {
    if (setting === 'sound') this.setSoundEnabled(!this.saveValue.settings.soundEnabled);
    else if (setting === 'music') this.setMusicEnabled(!this.saveValue.settings.musicEnabled);
    else {
      this.saveValue = migrateSave({ ...this.saveValue, settings: { ...this.saveValue.settings, vibrationEnabled: !this.saveValue.settings.vibrationEnabled } });
      this.storage.save(this.saveValue);
      this.render();
    }
    return true;
  }

  returnToRoute(): void {
    this.backToRoute();
  }

  pause(): boolean {
    if (this.screenValue !== 'game' || !this.simulation || this.simulation.phase === 'result' || this.userPaused) return false;
    this.userPaused = true;
    this.syncLoopPause();
    this.render();
    return true;
  }

  resume(): boolean {
    if (!this.userPaused) return false;
    this.userPaused = false;
    this.syncLoopPause();
    this.render();
    return true;
  }

  togglePause(): boolean {
    if (this.userPaused) {
      this.resume();
    } else {
      this.pause();
    }
    return this.userPaused;
  }

  setPaused(paused: boolean): boolean {
    return paused ? this.pause() : this.resume();
  }

  markUserGesture(): void {
    this.audio.markUserGesture();
    if (!this.musicStarted && this.audioSources.music) {
      this.musicStarted = this.audio.playMusic(this.audioSources.music, 0.55);
    }
  }

  setSoundEnabled(enabled: boolean): void {
    this.audio.setSoundEnabled(enabled);
    this.saveValue = migrateSave({ ...this.saveValue, settings: { ...this.saveValue.settings, soundEnabled: enabled } });
    this.storage.save(this.saveValue);
  }

  setMusicEnabled(enabled: boolean): void {
    this.audio.setMusicEnabled(enabled);
    if (enabled) this.musicStarted = false;
    this.saveValue = migrateSave({ ...this.saveValue, settings: { ...this.saveValue.settings, musicEnabled: enabled } });
    this.storage.save(this.saveValue);
  }

  getSnapshot(): RuntimeSnapshot {
    return this.snapshot();
  }

  snapshot(): RuntimeSnapshot {
    return {
      screen: this.screenValue,
      selectedLevelIndex: this.selectedLevelIndexValue,
      selectedLevelId: this.currentLevel.id,
      unlockedLevelIds: this.unlockedLevelIds(),
      bestScores: { ...this.saveValue.bestScores },
      bestStars: { ...this.saveValue.bestStars },
      achievements: [...this.saveValue.achievements],
      appearanceId: this.saveValue.appearanceId,
      unlockedAppearanceIds: unlockedAppearanceIds(this.saveValue),
      routeMenuExpanded: this.routeMenuExpanded,
      routeScrollOffset: this.routeScrollOffset,
      paused: this.paused,
      running: this.runningValue,
      state: this.simulation ? this.simulation.snapshot() : null,
    };
  }

  private createCanvasAdapter(api: WxGameApi | undefined): WxCanvasAdapter {
    if (!api?.createCanvas) {
      throw new Error('GameRuntime requires api.createCanvas or canvasAdapter');
    }
    return createWxCanvasAdapter(api);
  }

  private normalizeSave(value: SaveData): SaveData {
    const next = migrateSave(value);
    const firstId = this.levels[0]?.id;
    if (firstId && !next.unlockedLevelIds.includes(firstId)) next.unlockedLevelIds.unshift(firstId);
    return next;
  }

  private resolveInitialIndex(initialLevelId?: string): number {
    if (initialLevelId) {
      const requested = this.levels.findIndex((level) => level.id === initialLevelId);
      if (requested >= 0 && this.isUnlocked(this.levels[requested]?.id)) return requested;
    }
    const firstUnlocked = this.levels.findIndex((level) => this.isUnlocked(level.id));
    return firstUnlocked >= 0 ? firstUnlocked : 0;
  }

  private resolveLevelIndex(levelOrIndex: string | number): number {
    if (typeof levelOrIndex === 'number') {
      if (!Number.isFinite(levelOrIndex)) return -1;
      const index = Math.floor(levelOrIndex);
      return index >= 0 && index < this.levels.length ? index : -1;
    }
    return this.levels.findIndex((level) => level.id === levelOrIndex);
  }

  private isUnlocked(levelId: string | undefined): boolean {
    return Boolean(levelId && this.saveValue.unlockedLevelIds.includes(levelId));
  }

  private unlockedLevelIds(): string[] {
    const known = new Set(this.levels.map((level) => level.id));
    return this.saveValue.unlockedLevelIds.filter((id) => known.has(id));
  }

  private seedForLevel(levelId: string): number | string {
    if (typeof this.baseSeed === 'number') {
      const index = Math.max(0, this.levels.findIndex((level) => level.id === levelId));
      return (this.baseSeed + index * 1009) >>> 0;
    }
    return `${this.baseSeed}:${levelId}`;
  }

  private startLevelAt(index: number): boolean {
    const safe = safeIndex(index, this.levels.length);
    const level = this.levels[safe];
    if (!level || !this.isUnlocked(level.id)) return false;
    this.selectedLevelIndexValue = safe;
    this.currentSeed = this.seedForLevel(level.id);
    this.simulation = new GameSimulation(level, this.currentSeed);
    this.audioEventCursor = 0;
    this.previewState = this.simulation.snapshot();
    this.screenValue = 'game';
    this.routeMenuExpanded = false;
    this.userPaused = false;
    this.resultRecorded = false;
    this.input.reset();
    this.loop.reset();
    this.saveValue = migrateSave(this.saveValue);
    this.saveValue.stats.plays += 1;
    this.storage.save(this.saveValue);
    this.syncLoopPause();
    this.updateInputLayout();
    this.render();
    return true;
  }

  private processCommands(): boolean {
    const commands = this.input.consumeCommands();
    let flowChanged = false;
    for (const command of commands) {
      switch (command.type) {
        case 'pause':
          if (this.screenValue === 'game') {
            this.togglePause();
            flowChanged = true;
          }
          break;
        case 'restart':
          if (this.screenValue === 'game' || this.screenValue === 'result') {
            flowChanged = this.retry() || flowChanged;
          }
          break;
        case 'retry':
          if (this.screenValue === 'result' || this.screenValue === 'game') {
            flowChanged = this.retry() || flowChanged;
          }
          break;
        case 'next-level':
          flowChanged = this.nextLevel() || flowChanged;
          break;
        case 'route':
          this.backToRoute();
          flowChanged = true;
          break;
        case 'back':
          if (this.screenValue === 'route' || this.screenValue === 'briefing' || this.screenValue === 'achievements' || this.screenValue === 'appearance' || this.screenValue === 'settings') {
            this.backToHome();
            flowChanged = true;
          }
          break;
        case 'toggle-route-menu':
          flowChanged = this.toggleRouteMenu() || flowChanged;
          break;
        case 'confirm-start':
          flowChanged = this.confirmStart() || flowChanged;
          break;
        case 'scroll-route':
          if (this.screenValue === 'route') {
            const list = routeListRect(this.renderer.context.layout.viewport);
            const visibleCount = this.unlockedLevelIds().length;
            const cardHeight = this.renderer.context.layout.viewport.contentRect.width >= this.renderer.context.layout.viewport.contentRect.height ? 66 : 74;
            const contentHeight = Math.max(0, visibleCount * (cardHeight + 10) - 10);
            this.routeScrollOffset = Math.max(0, Math.min(Math.max(0, contentHeight - list.height), this.routeScrollOffset + command.delta));
            this.render();
            flowChanged = true;
          }
          break;
        case 'menu':
          if (this.screenValue === 'home') {
            if (command.id === 'start') this.openRoute();
            else if (command.id === 'achievements') this.openAchievements();
            else if (command.id === 'appearance') this.openAppearance();
            else if (command.id === 'settings') this.openSettings();
            flowChanged = true;
          }
          break;
        case 'select-appearance':
          flowChanged = this.setAppearance(command.appearanceId) || flowChanged;
          break;
        case 'toggle-setting':
          flowChanged = this.toggleSetting(command.setting) || flowChanged;
          break;
        case 'select-level':
          if (this.screenValue === 'route') flowChanged = this.selectLevel(command.levelId) || flowChanged;
          break;
        case 'select-door':
          if (this.screenValue === 'game') this.simulation?.selectDoor(command.doorId);
          break;
      }
    }
    return flowChanged;
  }

  private detectResult(): void {
    if (!this.simulation || this.simulation.phase !== 'result') return;
    this.recordResult();
  }

  /** 将规则层事件转换为一次性音效；未知事件只推进游标，不产生声音。 */
  private processAudioEvents(): void {
    const state = this.simulation?.getState();
    if (!state) {
      this.audioEventCursor = 0;
      return;
    }
    if (!Array.isArray(state.events)) return;
    // 调试或外部存档恢复可能替换事件数组；从头扫描可避免永久卡在旧索引。
    if (this.audioEventCursor > state.events.length) this.audioEventCursor = 0;
    while (this.audioEventCursor < state.events.length) {
      const event = state.events[this.audioEventCursor];
      this.audioEventCursor += 1;
      if (!event) continue;
      const source = this.audioSourceForEvent(event);
      if (source) this.audio.playEffect(source);
    }
  }

  private audioSourceForEvent(event: EventRecord): string | undefined {
    switch (event.type) {
      case 'guide':
        return this.audioSources.guide;
      case 'success':
        return this.audioSources.success;
      case 'failure':
        return this.audioSources.failure;
      case 'event-start':
        return this.audioSources.eventStart;
      default:
        return undefined;
    }
  }

  private recordResult(): void {
    if (!this.simulation || this.resultRecorded) return;
    const state = this.simulation.getState();
    if (state.phase !== 'result') return;
    this.resultRecorded = true;
    const level = this.currentLevel;
    let next = updateBestScore(this.saveValue, level.id, state.score?.total ?? 0);
    next = updateBestStars(next, level.id, state.score?.stars ?? 0);
    next.stats.totalGuides += state.metrics.guideUses;
    if (state.outcome === 'success') {
      next.stats.clears += 1;
      const clearAchievement = `clear:${level.id}`;
      if (!next.achievements.includes(clearAchievement)) next.achievements.push(clearAchievement);
      const medal = state.score?.medal;
      if (medal && medal !== 'none') {
        const medalAchievement = `medal:${level.id}:${medal}`;
        if (!next.achievements.includes(medalAchievement)) next.achievements.push(medalAchievement);
      }
      const nextLevel = this.levels[this.selectedLevelIndexValue + 1];
      if (nextLevel) next = unlockLevel(next, nextLevel.id);
    }
    this.saveValue = this.normalizeSave(next);
    this.storage.save(this.saveValue);
    this.screenValue = 'result';
    this.userPaused = false;
    this.input.reset();
    this.loop.setPaused(true);
    this.updateInputLayout();
  }

  private handleLifecyclePause(): void {
    this.lifecyclePaused = true;
    this.syncLoopPause();
    if (this.runningValue) this.render();
  }

  private handleLifecycleResume(): void {
    this.lifecyclePaused = false;
    this.syncLoopPause();
    if (this.runningValue) this.render();
  }

  private syncExternalLifecycleState(): void {
    if (this.lifecycle.paused === this.lifecyclePaused) return;
    this.lifecyclePaused = this.lifecycle.paused;
    this.syncLoopPause();
  }

  private syncLoopPause(): void {
    const shouldPause = this.screenValue !== 'game' || this.userPaused || this.lifecyclePaused || this.simulation?.phase === 'result';
    this.loop.setPaused(shouldPause);
  }

  private scheduleFrame(): void {
    if (!this.runningValue || this.frameHandle !== null) return;
    try {
      const token = this.scheduleToken;
      this.frameHandle = this.scheduler.request((timestamp) => this.handleFrame(timestamp, token)) ?? null;
    } catch {
      // 调度器不可用时仍保留手动 tick 能力，并停止重试造成的异常循环。
      this.runningValue = false;
    }
  }

  private render(): void {
    this.detectResult();
    this.processAudioEvents();
    const level = this.currentLevel;
    const state = this.simulation?.getState() ?? this.previewState;
    const options: RenderOptions = {
      screen: this.screenValue,
      paused: this.paused,
      showControls: this.screenValue === 'game',
      levels: this.levels,
      unlockedLevelIds: this.unlockedLevelIds(),
      selectedLevelIndex: this.selectedLevelIndexValue,
      bestScores: this.saveValue.bestScores,
      bestStars: this.saveValue.bestStars,
      achievements: this.saveValue.achievements,
      appearanceId: this.saveValue.appearanceId,
      unlockedAppearanceIds: unlockedAppearanceIds(this.saveValue),
      settings: this.saveValue.settings,
      routeMenuExpanded: this.routeMenuExpanded,
      routeScrollOffset: this.routeScrollOffset,
    };
    this.renderer.render(state, level, options);
    this.updateInputLayout();
  }

  private emptyTouchLayout(): TouchControlsLayout {
    return {
      joystickCenter: { x: -1000, y: -1000 },
      joystickRadius: 1,
      guideButtonRect: { x: -1000, y: -1000, width: 1, height: 1 },
    };
  }

  /** 横屏舞台使用非等比缩放，摇杆方向需还原到规则坐标后再交给模拟层。 */
  private sampleSimulationInput(): SimulationInput {
    const input = this.input.sample();
    const layout = this.renderer.context.layout;
    if (layout.orientation !== 'landscape' || !input.move) return input;
    return {
      ...input,
      move: screenDirectionToWorld(
        input.move,
        layout.orientation,
        layout.worldScaleX,
        layout.worldScaleY,
      ),
    };
  }

  private updateInputLayout(): void {
    const layout = this.renderer.context.layout;
    const offscreen = { x: -1000, y: -1000 };
    const base: TouchControlsLayout = {
      joystickCenter: offscreen,
      joystickRadius: 1,
      guideButtonRect: { x: -1000, y: -1000, width: 1, height: 1 },
    };

    if (this.screenValue === 'home') {
      base.menuHitAreas = [
        { id: 'start', rect: menuButtonRect(layout.viewport, 0, 4) },
        { id: 'achievements', rect: menuButtonRect(layout.viewport, 1, 4) },
        { id: 'appearance', rect: menuButtonRect(layout.viewport, 2, 4) },
        { id: 'settings', rect: menuButtonRect(layout.viewport, 3, 4) },
      ];
    } else if (this.screenValue === 'route') {
      base.pageBackRect = pageBackRect(layout.viewport);
      base.routeListRect = routeListRect(layout.viewport);
      const unlocked = new Set(this.unlockedLevelIds());
      const visibleLevels = this.levels.filter((level) => unlocked.has(level.id));
      base.levelHitAreas = visibleLevels.map((level, index) => ({
          id: level.id,
          rect: routeListCardRect(layout.viewport, index, this.routeScrollOffset),
        }));
    } else if (this.screenValue === 'briefing') {
      base.pageBackRect = pageBackRect(layout.viewport);
      base.briefingConfirmRect = layout.briefingConfirmRect;
    } else if (this.screenValue === 'achievements' || this.screenValue === 'settings') {
      base.pageBackRect = pageBackRect(layout.viewport);
      if (this.screenValue === 'settings') {
        base.settingsHitAreas = [
          { id: 'sound', rect: menuButtonRect(layout.viewport, 0, 3) },
          { id: 'music', rect: menuButtonRect(layout.viewport, 1, 3) },
          { id: 'vibration', rect: menuButtonRect(layout.viewport, 2, 3) },
        ];
      }
    } else if (this.screenValue === 'appearance') {
      base.pageBackRect = pageBackRect(layout.viewport);
      const unlocked = new Set(unlockedAppearanceIds(this.saveValue));
      base.appearanceHitAreas = ['default', 'seafoam', 'sunset', 'night']
        .filter((id) => unlocked.has(id))
        .map((id) => ({
          id,
          rect: menuButtonRect(layout.viewport, ['default', 'seafoam', 'sunset', 'night'].indexOf(id), 4),
        }));
    } else if (this.screenValue === 'game') {
      base.joystickCenter = layout.joystickCenter;
      base.joystickRadius = layout.joystickRadius;
      base.guideButtonRect = layout.guideButtonRect;
      base.pauseButtonRect = layout.pauseButtonRect;
    } else {
      base.resultRetryRect = layout.resultRetryRect;
      base.resultNextRect = layout.resultNextRect;
      base.resultRouteRect = layout.resultRouteRect;
    }
    this.input.setLayout(base);
  }

}

export function createGameRuntime(options: GameRuntimeOptions): GameRuntime;
export function createGameRuntime(api: WxGameApi, options?: Omit<GameRuntimeOptions, 'api'>): GameRuntime;
export function createGameRuntime(
  first: GameRuntimeOptions | WxGameApi,
  second: Omit<GameRuntimeOptions, 'api'> = {},
): GameRuntime {
  return isWxApi(first)
    ? new GameRuntime(first, second)
    : new GameRuntime(first);
}

export const createWxGameRuntime = createGameRuntime;
