import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, startBoarding } from './helpers/item-harness.mjs';
import { emptySave, serializeSave } from '../src/core/save-schema.ts';
import { itemUiLayout, itemHitAreas } from '../src/render/item-ui.ts';
import { failedResultLayout } from '../src/render/context.ts';
import { DEFAULT_SAVE_KEY } from '../src/platform/wx/storage.ts';
import { GameRuntime } from '../src/runtime/game-runtime.ts';

function finishLevel(runtime, success = false) {
  runtime.startLevel('sea-gate'); runtime.confirmStart();
  const state = runtime.state;
  state.phase = 'result'; state.outcome = success ? 'success' : 'failure';
  state.score = { total: 45, stars: success ? 1 : 0, success, medal: 'none', efficiency: 0, courtesy: 45, stamina: 90 };
  runtime.tick(0);
  assert.equal(runtime.screen, 'result');
}

function assertResultRewardButtons(h, expected) {
  h.runtime.tick(0);
  const areas = itemHitAreas(h.runtime.renderer.context.layout, h.runtime.screen, h.runtime.state, h.runtime.getItemUi());
  assert.deepEqual(areas.map(({ id }) => id), expected);
  const labels = h.context.frameOperations.map(([text]) => text);
  assert.equal(labels.includes('车票 ×1'), expected.includes('result-share-ticket'));
  assert.equal(labels.includes('喇叭 ×1'), expected.includes('result-ad-horn'));
}

test('道具在模拟步执行，保存失败不使用，连续触摸只扣一件', () => {
  const h = createHarness(); startBoarding(h.runtime);
  const before = h.runtime.state.doorRemaining;
  h.failWrites(true); h.runtime.queueItem('delay-ticket'); h.runtime.tick(1 / 60);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  assert.ok(h.runtime.state.doorRemaining < before);
  h.failWrites(false); const remaining = h.runtime.state.doorRemaining;
  assert.equal(h.runtime.queueItem('delay-ticket'), true); assert.equal(h.runtime.queueItem('delay-ticket'), false);
  h.runtime.tick(1 / 60);
  assert.ok(Math.abs(h.runtime.state.doorRemaining - remaining - 3 + 1 / 60) < 1e-6);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 0);
  assert.equal(h.runtime.getItemUi().used['delay-ticket'], 1);
  assert.equal(h.runtime.queueItem('delay-ticket'), false); h.runtime.destroy();
});
test('广告、分享与弹窗全程冻结模拟，入包后保持暂停直到玩家继续', async () => {
  const h = createHarness(); startBoarding(h.runtime);
  const before = structuredClone(h.runtime.state);
  h.runtime.openSupply('delay-ticket'); const watch = h.runtime.requestReward('rewarded-ad');
  h.runtime.tick(20); h.listeners.Hide(); h.listeners.Show(); h.runtime.tick(20);
  assert.deepEqual(h.runtime.state, before);
  h.ad.close({ isEnded: true }); await watch; h.runtime.tick(20);
  assert.deepEqual(h.runtime.state, before); assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 2);
  h.tap('close'); assert.equal(h.runtime.paused, false); assert.deepEqual(h.runtime.state, before);
  h.runtime.tick(1 / 60); assert.ok(h.runtime.state.doorRemaining < before.doorRemaining);
  h.runtime.pause(); h.runtime.openSupply(); await h.runtime.requestReward('share-participation');
  h.listeners.Hide(); h.listeners.Show(); h.tap('close'); assert.equal(h.runtime.paused, true);
  h.runtime.resume(); assert.equal(h.runtime.paused, false); h.runtime.destroy();
});
test('空库存快捷入口直接分享领取车票，无需选择或打开背包', () => {
  const h = createHarness({ fresh: false }); startBoarding(h.runtime);
  h.tap('use:delay-ticket'); assert.equal(h.runtime.getItemUi().panel, 'reward');
  assert.equal(h.runtime.getItemUi().selected, 'delay-ticket'); assert.equal(h.ad.shows, 0); assert.equal(h.shares.length, 1);
  assert.equal(h.runtime.getItemUi().status, 'sharing');
  assert.deepEqual(itemHitAreas(h.runtime.renderer.context.layout, 'game', h.runtime.state, h.runtime.getItemUi(), true).map(({ id }) => id), ['close', 'claim-share']);
  h.runtime.destroy();
});
test('局内各阶段点击空道具直接广告或分享，打开当帧至返回前完整暂停', async () => {
  for (const id of ['commute-horn', 'delay-ticket']) {
    for (const phase of ['positioning', 'exiting', 'boarding', 'warning']) {
      const h = createHarness({ fresh: false }); startBoarding(h.runtime);
      h.runtime.state.phase = phase;
      if (phase === 'warning') h.runtime.state.doorRemaining = 1;
      const before = structuredClone(h.runtime.state);
      h.tap(`use:${id}`);
      assert.equal(h.runtime.getItemUi().panel, 'reward', `${phase}: ${id}`);
      assert.equal(h.runtime.getItemUi().selected, id); assert.equal(h.runtime.paused, true);
      assert.deepEqual(h.runtime.state, before);
      h.runtime.tick(20); h.listeners.Hide(); h.listeners.Show(); h.runtime.tick(20);
      assert.deepEqual(h.runtime.state, before);
      assert.equal(h.ad.shows, id === 'commute-horn' ? 1 : 0);
      assert.equal(h.shares.length, id === 'delay-ticket' ? 1 : 0);
      if (id === 'commute-horn') { h.ad.close({ isEnded: true }); await Promise.resolve(); }
      assert.equal(h.runtime.saveData.items.inventory[id], 1);
      assert.equal(h.runtime.getItemUi().used[id], 0);
      h.runtime.tick(20); assert.deepEqual(h.runtime.state, before);
      h.tap('close');
      assert.equal(h.runtime.paused, false); assert.deepEqual(h.runtime.state, before);
      h.runtime.tick(1 / 60); assert.ok(h.runtime.state.elapsed > before.elapsed);
      h.runtime.destroy();
    }
  }
});

