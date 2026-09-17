import {
  GameSimulation,
  CAMPAIGN_LEVELS,
  ENDLESS_LEVEL,
  ENDLESS_LEVEL_ID,
  createEndlessLevel,
  migrateSave,
  unlockedAppearanceIds,
  isAppearanceUnlocked,
  setAppearance,
  unlockLevel,
  unlockEndless,
  updateEndlessRecord,
  updateBestScore,
  updateBestStars,
  APPEARANCE_OPTIONS,
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
  failedResultLayout,
  appearanceCardRect,
  menuButtonRect,
  homePageLayout,
  pageBackRect,
  routeCardRect,
  routeListRect,
  routeListCardRect,
  routeDropdownRect,
  screenDirectionToWorld,
} from '../render/index.ts';
import type { RenderOptions } from '../render/index.ts';
import { emptyItemCounts, isItemId, ITEMS, ITEM_IDS, itemPhaseAllowed } from '../core/items.ts';
import type { ItemId } from '../core/types.ts';
import { RewardService, type RewardRequest, type RewardSource } from './reward-service.ts';
import { WxRewardedAdAdapter, WxShareAdapter, type WxRewardedAdApi, type WxShareApi } from '../platform/wx/index.ts';
import { itemHitAreas, type ItemPanel, type ItemUiState, type RewardStatus } from '../render/item-ui.ts';
import { REWARD_CONFIG } from './reward-config.ts';

let runtimeSequence = 0;

/**
 * game.js 只需把微信全局对象注入这里。接口故意只声明本运行时实际用到的
 * 能力，因而可以在 Node 集成测试中用很小的 mock 替代微信 SDK。
 */
export interface WxGameApi
  extends WxCanvasApi,
    WxTouchApi,
    WxStorageApi,
    WxLifecycleApi,
    WxRewardedAdApi,
    WxShareApi,
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
  music: 'assets/audio/tideline-loop.mp3',
  guide: 'assets/audio/ui-guide.wav',
  success: 'assets/audio/ui-success.wav',
  failure: 'assets/audio/ui-failure.wav',
  eventStart: 'assets/audio/event-alert.wav',
};

export interface GameRuntimeOptions {
  /** 入口使用同一 Date.now 时钟记录模块加载阶段；不上传、不输出生产日志。 */
  startupTrace?: { startedAt: number; modulesReadyAt: number; retries: number };
  rewardedAdUnitId?: string;
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
  itemUi: ItemUiState;
  screen: RuntimeScreen;
  selectedLevelIndex: number;
  selectedLevelId: string;
  unlockedLevelIds: string[];
  endlessUnlocked: boolean;
  endlessWave: number;
  endlessBestWave: number;
  endlessBestScore: number;
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

export type StartupStage = 'modulesReady' | 'runtimeStarted' | 'canvasReady' | 'storageReady'
  | 'runtimeReady' | 'homeSubmitted' | 'preloadsStarted';

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
  // 小游戏的原生 rAF 挂在全局对象上；wx 命名空间版本仅用于兼容注入适配器。
  if (typeof globalThis.requestAnimationFrame === 'function') {
    const request = globalThis.requestAnimationFrame.bind(globalThis);
    const cancel = globalThis.cancelAnimationFrame?.bind(globalThis);
    return {
      request: (callback) => request(callback),
      cancel: (handle) => { cancel?.(handle as number); },
    };
  }
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
  private endlessActive = false;
  private endlessWave = 0;
  private saveValue: SaveData;
  private simulation?: GameSimulation;
  private currentSeed: number | string;
  private startupTask = 0;
  private readonly startupOrigin: number;
  private readonly startupRetries: number;
  private readonly startupTimings: Partial<Record<StartupStage, number>> = {};
  private userPaused = false;
  private lifecyclePaused = false;
  private runningValue = false;
  private frameHandle: unknown = null;
  private lastFrameTimestamp: number | undefined;
  private scheduleToken = 0;
  private resultRecorded = false;
  private readonly rewards: RewardService;
  private readonly rewardedAd: WxRewardedAdAdapter;
  private readonly share: WxShareAdapter;
  private storageWritable = true;
  private recoverySettings: Partial<SaveSettings> = {};
  private recoveryAppearanceId?: string;
  private itemPanel: ItemPanel = null;
  private selectedItem: ItemId = 'commute-horn';
  private rewardStatus: RewardStatus = 'idle';
  private rewardRequest?: RewardRequest;
  private rewardResultRunId?: string;
  private readonly claimedResultRewards = new Set<ItemId>();
  private itemMessage = '';
  private messageUntil = 0;
  private usedItems = emptyItemCounts();
  private queuedItem?: ItemId;
  private runId = '';
  private requestSequence = 0;
  private readonly instanceId = ++runtimeSequence;
  private disposed = false;
  private rewardMuted = false;
  private pendingUseApplied = false;
  private musicStarted = false;
  private audioEventCursor = 0;
  private renderDirty = true;
  private renderedAssetVersion = 0;
  private renderedMessage = '';
  private renderedAdAvailable = false;
  private inputLayout?: GameRenderer['context']['layout'];

