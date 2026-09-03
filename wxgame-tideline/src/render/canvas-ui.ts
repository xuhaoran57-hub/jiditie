import type { GameState, LevelConfig, ScoreResult } from '../core/types.ts';
import { clamp } from '../core/vector.ts';
import type { Canvas2DContextLike } from './context.ts';
import {
  drawCenteredText,
  fillRoundRect,
  RenderContext,
  routeCardRect,
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
  const phaseLabel = state.activeEvent
    ? `${PHASE_LABELS[state.phase]} · ${state.activeEvent.label} ${formatSeconds(state.activeEvent.remaining)}`
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
    const phaseLabel = state.activeEvent
      ? `${PHASE_LABELS[state.phase]} · ${state.activeEvent.label}`
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
        `${state.activeEvent.label} ${formatSeconds(state.activeEvent.remaining)}`,
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
      const rows: Array<[string, number]> = [
        ['\u6548\u7387', score.efficiency],
        ['\u793c\u8ba9', score.courtesy],
        ['\u4f53\u529b', score.stamina],
        ['\u8def\u7ebf', score.route],
      ];
      const columnGap = 18;
      const cellWidth = Math.max(70, (rect.width - 48 - columnGap) / 2);
      rows.forEach(([label, value], index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const cellX = rect.x + 24 + column * (cellWidth + columnGap);
        const cellY = rect.y + 116 + row * 34;
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
      const rows: Array<[string, number]> = [
        ['效率', score.efficiency],
        ['礼让', score.courtesy],
        ['体力', score.stamina],
        ['路线', score.route],
      ];
      rows.forEach(([label, value], index) => {
        const y = rect.y + 142 + index * 28;
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
): void {
  const { ctx, layout } = renderContext;
  const content = layout.viewport.contentRect;
  renderContext.withScreen(() => {
    ctx.fillStyle = '#0b1627';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    drawCenteredText(ctx, '\u6f6e\u6c5f\u7ebf', {
      x: content.x + content.width / 2,
      y: content.y + 28,
    }, canvasFont(700, 24), UI.text);
    drawCenteredText(ctx, '\u9009\u62e9\u4e00\u7ad9\uff0c\u7ec3\u4e60\u66f4\u4f53\u9762\u7684\u901a\u884c', {
      x: content.x + content.width / 2,
      y: content.y + 54,
    }, canvasFont(400, 11), UI.muted);

    levels.forEach((level, index) => {
      const card = routeCardRect(layout.viewport, index);
      const unlocked = unlockedLevelIds.includes(level.id);
      const selected = index === selectedIndex;
      const padding = clamp(card.height * 0.15, 10, 16);
      const titleSize = clamp(card.height * 0.17, 12, 16);
      const bodySize = clamp(card.height * 0.115, 9, 12);
      const radius = clamp(card.height * 0.16, 9, 15);
      fillRoundRect(ctx, card.x, card.y, card.width, card.height, radius, unlocked ? UI.panel : '#151d2d');
      strokeRoundRect(ctx, card.x, card.y, card.width, card.height, radius, selected ? UI.accent : '#30415c', selected ? 2 : 1);
      ctx.font = canvasFont(700, titleSize);
      ctx.fillStyle = unlocked ? UI.text : UI.muted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      fillTextCompat(ctx, `${index + 1}. ${level.name}`, card.x + padding, card.y + padding, Math.max(1, card.width - padding * 2));
      ctx.font = canvasFont(400, bodySize);
      ctx.fillStyle = UI.muted;
      fillTextCompat(
        ctx,
        unlocked ? level.description : '\u5b8c\u6210\u4e0a\u4e00\u7ad9\u540e\u89e3\u9501',
        card.x + padding,
        card.y + card.height * 0.46,
        Math.max(1, card.width - padding * 2),
      );
      ctx.font = canvasFont(600, bodySize);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = unlocked ? UI.accent : UI.muted;
      ctx.fillText(unlocked ? '\u53ef\u51fa\u53d1' : '\u9501\u5b9a', card.x + card.width - padding, card.y + card.height - padding);
    });
  });
}

export function renderRoutePage(
  renderContext: RenderContext,
  levels: readonly LevelConfig[],
  unlockedLevelIds: readonly string[],
  selectedIndex = 0,
): void {
  const { ctx, layout } = renderContext;
  if (layout.orientation === 'landscape') {
    renderLandscapeRoutePage(renderContext, levels, unlockedLevelIds, selectedIndex);
    return;
  }
  renderContext.withScreen(() => {
    const content = layout.viewport.contentRect;
    ctx.fillStyle = '#0b1627';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    drawCenteredText(ctx, '潮汐线', { x: content.x + content.width / 2, y: content.y + 52 }, canvasFont(700, 28), UI.text);
    drawCenteredText(ctx, '选择一站，练习更体面的通行', { x: content.x + content.width / 2, y: content.y + 82 }, canvasFont(400, 13), UI.muted);
    levels.forEach((level, index) => {
      const card = routeCardRect(layout.viewport, index);
      const y = card.y;
      const unlocked = unlockedLevelIds.includes(level.id);
      const selected = index === selectedIndex;
      // 先画一层基础矩形。部分微信 Canvas 实现对圆角路径支持不完整，
      // 但 fillRect/strokeRect 是稳定能力；基础层可保证卡片和命中区域始终可见。
      try {
        ctx.fillStyle = unlocked ? UI.panel : '#151d2d';
        ctx.fillRect(card.x, y, card.width, card.height);
      } catch {
        // 圆角/矩形均属于视觉增强；文字和后续卡片仍应继续绘制。
      }
      fillRoundRect(ctx, card.x, y, card.width, card.height, 18, unlocked ? UI.panel : '#151d2d');
      try {
        ctx.strokeStyle = selected ? UI.accent : '#30415c';
        ctx.lineWidth = selected ? 2 : 1;
        ctx.strokeRect(card.x, y, card.width, card.height);
      } catch {
        // 由 strokeRoundRect 的兼容路径继续尝试边框绘制。
      }
      strokeRoundRect(ctx, card.x, y, card.width, card.height, 18, selected ? UI.accent : '#30415c', selected ? 2 : 1);
      ctx.font = canvasFont(700, 17);
      ctx.fillStyle = unlocked ? UI.text : UI.muted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${index + 1}. ${level.name}`, card.x + 18, y + 17);
      ctx.font = canvasFont(400, 12);
      ctx.fillStyle = UI.muted;
      fillTextCompat(ctx, unlocked ? level.description : '完成上一站后解锁', card.x + 18, y + 48, card.width - 36);
      ctx.textAlign = 'right';
      ctx.fillStyle = unlocked ? UI.accent : UI.muted;
      ctx.fillText(unlocked ? '可出发' : '锁定', card.x + card.width - 18, y + 86);
    });
  });
}
