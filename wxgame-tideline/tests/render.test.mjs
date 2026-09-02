import test from 'node:test';
import assert from 'node:assert/strict';

import { GameSimulation, MVP_LEVELS } from '../src/core/index.ts';
import { DebugInputController, FixedTimestepLoop } from '../src/platform/debug/index.ts';
import {
  GameRenderer,
  RenderContext,
  configureCanvas,
  createRenderLayout,
  createViewportMetrics,
  fillRoundRect,
  renderGameFrame,
  roundRectPath,
} from '../src/render/index.ts';

class MockContext {
  operations = [];
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  font = '10px sans-serif';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  lineCap = 'butt';
  lineJoin = 'miter';

  constructor({ nativeRoundRect = true } = {}) {
    if (!nativeRoundRect) this.roundRect = undefined;
  }

  record(name, ...args) {
    this.operations.push([name, ...args]);
  }

  save() { this.record('save'); }
  restore() { this.record('restore'); }
  translate(x, y) { this.record('translate', x, y); }
  scale(x, y) { this.record('scale', x, y); }
  rotate(angle) { this.record('rotate', angle); }
  beginPath() { this.record('beginPath'); }
  closePath() { this.record('closePath'); }
  moveTo(x, y) { this.record('moveTo', x, y); }
  lineTo(x, y) { this.record('lineTo', x, y); }
  quadraticCurveTo(cpx, cpy, x, y) { this.record('quadraticCurveTo', cpx, cpy, x, y); }
  arc(x, y, radius, startAngle, endAngle) { this.record('arc', x, y, radius, startAngle, endAngle); }
  ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle) {
    this.record('ellipse', x, y, radiusX, radiusY, rotation, startAngle, endAngle);
  }
  rect(x, y, width, height) { this.record('rect', x, y, width, height); }
  fill(fillRule) { this.record('fill', fillRule); }
  stroke() { this.record('stroke'); }
  fillRect(x, y, width, height) { this.record('fillRect', x, y, width, height); }
  strokeRect(x, y, width, height) { this.record('strokeRect', x, y, width, height); }
  clearRect(x, y, width, height) { this.record('clearRect', x, y, width, height); }
  fillText(text, x, y, maxWidth) { this.record('fillText', text, x, y, maxWidth); }
  strokeText(text, x, y, maxWidth) { this.record('strokeText', text, x, y, maxWidth); }
  measureText(text) { return { width: text.length * 8 }; }
  setLineDash(segments) { this.record('setLineDash', ...segments); }
  setTransform(a, b, c, d, e, f) { this.record('setTransform', a, b, c, d, e, f); }
  roundRect(x, y, width, height, radii) { this.record('roundRect', x, y, width, height, radii); }
}

function makeCanvas(context) {
  return {
    width: 0,
    height: 0,
    getContext(type) {
      assert.equal(type, '2d');
      return context;
    },
  };
}

