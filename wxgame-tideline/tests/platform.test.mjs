import test from 'node:test';
import assert from 'node:assert/strict';

import { emptySave, unlockLevel } from '../src/core/index.ts';
import {
  DEFAULT_SAVE_KEY,
  WxAudioAdapter,
  WxCanvasAdapter,
  WxDiagnostics,
  WxLifecycleAdapter,
  WxStorageAdapter,
  WxTouchInputAdapter,
  viewportFromWxInfo,
} from '../src/platform/wx/index.ts';

class MockCanvasContext {
  calls = [];
  setTransform(...args) { this.calls.push(['setTransform', ...args]); }
}

function makeCanvas(context = new MockCanvasContext()) {
  return {
    width: 0,
    height: 0,
    context,
    getContext(type) {
      assert.equal(type, '2d');
      return this.context;
    },
  };
}

test('微信 Canvas 适配器读取窗口/安全区并同步 DPR，异常时使用回退值', () => {
  const context = new MockCanvasContext();
  const canvas = makeCanvas(context);
  const info = {
    windowWidth: 390,
    windowHeight: 844,
    pixelRatio: 3,
    safeArea: { left: 0, top: 44, right: 390, bottom: 810 },
  };
  const api = {
    createCanvas: () => canvas,
    getWindowInfo: () => info,
  };
  const adapter = new WxCanvasAdapter(api);
  assert.equal(adapter.viewport.width, 390);
  assert.equal(adapter.viewport.height, 844);
  assert.equal(adapter.viewport.dpr, 2);
  assert.deepEqual(adapter.viewport.insets, { left: 0, top: 44, right: 0, bottom: 34 });
  assert.equal(canvas.width, 780);
  assert.equal(canvas.height, 1688);

  info.windowWidth = 414;
  info.windowHeight = 896;
  info.pixelRatio = 1;
  info.safeArea = undefined;
  adapter.refresh();
  assert.equal(adapter.viewport.width, 414);
  assert.equal(canvas.width, 414);
  assert.equal(context.calls.at(-1)[0], 'setTransform');

  const fallbackCanvas = makeCanvas();
  const fallback = new WxCanvasAdapter({
    createCanvas: () => fallbackCanvas,
    getWindowInfo: undefined,
    getSystemInfoSync: () => ({ windowWidth: 320, windowHeight: 568, pixelRatio: 1 }),
  });
  assert.equal(fallback.viewport.width, 320);
  assert.equal(fallback.viewport.height, 568);
  let bridgeFallbackCalls = 0;
  const bridgeFallback = new WxCanvasAdapter({
    createCanvas: () => makeCanvas(),
    getWindowInfo: () => { throw new Error('jsbridge not ready'); },
    getSystemInfoSync: () => {
      bridgeFallbackCalls += 1;
      return { windowWidth: 320, windowHeight: 568, pixelRatio: 1 };
    },
  });
  assert.equal(bridgeFallback.viewport.width, 667);
  assert.equal(bridgeFallback.viewport.height, 375);
  assert.equal(bridgeFallbackCalls, 0);
  assert.throws(
    () => new WxCanvasAdapter({ createCanvas: () => ({ width: 0, height: 0 }) }),
    /2d canvas context/,
  );

  const fromSafeSize = viewportFromWxInfo({ windowWidth: 300, windowHeight: 600, safeArea: { left: 10, top: 20, width: 280, height: 560 } });
  assert.deepEqual(fromSafeSize.insets, { left: 10, top: 20, right: 10, bottom: 20 });
});

test('微信 Canvas 适配器暴露可选图片工厂', () => {
  const image = {};
  const adapter = new WxCanvasAdapter({
    createCanvas: () => makeCanvas(),
    createImage: () => image,
  });
  assert.equal(adapter.imageFactory?.(), image);
});

test('外观缓存优先使用离屏 Canvas，旧版回退不会修改主画布', () => {
  const screen = makeCanvas();
  const offscreen = makeCanvas();
  const adapter = new WxCanvasAdapter({
    createCanvas: () => screen,
    createOffscreenCanvas(options) {
      assert.deepEqual(options, { type: '2d', width: 256, height: 64 });
      return offscreen;
    },
  });
  assert.equal(adapter.offscreenCanvasFactory(), offscreen);
  const fallback = new WxCanvasAdapter({ createCanvas: () => makeCanvas() });
  assert.notEqual(fallback.offscreenCanvasFactory(), fallback.canvas);
  const reused = new WxCanvasAdapter({ createCanvas: () => screen });
  const dimensions = [screen.width, screen.height];
  assert.throws(() => reused.offscreenCanvasFactory(), /must not be the screen canvas/);
  assert.deepEqual([screen.width, screen.height], dimensions);
});

