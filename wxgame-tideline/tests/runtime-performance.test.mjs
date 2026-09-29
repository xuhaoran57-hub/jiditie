import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, MockContext } from './helpers/item-harness.mjs';
import { GameSimulation, MVP_LEVELS } from '../src/core/index.ts';
import { homePageLayout, menuButtonRect } from '../src/render/context.ts';
import { GameRenderer } from '../src/render/game-renderer.ts';

function counters(runtime) {
  const counts = { draws: 0, layouts: 0 };
  const render = runtime.renderer.render.bind(runtime.renderer);
  const setLayout = runtime.input.setLayout.bind(runtime.input);
  runtime.renderer.render = (...args) => { counts.draws++; render(...args); };
  runtime.input.setLayout = (...args) => { counts.layouts++; setLayout(...args); };
  return counts;
}

function idle(runtime, frames = 120) {
  for (let i = 0; i < frames; i++) runtime.tick(1 / 60);
}

function touch(runtime, rect) {
  const point = { identifier: 123, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  runtime.input.handleTouchStart({ changedTouches: [point] });
  runtime.input.handleTouchEnd({ touches: [], changedTouches: [point] });
  runtime.tick(0);
}

function foregroundHarness(t) {
  const frames = new Map();
  const timers = new Map();
  let sequence = 0;
  let timestamp = 0;
  const scheduler = {
    request(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancel(id) { frames.delete(id); },
  };
  t.mock.method(globalThis, 'setTimeout', (callback, delay = 0) => {
    const id = ++sequence;
    timers.set(id, { callback, at: timestamp + delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => { timers.delete(id); });
  const h = createHarness({ fresh: false, scheduler });
  t.after(() => h.runtime.destroy());
  idle(h.runtime, 4);
  const advance = (ms) => {
    const until = timestamp + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      const [id, timer] = next;
      h.elapse(timer.at - timestamp);
      timestamp = timer.at;
      timers.delete(id);
      timer.callback();
    }
    h.elapse(until - timestamp);
    timestamp = until;
  };
  return {
    ...h, scheduler, frames, timers, advance,
    frame() {
      assert.equal(frames.size, 1, 'only one animation callback is pending');
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      timestamp += 17;
      h.elapse(17);
      callback(timestamp);
      assert.equal(frames.size, 1, 'the next animation callback survives recovery');
    },
  };
}

test('分享返回同步绘制后同尺寸画布再次丢失，首个和后续前台帧补画静态奖励弹窗', async (t) => {
  const h = foregroundHarness(t);
  h.runtime.selectLevel(0); h.runtime.confirmStart();
  h.runtime.openSupply('delay-ticket');
  await h.runtime.requestReward('share-participation');
  const state = structuredClone(h.runtime.state);
  h.listeners.Hide(); h.listeners.Show();
  assert.equal(h.runtime.getItemUi().status, 'granted');
  assert.ok(h.context.frameOperations.length > 0);
  const canvas = h.wx.createCanvas();
  const originalSize = [canvas.width, canvas.height];
  for (let i = 0; i < 2; i++) {
    // 微信可能在 onShow 同步回调结束后重新挂载相同尺寸的显示 surface。
    h.context.clearRect();
    h.frame();
    assert.ok(h.context.frameOperations.length > 0, 'resume rAF must redraw even while the reward panel is static');
    assert.deepEqual([canvas.width, canvas.height], originalSize);
    assert.deepEqual(h.runtime.state, state, 'recovering the canvas never advances a paused reward screen');
  }
  h.advance(1501);
  for (let i = 0; i < 6; i++) h.frame();
  const counts = counters(h.runtime);
  for (let i = 0; i < 120; i++) h.frame();
  assert.equal(counts.draws, 0, 'the static screen returns to demand rendering after recovery settles');
  assert.equal(h.timers.size, 0, 'recovery retries are bounded');
});

test('分享返回刷新画布暂时失败不阻止奖励入账，重复 Show 和延迟恢复不会重复发奖', async (t) => {
  const h = foregroundHarness(t);
  h.runtime.selectLevel(0); h.runtime.confirmStart();
  h.runtime.openSupply('delay-ticket');
  const inventory = h.runtime.saveData.items.inventory['delay-ticket'];
  await h.runtime.requestReward('share-participation');
  assert.equal(h.shares.length, 1);
  h.listeners.Hide();
  const refresh = h.runtime.canvasAdapter.refresh.bind(h.runtime.canvasAdapter);
  let refreshAttempts = 0;
  h.runtime.canvasAdapter.refresh = (...args) => {
    if (++refreshAttempts === 1) throw new Error('canvas surface not ready');
    return refresh(...args);
  };
  assert.doesNotThrow(() => h.listeners.Show());
  assert.equal(h.runtime.getItemUi().status, 'granted', 'canvas recovery failure cannot skip processing the completed share');
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], inventory + 1);
  assert.ok(h.runtime.diagnostics.getRecent().some(({ type }) => type === 'error'));
  const writesAfterGrant = h.writes.length;
  h.context.clearRect(); h.frame();
  assert.ok(h.context.frameOperations.length > 0, 'the first animation frame restores the reward screen');
  h.context.clearRect(); h.advance(1001);
  assert.ok(h.context.frameOperations.length > 0, 'the delayed fallback also restores the reward screen');
  h.listeners.Show(); h.listeners.Show();
  h.advance(1501);
  for (let i = 0; i < 6; i++) h.frame();
  assert.equal(h.runtime.getItemUi().status, 'granted');
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], inventory + 1, 'all recovery paths retain exactly one reward');
  assert.equal(h.writes.length, writesAfterGrant, 'repainting does not repeat the reward transaction');
});