  private handleFrame(timestamp: number, token: number): void {
    if (token !== this.scheduleToken) return;
    this.frameHandle = null;
    if (!this.runningValue || this.lifecyclePaused || this.disposed) return;
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
    const configuredLevels = options.levels && options.levels.length > 0 ? options.levels : CAMPAIGN_LEVELS;
    // 仅完整战役显示无尽模式入口；MVP/压力测试注入的临时关卡保持原有索引。
    this.levels = configuredLevels.some((level) => level.id === 'morning-light')
      && !configuredLevels.some((level) => level.id === ENDLESS_LEVEL_ID)
      ? [...configuredLevels, ENDLESS_LEVEL]
      : configuredLevels;
    this.baseSeed = options.seed ?? DEFAULT_SEED;
    this.now = options.now ?? (() => Date.now());
    this.startupOrigin = options.startupTrace?.startedAt ?? this.now();
    this.startupRetries = options.startupTrace?.retries ?? 0;
    if (options.startupTrace) {
      this.startupTimings.modulesReady = Math.max(0, options.startupTrace.modulesReadyAt - this.startupOrigin);
    }
    this.markStartup('runtimeStarted');
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
        { imageFactory: canvasAdapter.imageFactory, canvasFactory: canvasAdapter.offscreenCanvasFactory, deferLoading: true },
      );
    } else {
      throw new Error('GameRuntime requires a renderer or canvasAdapter');
    }

    this.markStartup('canvasReady');
    this.storage = options.storageAdapter ?? createWxStorageAdapter(api ?? {});
    const loaded = typeof this.storage.loadWithStatus === 'function'
      ? this.storage.loadWithStatus() : { save: this.storage.load(), status: 'loaded' as const };
    this.storageWritable = loaded.status !== 'unsupported' && loaded.status !== 'unavailable';
    this.saveValue = this.normalizeSave(loaded.save);
    if (loaded.status === 'missing') this.saveValue.items.welcomeGiftStatus = 'eligible';
    this.markStartup('storageReady');
    this.rewards = new RewardService(() => this.saveValue, (next) => {
      if (!this.storageWritable || !this.storage.save(next)) return false;
      this.saveValue = next;
      this.renderDirty = true;
      return true;
    });
    this.rewardedAd = new WxRewardedAdAdapter(api ?? {}, options.rewardedAdUnitId ?? REWARD_CONFIG.adUnitId);
    this.share = new WxShareAdapter(api ?? {});

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
    if (this.saveValue.items.pendingUse && !this.rewards.recoverUse()) {
      this.notice('有未完成的道具使用，恢复存储后重试');
    }
    if (this.saveValue.items.welcomeGiftStatus === 'eligible') {
      this.itemPanel = 'welcome';
      this.itemMessage = '领取后进入游戏，点击道具即可使用';
    }
    this.syncLoopPause();
    this.updateInputLayout();
    this.markStartup('runtimeReady');
    if (options.autoStart) this.start();
  }

  /** 毫秒时间点相对入口开始；绘制提交不代表 GPU 上屏，预加载发起不代表解码完成。 */
  getStartupTimings(): Partial<Record<StartupStage, number>> & { retries: number } {
    return { ...this.startupTimings, retries: this.startupRetries };
  }

  private markStartup(stage: StartupStage): void {
    if (this.startupTimings[stage] === undefined) {
      this.startupTimings[stage] = Math.max(0, this.now() - this.startupOrigin);
    }
  }

  private runStartupTask(): void {
    // start() 已绘制首页，第一轮帧回调让出后再分帧完成非首屏工作。
    if (!this.runningValue || this.disposed || this.lifecyclePaused) return;
    if (this.startupTask === 0) {
      if (this.saveValue.items.welcomeGiftStatus === 'eligible' && this.itemPanel === 'welcome') {
        const granted = this.rewards.welcome();
        this.itemMessage = granted ? '两种道具已领取，进入游戏后点击使用' : '暂时无法保存，请重试领取';
        this.renderDirty = true;
      }
    } else if (this.startupTask === 1) {
      this.renderer.preloadAssets?.();
    } else if (this.startupTask === 2) {
      this.rewardedAd.preload();
      this.markStartup('preloadsStarted');
    } else return;
    this.startupTask += 1;
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
    if (level.id === ENDLESS_LEVEL_ID && this.endlessWave > 0) return createEndlessLevel(this.endlessWave);
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
    return this.userPaused || this.lifecyclePaused || this.itemPanel !== null || this.rewardStatus === 'watching';
  }

  get running(): boolean {
    return this.runningValue;
  }

  /** 启动输入、生命周期监听和唯一 ticker；重复调用不会创建第二条循环。 */
  start(): boolean {
    if (this.runningValue || this.disposed) return false;
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
    this.cancelFrame();
    this.input.detach();
    this.lifecycle.detach();
    this.diagnostics.detach();
    return true;
  }

  private cancelFrame(): void {
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
  }

  destroy(): void {
    this.disposed = true;
    this.rewardRequest = undefined;
    this.share.cancel();
    this.rewardedAd.destroy();
    this.stop();
    this.audio.destroy();
    this.renderer.destroy?.();
  }

  /** 手动推进一帧，测试和桌面调试可直接调用；frameDelta 单位为秒。 */
  tick(frameDelta: number): number {
    if (this.disposed) return 0;
    this.syncExternalLifecycleState();
    if (this.lifecyclePaused) return 0;
    this.runStartupTask();
    const flowChanged = this.processCommands();
    this.syncExternalLifecycleState();

    let steps = 0;
    if (!flowChanged && this.screenValue === 'game' && this.simulation && !this.paused) {
      this.syncLoopPause();
      steps = this.loop.advance(frameDelta, this.simulation, () => this.sampleSimulationInput());
      this.detectResult();
    }
    this.render(false);
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
    const previous = this.renderer.context.layout.viewport;
    const canvas = this.canvasAdapter?.canvas;
    const canvasChanged = canvas && (canvas.width !== Math.round(previous.width * previous.dpr)
      || canvas.height !== Math.round(previous.height * previous.dpr));
    const viewport = this.canvasAdapter?.refresh() ?? this.renderer.context.layout.viewport;
    if (!canvasChanged && viewport.width === previous.width && viewport.height === previous.height
      && viewport.dpr === previous.dpr
      && viewport.insets.top === previous.insets.top && viewport.insets.right === previous.insets.right
      && viewport.insets.bottom === previous.insets.bottom && viewport.insets.left === previous.insets.left) return;
    this.renderer.resize(viewport.width, viewport.height, viewport.dpr, viewport.insets);
    this.render();
  }

  /** 选择一个已解锁关卡，先展示三星目标，确认后才开始。 */
  selectLevel(levelOrIndex: string | number): boolean {
    if (!this.closeItemPanel()) return false;
    const index = this.resolveLevelIndex(levelOrIndex);
    if (index < 0 || !this.isUnlocked(this.levels[index]?.id)) return false;
    this.selectedLevelIndexValue = index;
    if (this.levels[index]?.id === ENDLESS_LEVEL_ID) {
      this.endlessActive = false;
      this.endlessWave = 1;
    } else {
      this.endlessActive = false;
      this.endlessWave = 0;
    }
    this.screenValue = 'briefing';
    this.simulation = undefined;
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
    if (this.endlessActive && this.currentLevel.id === ENDLESS_LEVEL_ID) {
      this.endlessWave += 1;
      this.startEndlessWave();
      return true;
    }
    const nextIndex = this.selectedLevelIndexValue + 1;
    if (nextIndex >= this.levels.length) return false;
    const nextId = this.levels[nextIndex]?.id;
    if (!nextId || !this.isUnlocked(nextId)) return false;
    return this.selectLevel(nextIndex);
  }

  backToRoute(): void {
    if (!this.closeItemPanel()) return;
    this.screenValue = 'route';
    this.routeMenuExpanded = false;
    this.routeScrollOffset = 0;
    this.simulation = undefined;
    this.endlessActive = false;
    this.endlessWave = 0;
    this.audioEventCursor = 0;
    this.resultRecorded = false;
    this.userPaused = false;
    this.input.reset();
    this.loop.reset();
    this.syncLoopPause();
    this.updateInputLayout();
    this.render();
  }

  backToHome(): void {
    if (!this.closeItemPanel()) return;
    this.screenValue = 'home';
    this.routeMenuExpanded = false;
    this.simulation = undefined;
    this.endlessActive = false;
    this.endlessWave = 0;
    this.audioEventCursor = 0;
    this.resultRecorded = false;
    this.userPaused = false;
    this.input.reset();
    this.loop.reset();
    this.syncLoopPause();
    this.updateInputLayout();
    this.render();
  }

  openRoute(): void {
    if (!this.closeItemPanel()) return;
    this.screenValue = 'route';
    this.routeMenuExpanded = false;
    this.routeScrollOffset = 0;
    this.updateInputLayout();
    this.render();
  }

  openAchievements(): void {
    if (!this.closeItemPanel()) return;
    this.screenValue = 'achievements';
    this.updateInputLayout();
    this.render();
  }

  openAppearance(): void {
    if (!this.closeItemPanel()) return;
    this.screenValue = 'appearance';
    this.updateInputLayout();
    this.render();
  }

  openSettings(): void {
    if (!this.closeItemPanel()) return;
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
    if (!this.storageWritable) this.recoveryAppearanceId = appearanceId;
    this.persistProgress();
    this.render();
    return true;
  }

  toggleSetting(setting: 'sound' | 'music' | 'vibration'): boolean {
    if (setting === 'sound') this.setSoundEnabled(!this.saveValue.settings.soundEnabled);
    else if (setting === 'music') this.setMusicEnabled(!this.saveValue.settings.musicEnabled);
    else {
      this.saveValue = migrateSave({ ...this.saveValue, settings: { ...this.saveValue.settings, vibrationEnabled: !this.saveValue.settings.vibrationEnabled } });
      if (!this.storageWritable) this.recoverySettings.vibrationEnabled = this.saveValue.settings.vibrationEnabled;
      this.persistProgress();
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
    this.queuedItem = undefined;
    this.input.reset();
    this.syncLoopPause();
    this.render();
    return true;
  }

  resume(): boolean {
    if (!this.userPaused) return false;
    this.userPaused = false;
    this.queuedItem = undefined;
    this.input.reset();
    this.lastFrameTimestamp = undefined;
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
    this.renderDirty = true;
    this.audio.setSoundEnabled(enabled);
    this.saveValue = migrateSave({ ...this.saveValue, settings: { ...this.saveValue.settings, soundEnabled: enabled } });
    if (!this.storageWritable) this.recoverySettings.soundEnabled = enabled;
    this.persistProgress();
  }

  setMusicEnabled(enabled: boolean): void {
    this.renderDirty = true;
    this.audio.setMusicEnabled(enabled);
    if (enabled) this.musicStarted = false;
    this.saveValue = migrateSave({ ...this.saveValue, settings: { ...this.saveValue.settings, musicEnabled: enabled } });
    if (!this.storageWritable) this.recoverySettings.musicEnabled = enabled;
    this.persistProgress();
  }

  getSnapshot(): RuntimeSnapshot {
    return this.snapshot();
  }

  snapshot(): RuntimeSnapshot {
    return {
      itemUi: this.getItemUi(),
      screen: this.screenValue,
      selectedLevelIndex: this.selectedLevelIndexValue,
      selectedLevelId: this.currentLevel.id,
      unlockedLevelIds: this.unlockedLevelIds(),
      endlessUnlocked: this.saveValue.endlessUnlocked,
      endlessWave: this.endlessWave,
      endlessBestWave: this.saveValue.endlessBestWave,
      endlessBestScore: this.saveValue.endlessBestScore,
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
    let next = migrateSave(value);
    if (next.achievements.includes('clear:morning-light')) next = unlockEndless(next);
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
    if (levelId === ENDLESS_LEVEL_ID) return this.saveValue.endlessUnlocked;
    return Boolean(levelId && this.saveValue.unlockedLevelIds.includes(levelId));
  }

  private unlockedLevelIds(): string[] {
    const known = new Set(this.levels.map((level) => level.id));
    return this.saveValue.unlockedLevelIds
      .filter((id) => known.has(id) && (id !== ENDLESS_LEVEL_ID || this.saveValue.endlessUnlocked));
  }

  private seedForLevel(levelId: string): number | string {
    if (typeof this.baseSeed === 'number') {
      const index = Math.max(0, this.levels.findIndex((level) => level.id === levelId));
      return (this.baseSeed + index * 1009 + (levelId === ENDLESS_LEVEL_ID ? this.endlessWave * 7919 : 0)) >>> 0;
    }
    return `${this.baseSeed}:${levelId}:${levelId === ENDLESS_LEVEL_ID ? this.endlessWave : ''}`;
  }

  private startLevelAt(index: number): boolean {
    if (!this.closeItemPanel()) return false;
    this.queuedItem = undefined;
    this.usedItems = emptyItemCounts();
    this.runId = this.newRequestId();
    const safe = safeIndex(index, this.levels.length);
    const level = this.levels[safe];
    if (!level || !this.isUnlocked(level.id)) return false;
    this.claimedResultRewards.clear();
    this.selectedLevelIndexValue = safe;
    this.endlessActive = level.id === ENDLESS_LEVEL_ID;
    this.endlessWave = this.endlessActive ? 1 : 0;
    const activeLevel = this.currentLevel;
    this.currentSeed = this.seedForLevel(activeLevel.id);
    this.simulation = new GameSimulation(activeLevel, this.currentSeed);
    this.audioEventCursor = 0;
    this.screenValue = 'game';
    this.routeMenuExpanded = false;
    this.userPaused = false;
    this.resultRecorded = false;
    this.input.reset();
    this.loop.reset();
    this.saveValue = migrateSave(this.saveValue);
    this.saveValue.stats.plays += 1;
    this.persistProgress();
    this.syncLoopPause();
    this.updateInputLayout();
    this.render();
    return true;
  }

  private processCommands(): boolean {
    const commands = this.input.consumeCommands();
    let flowChanged = false;
    for (const command of commands) {
      this.renderDirty = true;
      if (command.type === 'item-action') {
        this.handleItemAction(command.id);
        // 打开或关闭面板的这一帧不推进时间，避免补算广告前后的间隔。
        if (!command.id.startsWith('use:') || this.itemPanel) flowChanged = true;
        continue;
      }
      if (this.itemPanel || this.rewardStatus === 'watching') continue;
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
          if (this.screenValue === 'game' && this.userPaused) this.backToHome();
          else this.backToRoute();
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
            const lastCard = routeListCardRect(this.renderer.context.layout.viewport, Math.max(0, this.levels.length - 1), 0);
            const contentWidth = Math.max(0, lastCard.x + lastCard.width - list.x);
            const maxOffset = Math.max(0, contentWidth - list.width);
            this.routeScrollOffset = Math.max(0, Math.min(maxOffset, this.routeScrollOffset + command.delta));
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
      case 'item-horn':
        return this.audioSources.guide;
      case 'item-delay':
        return this.audioSources.eventStart;
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

  private startEndlessWave(): void {
    this.queuedItem = undefined;
    const level = this.currentLevel;
    this.currentSeed = this.seedForLevel(level.id);
    this.simulation = new GameSimulation(level, this.currentSeed);
    this.audioEventCursor = 0;
    this.screenValue = 'game';
    this.routeMenuExpanded = false;
    this.userPaused = false;
    this.resultRecorded = false;
    this.input.reset();
    this.loop.reset();
    this.syncLoopPause();
    this.updateInputLayout();
  }

  private recordResult(): void {
    if (!this.simulation || this.resultRecorded) return;
    const state = this.simulation.getState();
    if (state.phase !== 'result') return;
    this.resultRecorded = true;
    this.renderDirty = true;
    const level = this.currentLevel;
    if (this.endlessActive && level.id === ENDLESS_LEVEL_ID) {
      const completedWave = state.outcome === 'success' ? this.endlessWave : Math.max(0, this.endlessWave - 1);
      let next = updateEndlessRecord(this.saveValue, completedWave, state.score?.total ?? 0);
      if (!ITEM_IDS.some((id) => this.usedItems[id] > 0)) {
        next.unassisted.endlessBestWave = Math.max(next.unassisted.endlessBestWave, completedWave);
        next.unassisted.endlessBestScore = Math.max(next.unassisted.endlessBestScore, state.score?.total ?? 0);
      }
      if (state.outcome === 'success') {
        this.saveValue = this.normalizeSave(next);
        this.persistProgress();
        // 轮次自动衔接前先消费本轮结算音效，避免替换 simulation 后丢失 success 事件。
        this.processAudioEvents();
        this.screenValue = 'result';
        this.userPaused = false;
        this.input.reset();
        this.loop.setPaused(true);
        this.updateInputLayout();
        return;
      }
      this.saveValue = this.normalizeSave(next);
      this.persistProgress();
      this.endlessActive = false;
      this.screenValue = 'result';
      this.userPaused = false;
      this.input.reset();
      this.loop.setPaused(true);
      this.updateInputLayout();
      return;
    }
    let next = updateBestScore(this.saveValue, level.id, state.score?.total ?? 0);
    next = updateBestStars(next, level.id, state.score?.stars ?? 0);
    if (!ITEM_IDS.some((id) => this.usedItems[id] > 0)) {
      next.unassisted.bestScores[level.id] = Math.max(next.unassisted.bestScores[level.id] ?? 0, state.score?.total ?? 0);
      next.unassisted.bestStars[level.id] = Math.max(next.unassisted.bestStars[level.id] ?? 0, state.score?.stars ?? 0);
    }
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
      if (nextLevel && nextLevel.id !== ENDLESS_LEVEL_ID) next = unlockLevel(next, nextLevel.id);
      if (level.id === 'morning-light') next = unlockEndless(next);
    }
    this.saveValue = this.normalizeSave(next);
    this.persistProgress();
    this.screenValue = 'result';
    this.userPaused = false;
    this.input.reset();
    this.loop.setPaused(true);
    this.updateInputLayout();
  }

  private handleLifecyclePause(): void {
    this.share.onHide();
    this.queuedItem = undefined;
    this.input.reset();
    this.lifecyclePaused = true;
    this.cancelFrame();
    this.renderDirty = true;
    this.syncLoopPause();
  }

  private handleLifecycleResume(): void {
    this.lifecyclePaused = false;
    this.lastFrameTimestamp = undefined;
    if (!this.storageWritable) this.persistProgress();
    const requestId = this.share.onShow();
    if (requestId && this.rewardRequest?.id === requestId) this.claimShare();
    this.syncLoopPause();
    if (this.runningValue) {
      this.render();
      this.scheduleFrame();
    }
  }

  private syncExternalLifecycleState(): void {
    if (this.lifecycle.paused === this.lifecyclePaused) return;
    if (this.lifecycle.paused) this.handleLifecyclePause();
    else this.handleLifecycleResume();
  }

  private syncLoopPause(): void {
    const shouldPause = this.screenValue !== 'game' || this.paused || this.simulation?.phase === 'result';
    this.loop.setPaused(shouldPause);
  }

  private scheduleFrame(): void {
    if (!this.runningValue || this.lifecyclePaused || this.disposed || this.frameHandle !== null) return;
    try {
      const token = this.scheduleToken;
      this.frameHandle = this.scheduler.request((timestamp) => this.handleFrame(timestamp, token)) ?? null;
    } catch {
      // 调度器不可用时仍保留手动 tick 能力，并停止重试造成的异常循环。
      this.runningValue = false;
    }
  }

  private render(force = true): void {
    if (this.disposed) return;
    if (force) this.renderDirty = true;
    if (this.lifecyclePaused) return;
    this.detectResult();
    const animated = this.screenValue === 'game' && !this.paused && this.state?.phase !== 'result';
    const usesSprites = this.screenValue === 'appearance' || this.screenValue === 'game' || this.screenValue === 'result';
    const assetVersion = usesSprites ? (this.renderer.assetVersion ?? 0) : 0;
    const message = this.visibleItemMessage();
    const adAvailable = this.rewardedAd.available;
    if (!this.renderDirty && !animated && assetVersion === this.renderedAssetVersion
      && message === this.renderedMessage && adAvailable === this.renderedAdAvailable) return;
    this.processAudioEvents();
    const level = this.currentLevel;
    const state = this.state;
    const options: RenderOptions = {
      itemUi: this.getItemUi(),
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
      endlessBestWave: this.saveValue.endlessBestWave,
      endlessBestScore: this.saveValue.endlessBestScore,
    };
    this.renderer.render(state, level, options);
    if (this.renderDirty || this.inputLayout !== this.renderer.context.layout) this.updateInputLayout();
    this.renderDirty = false;
    // render() 可能按需加载图片；记录绘制前状态以便下一帧处理同步/异步就绪。
    this.renderedAssetVersion = assetVersion;
    this.renderedMessage = message;
    this.renderedAdAvailable = adAvailable;
    if (this.screenValue === 'home') this.markStartup('homeSubmitted');
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
    if (this.commitQueuedItem()) input.useGuide = false;
    const layout = this.renderer.context.layout;
    if (layout.orientation !== 'landscape' || !input.move) return input;
    const scaleX = Math.max(0.05, Math.abs(layout.worldScaleX));
    const scaleY = Math.max(0.05, Math.abs(layout.worldScaleY));
    const compensated = {
      x: input.move.x / scaleX,
      y: input.move.y / scaleY,
    };
    return {
      ...input,
      move: screenDirectionToWorld(
        input.move,
        layout.orientation,
        layout.worldScaleX,
        layout.worldScaleY,
      ),
      // screenDirectionToWorld normalizes the compensated direction. Preserve
      // its original magnitude so the final rendered X/Y displacement remains
      // proportional to the screen-space input after the non-uniform canvas scale.
      moveScale: Math.hypot(compensated.x, compensated.y),
    };
  }

  private updateInputLayout(): void {
    const layout = this.renderer.context.layout;
    this.inputLayout = layout;
    const offscreen = { x: -1000, y: -1000 };
    const base: TouchControlsLayout = {
      joystickCenter: offscreen,
      joystickRadius: 1,
      guideButtonRect: { x: -1000, y: -1000, width: 1, height: 1 },
    };

    base.itemHitAreas = itemHitAreas(layout, this.screenValue, this.state, this.getItemUi(), this.paused);
    if (this.itemPanel || this.rewardStatus === 'watching') {
      this.input.setLayout(base);
      return;
    }

    if (this.screenValue === 'home') {
      const home = homePageLayout(layout.viewport);
      base.menuHitAreas = [
        { id: 'start', rect: home.buttons[0] },
        { id: 'achievements', rect: home.buttons[1] },
        { id: 'appearance', rect: home.buttons[2] },
        { id: 'settings', rect: home.buttons[3] },
      ];
    } else if (this.screenValue === 'route') {
      base.pageBackRect = pageBackRect(layout.viewport);
      base.routeListRect = routeListRect(layout.viewport);
      const unlocked = new Set(this.unlockedLevelIds());
      base.levelHitAreas = this.levels
        .map((level, index) => ({ level, index }))
        .filter(({ level }) => unlocked.has(level.id))
        .map(({ level, index }) => ({
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
      base.appearanceHitAreas = APPEARANCE_OPTIONS.map((option) => option.id)
        .filter((id) => unlocked.has(id))
        .map((id) => ({
          id,
          rect: appearanceCardRect(layout.viewport, APPEARANCE_OPTIONS.findIndex((option) => option.id === id)),
        }));
    } else if (this.screenValue === 'game') {
      if (!this.paused) {
        base.joystickCenter = layout.joystickCenter;
        base.joystickRadius = layout.joystickRadius;
        base.guideButtonRect = layout.guideButtonRect;
      }
      base.pauseButtonRect = layout.pauseButtonRect;
      if (this.userPaused) {
        base.resultRetryRect = layout.resultRetryRect;
        base.resultRouteRect = layout.resultRouteRect;
      }
    } else {
      base.resultRetryRect = layout.resultRetryRect;
      if (this.state?.outcome === 'failure') {
        const actions = failedResultLayout(layout, [...this.claimedResultRewards]);
        base.resultRetryRect = actions.retry;
        base.resultRouteRect = actions.route;
      } else if (this.state?.score?.success) {
        base.resultNextRect = layout.resultNextRect;
        base.resultRouteRect = layout.resultRouteRect;
      } else {
        // 未完成的结算状态不让隐藏的下一关区域响应触摸。
        base.resultRouteRect = layout.resultNextRect;
      }
    }
    this.input.setLayout(base);
  }

  getItemUi(): ItemUiState {
    return {
      panel: this.itemPanel, selected: this.selectedItem, status: this.rewardStatus,
      inventory: { ...this.saveValue.items.inventory }, used: { ...this.usedItems },
      claimedResultRewards: [...this.claimedResultRewards],
      message: this.visibleItemMessage(),
      adAvailable: this.rewardedAd.available, shareAvailable: this.share.available,
      endless: this.currentLevel.id === ENDLESS_LEVEL_ID,
      welcomePending: this.saveValue.items.welcomeGiftStatus === 'eligible',
      unassistedScore: this.currentLevel.id === ENDLESS_LEVEL_ID ? this.saveValue.unassisted.endlessBestScore : this.saveValue.unassisted.bestScores[this.currentLevel.id] ?? 0,
    };
  }

  openSupply(itemId: ItemId = this.selectedItem): void {
    this.selectedItem = this.rewardRequest?.itemId ?? itemId;
    this.openItemPanel('supply');
  }

  private openQuickReward(itemId: ItemId): void {
    this.selectedItem = this.rewardRequest?.itemId ?? itemId;
    this.openItemPanel('reward');
    void this.requestReward(this.selectedItem === 'commute-horn' ? 'rewarded-ad' : 'share-participation');
  }

  private openItemPanel(panel: ItemPanel): void {
    if (this.disposed || this.rewardStatus === 'watching') return;
    const previousPanel = this.itemPanel;
    const storageReady = this.persistProgress();
    if (panel !== 'reward' && previousPanel !== 'welcome' && this.itemPanel === 'welcome') panel = 'welcome';
    // 保存失败的有效奖励保留原请求，不能被新一轮领取覆盖。
    this.itemPanel = this.rewardStatus === 'save-error' ? (panel === 'reward' ? 'reward' : 'supply')
      : this.saveValue.items.welcomeGiftStatus === 'eligible' ? 'welcome' : panel;
    if (!this.rewardRequest) {
      this.rewardStatus = 'idle';
      if (this.itemPanel !== 'welcome') this.itemMessage = storageReady ? '' : '暂时无法读取或保存存档，请稍后重试';
    }
    this.queuedItem = undefined;
    this.input.reset();
    this.syncLoopPause();
    this.render();
  }

  closeItemPanel(): boolean {
    if (this.rewardStatus === 'watching' || this.rewardStatus === 'saving') return false;
    this.renderDirty = true;
    // 首屏后任务尚未执行时，用户也可以立即领取/关闭，不会丢失首次赠送。
    if (this.itemPanel === 'welcome' && this.saveValue.items.welcomeGiftStatus === 'eligible') {
      this.rewards.welcome();
    }
    if (this.itemPanel === 'welcome' && this.saveValue.items.welcomeGiftStatus === 'granted') {
      this.saveValue.items.tutorialSeen = true;
      this.persistProgress();
    }
    if (this.rewardStatus !== 'save-error') {
      this.rewardRequest = undefined;
      this.rewardResultRunId = undefined;
      this.rewardStatus = 'idle';
      this.share.cancel();
    }
    this.itemPanel = null;
    this.queuedItem = undefined;
    this.itemMessage = '';
    this.restoreRewardAudio();
    this.lastFrameTimestamp = undefined;
    this.input.reset();
    this.syncLoopPause();
    return true;
  }

  private newRequestId(): string { return `${this.now()}:${this.instanceId}:${++this.requestSequence}`; }
  private ensureStorageReady(): boolean {
    if (!this.storageWritable) {
      const loaded = this.storage.loadWithStatus();
      // 必须重新读到可处理的存档后才解除保护，不能直接把启动时的空回退写回。
      if (loaded.status === 'unsupported' || loaded.status === 'unavailable') return false;
      const session = this.saveValue;
      const next = this.normalizeSave(loaded.save);
      // 读取失败期间只能积累临时进度；库存、首礼及奖励去重记录以原存档为准。
      next.unlockedLevelIds = [...new Set([...next.unlockedLevelIds, ...session.unlockedLevelIds])];
      next.achievements = [...new Set([...next.achievements, ...session.achievements])];
      next.endlessUnlocked ||= session.endlessUnlocked;
      for (const key of ['bestScores', 'bestStars'] as const) {
        for (const [id, value] of Object.entries(session[key])) next[key][id] = Math.max(next[key][id] ?? 0, value);
        for (const [id, value] of Object.entries(session.unassisted[key])) {
          next.unassisted[key][id] = Math.max(next.unassisted[key][id] ?? 0, value);
        }
      }
      for (const key of ['endlessBestWave', 'endlessBestScore'] as const) {
        next[key] = Math.max(next[key], session[key]);
        next.unassisted[key] = Math.max(next.unassisted[key], session.unassisted[key]);
      }
      for (const key of ['plays', 'clears', 'totalGuides'] as const) next.stats[key] += session.stats[key];
      next.settings = { ...next.settings, ...this.recoverySettings };
      next.appearanceId = this.recoveryAppearanceId ?? next.appearanceId;
      if (loaded.status === 'missing') next.items.welcomeGiftStatus = 'eligible';
      this.saveValue = this.normalizeSave(next);
      this.storageWritable = true;
      this.recoverySettings = {};
      this.recoveryAppearanceId = undefined;
      if (!this.rewardMuted) {
        this.audio.setSettings(this.saveValue.settings);
        this.musicStarted = false;
      }
    }
    if (this.saveValue.items.pendingUse && !this.pendingUseApplied && !this.rewards.recoverUse()) return false;
    if (this.saveValue.items.welcomeGiftStatus === 'eligible') {
      const granted = this.rewards.welcome();
      this.itemPanel = 'welcome';
      this.itemMessage = granted ? '两种道具已领取，进入游戏后点击使用' : '暂时无法保存，请重试领取';
      return granted;
    }
    return true;
  }

  private persistProgress(): boolean { return this.ensureStorageReady() && this.storage.save(this.saveValue); }
  private visibleItemMessage(): string {
    return this.itemPanel || this.now() < this.messageUntil ? this.itemMessage : '';
  }

  private notice(message: string): void {
    this.itemMessage = message;
    this.messageUntil = this.now() + 2400;
    this.renderDirty = true;
  }

  queueItem(id: ItemId): boolean {
    const state = this.state;
    if (!state || this.screenValue !== 'game' || state.phase === 'result' || this.paused) return false;
    // 空库存直接领取，不受使用阶段或本局次数限制；调起外部界面前暂停并清空待使用操作。
    if (this.saveValue.items.inventory[id] <= 0) { this.openQuickReward(id); return false; }
    if (this.queuedItem) return false;
    if (this.usedItems[id] >= 1) { this.notice(this.currentLevel.id === ENDLESS_LEVEL_ID ? '本场已经使用过该道具' : '本局已经使用过该道具'); return false; }
    if (!itemPhaseAllowed(state, id)) { this.notice(ITEMS[id].hint); return false; }
    this.queuedItem = id;
    return true;
  }

  private commitQueuedItem(): boolean {
    const id = this.queuedItem;
    this.queuedItem = undefined;
    if (!id || !this.simulation || this.paused || this.usedItems[id] >= 1) return false;
    const result = this.simulation.checkItem(id);
    if (!result.used) { this.notice(result.reason === 'no-target' ? '前方没有可疏导的乘客，未消耗道具' : ITEMS[id].hint); return false; }
    const pending = this.saveValue.items.pendingUse;
    if (pending) {
      const cleared = this.pendingUseApplied ? this.rewards.finishUse(pending.requestId) : this.rewards.recoverUse();
      if (!cleared) { this.notice('无法保存道具，请稍后重试'); return false; }
      this.pendingUseApplied = false;
    }
    const requestId = this.newRequestId();
    if (!this.rewards.reserveUse(id, requestId, this.runId)) { this.notice('无法保存道具，未使用，请稍后重试'); return false; }
    const used = this.simulation.useItem(id).used;
    if (!used) { this.rewards.recoverUse(); return false; }
    this.pendingUseApplied = true;
    this.usedItems[id] += 1;
    if (this.rewards.finishUse(requestId)) this.pendingUseApplied = false;
    this.notice(`${ITEMS[id].name}已使用`);
    return true;
  }

  async requestReward(source: RewardSource): Promise<void> {
    if (this.disposed || (this.itemPanel !== 'supply' && this.itemPanel !== 'reward') || this.rewardRequest) return;
    const direct = this.itemPanel === 'reward';
    const fromFailure = direct && this.screenValue === 'result' && this.state?.outcome === 'failure';
    if (fromFailure && this.claimedResultRewards.has(this.selectedItem)) return;
    if (direct && source !== (this.selectedItem === 'commute-horn' ? 'rewarded-ad' : 'share-participation')) return;
    if (source === 'rewarded-ad' && !this.rewardedAd.available) { this.notice(direct ? '暂无可用广告，请稍后重试' : this.rewardedAd.unavailableReason); this.render(); return; }
    if (source === 'share-participation' && !this.share.available) { this.notice('当前环境不支持分享'); this.render(); return; }
    if (!this.persistProgress()) {
      this.notice('暂时无法读取或保存存档，请稍后重试领取'); this.render(); return;
    }
    if (direct) this.itemPanel = 'reward';
    if (this.itemPanel !== 'supply' && this.itemPanel !== 'reward') { this.render(); return; }
    const request: RewardRequest = { id: this.newRequestId(), itemId: this.selectedItem, source };
    this.rewardRequest = request;
    this.rewardResultRunId = fromFailure ? this.runId : undefined;
    this.rewardStatus = source === 'rewarded-ad' ? 'watching' : 'sharing';
    this.itemMessage = source === 'rewarded-ad' ? '完整观看后领取，游戏中手动使用' : '分享返回后可领取，若未到账请点领取';
    this.input.reset(); this.syncLoopPause();
    this.rewardMuted = true;
    this.audio.setSettings({ soundEnabled: false, musicEnabled: false });
    if (source === 'share-participation') {
      if (!this.share.begin(request.id)) {
        this.rewardRequest = undefined; this.rewardStatus = 'idle'; this.itemMessage = '暂时无法调起分享，请重试'; this.restoreRewardAudio();
      }
      this.render();
      return;
    }
    this.render();
    const result = await this.rewardedAd.watch();
    if (this.disposed || this.rewardRequest?.id !== request.id) return;
    if (result === 'completed') this.saveReward();
    else {
      this.rewardStatus = 'idle'; this.rewardRequest = undefined;
      this.itemMessage = result === 'cancelled' ? '视频未完整观看，未领取道具' : direct ? '暂无可用广告，请稍后重试' : '暂无可用广告，可选择分享领取';
      this.render();
    }
  }

  claimShare(): boolean {
    const request = this.rewardRequest;
    if (this.disposed || !request || request.source !== 'share-participation' || this.rewardStatus !== 'sharing'
      || !this.share.complete(request.id)) return false;
    return this.saveReward();
  }

  private saveReward(): boolean {
    const request = this.rewardRequest;
    if (!request || this.disposed) return false;
    const direct = this.itemPanel === 'reward';
    this.rewardStatus = 'saving';
    const saved = this.ensureStorageReady() && this.rewards.grant(request);
    // 奖励落盘后才隐藏本次失败结算的对应入口；旧局延迟保存不能影响新一局。
    if (saved && this.rewardResultRunId === this.runId && this.screenValue === 'result' && this.state?.outcome === 'failure') {
      this.claimedResultRewards.add(request.itemId);
    }
    this.rewardStatus = saved ? 'granted' : 'save-error';
    this.itemMessage = saved ? `${ITEMS[request.itemId].name} ×1 已领取，游戏中手动使用` : '奖励已确认，保存失败，请重试保存';
    this.itemPanel = direct ? 'reward' : 'supply';
    this.syncLoopPause(); this.render();
    return saved;
  }

  private restoreRewardAudio(): void {
    if (!this.rewardMuted) return;
    this.rewardMuted = false;
    this.audio.setSettings(this.saveValue.settings);
    if (this.musicStarted && this.audioSources.music) this.audio.playMusic(this.audioSources.music);
  }

  private handleItemAction(action: string): void {
    if (action.startsWith('use:')) { const id = action.slice(4); if (isItemId(id)) this.queueItem(id); return; }
    if (action === 'close') { this.closeItemPanel(); return; }
    if (this.rewardStatus === 'watching' || this.rewardStatus === 'saving') return;
    if (action === 'claim-share') { this.claimShare(); return; }
    if (action === 'save-retry') { if (this.rewardStatus === 'save-error') this.saveReward(); return; }
    if (action === 'welcome-retry') {
      this.itemMessage = this.rewards.welcome() ? '两种道具已领取，进入游戏后点击使用' : '暂时无法保存，请重试领取'; return;
    }
    if (action === 'supply') { this.openSupply(); return; }
    if (action === 'reward-retry' && this.itemPanel === 'reward') {
      void this.requestReward(this.selectedItem === 'commute-horn' ? 'rewarded-ad' : 'share-participation'); return;
    }
    if (action === 'result-share-ticket' || action === 'result-ad-horn') {
      if (this.itemPanel || this.screenValue !== 'result' || this.state?.outcome !== 'failure') return;
      const shareTicket = action === 'result-share-ticket';
      const itemId = shareTicket ? 'delay-ticket' : 'commute-horn';
      if (this.claimedResultRewards.has(itemId)) return;
      this.openQuickReward(itemId);
      return;
    }
    if (this.rewardRequest) return;
    if (action.startsWith('select:')) { const id = action.slice(7); if (isItemId(id)) this.selectedItem = id; this.itemMessage = ''; }
    if (action === 'ad') void this.requestReward('rewarded-ad');
    if (action === 'share') void this.requestReward('share-participation');
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