test('道具用完后仍可暂停领取，补充库存不重置本局使用次数', () => {
  const h = createHarness(); startBoarding(h.runtime);
  h.tap('use:delay-ticket');
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 0);
  const before = structuredClone(h.runtime.state);
  h.tap('use:delay-ticket');
  assert.equal(h.runtime.getItemUi().panel, 'reward'); assert.equal(h.runtime.paused, true);
  assert.equal(h.shares.length, 1); h.listeners.Hide(); h.listeners.Show(); h.runtime.tick(20);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  assert.deepEqual(h.runtime.state, before);
  h.tap('close');
  assert.equal(h.runtime.getItemUi().used['delay-ticket'], 1);
  assert.equal(h.runtime.queueItem('delay-ticket'), false);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  h.runtime.destroy();
});

test('局内广告取消可直接重试，保存失败只重试原奖励且库存不重复增加', async () => {
  const h = createHarness({ fresh: false }); startBoarding(h.runtime);
  const before = structuredClone(h.runtime.state);
  h.tap('use:commute-horn');
  assert.equal(h.ad.shows, 1); assert.equal(h.runtime.paused, true);
  assert.equal(h.runtime.closeItemPanel(), false);
  await h.runtime.requestReward('rewarded-ad');
  assert.equal(h.ad.shows, 1);
  h.ad.close({ isEnded: false }); await Promise.resolve();
  assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 0);
  h.tap('reward-retry'); assert.equal(h.ad.shows, 2);
  h.failWrites(true); h.ad.close({ isEnded: true }); await Promise.resolve();
  assert.equal(h.runtime.getItemUi().status, 'save-error');
  assert.equal(h.runtime.getItemUi().panel, 'reward');
  h.tap('close'); h.tap('use:delay-ticket');
  assert.equal(h.runtime.getItemUi().selected, 'commute-horn');
  assert.equal(h.shares.length, 0);
  h.failWrites(false); h.tap('save-retry');
  assert.equal(h.ad.shows, 2);
  assert.deepEqual(h.runtime.saveData.items.inventory, { 'commute-horn': 1, 'delay-ticket': 0 });
  assert.equal(h.runtime.getItemUi().panel, 'reward');
  h.runtime.tick(20); assert.deepEqual(h.runtime.state, before);
  h.tap('close'); assert.equal(h.runtime.paused, false);
  assert.equal(h.runtime.getItemUi().panel, null);
  assert.ok(!h.context.operations.some(([text]) => text.includes('背包')));
  h.runtime.destroy();
});

