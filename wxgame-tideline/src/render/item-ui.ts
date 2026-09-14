import { ITEMS, ITEM_IDS, itemPhaseAllowed } from '../core/items.ts';
import type { GameState, ItemId, Rect } from '../core/types.ts';
import { failedResultLayout, fillRoundRect, strokeRoundRect, type RenderContext, type RenderLayout } from './context.ts';
import { canvasFont } from './design-tokens.ts';

export type ItemPanel = 'supply' | 'welcome' | 'reward' | null;
export type RewardStatus = 'idle' | 'watching' | 'sharing' | 'saving' | 'save-error' | 'granted';
export interface ItemUiState {
  panel: ItemPanel;
  selected: ItemId;
  status: RewardStatus;
  inventory: Record<ItemId, number>;
  used: Record<ItemId, number>;
  claimedResultRewards: ItemId[];
  message: string;
  adAvailable: boolean;
  shareAvailable: boolean;
  endless: boolean;
  welcomePending: boolean;
  unassistedScore: number;
}
export interface ItemHitArea { id: string; rect: Rect }

export function itemUiLayout(layout: RenderLayout) {
  const c = layout.viewport.contentRect;
  const w = Math.min(552, c.width - 24);
  const h = Math.min(360, c.height - 20);
  const panel = { x: c.x + (c.width - w) / 2, y: c.y + (c.height - h) / 2, width: w, height: h };
  const gap = 10;
  const cardHeight = h < 320 ? 66 : 86;
  const cardWidth = (w - 36 - gap) / 2;
  const cards = ITEM_IDS.map((id, i) => ({ id, rect: { x: panel.x + 18 + i * (cardWidth + gap), y: panel.y + 66, width: cardWidth, height: cardHeight } }));
  const rowY = panel.y + h - 112;
  const half = (w - 46) / 2;
  // 横屏面板较宽时，奖励按钮不再拉伸到整行，保持紧凑且易于区分。
  const rewardWidth = Math.min(180, half);
  const rewardStartX = panel.x + (w - rewardWidth * 2 - gap) / 2;
  const primary = { x: rewardStartX, y: rowY + 4, width: rewardWidth, height: 36 };
  const secondary = { ...primary, x: primary.x + rewardWidth + gap };
  const single = { x: panel.x + 18, y: rowY, width: w - 36, height: 44 };
  const back = { x: panel.x + 18, y: panel.y + h - 58, width: w - 36, height: 44 };
  const g = layout.guideButtonRect;
  const quick = ITEM_IDS.map((id, i) => ({ id, rect: { x: c.x + c.width - 132 + i * 58, y: g.y - 64, width: 52, height: 54 } }));
  const entry = { x: c.x + c.width - Math.min(194, c.width - 100) - 12, y: c.y + 12, width: Math.min(194, c.width - 100), height: 44 };
  const rewardPanel = { x: panel.x, y: c.y + (c.height - 224) / 2, width: w, height: 224 };
  const rewardAction = { x: rewardPanel.x + 18, y: rewardPanel.y + 112, width: w - 36, height: 44 };
  const rewardBack = { ...rewardAction, y: rewardPanel.y + 166 };
  return { panel, cards, primary, secondary, single, back, quick, entry, rewardPanel, rewardAction, rewardBack };
}

