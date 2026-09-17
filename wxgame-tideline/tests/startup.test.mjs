import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRuntime } from '../src/runtime/game-runtime.ts';
import { MVP_LEVELS } from '../src/core/levels.ts';
import { emptySave, serializeSave } from '../src/core/save-schema.ts';
import { WxRewardedAdAdapter } from '../src/platform/wx/rewarded-ad.ts';
import { MockContext } from './helpers/item-harness.mjs';

function startupHarness({ fresh = true } = {}) {
  const context = new MockContext();
  const events = [];
  const originalFillText = context.fillText.bind(context);
  context.fillText = (...args) => { events.push('draw'); originalFillText(...args); };
  let width = 0, height = 0, sizeWrites = 0, saved, now = 100, nextFrame = 0, passengerReads = 0;
  if (!fresh) saved = serializeSave(emptySave());
  const canvas = {
    get width() { return width; }, set width(value) { width = value; sizeWrites++; },
    get height() { return height; }, set height(value) { height = value; sizeWrites++; },
    getContext: () => context,
  };
  const windowInfo = { windowWidth: 667, windowHeight: 375, pixelRatio: 2 };
  const frames = new Map();
  const images = [];
  const ad = { async load() { events.push('ad-load'); }, async show() { events.push('ad-show'); },
    onClose() {}, offClose() {}, onError() {}, offError() {}, destroy() { events.push('ad-destroy'); } };
  const api = {
    createCanvas: () => canvas,
    getWindowInfo: () => windowInfo,
    createImage: () => { events.push('image'); const image = {}; images.push(image); return image; },
    getStorageSync: () => saved,
    setStorageSync: (_key, value) => { events.push('write'); saved = value; },
    createRewardedVideoAd: () => { events.push('ad-create'); return ad; },
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  const level = { ...MVP_LEVELS[0], passenger: { ...MVP_LEVELS[0].passenger } };
  Object.defineProperty(level.passenger, 'count', { get() { passengerReads++; return MVP_LEVELS[0].passenger.count; } });
  const runtime = new GameRuntime(api, { levels: [level], now: () => now, rewardedAdUnitId: 'adunit-test',
    startupTrace: { startedAt: 90, modulesReadyAt: 95, retries: 0 } });
  return { runtime, events, images, frames, context, canvas, windowInfo,
    sizeWrites: () => sizeWrites, passengerReads: () => passengerReads,
    frame() {
      assert.equal(frames.size, 1, '始终只有一条帧循环');
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      now += 16;
      callback(now);
    },
  };
}

test('首页提交后分帧发礼包、加载图集和广告，启动不会生成乘客', (t) => {
  const h = startupHarness(); t.after(() => h.runtime.destroy());
  assert.deepEqual(h.events, []);
  h.runtime.start();
  assert.ok(h.context.operations.some(([text]) => text === '挤上这班车'));
  assert.equal(h.context.operations.some(([text]) => text === '重试领取'), false, '首次领取尚未尝试，不显示重试错误态');
  assert.equal(h.passengerReads(), 0);
  assert.equal(h.images.length, 0);
  assert.equal(h.events.includes('write'), false);
  assert.equal(h.events.includes('ad-create'), false);
  assert.equal(h.sizeWrites(), 2, '首次配置只写一次宽和高');
  assert.equal(h.runtime.getStartupTimings().modulesReady, 5);
  assert.equal(h.runtime.getStartupTimings().homeSubmitted, 10);
  h.frame(); // 首次 rAF 只建立时间基线，留出首页上屏机会。
  assert.equal(h.events.includes('write'), false);
  h.frame();
  assert.equal(h.events.filter((event) => event === 'write').length, 1);
  assert.deepEqual(h.runtime.saveData.items.inventory, { 'commute-horn': 1, 'delay-ticket': 1 });
  assert.equal(h.images.length, 0);
  h.frame(); assert.equal(h.images.length, 5);
  assert.equal(h.events.includes('ad-create'), false);
  h.frame(); assert.equal(h.events.filter((event) => event === 'ad-create').length, 1);
  h.frame(); h.frame();
  assert.equal(h.images.length, 5);
  assert.equal(h.passengerReads(), 0);
  assert.ok(h.runtime.getStartupTimings().preloadsStarted > h.runtime.getStartupTimings().homeSubmitted);
});

test('快速进入关卡仍正常领取礼包、按需加载，后续预加载不重复', (t) => {
  const h = startupHarness(); t.after(() => h.runtime.destroy());
  h.runtime.start();
  assert.equal(h.runtime.selectLevel(0), true);
  assert.equal(h.passengerReads(), 0, '关卡介绍页也不创建模拟');
  assert.equal(h.runtime.confirmStart(), true);
  assert.ok(h.passengerReads() > 0);
  assert.equal(h.runtime.state.passengers.length, MVP_LEVELS[0].passenger.count);
  assert.equal(h.images.length, 5);
  const inventory = h.runtime.saveData.items.inventory;
  for (let i = 0; i < 6; i++) h.frame();
  assert.deepEqual(h.runtime.saveData.items.inventory, inventory);
  assert.equal(h.images.length, 5);
  h.runtime.backToHome();
  const reads = h.passengerReads();
  h.runtime.openRoute(); h.runtime.backToHome();
  assert.equal(h.passengerReads(), reads);
});

test('暂停、停止和销毁不会触发延迟预加载，重新启动仍只有一条循环', () => {
  const h = startupHarness({ fresh: false });
  h.runtime.start();
  const stale = h.frames.values().next().value;
  h.runtime.stop(); stale(116);
  assert.equal(h.frames.size, 0);
  assert.equal(h.images.length, 0);
  h.runtime.start();
  h.runtime.lifecycle.pause();
  assert.equal(h.frames.size, 0, '后台停止调度，而不是继续空转');
  for (let i = 0; i < 5; i++) h.runtime.tick(1 / 60);
  assert.equal(h.images.length, 0);
  assert.equal(h.events.includes('ad-create'), false);
  h.runtime.lifecycle.resume();
  for (let i = 0; i < 5; i++) h.frame();
  assert.equal(h.images.length, 5);
  assert.equal(h.events.filter((event) => event === 'ad-create').length, 1);
  const late = h.frames.values().next().value;
  h.runtime.destroy(); late(300); h.runtime.tick(0);
  assert.equal(h.frames.size, 0);
  assert.equal(h.events.filter((event) => event === 'ad-create').length, 1);
});

test('相同 viewport 不清空或重绘；安全区变化和宿主尺寸重置仍会恢复', (t) => {
  const h = startupHarness({ fresh: false }); t.after(() => h.runtime.destroy());
  h.runtime.start();
  const draws = h.context.operations.length;
  h.runtime.resize();
  assert.equal(h.sizeWrites(), 2);
  assert.equal(h.context.operations.length, draws);
  h.windowInfo.safeArea = { left: 20, top: 0, right: 647, bottom: 375 };
  h.runtime.resize();
  assert.equal(h.runtime.renderer.context.layout.viewport.insets.left, 20);
  assert.ok(h.context.operations.length > draws);
  assert.equal(h.sizeWrites(), 2);
  h.canvas.width = 300;
  h.runtime.resize();
  assert.equal(h.canvas.width, 1334);
  h.windowInfo.windowWidth = 740;
  h.runtime.resize();
  assert.equal(h.canvas.width, 1480);
});

test('广告的能力查询不创建对象，主动观看能按需创建，失败和销毁可降级', async () => {
  let calls = 0;
  const broken = new WxRewardedAdAdapter({ createRewardedVideoAd() { calls++; throw Error('bridge'); } }, 'adunit-test');
  assert.equal(broken.available, true);
  assert.equal(calls, 0);
  assert.equal(await broken.watch(), 'unavailable');
  assert.equal(broken.available, false);
  broken.preload(); assert.equal(calls, 1);
  const disposed = new WxRewardedAdAdapter({ createRewardedVideoAd() { calls++; throw Error('unexpected'); } }, 'adunit-test');
  disposed.destroy(); disposed.preload();
  assert.equal(await disposed.watch(), 'unavailable');
  assert.equal(calls, 1);
});

test('异步图片就绪会刷新外观页和暂停页，首页不因图集解码而重复绘制', (t) => {
  const h = startupHarness({ fresh: false }); t.after(() => h.runtime.destroy());
  h.runtime.start(); for (let i = 0; i < 5; i++) h.frame();
  let draws = 0;
  const render = h.runtime.renderer.render.bind(h.runtime.renderer);
  h.runtime.renderer.render = (...args) => { draws++; render(...args); };
  h.images[0].onload(); h.frame(); assert.equal(draws, 0);
  h.runtime.openAppearance();
  h.frame(); // 切页后首帧重建时间基线。
  draws = 0;
  h.images[4].onload(); h.frame(); assert.equal(draws, 1);
  h.frame(); assert.equal(draws, 1);
  h.runtime.selectLevel(0); h.runtime.confirmStart(); h.runtime.pause();
  h.frame();
  draws = 0;
  h.images[1].onload(); h.frame(); assert.equal(draws, 1);
  h.images[2].onerror(); h.frame(); assert.equal(draws, 2);
  h.frame(); assert.equal(draws, 2);
});
