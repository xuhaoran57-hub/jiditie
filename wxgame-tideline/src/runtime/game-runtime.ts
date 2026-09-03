import {
  GameSimulation,
  MVP_LEVELS,
  migrateSave,
  unlockLevel,
  updateBestScore,
} from '../core/index.ts';
import type {
  EventRecord,
  GameState,
  LevelConfig,
  Rect,
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
  routeCardRect,
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

export type RuntimeScreen = 'route' | 'game' | 'result';

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

function unionRect(first: Rect, second: Rect, padding = 0): Rect {
  const left = Math.min(first.x, second.x) - padding;
  const top = Math.min(first.y, second.y) - padding;
  const right = Math.max(first.x + first.width, second.x + second.width) + padding;
  const bottom = Math.max(first.y + first.height, second.y + second.height) + padding;
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
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
  private screenValue: RuntimeScreen = 'route';
  private selectedLevelIndexValue = 0;
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
    this.levels = options.levels && options.levels.length > 0 ? options.levels : MVP_LEVELS;
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

  /** 选择并开始一个已解锁关卡。参数可以是路线索引或关卡 id。 */
  selectLevel(levelOrIndex: string | number): boolean {
    const index = this.resolveLevelIndex(levelOrIndex);
    if (index < 0 || !this.isUnlocked(this.levels[index]?.id)) return false;
    return this.startLevelAt(index);
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
    return this.startLevelAt(nextIndex);
  }

  backToRoute(): void {
    this.screenValue = 'route';
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

    if (this.screenValue === 'route') {
      base.levelHitAreas = this.levels.map((level, index) => ({
        id: level.id,
        rect: routeCardRect(layout.viewport, index),
      }));
    } else if (this.screenValue === 'game') {
      base.joystickCenter = layout.joystickCenter;
      base.joystickRadius = layout.joystickRadius;
      base.guideButtonRect = layout.guideButtonRect;
      base.pauseButtonRect = layout.pauseButtonRect;
      base.doorHitAreas = this.currentLevel.doors.map((door) => ({
        id: door.id,
        rect: this.screenRectFromWorld(unionRect(door.entryZone, door.safeZone, 8)),
      }));
    } else {
      base.resultRetryRect = layout.resultRetryRect;
      base.resultNextRect = layout.resultNextRect;
      base.resultRouteRect = layout.resultRouteRect;
    }
    this.input.setLayout(base);
  }

  private screenRectFromWorld(rect: Rect): Rect {
    const context = this.renderer.context;
    const topLeft = context.worldToScreen({ x: rect.x, y: rect.y });
    const bottomRight = context.worldToScreen({ x: rect.x + rect.width, y: rect.y + rect.height });
    return {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y),
    };
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