export function itemHitAreas(layout: RenderLayout, screen: string, state: GameState, ui: ItemUiState, paused = false): ItemHitArea[] {
  const l = itemUiLayout(layout);
  if (ui.panel) {
    if (ui.status === 'watching' || ui.status === 'saving') return [];
    if (ui.panel === 'reward') {
      const areas: ItemHitArea[] = [{ id: 'close', rect: l.rewardBack }];
      if (ui.status !== 'granted') areas.push({
        id: ui.status === 'sharing' ? 'claim-share' : ui.status === 'save-error' ? 'save-retry' : 'reward-retry',
        rect: l.rewardAction,
      });
      return areas;
    }
    const areas: ItemHitArea[] = [{ id: 'close', rect: l.back }];
    if (ui.panel === 'welcome') return [...areas, { id: ui.welcomePending ? 'welcome-retry' : 'close', rect: l.single }];
    if (ui.status === 'sharing') return [...areas, { id: 'claim-share', rect: l.single }];
    if (ui.status === 'save-error') return [...areas, { id: 'save-retry', rect: l.single }];
    if (ui.status === 'granted') return areas;
    areas.push(...l.cards.map((card) => ({ id: `select:${card.id}`, rect: card.rect })));
    areas.push({ id: 'ad', rect: l.primary }, { id: 'share', rect: l.secondary });
    return areas;
  }
  if (screen === 'result' && state.outcome === 'failure') {
    const actions = failedResultLayout(layout, ui.claimedResultRewards);
    const areas: ItemHitArea[] = [];
    if (actions.shareTicket) areas.push({ id: 'result-share-ticket', rect: actions.shareTicket });
    if (actions.adHorn) areas.push({ id: 'result-ad-horn', rect: actions.adHorn });
    return areas;
  }
  if (screen === 'briefing' || screen === 'result') return [{ id: 'supply', rect: l.entry }];
  if (screen === 'game' && !paused && state.phase !== 'result') return l.quick.map((area) => ({ id: `use:${area.id}`, rect: area.rect }));
  return [];
}

function label(context: RenderContext, text: string, rect: Rect, size = 13, color = '#fbffff', weight = 600): void {
  const ctx = context.ctx;
  ctx.fillStyle = color;
  ctx.font = canvasFont(weight, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width - 12);
}
function button(context: RenderContext, rect: Rect, text: string, accent = '#63ead4', enabled = true): void {
  fillRoundRect(context.ctx, rect.x, rect.y, rect.width, rect.height, 12, enabled ? '#183d53' : '#263b4c');
  strokeRoundRect(context.ctx, rect.x, rect.y, rect.width, rect.height, 12, enabled ? accent : '#456073', 1.2);
  label(context, text, rect, 13, enabled ? '#fbffff' : '#9eb5c3');
}

function icon(context: RenderContext, id: ItemId, x: number, y: number, color: string): void {
  const ctx = context.ctx;
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
  if (id === 'commute-horn') {
    ctx.moveTo(-10, -4); ctx.lineTo(-4, -4); ctx.lineTo(5, -10); ctx.lineTo(5, 10); ctx.lineTo(-4, 4); ctx.lineTo(-10, 4); ctx.closePath();
    ctx.moveTo(-5, 5); ctx.lineTo(-3, 12); ctx.moveTo(9, -6); ctx.lineTo(13, -9); ctx.moveTo(10, 0); ctx.lineTo(15, 0); ctx.moveTo(9, 6); ctx.lineTo(13, 9);
  } else {
    ctx.rect(-13, -8, 26, 16); ctx.moveTo(-5, -8); ctx.lineTo(-5, 8); ctx.moveTo(2, 0); ctx.lineTo(10, 0); ctx.moveTo(6, -4); ctx.lineTo(6, 4);
  }
  ctx.stroke(); ctx.restore();
}

