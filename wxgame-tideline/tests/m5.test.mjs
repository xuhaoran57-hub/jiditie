import test from 'node:test';
import assert from 'node:assert/strict';

import { GameRuntime } from '../src/runtime/index.ts';
import { WxAudioAdapter } from '../src/platform/wx/index.ts';
import { appearanceCardRect, menuButtonRect, routeListCardRect } from '../src/render/index.ts';
import { emptySave, serializeSave } from '../src/core/save-schema.ts';

class MockContext {
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  font = '10px sans-serif';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  lineCap = 'butt';
  lineJoin = 'miter';

  save() {}
  restore() {}
  translate() {}
  scale() {}
  rotate() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  arc() {}
  ellipse() {}
  rect() {}
  fill() {}
  stroke() {}
  fillRect() {}
  strokeRect() {}
  clearRect() {}
  fillText() {}
  strokeText() {}
  measureText(text) { return { width: text.length * 8 }; }
  setLineDash() {}
  setTransform() {}
  roundRect() {}
}

function createMockWx() {
  const context = new MockContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; },
  };
  const listeners = {};
  const storage = new Map();
  const frames = new Map();
  let nextFrameId = 1;
  let now = 0;
  const wx = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 1 }),
    onTouchStart: (listener) => { listeners.touchStart = listener; },
    onTouchMove: (listener) => { listeners.touchMove = listener; },
    onTouchEnd: (listener) => { listeners.touchEnd = listener; },
    onTouchCancel: (listener) => { listeners.touchCancel = listener; },
    offTouchStart: () => { delete listeners.touchStart; },
    offTouchMove: () => { delete listeners.touchMove; },
    offTouchEnd: () => { delete listeners.touchEnd; },
    offTouchCancel: () => { delete listeners.touchCancel; },
    onShow: (listener) => { listeners.show = listener; },
    onHide: (listener) => { listeners.hide = listener; },
    offShow: () => { delete listeners.show; },
    offHide: () => { delete listeners.hide; },
    onError: (listener) => { listeners.error = listener; },
    onUnhandledRejection: (listener) => { listeners.rejection = listener; },
    offError: () => { delete listeners.error; },
    offUnhandledRejection: () => { delete listeners.rejection; },
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    createInnerAudioContext: () => ({
      src: '', loop: false, volume: 1,
      play() {}, stop() {}, destroy() {},
    }),
    requestAnimationFrame: (callback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    _listeners: listeners,
    _frames: frames,
    _stepFrame(deltaMs = 16) {
      now += deltaMs;
      const pending = [...frames.entries()];
      frames.clear();
      pending.forEach(([, callback]) => callback(now));
    },
  };
  return wx;
}

function runUntilResult(runtime, count = 120) {
  for (let index = 0; index < count && runtime.screen !== 'result'; index += 1) {
    runtime.tick(0.25);
  }
}

function createRecordingAudio() {
  const played = [];
  const audio = new WxAudioAdapter({
    createInnerAudioContext: () => {
      const context = {
        src: '',
        loop: false,
        volume: 1,
        play() { played.push(this.src); },
        stop() {},
        destroy() {},
      };
      return context;
    },
  });
  return { audio, played };
}

test('外观预览卡片触摸能装备并持久化，未解锁外观不能装备', () => {
  for (const [width, height] of [[480, 320], [667, 375], [375, 667]]) {
    const wx = createMockWx();
    wx.getWindowInfo = () => ({ windowWidth: width, windowHeight: height, pixelRatio: 1 });
    const save = emptySave();
    save.achievements.push('clear:sea-gate');
    wx.setStorageSync('tideline.save.v1', serializeSave(save));
    const runtime = new GameRuntime(wx);
    runtime.start();
    runtime.openAppearance();
    assert.equal(runtime.setAppearance('night'), false);
    const card = appearanceCardRect(runtime.renderer.context.layout.viewport, 1);
    wx._listeners.touchStart({ changedTouches: [{ identifier: 1, x: card.x + card.width / 2, y: card.y + card.height / 2 }] });
    runtime.tick(0);
    assert.equal(runtime.saveData.appearanceId, 'seafoam');
    runtime.stop();
    const reloaded = new GameRuntime(wx);
    assert.equal(reloaded.saveData.appearanceId, 'seafoam');
    reloaded.stop();
  }
});