test('局内广告不可用或保存失败保留暂停及重试入口，不进入补给选择页', async () => {
  for (const id of ['commute-horn', 'delay-ticket']) {
    const h = createHarness({ fresh: false }); startBoarding(h.runtime);
    h.failWrites(true); h.tap(`use:${id}`);
    assert.equal(h.ad.shows, 0); assert.equal(h.shares.length, 0);
    assert.equal(h.runtime.getItemUi().panel, 'reward'); assert.equal(h.runtime.paused, true);
    assert.match(h.runtime.getItemUi().message, /存档/);
    h.failWrites(false); h.tap('reward-retry');
    if (id === 'commute-horn') { assert.equal(h.ad.shows, 1); h.ad.close({ isEnded: true }); await Promise.resolve(); }
    else { assert.equal(h.shares.length, 1); h.tap('claim-share'); }
    assert.equal(h.runtime.saveData.items.inventory[id], 1);
    h.tap('close'); h.runtime.destroy();
  }
  const h = createHarness({ fresh: false, adUnitId: '' }); startBoarding(h.runtime);
  const before = structuredClone(h.runtime.state);
  h.tap('use:commute-horn');
  assert.equal(h.runtime.getItemUi().panel, 'reward'); assert.equal(h.runtime.paused, true);
  assert.match(h.runtime.getItemUi().message, /暂无可用广告/);
  assert.equal(h.ad.shows, 0); assert.equal(h.shares.length, 0);
  h.tap('reward-retry'); h.runtime.tick(20); assert.deepEqual(h.runtime.state, before);
  h.tap('close'); assert.equal(h.runtime.paused, false); h.runtime.destroy();
});

test('同一帧点击其他道具再点击空道具，获取页暂停并清除待使用操作', () => {
  const save = emptySave(); save.items.inventory['commute-horn'] = 1;
  const h = createHarness({ save }); startBoarding(h.runtime);
  const before = structuredClone(h.runtime.state);
  const quick = itemUiLayout(h.runtime.renderer.context.layout).quick;
  h.runtime.input.handleTouchStart({ changedTouches: quick.map(({ rect }, index) => ({
    identifier: index, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
  })) });
  h.runtime.tick(0.25);
  assert.equal(h.runtime.getItemUi().panel, 'reward'); assert.equal(h.runtime.paused, true);
  assert.deepEqual(h.runtime.state, before);
  h.tap('close'); h.runtime.tick(1 / 60);
  assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 1);
  assert.equal(h.runtime.getItemUi().used['commute-horn'], 0); h.runtime.destroy();
});

test('暂停或弹窗不接受旧道具命令，关闭提示保留原页面', () => {
  const h = createHarness(); startBoarding(h.runtime);
  h.runtime.queueItem('delay-ticket'); h.runtime.openSupply(); h.runtime.tick(1);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  h.tap('close'); h.runtime.tick(1 / 60); assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  h.runtime.queueItem('delay-ticket'); h.runtime.pause(); h.runtime.resume(); h.runtime.tick(1 / 60);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  h.runtime.backToHome();
  assert.deepEqual(itemHitAreas(h.runtime.renderer.context.layout, 'home', h.runtime.state, h.runtime.getItemUi()), []);
  h.runtime.startLevel('sea-gate'); h.tap('supply'); h.tap('close'); assert.equal(h.runtime.screen, 'briefing'); h.runtime.destroy();
});