test('仅 onShow 返回时丢失的旧 rAF 被替换，迟到旧回调不影响新循环', (t) => {
  const h = foregroundHarness(t);
  const stale = h.frames.values().next().value;
  h.frames.clear(); // 宿主未发 onHide，但已丢弃挂起的回调。
  h.listeners.Show();
  assert.equal(h.frames.size, 1, 'onShow must request a fresh callback even without onHide');
  const current = h.frames.values().next().value;
  stale(100000);
  assert.equal(h.frames.size, 1);
  assert.equal(h.frames.values().next().value, current, 'the stale callback cannot consume or replace the new request');
  h.context.clearRect(); h.frame();
  assert.ok(h.context.frameOperations.length > 0);
});

test('恢复时同步绘制和首个 rAF 暂时失败仍会诊断并继续调度', (t) => {
  const h = foregroundHarness(t);
  h.listeners.Hide();
  const render = h.runtime.renderer.render.bind(h.runtime.renderer);
  let failures = 2;
  h.runtime.renderer.render = (...args) => {
    if (failures > 0) { failures--; throw new Error('surface temporarily unavailable'); }
    render(...args);
  };
  const before = h.runtime.diagnostics.getRecent().length;
  assert.doesNotThrow(() => h.listeners.Show());
  assert.equal(h.frames.size, 1, 'a failed synchronous draw still schedules recovery');
  assert.doesNotThrow(() => h.frame());
  assert.ok(h.runtime.diagnostics.getRecent().length >= before + 2);
  h.context.clearRect(); h.frame();
  assert.ok(h.context.frameOperations.length > 0, 'a later frame recovers after transient draw errors');
});

test('rAF 未恢复时短定时器独立重绘并重启丢失帧，定时绘制失败后仍可恢复', (t) => {
  const h = foregroundHarness(t);
  h.listeners.Hide(); h.listeners.Show();
  h.frames.clear();
  h.context.clearRect();
  const render = h.runtime.renderer.render.bind(h.runtime.renderer);
  let attempts = 0;
  h.runtime.renderer.render = (...args) => {
    attempts++;
    if (attempts === 1) throw new Error('surface still unavailable');
    render(...args);
  };
  assert.doesNotThrow(() => h.advance(1001));
  assert.ok(attempts >= 2, 'timer recovery retries independently of animation callbacks');
  assert.ok(h.runtime.diagnostics.getRecent().some(({ type }) => type === 'error'));
  assert.ok(h.context.frameOperations.length > 0, 'the recovery timer redraws without an rAF');
  assert.equal(h.frames.size, 1, 'stalled frame scheduling is restarted without duplicates');
  h.advance(10000);
  const settled = attempts;
  h.advance(10000);
  assert.equal(attempts, settled, 'timer recovery stops after the bounded retry window');
  assert.equal(h.timers.size, 0);
});

