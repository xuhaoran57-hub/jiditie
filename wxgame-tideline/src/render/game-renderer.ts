import type { GameState, LevelConfig, Rect, SaveSettings } from '../core/types.ts';
import { renderItemUi, type ItemUiState } from './item-ui.ts';
import { renderActors } from './actor-renderer.ts';
import type { CanvasFactory, CanvasImageFactory, CanvasLike, ViewportInsets } from './context.ts';
import { PlayerAppearanceSprites } from './player-appearance.ts';
import {
  createViewportMetrics,
  configureCanvas,
  RenderContext,
} from './context.ts';
import { renderEffects } from './effects.ts';
import {
  renderControls,
  renderAchievementsPage,
  renderAppearancePage,
  renderHomePage,
  renderLevelBriefing,
  renderHud,
  renderPauseOverlay,
  renderResultScreen,
  renderRoutePage,
  renderSettingsPage,
} from './canvas-ui.ts';
import { renderStationBackground, renderStationForeground } from './station-renderer.ts';
import { StationBackgroundCache } from './station-background.ts';
import { loadPlayerSprite, type PlayerSpriteAsset } from './player-sprite.ts';
import { loadPassengerAtlasSprite, loadPassengerFastSprite, loadPassengerLuggageSprite, loadPassengerRegularSprite, type PassengerSpriteAsset } from './passenger-sprite.ts';

export type RenderScreen = 'home' | 'game' | 'route' | 'briefing' | 'result' | 'achievements' | 'appearance' | 'settings';

export interface RenderOptions {
  itemUi?: ItemUiState;
  screen?: RenderScreen;
  paused?: boolean;
  showControls?: boolean;
  levels?: readonly LevelConfig[];
  unlockedLevelIds?: readonly string[];
  selectedLevelIndex?: number;
  bestScores?: Readonly<Record<string, number>>;
  bestStars?: Readonly<Record<string, number>>;
  achievements?: readonly string[];
  appearanceId?: string;
  unlockedAppearanceIds?: readonly string[];
  settings?: SaveSettings;
  routeMenuExpanded?: boolean;
  routeScrollOffset?: number;
  endlessBestWave?: number;
  endlessBestScore?: number;
}

export interface RenderAssetOptions {
  /** 首页无需角色图集，由运行时在首屏后预加载。 */
  deferLoading?: boolean;
  /** 可选的微信图片工厂；未提供或解码失败时继续使用几何角色。 */
  imageFactory?: CanvasImageFactory;
  canvasFactory?: CanvasFactory;
  playerSprite?: PlayerSpriteAsset;
  passengerSprite?: PassengerSpriteAsset;
  passengerFastSprite?: PassengerSpriteAsset;
  passengerLuggageSprite?: PassengerSpriteAsset;
  passengerAtlasSprite?: PassengerSpriteAsset;
}

function worldBoundsFor(level: LevelConfig): Rect {
  const x = Math.min(level.platformBounds.x, level.trainBounds.x);
  const y = Math.min(level.platformBounds.y, level.trainBounds.y);
  const right = Math.max(
    level.platformBounds.x + level.platformBounds.width,
    level.trainBounds.x + level.trainBounds.width,
  );
  const bottom = Math.max(
    level.platformBounds.y + level.platformBounds.height,
    level.trainBounds.y + level.trainBounds.height,
  );
  return { x, y, width: right - x, height: bottom - y };
}

function spriteStatus(sprite: PlayerSpriteAsset | PassengerSpriteAsset | undefined): number {
  return (sprite?.ready ? 1 : 0) | (sprite?.failed ? 2 : 0);
}

export class GameRenderer {
  readonly context: RenderContext;
  private readonly canvas?: CanvasLike;
  private readonly assets: RenderAssetOptions;
  private assetsLoaded = false;
  private readonly sprites: RenderAssetOptions = {};
  get playerSprite(): PlayerSpriteAsset | undefined { return this.sprites.playerSprite; }
  private readonly appearanceSprites: PlayerAppearanceSprites;
  private readonly background: StationBackgroundCache;
  get passengerSprite(): PassengerSpriteAsset | undefined { return this.sprites.passengerSprite; }
  get passengerFastSprite(): PassengerSpriteAsset | undefined { return this.sprites.passengerFastSprite; }
  get passengerLuggageSprite(): PassengerSpriteAsset | undefined { return this.sprites.passengerLuggageSprite; }
  get passengerAtlasSprite(): PassengerSpriteAsset | undefined { return this.sprites.passengerAtlasSprite; }