function rewardIcon(context: RenderContext, source: 'share' | 'ad', x: number, y: number, color: string): void {
  const ctx = context.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  if (source === 'share') {
    ctx.beginPath();
    ctx.moveTo(-6, -1.5); ctx.lineTo(6, -7);
    ctx.moveTo(-6, 1.5); ctx.lineTo(6, 7);
    ctx.stroke();
    for (const point of [{ x: -8, y: 0 }, { x: 8, y: -8 }, { x: 8, y: 8 }]) {
      ctx.beginPath(); ctx.arc(point.x, point.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    strokeRoundRect(ctx, -12, -9, 24, 18, 4, color, 1.8);
    ctx.beginPath();
    ctx.moveTo(-3, -5); ctx.lineTo(5, 0); ctx.lineTo(-3, 5); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function rewardButton(context: RenderContext, rect: Rect, source: 'share' | 'ad', id: ItemId, enabled: boolean): void {
  const accent = ITEMS[id].color;
  button(context, rect, '', accent, enabled);
  const x = rect.x + (rect.width - 100) / 2;
  rewardIcon(context, source, x + 12, rect.y + rect.height / 2, enabled ? accent : '#829ba9');
  label(context, `${ITEMS[id].shortName} ×1`, { x: x + 32, y: rect.y, width: 68, height: rect.height }, 13, enabled ? '#fbffff' : '#9eb5c3');
}

export function renderItemUi(context: RenderContext, screen: string, state: GameState, ui: ItemUiState, paused = false): void {
  const l = itemUiLayout(context.layout);
  const c = context.layout.viewport.contentRect;
  context.withScreen(() => {
    const ctx = context.ctx;
    if (screen === 'briefing' || screen === 'result') {
      const failed = screen === 'result' && state.outcome === 'failure';
      const actions = failedResultLayout(context.layout, ui.claimedResultRewards);
      if (failed) {
        if (actions.shareTicket) rewardButton(context, actions.shareTicket, 'share', 'delay-ticket', ui.shareAvailable);
        if (actions.adHorn) rewardButton(context, actions.adHorn, 'ad', 'commute-horn', ui.adAvailable);
      } else {
        button(context, l.entry, `补给  喇叭 ${ui.inventory['commute-horn']} · 车票 ${ui.inventory['delay-ticket']}`);
      }
      if (screen === 'result') {
        const used = ITEM_IDS.filter((id) => ui.used[id] > 0);
        const usage = used.length ? `已使用：${used.map((id) => ITEMS[id].shortName).join('、')}` : (state.outcome === 'success' ? '无道具通关' : '本局未使用道具');
        const noteRect = failed
          ? { x: actions.panel.x + 12, y: actions.panel.y + actions.panel.height - 23, width: actions.panel.width - 24, height: 18 }
          : { x: c.x + 12, y: c.y + 58, width: c.width - 24, height: 18 };
        label(context, failed ? `${usage} · 领取后下局可用` : usage, noteRect, 11, '#ffd36a');
      }
    }
    if (screen === 'game' && state.phase !== 'result' && !paused) {
      l.quick.forEach(({ id, rect }) => {
        const count = ui.inventory[id] > 99 ? '99+' : String(ui.inventory[id]);
        const needsSupply = ui.inventory[id] <= 0;
        const used = ui.used[id] >= 1;
        const enabled = needsSupply || (!used && itemPhaseAllowed(state, id));
        button(context, rect, '', ITEMS[id].color, enabled);
        if (needsSupply) rewardIcon(context, id === 'commute-horn' ? 'ad' : 'share', rect.x + rect.width / 2, rect.y + 17, ITEMS[id].color);
        else icon(context, id, rect.x + rect.width / 2, rect.y + 17, enabled ? ITEMS[id].color : '#829ba9');
        label(context, needsSupply ? (id === 'commute-horn' ? '广告领喇叭' : '分享领车票') : `${ITEMS[id].shortName} ${count}`, { ...rect, y: rect.y + 33, height: 16 }, 10, enabled ? '#fbffff' : '#9eb5c3');
      });
    }
    if (!ui.panel) {
      if (ui.message && screen !== 'result') {
        const toast = { x: c.x + c.width * 0.15, y: c.y + c.height * 0.51, width: c.width * 0.7, height: 42 };
        fillRoundRect(ctx, toast.x, toast.y, toast.width, toast.height, 12, '#10283e'); label(context, ui.message, toast, 12);
      }
      return;
    }
    ctx.fillStyle = 'rgba(4,14,25,0.82)'; ctx.fillRect(0, 0, context.layout.viewport.width, context.layout.viewport.height);
    if (ui.panel === 'reward') {
      const p = l.rewardPanel;
      const busy = ui.status === 'watching' || ui.status === 'saving';
      fillRoundRect(ctx, p.x, p.y, p.width, p.height, 20, '#10283e');
      strokeRoundRect(ctx, p.x, p.y, p.width, p.height, 20, ITEMS[ui.selected].color, 1.5);
      label(context, ui.status === 'granted' ? `${ITEMS[ui.selected].shortName} +1` : ui.selected === 'commute-horn' ? '看广告领取喇叭' : '分享领取车票', { ...p, y: p.y + 16, height: 28 }, 21);
      label(context, screen === 'game' ? '游戏已暂停，倒计时已停止' : '领取后可在游戏中使用', { ...p, y: p.y + 49, height: 20 }, 12, '#b5cad8');
      label(context, ui.message, { ...p, x: p.x + 12, y: p.y + 78, width: p.width - 24, height: 24 }, 12, '#ffd36a');
      if (busy) label(context, ui.status === 'watching' ? '广告准备／播放中…' : '正在保存…', l.rewardAction);
      else if (ui.status !== 'granted') button(context, l.rewardAction, ui.status === 'sharing' ? '领取车票' : ui.status === 'save-error' ? '重试保存' : '重试领取', ITEMS[ui.selected].color);
      button(context, l.rewardBack, screen === 'game' ? '继续游戏' : '返回', '#8daaba', !busy);
      return;
    }
    const p = l.panel;
    fillRoundRect(ctx, p.x, p.y, p.width, p.height, 20, '#10283e');
    strokeRoundRect(ctx, p.x, p.y, p.width, p.height, 20, '#438294', 1.5);
    const title = ui.panel === 'welcome' ? '新手通勤补给' : '补充通勤道具';
    label(context, title, { ...p, y: p.y + 12, height: 28 }, 21);
    const subtitle = ui.panel === 'welcome' ? '喇叭和车票各 1 件，进站后手动使用'
      : ui.status !== 'idle' ? `本次领取：${ITEMS[ui.selected].name} ×1，游戏中手动使用` : '先选道具，再领取；游戏中手动使用';
    label(context, `${screen === 'game' ? '已暂停 · ' : ''}${subtitle}`, { ...p, y: p.y + 40, height: 18 }, 11, '#b5cad8', 400);
    l.cards.forEach(({ id, rect }) => {
      fillRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 12, ui.selected === id ? '#204b60' : '#193447');
      strokeRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 12, ui.selected === id ? ITEMS[id].color : '#31566c', 1.5);
      icon(context, id, rect.x + 23, rect.y + 25, ITEMS[id].color);
      label(context, ITEMS[id].name, { x: rect.x + 40, y: rect.y + 10, width: rect.width - 46, height: 26 }, 14);
      label(context, `库存 ×${ui.inventory[id]}`, { ...rect, y: rect.y + 40, height: 20 }, 12, ITEMS[id].color);
      if (rect.height >= 80) label(context, ITEMS[id].description, { ...rect, y: rect.y + 65, height: 16 }, 10, '#b5cad8', 400);
    });
    const descriptionY = l.cards[0].rect.y + l.cards[0].rect.height + 5;
    label(context, ui.message || ITEMS[ui.selected].description, { x: p.x + 12, y: descriptionY, width: p.width - 24, height: 25 }, 12, '#ffd36a');
    if (p.height >= 330) {
      const hint = ui.panel === 'welcome' ? '进入关卡后点击道具使用' : '分享返回后可领取 1 件道具';
      label(context, hint, { x: p.x + 12, y: descriptionY + 26, width: p.width - 24, height: 20 }, 11, '#b5cad8', 400);
    }
    if (ui.panel === 'welcome') button(context, l.single, ui.welcomePending ? '重试领取' : '知道了');
    else if (ui.status === 'sharing') button(context, l.single, '领取所选道具');
    else if (ui.status === 'save-error') button(context, l.single, '重试保存');
    else if (ui.status === 'watching' || ui.status === 'saving') label(context, ui.status === 'watching' ? '广告准备／播放中…' : '正在保存…', { ...l.primary, width: p.width - 36 });
    else if (ui.status !== 'granted') {
      button(context, l.primary, '看视频领取 ×1', '#63ead4', ui.adAvailable);
      button(context, l.secondary, '分享好友领取 ×1', '#ffd36a', ui.shareAvailable);
    }
    const backText = ui.status === 'granted' ? (screen === 'game' ? '继续游戏（手动使用）' : '领取完成，返回') : screen === 'game' ? '返回游戏' : '返回';
    button(context, l.back, backText, '#8daaba', ui.status !== 'watching' && ui.status !== 'saving');
  });
}