test('Show 后宿主首次拒绝 rAF 请求时保留运行状态，由定时恢复重新请求帧', (t) => {
  const h = foregroundHarness(t);
  h.listeners.Hide();
  const request = h.scheduler.request;
  let requests = 0;
  h.scheduler.request = (callback) => {
    if (++requests === 1) throw new Error('animation scheduling temporarily unavailable');
    return request(callback);
  };
  assert.doesNotThrow(() => h.listeners.Show());
  assert.equal(h.runtime.running, true);
  assert.equal(h.frames.size, 0);
  assert.ok(h.runtime.diagnostics.getRecent().some(({ type }) => type === 'error'));
  h.context.clearRect();
  h.advance(101);
  assert.equal(h.runtime.running, true);
  assert.equal(h.frames.size, 1, 'the recovery timer retries a rejected animation request');
  assert.ok(h.context.frameOperations.length > 0);
  h.context.clearRect(); h.frame();
  assert.ok(h.context.frameOperations.length > 0, 'the restarted animation loop can draw again');
});

test('重复前台事件只保留一条恢复调度，hide、stop 和 destroy 释放全部恢复任务', (t) => {
  const h = foregroundHarness(t);
  for (const suspend of [() => h.listeners.Hide(), () => h.runtime.stop(), () => h.runtime.destroy()]) {
    h.runtime.start();
    h.listeners.Show(); h.listeners.Show(); h.listeners.Show();
    assert.equal(h.frames.size, 1);
    assert.equal(h.timers.size, 1, 'repeated onShow replaces the existing recovery timer');
    const lateFrame = h.frames.values().next().value;
    const lateTimer = h.timers.values().next().value.callback;
    const counts = counters(h.runtime);
    suspend();
    assert.equal(h.frames.size, 0);
    assert.equal(h.timers.size, 0);
    lateFrame(100000); lateTimer(); h.advance(2000);
    assert.equal(h.frames.size, 0, 'cancelled callbacks cannot restart the animation loop');
    assert.equal(h.timers.size, 0, 'cancelled callbacks cannot recreate recovery timers');
    assert.equal(counts.draws, 0, 'cancelled callbacks cannot draw while hidden, stopped or destroyed');
  }
});

test('station background refreshes for door geometry while reusing dynamic door frames', (t) => {
  const context = new MockContext();
  context.drawImage = () => {};
  const backgroundContext = new MockContext();
  let redraws = 0;
  backgroundContext.clearRect = () => { redraws++; };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const backgroundCanvas = { width: 0, height: 0, getContext: () => backgroundContext };
  const level = structuredClone(MVP_LEVELS[0]);
  const state = new GameSimulation(level, 7).getState();
  const renderer = GameRenderer.fromCanvas(canvas, 667, 375, 1, {}, level, {
    canvasFactory: () => backgroundCanvas,
  });
  t.after(() => renderer.destroy());
  renderer.render(state, level);
  assert.equal(redraws, 1);
  renderer.render(state, structuredClone(level));
  assert.equal(redraws, 1, 'equivalent door configuration reuses the background');

  state.doors[0].open = !state.doors[0].open;
  state.doors[0].blocked = !state.doors[0].blocked;
  state.doors[0].occupancy += 1;
  renderer.render(state, level);
  assert.equal(redraws, 1, 'door animation and occupancy do not invalidate static geometry');

  for (const change of [
    () => { level.doors[0].center.x += 8; },
    () => { level.doors[0].center.y += 2; },
    () => { level.doors[0].width += 12; },
    () => { level.doors[0].id = 'relocated-door'; },
    () => { level.doors.push({ ...structuredClone(level.doors[0]), id: 'extra-door' }); },
    () => { level.doors.pop(); },
  ]) {
    const previous = redraws;
    change();
    renderer.render(state, level);
    assert.equal(redraws, previous + 1, 'in-place door geometry changes rebuild the background');
    renderer.render(state, level);
    assert.equal(redraws, previous + 1, 'unchanged geometry reuses the rebuilt background');
  }
});

