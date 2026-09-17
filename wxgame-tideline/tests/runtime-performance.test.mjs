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
