import type { GameState, LevelConfig, SaveSettings, ScoreResult } from '../core/types.ts';
import { clamp } from '../core/vector.ts';
import type { Canvas2DContextLike } from './context.ts';
import { APPEARANCE_OPTIONS } from '../core/appearance.ts';
import { drawPlayerPreview } from './actor-renderer.ts';
import type { PlayerSpriteAsset } from './player-sprite.ts';
import {
  drawCenteredText,
  fillRoundRect,
  RenderContext,
  routeCardRect,
  routeListRect,
  routeListCardRect,
  menuButtonRect,
  appearanceCardRect,
  pageBackRect,
  worldDirectionToScreen,
  strokeRoundRect,
} from './context.ts';
import { canvasFont, canvasMonoFont, TIDELINE_TOKENS } from './design-tokens.ts';

const UI = {
  panel: TIDELINE_TOKENS.color.panel,
  panelAlt: TIDELINE_TOKENS.color.panelAlt,
  text: TIDELINE_TOKENS.color.text,
  muted: TIDELINE_TOKENS.color.muted,
  accent: TIDELINE_TOKENS.color.accent,
  warning: TIDELINE_TOKENS.color.warning,
  gold: TIDELINE_TOKENS.color.gold,
  silver: TIDELINE_TOKENS.color.silver,
  bronze: TIDELINE_TOKENS.color.bronze,
} as const;

const PHASE_LABELS: Record<GameState['phase'], string> = {
  intro: '准备进站',
  arriving: '列车进站',
  positioning: '观察人流',
  exiting: '先下后上',
  boarding: '乘客进入车厢',
  warning: '即将关门',
  result: '本局结算',
};

function objectiveSummary(level: LevelConfig): string {
  return (level.objectives ?? []).slice(0, 3).map((objective) => {
    switch (objective.id) {
      case 'alighting-rate': return `下车${Math.round(objective.minRatio * 100)}%`;
      case 'finish-time': return `提前${objective.minRemaining}s`;
      case 'guide-limit': return `疏导≤${objective.maxUses}`;
      case 'courtesy-score': return `礼让≥${Math.round(objective.minScore)}`;
      case 'stamina': return `体力≥${Math.round(objective.minRatio * 100)}%`;
      case 'no-collision': return '零碰撞';
      default: return '';
    }
  }).filter(Boolean).join(' · ');
}

function starDisplay(value: number): string {
  const stars = Math.min(3, Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)));
  return '★'.repeat(stars) + '☆'.repeat(3 - stars);
}

function drawBar(
  ctx: Canvas2DContextLike,
  rect: { x: number; y: number; width: number; height: number },
  ratio: number,
  color: string,
): void {
  fillRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, rect.height / 2, '#17324a');
  fillRoundRect(ctx, rect.x, rect.y, rect.width * clamp(ratio, 0, 1), rect.height, rect.height / 2, color);
}