test('微信触摸适配器支持多指摇杆、按钮命中和滑出/取消释放', () => {
  const listeners = {};
  const api = {
    onTouchStart: (listener) => { listeners.start = listener; },
    onTouchMove: (listener) => { listeners.move = listener; },
    onTouchEnd: (listener) => { listeners.end = listener; },
    onTouchCancel: (listener) => { listeners.cancel = listener; },
    offTouchStart: (listener) => { if (listeners.start === listener) delete listeners.start; },
    offTouchMove: (listener) => { if (listeners.move === listener) delete listeners.move; },
    offTouchEnd: (listener) => { if (listeners.end === listener) delete listeners.end; },
    offTouchCancel: (listener) => { if (listeners.cancel === listener) delete listeners.cancel; },
  };
  const input = new WxTouchInputAdapter(api, {
    joystickCenter: { x: 50, y: 100 },
    joystickRadius: 40,
    guideButtonRect: { x: 200, y: 70, width: 60, height: 60 },
    pauseButtonRect: { x: 10, y: 10, width: 40, height: 30 },
    restartButtonRect: { x: 70, y: 10, width: 40, height: 30 },
    doorHitAreas: [{ id: 'door-a', rect: { x: 120, y: 10, width: 50, height: 30 } }],
  });
  input.attach();
  input.attach();
  assert.equal(input.attached, true);

  listeners.start({ changedTouches: [{ identifier: 1, pageX: 50, pageY: 100 }] });
  listeners.move({ touches: [{ identifier: 1, pageX: 90, pageY: 100 }] });
  assert.deepEqual(input.sample().move, { x: 1, y: 0 });

  // 第二根手指触发按钮，不会抢走摇杆控制权。
  listeners.start({ changedTouches: [
    { identifier: 2, pageX: 220, pageY: 90 },
    { identifier: 3, x: 20, y: 20 },
    { identifier: 4, x: 80, y: 20 },
    { identifier: 5, x: 130, y: 20 },
  ] });
  assert.equal(input.sample().useGuide, true);
  assert.deepEqual(input.consumeCommands(), [
    { type: 'pause' },
    { type: 'restart' },
    { type: 'select-door', doorId: 'door-a' },
  ]);
  assert.equal(input.activeJoystickId, 1);

  listeners.end({ changedTouches: [{ identifier: 2 }], touches: [{ identifier: 1, pageX: 90, pageY: 100 }] });
  assert.equal(input.activeJoystickId, 1);
  listeners.cancel({});
  assert.equal(input.activeJoystickId, null);
  assert.deepEqual(input.sample().move, { x: 0, y: 0 });

  input.detach();
  assert.equal(input.attached, false);
  assert.equal(Object.keys(listeners).length, 0);
});

test('微信存储适配器安全处理正常、损坏和未来版本存档', () => {
  const values = new Map();
  const api = {
    getStorageSync: (key) => values.get(key),
    setStorageSync: (key, value) => values.set(key, value),
    removeStorageSync: (key) => values.delete(key),
  };
  const storage = new WxStorageAdapter(api);
  assert.equal(storage.key, DEFAULT_SAVE_KEY);
  assert.deepEqual(storage.load(), emptySave());

  const save = unlockLevel(emptySave(), 'cloud-harbor');
  assert.equal(storage.save(save), true);
  assert.equal(typeof values.get(DEFAULT_SAVE_KEY), 'string');
  assert.deepEqual(storage.load(), save);

  values.set(DEFAULT_SAVE_KEY, '{broken');
  assert.deepEqual(storage.load(), emptySave());
  values.set(DEFAULT_SAVE_KEY, JSON.stringify({ version: 999, unlockedLevelIds: ['star-ring'] }));
  assert.deepEqual(storage.load(), emptySave());
  assert.equal(storage.clear(), true);
  assert.equal(values.has(DEFAULT_SAVE_KEY), false);

  const failing = new WxStorageAdapter({
    getStorageSync: () => { throw new Error('read failed'); },
    setStorageSync: () => { throw new Error('write failed'); },
    removeStorageSync: () => { throw new Error('clear failed'); },
  });
  assert.deepEqual(failing.load(), emptySave());
  assert.equal(failing.save(save), false);
  assert.equal(failing.clear(), false);
  assert.equal(new WxStorageAdapter({}).save(save), false);
});