  constructor(
    context: RenderContext,
    canvas?: CanvasLike,
    assets: RenderAssetOptions = {},
  ) {
    this.context = context;
    this.canvas = canvas;
    this.appearanceSprites = new PlayerAppearanceSprites(assets.canvasFactory);
    this.background = new StationBackgroundCache(assets.canvasFactory, canvas);
    this.assets = assets;
    if (!assets.deferLoading) this.preloadAssets();
  }

  /** 图片异步解码后，静态外观页/暂停页也需要补画一次。查询不产生分配。 */
  get assetVersion(): number {
    return spriteStatus(this.playerSprite)
      | (spriteStatus(this.passengerSprite) << 2)
      | (spriteStatus(this.passengerFastSprite) << 4)
      | (spriteStatus(this.passengerLuggageSprite) << 6)
      | (spriteStatus(this.passengerAtlasSprite) << 8);
  }

  destroy(): void { this.background.destroy(); }

  preloadAssets(): void {
    if (this.assetsLoaded) return;
    this.assetsLoaded = true;
    const assets = this.assets;
    const passengerSprite = assets.passengerSprite
      ?? loadPassengerRegularSprite(assets.imageFactory);
    const passengerFastSprite = assets.passengerFastSprite
      ?? loadPassengerFastSprite(assets.imageFactory);
    const passengerLuggageSprite = assets.passengerLuggageSprite
      ?? loadPassengerLuggageSprite(assets.imageFactory);
    const passengerAtlasSprite = assets.passengerAtlasSprite
      ?? loadPassengerAtlasSprite(assets.imageFactory);
    this.sprites.playerSprite = assets.playerSprite ?? loadPlayerSprite(assets.imageFactory);
    // 某些测试桩或低版本运行时可能复用同一个 Image 对象；避免第二次设置
    // src 覆盖玩家图集，NPC 在这种情况下回退到几何绘制。
    this.sprites.passengerSprite = passengerSprite?.image === this.playerSprite?.image
      ? undefined
      : passengerSprite;
    this.sprites.passengerFastSprite = passengerFastSprite?.image === this.playerSprite?.image
      || passengerFastSprite?.image === this.passengerSprite?.image
      ? undefined
      : passengerFastSprite;
    this.sprites.passengerLuggageSprite = passengerLuggageSprite?.image === this.playerSprite?.image
      || passengerLuggageSprite?.image === this.passengerSprite?.image
      || passengerLuggageSprite?.image === this.passengerFastSprite?.image
      ? undefined
      : passengerLuggageSprite;
    this.sprites.passengerAtlasSprite = passengerAtlasSprite?.image === this.playerSprite?.image
      || passengerAtlasSprite?.image === this.passengerSprite?.image
      || passengerAtlasSprite?.image === this.passengerFastSprite?.image
      || passengerAtlasSprite?.image === this.passengerLuggageSprite?.image
      ? undefined
      : passengerAtlasSprite;
  }

  static fromCanvas(
    canvas: CanvasLike,
    width: number,
    height: number,
    dpr = 1,
    insets: ViewportInsets = {},
    level?: LevelConfig,
    assets: RenderAssetOptions = {},
  ): GameRenderer {
    const context = canvas.getContext?.('2d');
    if (!context) throw new Error('a 2d canvas context is required');
    const viewport = createViewportMetrics(width, height, dpr, insets);
    configureCanvas(canvas, context, viewport);
    const fallbackWorld: Rect = level ? worldBoundsFor(level) : { x: 0, y: -300, width: 320, height: 868 };
    return new GameRenderer(new RenderContext(context, viewport, fallbackWorld), canvas, assets);
  }