test('M5 runtime 启动进入路线页，选关后只维护一条 ticker', () => {
  const wx = createMockWx();
  const runtime = new GameRuntime(wx, { seed: 7 });
  assert.equal(runtime.screen, 'home');
  assert.equal(runtime.running, false);
  assert.equal(runtime.start(), true);
  assert.equal(runtime.start(), false);
  assert.equal(runtime.running, true);
  assert.equal(wx._frames.size, 1);

  runtime.openRoute();
  assert.equal(runtime.selectLevel('sea-gate'), true);
  assert.equal(runtime.screen, 'briefing');
  assert.equal(runtime.confirmStart(), true);
  assert.equal(runtime.screen, 'game');
  assert.equal(runtime.selectedLevelId, 'sea-gate');
  runtime.stop();
  assert.equal(runtime.running, false);
  assert.equal(wx._frames.size, 0);
});

test('M5 路线卡片触摸、摇杆输入和生命周期暂停可串联', () => {
  const wx = createMockWx();
  const runtime = new GameRuntime(wx, { seed: 11 });
  runtime.start();
  const startRect = menuButtonRect(runtime.renderer.context.layout.viewport, 0, 4);
  wx._listeners.touchStart({ changedTouches: [{ identifier: 0, x: startRect.x + 12, y: startRect.y + 12 }] });
  runtime.tick(0);
  const routeRect = routeListCardRect(runtime.renderer.context.layout.viewport, 0, 0);
  wx._listeners.touchStart({ changedTouches: [{ identifier: 2, x: routeRect.x + 12, y: routeRect.y + 12 }] });
  wx._listeners.touchEnd({ changedTouches: [{ identifier: 2, x: routeRect.x + 12, y: routeRect.y + 12 }] });
  runtime.tick(0);
  const confirm = runtime.renderer.context.layout.briefingConfirmRect;
  wx._listeners.touchStart({ changedTouches: [{ identifier: 3, x: confirm.x + 8, y: confirm.y + 8 }] });
  runtime.tick(0);
  assert.equal(runtime.screen, 'game');
  assert.equal(runtime.audio.unlocked, true);

  // 按住摇杆向上，跨过进站阶段后玩家应发生位移。
  const joystick = runtime.renderer.context.layout.joystickCenter;
  const beforeY = runtime.state.player.position.y;
  wx._listeners.touchStart({ changedTouches: [{ identifier: 2, x: joystick.x, y: joystick.y - 40 }] });
  for (let index = 0; index < 12; index += 1) runtime.tick(0.25);
  assert.ok(runtime.state.player.position.y < beforeY);
  const heldY = runtime.state.player.position.y;
  runtime.tick(0.25);
  assert.ok(runtime.state.player.position.y < heldY);

  const elapsedBeforeHide = runtime.state.elapsed;
  wx._listeners.hide();
  runtime.tick(2);
  assert.equal(runtime.state.elapsed, elapsedBeforeHide);
  wx._listeners.show();
  runtime.tick(0.25);
  assert.ok(runtime.state.elapsed > elapsedBeforeHide);
});