test('微信音频适配器在用户手势后播放，并正确响应静音和销毁', () => {
  const contexts = [];
  const api = {
    createInnerAudioContext: () => {
      const context = {
        src: '',
        loop: false,
        volume: 1,
        obeyMuteSwitch: false,
        plays: 0,
        stops: 0,
        destroyed: 0,
        play() { this.plays += 1; return undefined; },
        stop() { this.stops += 1; },
        destroy() { this.destroyed += 1; },
      };
      contexts.push(context);
      return context;
    },
  };
  const audio = new WxAudioAdapter(api, { masterVolume: 0.8 });
  assert.equal(audio.playEffect('beep.wav'), false);
  audio.markUserGesture();
  assert.equal(audio.playEffect('beep.wav', 0.5), true);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].volume, 0.4);
  assert.equal(audio.playEffect('beep.wav'), true);
  assert.equal(contexts.length, 1);
  assert.equal(audio.playMusic('loop.wav', 0.75), true);
  assert.equal(contexts.length, 2);
  assert.equal(contexts[1].loop, true);
  assert.ok(Math.abs(contexts[1].volume - 0.6) < 1e-9);

  audio.setSoundEnabled(false);
  assert.equal(contexts[0].stops, 1);
  assert.equal(audio.playEffect('other.wav'), false);
  audio.setMusicEnabled(false);
  assert.equal(contexts[1].stops, 1);
  assert.equal(audio.playMusic('loop.wav'), false);
  audio.destroy();
  assert.equal(contexts[0].destroyed, 1);
  assert.equal(contexts[1].destroyed, 1);
});

test('微信生命周期适配器对重复 hide/show 幂等，并可解绑', () => {
  const listeners = {};
  const api = {
    onShow: (listener) => { listeners.show = listener; },
    onHide: (listener) => { listeners.hide = listener; },
    offShow: (listener) => { if (listeners.show === listener) delete listeners.show; },
    offHide: (listener) => { if (listeners.hide === listener) delete listeners.hide; },
  };
  const transitions = [];
  const lifecycle = new WxLifecycleAdapter(api, {
    onPause: () => transitions.push('pause'),
    onResume: () => transitions.push('resume'),
  });
  lifecycle.attach();
  lifecycle.attach();
  listeners.hide();
  listeners.hide();
  assert.equal(lifecycle.paused, true);
  listeners.show({});
  listeners.show({});
  assert.equal(lifecycle.paused, false);
  assert.deepEqual(transitions, ['pause', 'resume']);
  lifecycle.pause();
  lifecycle.detach();
  assert.equal(lifecycle.attached, false);
  assert.deepEqual(Object.keys(listeners), []);
});

test('诊断适配器只记录脱敏类别并限制缓存长度', () => {
  const listeners = {};
  const logs = [];
  const api = {
    onError: (listener) => { listeners.error = listener; },
    onUnhandledRejection: (listener) => { listeners.rejection = listener; },
    offError: (listener) => { if (listeners.error === listener) delete listeners.error; },
    offUnhandledRejection: (listener) => { if (listeners.rejection === listener) delete listeners.rejection; },
  };
  let clock = 100;
  const diagnostics = new WxDiagnostics(api, {
    maxRecords: 2,
    now: () => clock++,
    logger: {
      error: (message) => logs.push(message),
      warn: (message) => logs.push(message),
    },
  });
  diagnostics.attach();
  listeners.error(new Error('secret-user-input'));
  listeners.rejection({ reason: 'token=private' });
  diagnostics.capture('error', { path: 'C:/private/user.json' });
  const records = diagnostics.getRecent();
  assert.equal(records.length, 2);
  assert.equal(records[0].type, 'unhandled-rejection');
  assert.equal(records[1].label, 'objectError');
  assert.equal(JSON.stringify(records).includes('secret'), false);
  assert.equal(logs.join('|').includes('private'), false);
  diagnostics.detach();
  assert.equal(Object.keys(listeners).length, 0);
  diagnostics.clear();
  assert.deepEqual(diagnostics.getRecent(), []);
});