  resize(width: number, height: number, dpr = this.context.layout.viewport.dpr, insets: ViewportInsets = this.context.layout.viewport.insets): void {
    const viewport = createViewportMetrics(width, height, dpr, insets);
    if (this.canvas) configureCanvas(this.canvas, this.context.ctx, viewport);
    this.context.resize(viewport);
  }

  render(state: GameState | null, level: LevelConfig, options: RenderOptions = {}): void {
    this.renderScene(state, level, options);
    if (options.itemUi) renderItemUi(this.context, options.screen ?? 'game', state, options.itemUi, options.paused);
  }

  private renderScene(state: GameState | null, level: LevelConfig, options: RenderOptions): void {
    const screen = options.screen ?? (state?.phase === 'result' ? 'result' : 'game');
    if (screen === 'home') {
      this.context.clear('#0b1627');
      renderHomePage(this.context);
      return;
    }
    if (screen === 'achievements') {
      this.context.clear('#0b1627');
      renderAchievementsPage(this.context, options.levels ?? [level], options.bestStars ?? {});
      return;
    }
    if (screen === 'appearance') {
      this.preloadAssets();
      this.context.clear('#0b1627');
      renderAppearancePage(this.context, options.appearanceId ?? 'default', options.unlockedAppearanceIds ?? ['default'],
        (id) => this.appearanceSprites.get(this.playerSprite, id));
      return;
    }
    if (screen === 'settings') {
      this.context.clear('#0b1627');
      renderSettingsPage(this.context, options.settings ?? { soundEnabled: true, musicEnabled: true, vibrationEnabled: true });
      return;
    }
    if (screen === 'route') {
      this.context.clear('#0b1627');
      // 外部调用方可能暂时传入空路线（例如存档/热更新切换的瞬间）。
      // 至少保留当前关卡，避免页面只剩标题而没有可点击内容。
      const routeLevels = options.levels && options.levels.length > 0 ? options.levels : [level];
      renderRoutePage(
        this.context,
        routeLevels,
        options.unlockedLevelIds ?? [level.id],
        options.selectedLevelIndex ?? 0,
        options.bestScores ?? {},
        options.bestStars ?? {},
        options.routeMenuExpanded ?? true,
        options.routeScrollOffset ?? 0,
        options.endlessBestWave ?? 0,
        options.endlessBestScore ?? 0,
      );
      return;
    }
    if (screen === 'briefing') {
      this.context.clear('#0b1627');
      renderLevelBriefing(this.context, level);
      return;
    }

    if (!state) return;
    this.preloadAssets();
    const expectedWorld = worldBoundsFor(level);
    if (
      expectedWorld.x !== this.context.layout.worldBounds.x ||
      expectedWorld.y !== this.context.layout.worldBounds.y ||
      expectedWorld.width !== this.context.layout.worldBounds.width ||
      expectedWorld.height !== this.context.layout.worldBounds.height
    ) {
      this.context.resize(this.context.layout.viewport, expectedWorld);
    }
    if (!this.background.draw(this.context, level)) {
      this.context.clear('#0b1627');
      renderStationBackground(this.context, level);
    }
    renderStationForeground(this.context, level, state);
    const appearanceId = options.appearanceId ?? 'default';
    renderActors(this.context, state, level, this.appearanceSprites.get(this.playerSprite, appearanceId), this.passengerSprite, this.passengerAtlasSprite, this.passengerFastSprite, appearanceId, this.passengerLuggageSprite);
    renderEffects(this.context, level, state);
    renderHud(this.context, level, state);

    if (screen === 'result' || state.phase === 'result') {
      renderResultScreen(this.context, level, state, options.itemUi?.claimedResultRewards);
    } else if (options.showControls !== false) {
      renderControls(this.context, state, level.guide.cost);
    }
    if (options.paused && state.phase !== 'result') renderPauseOverlay(this.context);
  }
}

export function renderGameFrame(
  renderContext: RenderContext,
  state: GameState,
  level: LevelConfig,
  options: RenderOptions = {},
): void {
  const renderer = new GameRenderer(renderContext);
  renderer.render(state, level, options);
}