function formatSeconds(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(1)}s`;
}

/** 兼容不接受 maxWidth 参数的旧版小游戏 Canvas。 */
function fillTextCompat(
  ctx: Canvas2DContextLike,
  text: string,
  x: number,
  y: number,
  maxWidth?: number,
): void {
  try {
    if (maxWidth === undefined) ctx.fillText(text, x, y);
    else ctx.fillText(text, x, y, maxWidth);
  } catch {
    if (maxWidth === undefined) return;
    try {
      ctx.fillText(text, x, y);
    } catch {
      // 文本属于非阻断性视觉反馈，单个字段失败不应中断整帧。
    }
  }
}

function medalColor(medal: ScoreResult['medal']): string {
  if (medal === 'gold') return UI.gold;
  if (medal === 'silver') return UI.silver;
  if (medal === 'bronze') return UI.bronze;
  return UI.muted;
}

function renderLandscapeHud(renderContext: RenderContext, level: LevelConfig, state: GameState): void {
  const { ctx, layout } = renderContext;
  const rect = layout.hudRect;
  const pause = layout.pauseButtonRect;
  const padding = 10;
  const centerX = rect.x + rect.width / 2;
  const barWidth = Math.max(24, rect.width - padding * 2);
  const occupancy = state.doors.reduce((sum, door) => sum + door.occupancy, 0);
  const eventLabel = state.activeEvent?.kind === 'door-close' && state.activeEvent.phase === 'warning'
    ? `即将关闭 ${formatSeconds(state.activeEvent.remaining)}`
    : state.activeEvent ? `${state.activeEvent.label} ${formatSeconds(state.activeEvent.remaining)}` : '';
  const phaseLabel = state.activeEvent
    ? `${PHASE_LABELS[state.phase]} · ${eventLabel}`
    : PHASE_LABELS[state.phase];
  const statsTop = rect.y + Math.max(76, rect.height - 40);
  renderContext.withScreen(() => {
    fillRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 14, UI.panel);
    strokeRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 14, '#30415c', 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = canvasFont(700, 11);
    ctx.fillStyle = UI.text;
    fillTextCompat(ctx, level.stationName, rect.x + padding, rect.y + 8, Math.max(1, pause.x - rect.x - padding - 6));
    ctx.font = canvasFont(400, 9);
    ctx.fillStyle = UI.muted;
    fillTextCompat(ctx, phaseLabel, rect.x + padding, rect.y + 27, barWidth);

    ctx.textAlign = 'center';
    ctx.font = canvasMonoFont(700, 17);
    ctx.fillStyle = state.phase === 'warning' ? UI.warning : UI.text;
    ctx.fillText(formatSeconds(state.doorRemaining), centerX, rect.y + 46);
    ctx.font = canvasFont(400, 9);
    ctx.fillStyle = UI.muted;
    ctx.fillText('\u5173\u95e8\u5012\u8ba1\u65f6', centerX, rect.y + 66);

    ctx.textAlign = 'left';
    ctx.font = canvasFont(400, 9);
    ctx.fillStyle = UI.muted;
    fillTextCompat(ctx, `\u4f53\u529b ${Math.round(state.player.stamina)}`, rect.x + padding, statsTop, barWidth);
    drawBar(ctx, {
      x: rect.x + padding,
      y: statsTop + 10,
      width: barWidth,
      height: 4,
    }, state.player.stamina / Math.max(1, state.player.maxStamina), UI.accent);
    fillTextCompat(ctx, `\u8f66\u53a2 ${occupancy}/${level.carriageCapacity}`, rect.x + padding, statsTop + 18, barWidth);
    drawBar(ctx, {
      x: rect.x + padding,
      y: statsTop + 29,
      width: barWidth,
      height: 4,
    }, occupancy / Math.max(1, level.carriageCapacity), occupancy >= level.carriageCapacity ? UI.warning : UI.gold);

    fillRoundRect(ctx, pause.x, pause.y, pause.width, pause.height, 9, UI.panelAlt);
    strokeRoundRect(ctx, pause.x, pause.y, pause.width, pause.height, 9, UI.muted, 1);
    drawCenteredText(ctx, '\u6682\u505c', {
      x: pause.x + pause.width / 2,
      y: pause.y + pause.height / 2,
    }, canvasFont(400, 9), UI.text);
  });
}

export function renderHud(renderContext: RenderContext, level: LevelConfig, state: GameState): void {
  const { ctx, layout } = renderContext;
  if (layout.orientation === 'landscape') {
    renderLandscapeHud(renderContext, level, state);
    return;
  }
  const rect = layout.hudRect;
  renderContext.withScreen(() => {
    fillRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 16, UI.panel);
    ctx.font = canvasFont(600, 16);
    ctx.fillStyle = UI.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(level.stationName, rect.x + 14, rect.y + 10);
    ctx.font = canvasFont(400, 12);
    ctx.fillStyle = UI.muted;
    const eventLabel = state.activeEvent?.kind === 'door-close' && state.activeEvent.phase === 'warning'
      ? `即将关闭 ${formatSeconds(state.activeEvent.remaining)}`
      : state.activeEvent?.label ?? '';
    const phaseLabel = state.activeEvent
      ? `${PHASE_LABELS[state.phase]} · ${eventLabel}`
      : PHASE_LABELS[state.phase];
    ctx.fillText(phaseLabel, rect.x + 14, rect.y + 33);

    ctx.textAlign = 'center';
    ctx.font = canvasMonoFont(700, 19);
    ctx.fillStyle = state.phase === 'warning' ? UI.warning : UI.text;
    ctx.fillText(formatSeconds(state.doorRemaining), rect.x + rect.width * 0.52, rect.y + 20);
    ctx.font = canvasFont(400, 11);
    ctx.fillStyle = UI.muted;
    ctx.fillText('关门倒计时', rect.x + rect.width * 0.52, rect.y + 43);

    const pause = layout.pauseButtonRect;
    const rightX = rect.x + rect.width - 126;
    ctx.textAlign = 'left';
    ctx.font = canvasFont(400, 11);
    ctx.fillStyle = UI.muted;
    ctx.fillText(`体力 ${Math.round(state.player.stamina)}`, rightX, rect.y + 9);
    drawBar(ctx, { x: rightX, y: rect.y + 25, width: 112, height: 7 }, state.player.stamina / Math.max(1, state.player.maxStamina), UI.accent);
    const occupancy = state.doors.reduce((sum, door) => sum + door.occupancy, 0);
    ctx.fillStyle = UI.muted;
    ctx.fillText(`车厢 ${occupancy}/${level.carriageCapacity}`, rightX, rect.y + 38);
    drawBar(ctx, { x: rightX, y: rect.y + 52, width: 112, height: 4 }, occupancy / Math.max(1, level.carriageCapacity), occupancy >= level.carriageCapacity ? UI.warning : UI.gold);

    // 暂停按钮固定在 HUD 下方右侧，同时作为触摸适配器的命中区域来源。
    fillRoundRect(ctx, pause.x, pause.y, pause.width, pause.height, 9, UI.panelAlt);
    strokeRoundRect(ctx, pause.x, pause.y, pause.width, pause.height, 9, UI.muted, 1);
    drawCenteredText(ctx, '暂停', { x: pause.x + pause.width / 2, y: pause.y + pause.height / 2 }, canvasFont(400, 12), UI.text);

    if (state.activeEvent) {
      const bannerWidth = Math.max(52, Math.min(190, rect.width - pause.width - 18));
      const banner = { x: rect.x, y: pause.y, width: bannerWidth, height: pause.height };
      fillRoundRect(ctx, banner.x, banner.y, banner.width, banner.height, 9, '#35647d');
      strokeRoundRect(ctx, banner.x, banner.y, banner.width, banner.height, 9, UI.gold, 1);
      drawCenteredText(
        ctx,
        eventLabel,
        { x: banner.x + banner.width / 2, y: banner.y + banner.height / 2 },
        canvasFont(400, 11),
        UI.text,
      );
    }
  });
}

export function renderControls(renderContext: RenderContext, state: GameState, guideCost = 18): void {
  const { ctx, layout } = renderContext;
  renderContext.withScreen(() => {
    const joystick = layout.joystickCenter;
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawCircleScreen(ctx, joystick, layout.joystickRadius, '#23445f', '#b0d1da', 2);
    ctx.globalAlpha = 0.85;
    const speedRatio = clamp(Math.hypot(state.player.velocity.x, state.player.velocity.y) / Math.max(1, state.player.speed), 0, 1);
    const facing = worldDirectionToScreen(
      state.player.facing,
      layout.orientation,
      layout.worldScaleX,
      layout.worldScaleY,
    );
    const knob = { x: joystick.x + facing.x * layout.joystickRadius * 0.45 * speedRatio, y: joystick.y + facing.y * layout.joystickRadius * 0.45 * speedRatio };
    drawCircleScreen(ctx, knob, layout.joystickRadius * 0.42, UI.accent, '#d8fff6', 2);
    ctx.restore();

    const button = layout.guideButtonRect;
    const available = state.player.abilityCooldown <= 0 && state.player.stamina >= guideCost;
    let latestGuide = -Infinity;
    for (const event of state.events) {
      if (event.type === 'guide' && Number.isFinite(event.at) && event.at <= state.elapsed + 1e-8) {
        latestGuide = Math.max(latestGuide, event.at);
      }
    }
    const guideAge = latestGuide === -Infinity ? -1 : Math.max(0, state.elapsed - latestGuide);
    if (guideAge >= 0 && guideAge < 0.8) {
      const pulse = 1 + (1 - guideAge / 0.8) * 0.16;
      ctx.save();
      ctx.globalAlpha = 0.2 + (1 - guideAge / 0.8) * 0.32;
      drawCircleScreen(
        ctx,
        { x: button.x + button.width / 2, y: button.y + button.height / 2 },
        button.width * 0.43 * pulse,
        'rgba(127,240,200,0)',
        UI.accent,
        2,
      );
      ctx.restore();
    }
    fillRoundRect(ctx, button.x, button.y, button.width, button.height, button.width * 0.28, available ? '#2f7880' : '#3d5367');
    strokeRoundRect(ctx, button.x, button.y, button.width, button.height, button.width * 0.28, available ? UI.accent : UI.muted, 2);
    drawCenteredText(ctx, '疏导', { x: button.x + button.width / 2, y: button.y + button.height * 0.42 }, canvasFont(700, 15), UI.text);
    ctx.font = canvasMonoFont(400, 11);
    ctx.fillStyle = UI.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.player.abilityCooldown > 0 ? formatSeconds(state.player.abilityCooldown) : 'SPACE', button.x + button.width / 2, button.y + button.height * 0.72);
  });
}

function drawCircleScreen(
  ctx: Canvas2DContextLike,
  center: { x: number; y: number },
  radius: number,
  fill: string,
  stroke?: string,
  lineWidth = 1,
): void {
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function renderLandscapeResultScreen(renderContext: RenderContext, level: LevelConfig, state: GameState): void {
  const { ctx, layout } = renderContext;
  const score = state.score;
  const rect = layout.resultRect;
  renderContext.withScreen(() => {
    ctx.globalAlpha = 0.76;
    ctx.fillStyle = '#10243a';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    ctx.globalAlpha = 1;
    fillRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 22, UI.panel);
    strokeRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 22, score?.success ? UI.accent : UI.warning, 2);
    drawCenteredText(ctx, score?.success ? '\u8d76\u4e0a\u4e86\u8fd9\u73ed\u8f66' : '\u8fd9\u6b21\u9519\u8fc7\u4e86', {
      x: rect.x + rect.width / 2,
      y: rect.y + 30,
    }, canvasFont(700, 21), UI.text);
    drawCenteredText(ctx, level.stationName, {
      x: rect.x + rect.width / 2,
      y: rect.y + 56,
    }, canvasFont(400, 12), UI.muted);
    if (score) {
      drawCenteredText(ctx, score.medal === 'none' ? '\u7ee7\u7eed\u89c2\u5bdf' : score.medal.toUpperCase() + ' MEDAL', {
        x: rect.x + rect.width / 2,
        y: rect.y + 82,
      }, canvasFont(700, 15), medalColor(score.medal));
      drawCenteredText(ctx, `三星目标 ${score.stars} / 3`, {
        x: rect.x + rect.width / 2,
        y: rect.y + 101,
      }, canvasFont(600, 11), UI.gold);
      const rows: Array<[string, number]> = [
        ['\u6548\u7387', score.efficiency],
        ['\u793c\u8ba9', score.courtesy],
        ['\u4f53\u529b', score.stamina],
      ];
      const columnGap = 18;
      const cellWidth = Math.max(70, (rect.width - 48 - columnGap) / 2);
      rows.forEach(([label, value], index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const cellX = rect.x + 24 + column * (cellWidth + columnGap);
        const cellY = rect.y + 126 + row * 34;
        ctx.font = canvasFont(400, 11);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = UI.muted;
        fillTextCompat(ctx, label, cellX, cellY, 38);
        drawBar(ctx, {
          x: cellX + 42,
          y: cellY - 3,
          width: Math.max(18, cellWidth - 74),
          height: 6,
        }, value / 100, value >= 80 ? UI.accent : UI.gold);
        ctx.textAlign = 'right';
        ctx.fillStyle = UI.text;
        ctx.fillText(String(value), cellX + cellWidth, cellY);
      });
      drawCenteredText(ctx, '\u603b\u5206 ' + score.total, {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height - 98,
      }, canvasMonoFont(700, 18), UI.text);
    }
    const buttons = [
      { rect: layout.resultRetryRect, label: '\u91cd\u8bd5', color: UI.accent },
      { rect: layout.resultNextRect, label: '\u4e0b\u4e00\u7ad9', color: score?.success ? UI.gold : UI.muted },
      { rect: layout.resultRouteRect, label: '\u8def\u7ebf', color: UI.muted },
    ];
    for (const button of buttons) {
      fillRoundRect(ctx, button.rect.x, button.rect.y, button.rect.width, button.rect.height, 10, UI.panelAlt);
      strokeRoundRect(ctx, button.rect.x, button.rect.y, button.rect.width, button.rect.height, 10, button.color, 1);
      drawCenteredText(ctx, button.label, {
        x: button.rect.x + button.rect.width / 2,
        y: button.rect.y + button.rect.height / 2,
      }, canvasFont(600, 12), UI.text);
    }
    drawCenteredText(ctx, '\u4e5f\u53ef\u6309 R \u91cd\u8bd5', {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height - 20,
    }, canvasFont(400, 10), UI.muted);
  });
}

export function renderResultScreen(renderContext: RenderContext, level: LevelConfig, state: GameState): void {
  const { ctx, layout } = renderContext;
  if (layout.orientation === 'landscape') {
    renderLandscapeResultScreen(renderContext, level, state);
    return;
  }
  const score = state.score;
  renderContext.withScreen(() => {
    ctx.globalAlpha = 0.76;
    ctx.fillStyle = '#10243a';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    ctx.globalAlpha = 1;
    const rect = layout.resultRect;
    fillRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 22, UI.panel);
    strokeRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 22, score?.success ? UI.accent : UI.warning, 2);
    drawCenteredText(ctx, score?.success ? '赶上了这班车' : '这次错过了', { x: rect.x + rect.width / 2, y: rect.y + 42 }, canvasFont(700, 24), UI.text);
    drawCenteredText(ctx, level.stationName, { x: rect.x + rect.width / 2, y: rect.y + 72 }, canvasFont(400, 13), UI.muted);

    if (score) {
      drawCenteredText(ctx, score.medal === 'none' ? '继续观察，再试一局' : `${score.medal.toUpperCase()} 牌`, { x: rect.x + rect.width / 2, y: rect.y + 108 }, canvasFont(700, 18), medalColor(score.medal));
      drawCenteredText(ctx, `三星目标 ${score.stars} / 3`, { x: rect.x + rect.width / 2, y: rect.y + 132 }, canvasFont(600, 12), UI.gold);
      const rows: Array<[string, number]> = [
        ['效率', score.efficiency],
        ['礼让', score.courtesy],
        ['体力', score.stamina],
      ];
      rows.forEach(([label, value], index) => {
        const y = rect.y + 158 + index * 28;
        ctx.font = canvasFont(400, 13);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = UI.muted;
        ctx.fillText(label, rect.x + 24, y);
        drawBar(ctx, { x: rect.x + 72, y: y - 4, width: rect.width - 128, height: 8 }, value / 100, value >= 80 ? UI.accent : UI.gold);
        ctx.textAlign = 'right';
        ctx.fillStyle = UI.text;
        ctx.fillText(String(value), rect.x + rect.width - 24, y);
      });
      drawCenteredText(ctx, `总分 ${score.total}`, { x: rect.x + rect.width / 2, y: rect.y + rect.height - 104 }, canvasMonoFont(700, 20), UI.text);
    }
    const buttons = [
      { rect: layout.resultRetryRect, label: '重试', color: UI.accent },
      { rect: layout.resultNextRect, label: '下一站', color: score?.success ? UI.gold : UI.muted },
      { rect: layout.resultRouteRect, label: '路线', color: UI.muted },
    ];
    for (const button of buttons) {
      fillRoundRect(ctx, button.rect.x, button.rect.y, button.rect.width, button.rect.height, 10, UI.panelAlt);
      strokeRoundRect(ctx, button.rect.x, button.rect.y, button.rect.width, button.rect.height, 10, button.color, 1);
      drawCenteredText(ctx, button.label, {
        x: button.rect.x + button.rect.width / 2,
        y: button.rect.y + button.rect.height / 2,
      }, canvasFont(600, 12), UI.text);
    }
    drawCenteredText(ctx, '也可按 R 重试', { x: rect.x + rect.width / 2, y: rect.y + rect.height - 22 }, canvasFont(400, 11), UI.muted);
  });
}

export function renderPauseOverlay(renderContext: RenderContext): void {
  const { ctx, layout } = renderContext;
  renderContext.withScreen(() => {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#10243a';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    ctx.globalAlpha = 1;
    drawCenteredText(ctx, '已暂停', { x: layout.viewport.width / 2, y: layout.viewport.height / 2 - 14 }, canvasFont(700, 24), UI.text);
    drawCenteredText(ctx, '再次点击暂停 / 按 Esc 继续', { x: layout.viewport.width / 2, y: layout.viewport.height / 2 + 20 }, canvasFont(400, 13), UI.muted);
  });
}

function renderLandscapeRoutePage(
  renderContext: RenderContext,
  levels: readonly LevelConfig[],
  unlockedLevelIds: readonly string[],
  selectedIndex: number,
  bestScores: Readonly<Record<string, number>>,
  bestStars: Readonly<Record<string, number>>,
  dropdownExpanded: boolean,
  scrollOffset: number,
): void {
  const { ctx, layout } = renderContext;
  const content = layout.viewport.contentRect;
  const visibleLevels = levels.map((level, index) => ({ level, index })).filter(({ level }) => unlockedLevelIds.includes(level.id));
  renderContext.withScreen(() => {
    ctx.fillStyle = '#0b1627';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    renderPageButton(renderContext, pageBackRect(layout.viewport), '首页');
    drawCenteredText(ctx, '挤上这班车', { x: content.x + content.width / 2, y: content.y + 28 }, canvasFont(700, 24), UI.text);
    drawCenteredText(ctx, '潮汐线·仅展示已解锁关卡', { x: content.x + content.width / 2, y: content.y + 54 }, canvasFont(400, 11), UI.muted);
    const list = routeListRect(layout.viewport);
    drawCenteredText(ctx, '上下滑动选择已解锁关卡', { x: content.x + content.width / 2, y: content.y + 76 }, canvasFont(400, 10), UI.muted);
    visibleLevels.forEach(({ level, index }, visibleIndex) => {
      const card = routeListCardRect(layout.viewport, visibleIndex, scrollOffset);
      if (card.y + card.height < list.y || card.y > list.y + list.height) return;
      const selected = index === selectedIndex;
      const padding = clamp(card.height * 0.15, 10, 16);
      const titleSize = clamp(card.height * 0.17, 12, 16);
      const bodySize = clamp(card.height * 0.115, 9, 12);
      const radius = clamp(card.height * 0.16, 9, 15);
      fillRoundRect(ctx, card.x, card.y, card.width, card.height, radius, UI.panel);
      strokeRoundRect(ctx, card.x, card.y, card.width, card.height, radius, selected ? UI.accent : '#30415c', selected ? 2 : 1);
      ctx.font = canvasFont(700, titleSize);
      ctx.fillStyle = UI.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      fillTextCompat(ctx, (index + 1) + '. ' + level.name, card.x + padding, card.y + padding, Math.max(1, card.width - padding * 2));
      ctx.font = canvasFont(400, bodySize);
      ctx.fillStyle = UI.muted;
      fillTextCompat(ctx, level.description, card.x + padding, card.y + card.height * 0.42, Math.max(1, card.width - padding * 2));
      ctx.font = canvasFont(600, bodySize);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = UI.accent;
      ctx.fillText('可出发', card.x + card.width - padding, card.y + card.height - padding);
      ctx.textAlign = 'left';
      ctx.fillStyle = UI.gold;
      ctx.fillText(starDisplay(bestStars[level.id] ?? 0), card.x + padding, card.y + card.height - padding);
      if (bestScores[level.id] !== undefined) {
        ctx.textAlign = 'center';
        ctx.fillStyle = UI.muted;
        ctx.fillText('最高 ' + String(bestScores[level.id]), card.x + card.width / 2, card.y + card.height - padding);
      }
    });
    if (visibleLevels.length === 0) drawCenteredText(ctx, '暂无可用关卡', { x: content.x + content.width / 2, y: content.y + content.height / 2 }, canvasFont(600, 15), UI.muted);
  });
}

function renderPageButton(
  renderContext: RenderContext,
  rect: { x: number; y: number; width: number; height: number },
  label: string,
  detail?: string,
  selected = false,
): void {
  const { ctx } = renderContext;
  fillRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 12, selected ? '#24566b' : UI.panel);
  strokeRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 12, selected ? UI.accent : '#30415c', selected ? 2 : 1);
  drawCenteredText(ctx, label, { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.42 }, canvasFont(700, 15), UI.text);
  if (detail) drawCenteredText(ctx, detail, { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.74 }, canvasFont(400, 10), UI.muted);
}

export function renderHomePage(renderContext: RenderContext): void {
  const { ctx, layout } = renderContext;
  const content = layout.viewport.contentRect;
  renderContext.withScreen(() => {
    ctx.fillStyle = '#0b1627';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    drawCenteredText(ctx, '挤上这班车', { x: content.x + content.width / 2, y: content.y + 38 }, canvasFont(800, 28), UI.text);
    drawCenteredText(ctx, '湾城潮汐线 · 通勤挑战', { x: content.x + content.width / 2, y: content.y + 66 }, canvasFont(400, 13), UI.muted);
    const buttons = [
      ['开始游戏', '选择已解锁关卡'],
      ['成就', '查看三星目标与称号'],
      ['外观更换', '更换主角配色'],
      ['设置', '声音与震动'],
    ] as const;
    buttons.forEach(([label, detail], index) => renderPageButton(renderContext, menuButtonRect(layout.viewport, index, buttons.length), label, detail));
    drawCenteredText(ctx, '所有线路均为虚构设定', { x: content.x + content.width / 2, y: content.y + content.height - 20 }, canvasFont(400, 10), UI.muted);
  });
}

export function renderLevelBriefing(renderContext: RenderContext, level: LevelConfig): void {
  const { ctx, layout } = renderContext;
  const content = layout.viewport.contentRect;
  renderContext.withScreen(() => {
    ctx.fillStyle = '#0b1627';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    ctx.globalAlpha = 0.96;
    const panel = layout.resultRect;
    fillRoundRect(ctx, panel.x, panel.y, panel.width, panel.height, 20, UI.panel);
    strokeRoundRect(ctx, panel.x, panel.y, panel.width, panel.height, 20, UI.accent, 2);
    ctx.globalAlpha = 1;
    drawCenteredText(ctx, '出发前提醒', { x: content.x + content.width / 2, y: panel.y + 42 }, canvasFont(800, 23), UI.text);
    drawCenteredText(ctx, level.stationName, { x: content.x + content.width / 2, y: panel.y + 70 }, canvasFont(500, 13), UI.muted);
    drawCenteredText(ctx, '本关三星目标', { x: panel.x + panel.width / 2, y: panel.y + 112 }, canvasFont(700, 14), UI.gold);
    (level.objectives ?? []).slice(0, 3).forEach((objective, index) => {
      const label = objectiveSummary({ ...level, objectives: [objective] });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = canvasFont(600, 13);
      ctx.fillStyle = UI.text;
      ctx.fillText(`${index + 1}. ${label}`, panel.x + 28, panel.y + 142 + index * 27);
    });
    fillRoundRect(ctx, layout.briefingConfirmRect.x, layout.briefingConfirmRect.y, layout.briefingConfirmRect.width, layout.briefingConfirmRect.height, 12, UI.accent);
    drawCenteredText(ctx, '确认并开始', { x: layout.briefingConfirmRect.x + layout.briefingConfirmRect.width / 2, y: layout.briefingConfirmRect.y + 22 }, canvasFont(700, 15), '#06202b');
  });
}

export function renderAchievementsPage(
  renderContext: RenderContext,
  levels: readonly LevelConfig[],
  bestStars: Readonly<Record<string, number>>,
): void {
  const { ctx, layout } = renderContext;
  const content = layout.viewport.contentRect;
  const totalStars = levels.reduce((sum, level) => sum + Math.min(3, Math.max(0, bestStars[level.id] ?? 0)), 0);
  renderContext.withScreen(() => {
    ctx.fillStyle = '#0b1627';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    renderPageButton(renderContext, pageBackRect(layout.viewport), '返回');
    drawCenteredText(ctx, '成就', { x: content.x + content.width / 2, y: content.y + 38 }, canvasFont(800, 26), UI.text);
    drawCenteredText(ctx, `战役星数 ${totalStars} / ${levels.length * 3}`, { x: content.x + content.width / 2, y: content.y + 66 }, canvasFont(500, 13), UI.gold);
    levels.forEach((level, index) => {
      const card = routeCardRect(layout.viewport, index, levels.length);
      fillRoundRect(ctx, card.x, card.y, card.width, card.height, 10, UI.panel);
      strokeRoundRect(ctx, card.x, card.y, card.width, card.height, 10, '#30415c', 1);
      ctx.font = canvasFont(600, Math.max(10, Math.min(14, card.height * 0.16)));
      ctx.fillStyle = UI.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      fillTextCompat(ctx, `${index + 1}. ${level.name}`, card.x + 10, card.y + 9, card.width - 20);
      ctx.textAlign = 'right';
      ctx.fillStyle = UI.gold;
      ctx.fillText('★'.repeat(Math.min(3, Math.max(0, bestStars[level.id] ?? 0))) + '☆'.repeat(3 - Math.min(3, Math.max(0, bestStars[level.id] ?? 0))), card.x + card.width - 10, card.y + 10);
    });
  });
}

export function renderAppearancePage(renderContext: RenderContext, appearanceId: string, unlockedAppearanceIds: readonly string[] = ['default'], spriteFor?: (id: string) => PlayerSpriteAsset | undefined): void {
  const { ctx, layout } = renderContext;
  const content = layout.viewport.contentRect;
  renderContext.withScreen(() => {
    ctx.fillStyle = '#0b1627';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    renderPageButton(renderContext, pageBackRect(layout.viewport), '返回');
    drawCenteredText(ctx, '外观更换', { x: content.x + content.width / 2, y: content.y + 38 }, canvasFont(800, 26), UI.text);
    drawCenteredText(ctx, '预览全部外观 · 点击已解锁外观装备', { x: content.x + content.width / 2, y: content.y + 67 }, canvasFont(400, 11), UI.muted);
    APPEARANCE_OPTIONS.forEach(({ id, label, condition }, index) => {
      const card = appearanceCardRect(layout.viewport, index);
      const unlocked = unlockedAppearanceIds.includes(id);
      fillRoundRect(ctx, card.x, card.y, card.width, card.height, 12, UI.panel);
      strokeRoundRect(ctx, card.x, card.y, card.width, card.height, 12, id === appearanceId ? UI.accent : '#30415c', id === appearanceId ? 2 : 1);
      const previewSize = Math.min(76, card.height - 12);
      drawPlayerPreview(renderContext, id, spriteFor?.(id), card.x + 42, card.y + card.height / 2, previewSize);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = canvasFont(600, 14);
      ctx.fillStyle = UI.text;
      ctx.fillText(label, card.x + 84, card.y + card.height * 0.3, card.width - 94);
      ctx.font = canvasFont(400, 10);
      ctx.fillStyle = unlocked ? UI.muted : UI.warning;
      ctx.fillText(condition, card.x + 84, card.y + card.height * 0.55, card.width - 94);
      ctx.fillText(unlocked ? (id === appearanceId ? '已使用' : '点击使用') : '未解锁', card.x + 84, card.y + card.height * 0.8, card.width - 94);
      ctx.globalAlpha = 1;
    });
  });
}

export function renderSettingsPage(renderContext: RenderContext, settings: SaveSettings): void {
  const { ctx, layout } = renderContext;
  const content = layout.viewport.contentRect;
  const entries = [
    ['声音', settings.soundEnabled],
    ['音乐', settings.musicEnabled],
    ['震动', settings.vibrationEnabled],
  ] as const;
  renderContext.withScreen(() => {
    ctx.fillStyle = '#0b1627';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    renderPageButton(renderContext, pageBackRect(layout.viewport), '返回');
    drawCenteredText(ctx, '设置', { x: content.x + content.width / 2, y: content.y + 38 }, canvasFont(800, 26), UI.text);
    entries.forEach(([label, enabled], index) => renderPageButton(renderContext, menuButtonRect(layout.viewport, index, entries.length), label, enabled ? '开启' : '关闭', enabled));
  });
}

export function renderRoutePage(
  renderContext: RenderContext,
  levels: readonly LevelConfig[],
  unlockedLevelIds: readonly string[],
  selectedIndex = 0,
  bestScores: Readonly<Record<string, number>> = {},
  bestStars: Readonly<Record<string, number>> = {},
  dropdownExpanded = true,
  scrollOffset = 0,
): void {
  const { ctx, layout } = renderContext;
  if (layout.orientation === 'landscape') {
    renderLandscapeRoutePage(renderContext, levels, unlockedLevelIds, selectedIndex, bestScores, bestStars, dropdownExpanded, scrollOffset);
    return;
  }
  renderContext.withScreen(() => {
    const content = layout.viewport.contentRect;
    const visibleLevels = levels.map((level, index) => ({ level, index })).filter(({ level }) => unlockedLevelIds.includes(level.id));
    ctx.fillStyle = '#0b1627';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    renderPageButton(renderContext, pageBackRect(layout.viewport), '首页');
    drawCenteredText(ctx, '挤上这班车', { x: content.x + content.width / 2, y: content.y + 52 }, canvasFont(700, 28), UI.text);
    drawCenteredText(ctx, '已解锁关卡列表', { x: content.x + content.width / 2, y: content.y + 82 }, canvasFont(400, 13), UI.muted);
    const list = routeListRect(layout.viewport);
    drawCenteredText(ctx, '上下滑动选择已解锁关卡', { x: content.x + content.width / 2, y: content.y + 105 }, canvasFont(400, 12), UI.muted);
    visibleLevels.forEach(({ level, index }, visibleIndex) => {
      const card = routeListCardRect(layout.viewport, visibleIndex, scrollOffset);
      if (card.y + card.height < list.y || card.y > list.y + list.height) return;
      const y = card.y;
      const selected = index === selectedIndex;
      try {
        ctx.fillStyle = UI.panel;
        ctx.fillRect(card.x, y, card.width, card.height);
      } catch {
        // 基础矩形不可用时由圆角兼容路径继续绘制。
      }
      fillRoundRect(ctx, card.x, y, card.width, card.height, 18, UI.panel);
      try {
        ctx.strokeStyle = selected ? UI.accent : '#30415c';
        ctx.lineWidth = selected ? 2 : 1;
        ctx.strokeRect(card.x, y, card.width, card.height);
      } catch {
        // 由 strokeRoundRect 的兼容路径继续尝试边框绘制。
      }
      strokeRoundRect(ctx, card.x, y, card.width, card.height, 18, selected ? UI.accent : '#30415c', selected ? 2 : 1);
      ctx.font = canvasFont(700, 17);
      ctx.fillStyle = UI.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText((index + 1) + '. ' + level.name, card.x + 18, y + 17);
      ctx.font = canvasFont(400, 12);
      ctx.fillStyle = UI.muted;
      fillTextCompat(ctx, level.description, card.x + 18, y + card.height * 0.4, card.width - 36);
      ctx.textAlign = 'right';
      ctx.fillStyle = UI.accent;
      ctx.fillText('可出发', card.x + card.width - 18, y + card.height - 8);
      ctx.textAlign = 'left';
      ctx.fillStyle = UI.gold;
      ctx.fillText(starDisplay(bestStars[level.id] ?? 0), card.x + 18, y + card.height - 8);
      if (bestScores[level.id] !== undefined) {
        ctx.textAlign = 'center';
        ctx.fillStyle = UI.muted;
        ctx.fillText('最高 ' + String(bestScores[level.id]), card.x + card.width / 2, y + card.height - 8);
      }
    });
    if (visibleLevels.length === 0) drawCenteredText(ctx, '暂无可用关卡', { x: content.x + content.width / 2, y: content.y + content.height / 2 }, canvasFont(600, 15), UI.muted);
  });
}