test('全局原生 rAF 优先，前后台只保留一条循环且不补算后台时间', (t) => {
  const previous = ['requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const frames = new Map(); let sequence = 0;
  globalThis.requestAnimationFrame = function (callback) {
    assert.equal(this, globalThis); frames.set(++sequence, callback); return sequence;
  };
  globalThis.cancelAnimationFrame = function (handle) { assert.equal(this, globalThis); frames.delete(handle); };
  const h = createHarness({ fresh: false });
  t.after(() => {
    h.runtime.destroy();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const frame = (timestamp) => {
    assert.equal(frames.size, 1);
    const [id, callback] = frames.entries().next().value;
    frames.delete(id); callback(timestamp);
    assert.equal(frames.size, 1);
  };
  assert.equal(h.runtime.start(), false);
  assert.equal(frames.size, 1);
  h.runtime.selectLevel(0); h.runtime.confirmStart();
  frame(1000); frame(1017);
  const counts = counters(h.runtime);
  const stale = frames.values().next().value;
  const elapsed = h.runtime.state.elapsed;
  h.listeners.Hide();
  assert.equal(frames.size, 0);
  stale(100000); h.runtime.tick(60);
  assert.equal(counts.draws, 0);
  assert.equal(h.runtime.state.elapsed, elapsed);
  h.listeners.Show();
  assert.equal(frames.size, 1);
  assert.equal(counts.draws, 1);
  stale(100001);
  assert.equal(frames.size, 1, '迟到的旧回调不能清掉新调度');
  frame(100010);
  assert.equal(h.runtime.state.elapsed, elapsed, '恢复首帧只重建时间基线');
  frame(100027);
  assert.ok(h.runtime.state.elapsed - elapsed < 0.04);
  h.runtime.stop(); assert.equal(frames.size, 0);
  h.runtime.start(); assert.equal(frames.size, 1);
  h.runtime.destroy(); assert.equal(frames.size, 0);
});

test('静态页面空闲 120 帧不重绘、不重建触摸布局；点击和设置更改仍刷新', (t) => {
  const h = createHarness({ fresh: false }); t.after(() => h.runtime.destroy());
  idle(h.runtime, 4);
  const counts = counters(h.runtime);
  for (const open of [() => h.runtime.backToHome(), () => h.runtime.openRoute(),
    () => h.runtime.openAchievements(), () => h.runtime.openSettings(),
    () => h.runtime.openAppearance(), () => h.runtime.selectLevel(0)]) {
    open(); idle(h.runtime, 1);
    const before = { ...counts };
    idle(h.runtime);
    assert.deepEqual(counts, before, h.runtime.screen);
  }
  h.runtime.backToHome();
  const before = counts.draws;
  touch(h.runtime, homePageLayout(h.runtime.renderer.context.layout.viewport).buttons[3]);
  assert.equal(h.runtime.screen, 'settings');
  assert.ok(counts.draws > before);
  const enabled = h.runtime.saveData.settings.soundEnabled;
  touch(h.runtime, menuButtonRect(h.runtime.renderer.context.layout.viewport, 0, 3));
  assert.equal(h.runtime.saveData.settings.soundEnabled, !enabled);
  const changed = counts.draws;
  h.runtime.setMusicEnabled(false); h.runtime.tick(0);
  assert.equal(counts.draws, changed + 1);
  idle(h.runtime); assert.equal(counts.draws, changed + 1);
});

test('运行中持续绘制但复用触摸布局；暂停、结算和补给弹窗按需绘制', (t) => {
  const h = createHarness({ fresh: false }); t.after(() => h.runtime.destroy());
  idle(h.runtime, 4);
  h.runtime.selectLevel(0); h.runtime.confirmStart();
  const counts = counters(h.runtime);
  idle(h.runtime, 12);
  assert.equal(counts.draws, 12);
  assert.equal(counts.layouts, 0);
  h.runtime.pause();
  let before = { ...counts }; idle(h.runtime);
  assert.deepEqual(counts, before);
  h.runtime.openSupply(); before = { ...counts }; idle(h.runtime);
  assert.deepEqual(counts, before);
  h.tap('select:delay-ticket');
  assert.equal(h.runtime.getItemUi().selected, 'delay-ticket');
  assert.ok(counts.draws > before.draws);
  h.runtime.closeItemPanel(); h.runtime.tick(0);
  assert.equal(h.runtime.getItemUi().panel, null);
  before = { ...counts }; idle(h.runtime); assert.deepEqual(counts, before);
  h.runtime.resume();
  for (let i = 0; i < 1000 && h.runtime.screen !== 'result'; i++) h.runtime.tick(1 / 30);
  assert.equal(h.runtime.screen, 'result');
  before = { ...counts }; idle(h.runtime); assert.deepEqual(counts, before);
});

test('静态页面上的限时提示到期后仅补画一次', (t) => {
  const h = createHarness({ fresh: false }); t.after(() => h.runtime.destroy());
  idle(h.runtime, 4);
  h.runtime.selectLevel(0); h.runtime.confirmStart();
  // 模拟规则层给出的普通提示；不依赖特定关卡的道具可用时段。
  h.runtime.notice('提示测试');
  h.runtime.pause();
  const counts = counters(h.runtime);
  idle(h.runtime); assert.equal(counts.draws, 0);
  h.elapse(2401); h.runtime.tick(0);
  assert.equal(h.runtime.getItemUi().message, '');
  assert.equal(counts.draws, 1);
  idle(h.runtime); assert.equal(counts.draws, 1);
});