test('M5 结算会保存最高分并解锁下一站，重试/下一站/返回路线均可用', () => {
  const wx = createMockWx();
  const runtime = new GameRuntime(wx, { seed: 11 });
  runtime.selectLevel('sea-gate');
  runtime.confirmStart();
  runtime.state.player.position = {
    x: runtime.currentLevel.trainBounds.x + runtime.currentLevel.trainBounds.width / 2,
    y: runtime.currentLevel.trainBounds.y + runtime.currentLevel.trainBounds.height / 2,
  };
  runUntilResult(runtime);
  assert.equal(runtime.screen, 'result');
  assert.equal(runtime.state.outcome, 'success');
  assert.ok(runtime.saveData.unlockedLevelIds.includes('lighthouse-bay'));
  assert.ok(Object.hasOwn(runtime.saveData.bestScores, 'sea-gate'));

  // 结算页的触摸重试命令和直接 API 保持同一条状态迁移路径。
  const retryRect = runtime.renderer.context.layout.resultRetryRect;
  runtime.input.handleTouchStart({ changedTouches: [{ identifier: 3, x: retryRect.x + 4, y: retryRect.y + 4 }] });
  runtime.tick(0);
  assert.equal(runtime.screen, 'game');
  // 再次让玩家进入车厢，验证下一站按钮前置条件仍由结算结果决定。
  runtime.state.player.position = {
    x: runtime.currentLevel.trainBounds.x + runtime.currentLevel.trainBounds.width / 2,
    y: runtime.currentLevel.trainBounds.y + runtime.currentLevel.trainBounds.height / 2,
  };
  runUntilResult(runtime);
  assert.equal(runtime.state.outcome, 'success');
  assert.equal(runtime.nextLevel(), true);
  assert.equal(runtime.screen, 'briefing');
  assert.equal(runtime.confirmStart(), true);
  assert.equal(runtime.screen, 'game');
  assert.equal(runtime.selectedLevelId, 'lighthouse-bay');
  assert.equal(runtime.retry(), true);
  assert.equal(runtime.screen, 'game');
  runtime.backToRoute();
  assert.equal(runtime.screen, 'route');

  const persisted = new GameRuntime(wx, { seed: 11 });
  assert.ok(persisted.saveData.unlockedLevelIds.includes('lighthouse-bay'));
});

test('M5 运行时快照暴露当前事件并驱动几何反馈', () => {
  const wx = createMockWx();
  const runtime = new GameRuntime(wx, { seed: 44, fixedDelta: 1 / 30, maxFrameDelta: 10 });
  runtime.selectLevel('sea-gate');
  runtime.confirmStart();
  runtime.tick(3.45);
  assert.equal(runtime.state?.activeEvent?.kind, 'rain');
  assert.equal(runtime.state?.activeEvent?.label, '伞流经过');
  runtime.tick(3.7);
  assert.equal(runtime.state.activeEvent, null);
});

test('M6 运行时按事件播放一次音效，重试后重新从头计数', () => {
  const wx = createMockWx();
  const recording = createRecordingAudio();
  const runtime = new GameRuntime(wx, {
    seed: 44,
    fixedDelta: 1 / 30,
    maxFrameDelta: 10,
    audioAdapter: recording.audio,
    audioSources: {
      music: 'music.wav',
      guide: 'guide.wav',
      success: 'success.wav',
      failure: 'failure.wav',
      eventStart: 'event.wav',
    },
  });

  runtime.markUserGesture();
  assert.deepEqual(recording.played, ['music.wav']);
  runtime.selectLevel('sea-gate');
  runtime.confirmStart();
  runtime.tick(3.45);
  assert.deepEqual(recording.played, ['music.wav', 'event.wav']);
  runtime.tick(0);
  assert.deepEqual(recording.played, ['music.wav', 'event.wav']);

  runtime.state.events.push({ type: 'guide', at: runtime.state.elapsed });
  runtime.tick(0);
  runtime.tick(0);
  assert.deepEqual(recording.played, ['music.wav', 'event.wav', 'guide.wav']);

  runtime.state.events.push(
    { type: 'success', at: runtime.state.elapsed },
    { type: 'failure', at: runtime.state.elapsed },
  );
  runtime.tick(0);
  assert.deepEqual(recording.played, [
    'music.wav',
    'event.wav',
    'guide.wav',
    'success.wav',
    'failure.wav',
  ]);

  assert.equal(runtime.retry(), true);
  runtime.state.events.push({ type: 'guide', at: runtime.state.elapsed });
  runtime.tick(0);
  assert.equal(recording.played.filter((source) => source === 'guide.wav').length, 2);
});

test('M6 缺少微信音频 API 时保持静默并继续推进', () => {
  const wx = createMockWx();
  delete wx.createInnerAudioContext;
  const runtime = new GameRuntime(wx, {
    fixedDelta: 1 / 30,
    maxFrameDelta: 10,
  });
  assert.doesNotThrow(() => {
    runtime.markUserGesture();
    runtime.selectLevel('sea-gate');
    runtime.confirmStart();
    runtime.tick(3.45);
  });
  assert.equal(runtime.audio.unlocked, true);
  assert.equal(runtime.state?.activeEvent?.kind, 'rain');
});