test('首页及新手提示不显示背包入口，局内库存为空时显示对应领取图标', () => {
  const h = createHarness();
  assert.ok(!h.context.operations.some(([text]) => text.includes('背包')));
  h.tap('close'); h.runtime.tick(0);
  assert.deepEqual(itemHitAreas(h.runtime.renderer.context.layout, 'home', {}, h.runtime.getItemUi()), []);
  assert.ok(!h.context.operations.some(([text]) => text.includes('背包')));
  startBoarding(h.runtime); h.context.operations.length = 0; h.runtime.tick(0);
  assert.ok(h.context.operations.some(([text]) => text === '喇叭 1'));
  assert.ok(h.context.operations.some(([text]) => text === '车票 1'));
  h.tap('use:delay-ticket'); h.context.operations.length = 0; h.runtime.tick(0);
  assert.ok(h.context.operations.some(([text]) => text === '分享领车票'));
  h.tap('use:delay-ticket'); h.listeners.Hide(); h.listeners.Show(); h.tap('close');
  h.context.operations.length = 0; h.runtime.tick(0);
  assert.ok(h.context.operations.some(([text]) => text === '车票 1'), '本局用过的道具仍显示剩余库存');
  h.runtime.destroy();
  const empty = createHarness({ fresh: false }); startBoarding(empty.runtime);
  empty.context.operations.length = 0; empty.runtime.tick(0);
  assert.ok(empty.context.operations.some(([text]) => text === '广告领喇叭'));
  assert.ok(empty.context.operations.some(([text]) => text === '分享领车票'));
  empty.runtime.destroy();
});
test('失败页分享按钮直接领取车票，返回后只入背包并保留失败结算', () => {
  const h = createHarness(); finishLevel(h.runtime);
  const before = structuredClone(h.runtime.state);
  h.tap('result-share-ticket');
  assert.equal(h.shares.length, 1); assert.equal(h.ad.shows, 0);
  assert.equal(h.runtime.getItemUi().selected, 'delay-ticket');
  assert.equal(h.runtime.getItemUi().status, 'sharing');
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  h.listeners.Hide(); h.listeners.Show(); h.listeners.Show();
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 2);
  assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 1);
  h.tap('close');
  assert.equal(h.runtime.screen, 'result'); assert.equal(h.runtime.getItemUi().panel, null);
  assertResultRewardButtons(h, ['result-ad-horn']);
  assert.deepEqual(h.runtime.state, before); h.runtime.destroy();
});

test('失败页广告按钮直接领取喇叭，提前关闭不发奖，完整观看后只入背包', async () => {
  const h = createHarness(); finishLevel(h.runtime);
  const before = structuredClone(h.runtime.state);
  h.tap('result-ad-horn');
  assert.equal(h.ad.shows, 1); assert.equal(h.shares.length, 0);
  assert.equal(h.runtime.getItemUi().selected, 'commute-horn');
  h.ad.close({ isEnded: false }); await Promise.resolve();
  assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 1);
  h.tap('close'); assertResultRewardButtons(h, ['result-share-ticket', 'result-ad-horn']);
  h.tap('result-ad-horn');
  assert.equal(h.ad.shows, 2);
  h.ad.close({ isEnded: true }); await Promise.resolve();
  assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 2);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  h.tap('close');
  assertResultRewardButtons(h, ['result-share-ticket']);
  assert.equal(h.runtime.screen, 'result'); assert.deepEqual(h.runtime.state, before); h.runtime.destroy();
});

test('失败页保存失败后点击另一领取按钮仍能恢复原奖励，不重新调起广告', () => {
  const h = createHarness(); finishLevel(h.runtime);
  h.tap('result-share-ticket'); h.failWrites(true);
  h.listeners.Hide(); h.listeners.Show();
  assert.equal(h.runtime.getItemUi().status, 'save-error');
  h.tap('close'); assertResultRewardButtons(h, ['result-share-ticket', 'result-ad-horn']);
  h.tap('result-ad-horn');
  assert.equal(h.ad.shows, 0); assert.equal(h.shares.length, 1);
  assert.equal(h.runtime.getItemUi().selected, 'delay-ticket');
  h.failWrites(false); h.tap('save-retry');
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 2);
  assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 1);
  h.tap('close'); assertResultRewardButtons(h, ['result-ad-horn']); h.runtime.destroy();
});

