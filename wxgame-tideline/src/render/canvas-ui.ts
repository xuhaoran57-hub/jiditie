import type { GameState, LevelConfig, ScoreResult } from '../core/types.ts';
import { clamp } from '../core/vector.ts';
import type { Canvas2DContextLike } from './context.ts';
import {
  drawCenteredText,
  fillRoundRect,
  RenderContext,
  routeCardRect,
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
  boarding: '寻找入口',
  warning: '即将关门',
  result: '本局结算',
};

function drawBar(
  ctx: Canvas2DContextLike,
  rect: { x: number; y: number; width: number; height: number },
  ratio: number,
  color: string,
): void {
  fillRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, rect.height / 2, '#0e1728');
  fillRoundRect(ctx, rect.x, rect.y, rect.width * clamp(ratio, 0, 1), rect.height, rect.height / 2, color);
}

function formatSeconds(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(1)}s`;
}

function medalColor(medal: ScoreResult['medal']): string {
  if (medal === 'gold') return UI.gold;
  if (medal === 'silver') return UI.silver;
  if (medal === 'bronze') return UI.bronze;
  return UI.muted;
}

export function renderHud(renderContext: RenderContext, level: LevelConfig, state: GameState): void {
  const { ctx, layout } = renderContext;
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
      fillRoundRect(ctx, banner.x, banner.y, banner.width, banner.height, 9, '#28425b');
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
    drawCircleScreen(ctx, joystick, layout.joystickRadius, '#18263e', '#8ba2bb', 2);
    ctx.globalAlpha = 0.85;
    const speedRatio = clamp(Math.hypot(state.player.velocity.x, state.player.velocity.y) / Math.max(1, state.player.speed), 0, 1);
    const knob = { x: joystick.x + state.player.facing.x * layout.joystickRadius * 0.45 * speedRatio, y: joystick.y + state.player.facing.y * layout.joystickRadius * 0.45 * speedRatio };
    drawCircleScreen(ctx, knob, layout.joystickRadius * 0.42, UI.accent, '#d8fff6', 2);
    ctx.restore();

    const button = layout.guideButtonRect;
    const available = state.player.abilityCooldown <= 0 && state.player.stamina >= guideCost;
    fillRoundRect(ctx, button.x, button.y, button.width, button.height, button.width * 0.28, available ? '#285d68' : '#29354a');
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

export function renderResultScreen(renderContext: RenderContext, level: LevelConfig, state: GameState): void {
  const { ctx, layout } = renderContext;
  const score = state.score;
  renderContext.withScreen(() => {
    ctx.globalAlpha = 0.76;
    ctx.fillStyle = '#080e1a';
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
    ctx.fillStyle = '#080e1a';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    ctx.globalAlpha = 1;
    drawCenteredText(ctx, '已暂停', { x: layout.viewport.width / 2, y: layout.viewport.height / 2 - 14 }, canvasFont(700, 24), UI.text);
    drawCenteredText(ctx, '再次点击暂停 / 按 Esc 继续', { x: layout.viewport.width / 2, y: layout.viewport.height / 2 + 20 }, canvasFont(400, 13), UI.muted);
  });
}

export function renderRoutePage(
  renderContext: RenderContext,
  levels: readonly LevelConfig[],
  unlockedLevelIds: readonly string[],
  selectedIndex = 0,
): void {
  const { ctx, layout } = renderContext;
  renderContext.withScreen(() => {
    const content = layout.viewport.contentRect;
    ctx.fillStyle = '#0c1220';
    ctx.fillRect(0, 0, layout.viewport.width, layout.viewport.height);
    drawCenteredText(ctx, '潮汐线', { x: content.x + content.width / 2, y: content.y + 52 }, canvasFont(700, 28), UI.text);
    drawCenteredText(ctx, '选择一站，练习更体面的通行', { x: content.x + content.width / 2, y: content.y + 82 }, canvasFont(400, 13), UI.muted);
    levels.forEach((level, index) => {
      const card = routeCardRect(layout.viewport, index);
      const y = card.y;
      const unlocked = unlockedLevelIds.includes(level.id);
      const selected = index === selectedIndex;
      fillRoundRect(ctx, card.x, y, card.width, card.height, 18, unlocked ? UI.panel : '#151d2d');
      strokeRoundRect(ctx, card.x, y, card.width, card.height, 18, selected ? UI.accent : '#30415c', selected ? 2 : 1);
      ctx.font = canvasFont(700, 17);
      ctx.fillStyle = unlocked ? UI.text : UI.muted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${index + 1}. ${level.name}`, card.x + 18, y + 17);
      ctx.font = canvasFont(400, 12);
      ctx.fillStyle = UI.muted;
      ctx.fillText(unlocked ? level.description : '完成上一站后解锁', card.x + 18, y + 48, card.width - 36);
      ctx.textAlign = 'right';
      ctx.fillStyle = unlocked ? UI.accent : UI.muted;
      ctx.fillText(unlocked ? '可出发' : '锁定', card.x + card.width - 18, y + 86);
    });
  });
}
