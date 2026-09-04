import type { GameState, LevelConfig, Rect } from '../core/types.ts';
import { renderActors } from './actor-renderer.ts';
import type { CanvasImageFactory, CanvasLike, ViewportInsets } from './context.ts';
import {
  createViewportMetrics,
  configureCanvas,
  RenderContext,
} from './context.ts';
import { renderEffects } from './effects.ts';
import {
  renderControls,
  renderHud,
  renderPauseOverlay,
  renderResultScreen,
  renderRoutePage,
} from './canvas-ui.ts';
import { renderStation } from './station-renderer.ts';
import { loadPlayerSprite, type PlayerSpriteAsset } from './player-sprite.ts';

export type RenderScreen = 'game' | 'route' | 'result';

export interface RenderOptions {
  screen?: RenderScreen;
  paused?: boolean;
  showControls?: boolean;
  levels?: readonly LevelConfig[];
  unlockedLevelIds?: readonly string[];
  selectedLevelIndex?: number;
}

export interface RenderAssetOptions {
  /** 可选的微信图片工厂；未提供或解码失败时继续使用几何角色。 */
  imageFactory?: CanvasImageFactory;
  playerSprite?: PlayerSpriteAsset;
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

export class GameRenderer {
  readonly context: RenderContext;
  private readonly canvas?: CanvasLike;
  readonly playerSprite?: PlayerSpriteAsset;

  constructor(
    context: RenderContext,
    canvas?: CanvasLike,
    assets: RenderAssetOptions = {},
  ) {
    this.context = context;
    this.canvas = canvas;
    this.playerSprite = assets.playerSprite ?? loadPlayerSprite(assets.imageFactory);
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
    const fallbackWorld: Rect = level ? worldBoundsFor(level) : { x: 0, y: -240, width: 320, height: 808 };
    return new GameRenderer(new RenderContext(context, viewport, fallbackWorld), canvas, assets);
  }

  resize(width: number, height: number, dpr = this.context.layout.viewport.dpr, insets: ViewportInsets = this.context.layout.viewport.insets): void {
    const viewport = createViewportMetrics(width, height, dpr, insets);
    if (this.canvas) configureCanvas(this.canvas, this.context.ctx, viewport);
    this.context.resize(viewport);
  }

  render(state: GameState, level: LevelConfig, options: RenderOptions = {}): void {
    const screen = options.screen ?? (state.phase === 'result' ? 'result' : 'game');
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
      );
      return;
    }

    const expectedWorld = worldBoundsFor(level);
    if (
      expectedWorld.x !== this.context.layout.worldBounds.x ||
      expectedWorld.y !== this.context.layout.worldBounds.y ||
      expectedWorld.width !== this.context.layout.worldBounds.width ||
      expectedWorld.height !== this.context.layout.worldBounds.height
    ) {
      this.context.resize(this.context.layout.viewport, expectedWorld);
    }
    this.context.clear('#0b1627');
    renderStation(this.context, level, state);
    renderActors(this.context, state, level, this.playerSprite);
    renderEffects(this.context, level, state);
    renderHud(this.context, level, state);

    if (screen === 'result' || state.phase === 'result') {
      renderResultScreen(this.context, level, state);
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
