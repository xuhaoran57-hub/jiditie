import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cloneLevelConfig,
  emptySave,
  GameSimulation,
  MVP_LEVELS,
} from '../src/core/index.ts';
import { GameRuntime } from '../src/runtime/index.ts';

function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeStressLevel() {
  const level = cloneLevelConfig(MVP_LEVELS[2]);
  level.passenger.count = 220;
  level.passenger.alightingCount = 48;
  level.carriageCapacity = 220;
  level.boardingDuration = 30;
  return level;
}

function assertFiniteState(state) {
  assert.ok(Number.isFinite(state.elapsed));
  assert.ok(Number.isFinite(state.doorRemaining));
  assert.ok(Number.isFinite(state.player.position.x));
  assert.ok(Number.isFinite(state.player.position.y));
  assert.ok(Number.isFinite(state.player.stamina));
  for (const passenger of state.passengers) {
    assert.ok(Number.isFinite(passenger.position.x));
    assert.ok(Number.isFinite(passenger.position.y));
    assert.ok(Number.isFinite(passenger.velocity.x));
    assert.ok(Number.isFinite(passenger.velocity.y));
    assert.ok(Number.isFinite(passenger.target.x));
    assert.ok(Number.isFinite(passenger.target.y));
  }
  for (const event of state.events) assert.ok(Number.isFinite(event.at));
}

function createRuntimeHarness() {
  const layout = {
    viewport: {
      width: 375,
      height: 667,
      dpr: 1,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      contentRect: { x: 0, y: 0, width: 375, height: 667 },
    },
    worldBounds: { x: 0, y: -160, width: 320, height: 728 },
    worldScale: 1,
    worldOffset: { x: 0, y: 0 },
    hudRect: { x: 0, y: 0, width: 320, height: 80 },
    resultRect: { x: 20, y: 100, width: 280, height: 300 },
    pauseButtonRect: { x: 8, y: 8, width: 42, height: 30 },
    resultRetryRect: { x: 20, y: 420, width: 100, height: 40 },
    resultNextRect: { x: 130, y: 420, width: 100, height: 40 },
    resultRouteRect: { x: 240, y: 420, width: 80, height: 40 },
    joystickCenter: { x: 54, y: 584 },
    joystickRadius: 44,
    guideButtonRect: { x: 270, y: 540, width: 72, height: 72 },
  };
  const renderer = {
    context: {
      layout,
      worldToScreen: (point) => ({ ...point }),
    },
    renderCount: 0,
    render() { this.renderCount += 1; },
    resize() {},
  };
  const input = {
    attached: false,
    attachCount: 0,
    detachCount: 0,
    setLayout(next) { this.layout = next; },
    attach() { this.attached = true; this.attachCount += 1; },
    detach() { this.attached = false; this.detachCount += 1; },
    reset() {},
    sample() { return { move: { x: 0, y: 0 }, useGuide: false }; },
    consumeCommands() { return []; },
  };
  const lifecycle = {
    paused: false,
    attachCount: 0,
    detachCount: 0,
    attach() { this.attachCount += 1; },
    detach() { this.detachCount += 1; },
    resume() { this.paused = false; },
  };
  const diagnostics = {
    attachCount: 0,
    detachCount: 0,
    attach() { this.attachCount += 1; },
    detach() { this.detachCount += 1; },
  };
  const audio = {
    unlocked: false,
    musicPlays: [],
    effects: [],
    setSettings(settings) { this.settings = { ...settings }; },
    markUserGesture() { this.unlocked = true; },
    playMusic(source) { this.musicPlays.push(source); return true; },
    playEffect(source) { this.effects.push(source); return true; },
    destroy() { this.destroyed = true; },
  };
  const storage = {
    value: emptySave(),
    load() { return jsonCopy(this.value); },
    save(value) { this.value = jsonCopy(value); return true; },
  };
  const scheduler = {
    nextId: 1,
    pending: new Map(),
    request(callback) {
      const id = this.nextId++;
      this.pending.set(id, callback);
      return id;
    },
    cancel(id) { this.pending.delete(id); },
  };
  const runtime = new GameRuntime({
    renderer,
    inputAdapter: input,
    lifecycleAdapter: lifecycle,
    diagnostics,
    audioAdapter: audio,
    storageAdapter: storage,
    scheduler,
    seed: 19,
  });
  return { runtime, renderer, input, lifecycle, diagnostics, audio, storage, scheduler };
}

test('M7 220 人压力回放保持有限状态并可确定性重放', () => {
  const level = makeStressLevel();
  const first = new GameSimulation(level, 'm7-stress');
  const second = new GameSimulation(level, 'm7-stress');

  for (let frame = 0; frame < 180; frame += 1) {
    const input = {
      move: {
        x: Math.sin(frame * 0.37),
        y: -0.55 + Math.cos(frame * 0.19) * 0.2,
      },
    };
    first.step(1 / 30, input);
    second.step(1 / 30, input);
    assert.equal(first.getState().passengers.length, 220);
    assertFiniteState(first.getState());
  }

  assert.ok(first.getState().events.length < 2000);
  assert.deepEqual(first.snapshot(), second.snapshot());
});

test('M7 快速启动/停止、前后台暂停和连续切关不产生状态串线', () => {
  const harness = createRuntimeHarness();
  const { runtime, input, lifecycle, storage, scheduler, renderer } = harness;

  assert.equal(runtime.start(), true);
  assert.equal(runtime.start(), false);
  assert.equal(scheduler.pending.size, 1);
  assert.equal(runtime.stop(), true);
  assert.equal(runtime.stop(), false);
  assert.equal(scheduler.pending.size, 0);
  assert.equal(runtime.start(), true);
  assert.equal(scheduler.pending.size, 1);
  assert.equal(input.attachCount, 2);
  assert.equal(lifecycle.attachCount, 2);

  runtime.markUserGesture();
  assert.equal(runtime.selectLevel('sea-gate'), true);
  const elapsedBeforeHide = runtime.state.elapsed;
  lifecycle.paused = true;
  runtime.tick(1);
  runtime.tick(1);
  assert.equal(runtime.state.elapsed, elapsedBeforeHide);
  lifecycle.paused = false;
  runtime.tick(0.25);
  assert.ok(runtime.state.elapsed > elapsedBeforeHide);

  assert.equal(runtime.retry(), true);
  assert.equal(runtime.state.levelId, 'sea-gate');
  assert.equal(runtime.state.elapsed, 0);
  const door = runtime.currentLevel.doors[0];
  runtime.state.player.position = {
    x: door.safeZone.x + door.safeZone.width / 2,
    y: door.safeZone.y + door.safeZone.height / 2,
  };
  for (let index = 0; index < 120 && runtime.screen !== 'result'; index += 1) runtime.tick(0.25);
  assert.equal(runtime.screen, 'result');
  assert.equal(runtime.state.outcome, 'success');
  assert.equal(runtime.nextLevel(), true);
  assert.equal(runtime.selectedLevelId, 'cloud-harbor');
  assert.equal(runtime.screen, 'game');
  assert.equal(runtime.retry(), true);
  assert.equal(runtime.selectedLevelId, 'cloud-harbor');
  assert.equal(runtime.state.elapsed, 0);
  runtime.backToRoute();
  assert.equal(runtime.screen, 'route');
  assert.equal(runtime.state, null);
  assert.ok(storage.value.stats.plays >= 4);
  assert.ok(renderer.renderCount > 0);

  runtime.stop();
  assert.equal(scheduler.pending.size, 0);
  assert.equal(input.attached, false);
  assert.equal(lifecycle.detachCount, 2);
});