test('失败页两种奖励领取后均隐藏且不能再次领取，新一局失败重新显示', async () => {
  for (const order of [['result-share-ticket', 'result-ad-horn'], ['result-ad-horn', 'result-share-ticket']]) {
    const h = createHarness(); finishLevel(h.runtime);
    for (const action of order) {
      h.tap(action);
      if (action === 'result-ad-horn') { h.ad.close({ isEnded: true }); await Promise.resolve(); }
      else { h.listeners.Hide(); h.listeners.Show(); }
      h.tap('close');
    }
    assertResultRewardButtons(h, []);
    const actions = failedResultLayout(h.runtime.renderer.context.layout, h.runtime.getItemUi().claimedResultRewards);
    assert.equal(actions.shareTicket, undefined); assert.equal(actions.adHorn, undefined);
    for (const action of order) h.runtime['handleItemAction'](action);
    assert.equal(h.runtime.getItemUi().panel, null);
    assert.equal(h.ad.shows, 1); assert.equal(h.shares.length, 1);
    assert.deepEqual(h.runtime.saveData.items.inventory, { 'commute-horn': 2, 'delay-ticket': 2 });
    h.runtime.resize(); assertResultRewardButtons(h, []);
    assert.equal(h.runtime.retry(), true);
    h.runtime.state.phase = 'result'; h.runtime.state.outcome = 'failure'; h.runtime.tick(0);
    assertResultRewardButtons(h, ['result-share-ticket', 'result-ad-horn']); h.runtime.destroy();
  }
});

test('上一局未保存奖励在新失败页恢复时不隐藏新一局的领取入口', () => {
  const h = createHarness(); finishLevel(h.runtime);
  h.tap('result-share-ticket'); h.failWrites(true); h.listeners.Hide(); h.listeners.Show();
  assert.equal(h.runtime.getItemUi().status, 'save-error'); h.tap('close');
  finishLevel(h.runtime); h.failWrites(false); h.tap('result-share-ticket'); h.tap('save-retry'); h.tap('close');
  assertResultRewardButtons(h, ['result-share-ticket', 'result-ad-horn']);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 2);
  h.tap('result-share-ticket'); h.listeners.Hide(); h.listeners.Show(); h.tap('close');
  assertResultRewardButtons(h, ['result-ad-horn']);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 3); h.runtime.destroy();
});

test('失败领取入口只在失败结算显示，通关仍保留原补给入口', () => {
  const h = createHarness(); h.tap('close');
  const areas = () => itemHitAreas(h.runtime.renderer.context.layout, h.runtime.screen, h.runtime.state ?? {}, h.runtime.getItemUi());
  assert.ok(areas().every((area) => !area.id.startsWith('result-')));
  finishLevel(h.runtime);
  assert.deepEqual(areas().map((area) => area.id), ['result-share-ticket', 'result-ad-horn']);
  const labels = h.context.frameOperations.map(([text]) => text);
  assert.ok(labels.includes('车票 ×1')); assert.ok(labels.includes('喇叭 ×1'));
  assert.ok(!labels.some((text) => text.startsWith('补给  ')));
  finishLevel(h.runtime, true);
  assert.deepEqual(areas().map((area) => area.id), ['supply']);
  assert.ok(!h.context.frameOperations.some(([text]) => text === '车票 ×1' || text === '喇叭 ×1'));
  h.runtime.destroy();
});