function assertClose(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`);
}

test('viewport layout keeps logical coordinates reversible and configures DPR', () => {
  const metrics = createViewportMetrics(375, 667, 3, { top: 24, right: 6, bottom: 34, left: 4 });
  assert.equal(metrics.dpr, 3);
  assert.deepEqual(metrics.contentRect, { x: 4, y: 24, width: 365, height: 609 });

  const layout = createRenderLayout(metrics, { x: 0, y: -160, width: 320, height: 728 });
  const context = new RenderContext(new MockContext(), metrics, layout.worldBounds);
  const worldPoint = { x: 123.5, y: 42.25 };
  const screenPoint = context.worldToScreen(worldPoint);
  const roundTrip = context.screenToWorld(screenPoint);
  assertClose(roundTrip.x, worldPoint.x);
  assertClose(roundTrip.y, worldPoint.y);
  assert.ok(layout.worldScale > 0);
  assert.ok(layout.guideButtonRect.x + layout.guideButtonRect.width <= metrics.contentRect.x + metrics.contentRect.width);

  const canvasContext = new MockContext();
  const canvas = makeCanvas(canvasContext);
  configureCanvas(canvas, canvasContext, metrics);
  assert.equal(canvas.width, 1125);
  assert.equal(canvas.height, 2001);
  assert.deepEqual(canvasContext.operations.at(-1), ['setTransform', 3, 0, 0, 3, 0, 0]);
});

test('roundRect uses native API when available and a quadratic fallback otherwise', () => {
  const native = new MockContext({ nativeRoundRect: true });
  fillRoundRect(native, 1, 2, 30, 20, 8, '#fff');
  assert.ok(native.operations.some(([name]) => name === 'roundRect'));

  const fallback = new MockContext({ nativeRoundRect: false });
  fallback.beginPath();
  roundRectPath(fallback, 1, 2, 30, 20, 8);
  assert.ok(fallback.operations.some(([name]) => name === 'quadraticCurveTo'));
  assert.ok(fallback.operations.some(([name]) => name === 'closePath'));
});

test('GameRenderer renders game, warning, pause, result and route screens on a mock canvas', () => {
  const context = new MockContext({ nativeRoundRect: false });
  const canvas = makeCanvas(context);
  const level = MVP_LEVELS[1];
  const simulation = new GameSimulation(level, 2026);
  const state = simulation.getState();
  const target = state.passengers[0];
  assert.ok(target);
  state.events.push(
    { type: 'guide', at: 0, detail: target.id },
    { type: 'collision', at: 0 },
  );

  const renderer = GameRenderer.fromCanvas(canvas, 375, 667, 2, { top: 24, bottom: 20 }, level);
  assert.equal(canvas.width, 750);
  assert.equal(canvas.height, 1334);
  renderer.render(state, level, { showControls: true });

  state.phase = 'warning';
  state.doorRemaining = 1.2;
  renderer.render(state, level, { paused: true });
  renderer.resize(414, 896, 1, { top: 24, bottom: 34 });
  renderGameFrame(renderer.context, state, level, { showControls: false });

  const resultSimulation = new GameSimulation('sea-gate', 11);
  resultSimulation.runUntilResult(30);
  renderer.render(resultSimulation.getState(), MVP_LEVELS[0], { screen: 'result' });
  renderer.render(state, level, {
    screen: 'route',
    levels: MVP_LEVELS,
    unlockedLevelIds: ['sea-gate', 'cloud-harbor'],
    selectedLevelIndex: 1,
  });

  const names = context.operations.map(([name]) => name);
  assert.ok(names.includes('fillRect'));
  assert.ok(names.includes('arc'));
  assert.ok(names.includes('fillText'));
  assert.ok(names.includes('quadraticCurveTo'));
  assert.ok(names.includes('translate'));
  assert.ok(names.includes('scale'));
});

test('debug input preserves Space and emits one-shot commands', () => {
  const input = new DebugInputController();
  input.keyDown('w');
  input.keyDown('ArrowRight');
  input.keyDown(' ');
  const first = input.sample();
  assert.deepEqual(first.move, { x: 1, y: -1 });
  assert.equal(first.useGuide, true);
  assert.equal(input.sample().useGuide, false);

  input.keyDown(' Space ');
  assert.equal(input.sample().useGuide, true);
  input.keyDown('Escape');
  input.keyDown('r');
  assert.deepEqual(input.consumeCommands(), { pause: true, restart: true });
  assert.deepEqual(input.consumeCommands(), { pause: false, restart: false });

  input.keyUp('w');
  input.keyUp('ArrowRight');
  assert.deepEqual(input.sample().move, { x: 0, y: 0 });
});

test('fixed timestep loop clamps long frames and pauses deterministically', () => {
  const loop = new FixedTimestepLoop(0.1, 0.25);
  const steps = [];
  const inputs = [];
  const target = {
    step(dt, input) {
      steps.push(dt);
      inputs.push(input);
      return {};
    },
  };

  // 0.35s is clamped to the configured 0.25s frame budget, so only two
  // 0.1s simulation steps are consumed and 0.05s remains for interpolation.
  assert.equal(loop.advance(0.35, target, () => ({ move: { x: 1, y: 0 } })), 2);
  assert.equal(steps.length, 2);
  assert.ok(steps.every((dt) => dt === 0.1));
  assert.equal(inputs.length, 2);
  assert.equal(loop.totalSteps, 2);
  assertClose(loop.interpolationAlpha, 0.5);

  loop.setPaused(true);
  assert.equal(loop.advance(1, target), 0);
  assert.equal(loop.interpolationAlpha, 0);
  assert.equal(loop.togglePaused(), false);
  assert.equal(loop.advance(0.1, target), 1);
  assert.equal(loop.totalSteps, 3);

  loop.reset();
  assert.equal(loop.totalSteps, 0);
  assert.equal(loop.paused, false);
});