test('失败页四个按钮适配横竖屏和安全区，重试与路线命中不会触发领取', () => {
  for (const [width, height, safeArea] of [[667, 375], [480, 320], [375, 667], [320, 568], [844, 390, { left: 44, top: 0, right: 800, bottom: 369, width: 756, height: 369 }]]) {
    const h = createHarness({ width, height, safeArea }); finishLevel(h.runtime);
    const layout = h.runtime.renderer.context.layout; const c = layout.viewport.contentRect;
    const actions = failedResultLayout(layout);
    const rects = [actions.retry, actions.route, actions.shareTicket, actions.adHorn];
    if (layout.orientation === 'landscape' && actions.panel.width >= 520) {
      assert.ok(actions.shareTicket.width <= 112);
      assert.ok(actions.adHorn.width <= 112);
      assert.equal(actions.retry.width, actions.route.width);
      assert.equal(actions.route.width, actions.shareTicket.width);
      assert.equal(actions.shareTicket.width, actions.adHorn.width);
    }
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    for (const r of rects) {
      assert.ok(r.x >= c.x && r.y >= c.y && r.x + r.width <= c.x + c.width && r.y + r.height <= c.y + c.height);
      assert.ok(r.height >= 44);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.equal(overlaps(rects[i], rects[j]), false);
    for (let i = 1; i < rects.length; i++) assert.ok(rects[i].y > rects[i - 1].y || rects[i].x > rects[i - 1].x);
    const tap = (rect) => {
      h.runtime.input.handleTouchStart({ changedTouches: [{ identifier: 8, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }] });
      h.runtime.tick(0);
      h.runtime.input.handleTouchEnd({ touches: [], changedTouches: [{ identifier: 8 }] });
    };
    tap(actions.route); assert.equal(h.runtime.screen, 'route');
    finishLevel(h.runtime); tap(actions.retry); assert.equal(h.runtime.screen, 'game');
    assert.equal(h.ad.shows, 0); assert.equal(h.shares.length, 0); h.runtime.destroy();
  }
});

test('失败页领取后剩余按钮逐行居中，绘制和点击位置随布局更新', async () => {
  for (const [width, height, safeArea] of [[667, 375], [480, 320], [375, 667], [320, 568], [844, 390, { left: 44, top: 0, right: 800, bottom: 369, width: 756, height: 369 }]]) {
    for (const first of ['result-share-ticket', 'result-ad-horn']) {
      const h = createHarness({ width, height, safeArea }); finishLevel(h.runtime);
      const layout = h.runtime.renderer.context.layout;
      const currentActions = () => failedResultLayout(layout, h.runtime.getItemUi().claimedResultRewards);
      const checkLayout = () => {
        h.runtime.tick(0);
        const actions = currentActions();
        const rects = [actions.retry, actions.route, actions.shareTicket, actions.adHorn].filter(Boolean);
        const c = layout.viewport.contentRect;
        for (const rect of rects) {
          assert.ok(rect.x >= c.x && rect.y >= c.y && rect.x + rect.width <= c.x + c.width && rect.y + rect.height <= c.y + c.height);
          assert.ok(rect.height >= 44);
        }
        const rows = [...new Set(rects.map(rect => rect.y))].map(y => rects.filter(rect => rect.y === y));
        for (const row of rows) {
          const left = row[0].x; const right = row.at(-1).x + row.at(-1).width;
          assert.ok(Math.abs((left + right) / 2 - (actions.panel.x + actions.panel.width / 2)) < 1e-6, '每行按钮整体居中');
          for (let i = 1; i < row.length; i++) assert.ok(Math.abs(row[i].x - row[i - 1].x - row[i - 1].width - 10) < 1e-6, '可见按钮之间没有空位');
        }
        for (const [text, rect, textOffset] of [['重试', actions.retry, 0], ['路线', actions.route, 0], ['车票 ×1', actions.shareTicket, 16], ['喇叭 ×1', actions.adHorn, 16]]) {
          const operation = h.context.frameOperations.find(([label]) => label === text);
          if (!rect) { assert.equal(operation, undefined); continue; }
          assert.ok(operation, text);
          assert.ok(Math.abs(operation[1] - rect.x - rect.width / 2 - textOffset) < 1e-6, `${text} 显示位置与命中布局一致`);
          assert.equal(operation[2], rect.y + rect.height / 2);
        }
        return actions;
      };
      const initial = checkLayout();
      const second = first === 'result-share-ticket' ? 'result-ad-horn' : 'result-share-ticket';
      for (const [index, action] of [first, second].entries()) {
        h.tap(action);
        if (action === 'result-ad-horn') { h.ad.close({ isEnded: true }); await Promise.resolve(); }
        else { h.listeners.Hide(); h.listeners.Show(); }
        h.tap('close');
        const actions = checkLayout();
        if (index === 0) {
          const reward = actions.shareTicket ?? actions.adHorn;
          const oldReward = action === 'result-share-ticket' ? initial.adHorn : initial.shareTicket;
          assert.notEqual(reward.x, oldReward.x, '剩余奖励按钮重新居中');
        } else {
          assert.equal(actions.retry.y, actions.route.y);
          if (actions.panel.width < 520) assert.ok(actions.retry.y > initial.retry.y, '只剩两按钮时移除第二行空位');
        }
      }
      h.runtime.resize(); checkLayout();
      const action = first === 'result-share-ticket' ? 'retry' : 'route';
      const rect = currentActions()[action];
      h.runtime.input.handleTouchStart({ changedTouches: [{ identifier: 8, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }] });
      h.runtime.tick(0);
      h.runtime.input.handleTouchEnd({ touches: [], changedTouches: [{ identifier: 8 }] });
      assert.equal(h.runtime.screen, action === 'retry' ? 'game' : 'route');
      assert.equal(h.ad.shows, 1); assert.equal(h.shares.length, 1); h.runtime.destroy();
    }
  }
});

test('无尽轮次不重置道具额度或无道具标记，重开整场才重置', () => {
  const save = emptySave(); save.endlessUnlocked = true; save.items.inventory['delay-ticket'] = 3;
  const h = createHarness({ save }); h.runtime.startLevel('endless'); h.runtime.confirmStart();
  for (let i = 0; i < 500 && h.runtime.state.phase !== 'boarding'; i++) h.runtime.tick(1 / 30);
  h.runtime.queueItem('delay-ticket'); h.runtime.tick(1 / 60);
  const state = h.runtime.state; state.phase = 'result'; state.outcome = 'success'; state.score = { total: 90, stars: 3, success: true, medal: 'gold', efficiency: 90, courtesy: 90, stamina: 90 };
  h.runtime.tick(0); assert.equal(h.runtime.saveData.unassisted.endlessBestWave, 0);
  assert.equal(h.runtime.nextLevel(), true); assert.equal(h.runtime.getItemUi().used['delay-ticket'], 1);
  assert.equal(h.runtime.queueItem('delay-ticket'), false); h.runtime.retry();
  assert.equal(h.runtime.getItemUi().used['delay-ticket'], 0); assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 2); h.runtime.destroy();
});
test('使用过道具仍可通关解锁，但不写无道具纪录', () => {
  const h = createHarness(); startBoarding(h.runtime); h.runtime.queueItem('delay-ticket'); h.runtime.tick(1 / 60);
  const state = h.runtime.state; state.phase = 'result'; state.outcome = 'success'; state.score = { total: 93, stars: 3, success: true, medal: 'gold', efficiency: 93, courtesy: 93, stamina: 93 };
  h.runtime.tick(0); assert.equal(h.runtime.saveData.bestScores['sea-gate'], 93);
  assert.equal(h.runtime.saveData.unassisted.bestScores['sea-gate'], undefined);
  assert.ok(h.runtime.saveData.unlockedLevelIds.includes('lighthouse-bay')); h.runtime.destroy();
});
test('上次未完成使用启动时只补偿一次', () => {
  const h = createHarness({ fresh: false }); h.runtime.destroy();
  const save = emptySave(); save.items.pendingUse = { requestId: 'crash-use', itemId: 'delay-ticket', runId: 'run' };
  h.storage.set(DEFAULT_SAVE_KEY, serializeSave(save));
  const a = new GameRuntime(h.wx); assert.equal(a.saveData.items.inventory['delay-ticket'], 1); a.destroy();
  const b = new GameRuntime(h.wx); assert.equal(b.saveData.items.inventory['delay-ticket'], 1); b.destroy();
});
test('横竖屏与安全区中的道具、弹窗命中区域有效且不重叠', () => {
  for (const [width, height, safeArea] of [[667, 375], [480, 320], [375, 667], [844, 390, { left: 44, top: 0, right: 800, bottom: 369, width: 756, height: 369 }]]) {
    const h = createHarness({ width, height, safeArea }); h.tap('close');
    const layout = h.runtime.renderer.context.layout; const c = layout.viewport.contentRect;
    const l = itemUiLayout(layout);
    if (layout.orientation === 'landscape') {
      assert.ok(l.primary.width <= 180);
      assert.equal(l.primary.height, 36);
      assert.equal(l.secondary.height, 36);
    }
    const inside = (r) => r.x >= c.x && r.y >= c.y && r.x + r.width <= c.x + c.width && r.y + r.height <= c.y + c.height;
    for (const r of [l.entry, l.panel, ...l.quick.map((q) => q.rect), l.primary, l.secondary, l.back, l.rewardPanel, l.rewardAction, l.rewardBack]) assert.ok(inside(r), JSON.stringify({ width, height, r }));
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    assert.equal(overlaps(l.rewardAction, l.rewardBack), false);
    for (const q of l.quick) assert.equal(overlaps(q.rect, layout.guideButtonRect), false);
    h.runtime.openSupply();
    const areas = itemHitAreas(layout, 'home', {}, h.runtime.getItemUi());
    for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) assert.equal(overlaps(areas[i].rect, areas[j].rect), false);
    h.runtime.destroy();
  }
});
