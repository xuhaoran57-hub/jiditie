import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CARRIAGE_THEMES, GameSimulation, MVP_LEVELS } from '../src/core/index.ts';
import { DebugInputController, FixedTimestepLoop } from '../src/platform/debug/index.ts';
import {
  GameRenderer,
  RenderContext,
  configureCanvas,
  CARRIAGE_COLORS,
  createRenderLayout,
  createViewportMetrics,
  DEFAULT_CARRIAGE_THEME,
  fillRoundRect,
  NPC_VISUAL_PROFILES,
  routeCardRect,
  renderActors,
  renderGameFrame,
  roundRectPath,
  STATION_COLORS,
  stationColorsFor,
  loadPassengerAtlasSprite,
  loadPassengerFastSprite,
  loadPassengerRegularSprite,
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

  constructor({ nativeRoundRect = true, throwingRoundRect = false } = {}) {
    if (!nativeRoundRect) this.roundRect = undefined;
    if (throwingRoundRect) this.roundRect = () => { throw new Error('roundRect unavailable'); };
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
  drawImage(...args) { this.record('drawImage', ...args); }
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

test('landscape layout keeps the train above the platform and geometry reversible', () => {
  const metrics = createViewportMetrics(667, 375, 1);
  const layout = createRenderLayout(metrics, { x: 0, y: -160, width: 320, height: 728 });
  assert.equal(layout.orientation, 'landscape');
  assert.deepEqual(layout.displayWorldBounds, { x: 0, y: -160, width: 320, height: 728 });
  assert.ok(layout.worldScaleX > layout.worldScaleY);
  assert.ok(layout.worldRect.x >= metrics.contentRect.x);
  assert.ok(layout.worldRect.y >= metrics.contentRect.y);
  assert.ok(layout.worldRect.x + layout.worldRect.width <= metrics.contentRect.x + metrics.contentRect.width);
  assert.ok(layout.worldRect.y + layout.worldRect.height <= metrics.contentRect.y + metrics.contentRect.height);
  assert.ok(layout.worldRect.y < metrics.contentRect.y + 40, 'landscape world should use the freed top area');
  assert.ok(layout.worldRect.height > 300, 'landscape carriage/platform stage should be taller');
  assert.ok(layout.hudRect.width < metrics.contentRect.width * 0.3, 'landscape HUD should be a floating side card');
  assert.ok(layout.pauseButtonRect.x >= layout.hudRect.x);
  assert.ok(layout.pauseButtonRect.y >= layout.hudRect.y);
  assert.ok(layout.pauseButtonRect.x + layout.pauseButtonRect.width <= layout.hudRect.x + layout.hudRect.width);

  const context = new RenderContext(new MockContext(), metrics, layout.worldBounds);
  const trainPoint = context.worldToScreen({ x: 160, y: -80 });
  const platformPoint = context.worldToScreen({ x: 160, y: 300 });
  assert.ok(trainPoint.y < platformPoint.y, 'train should appear above the platform');
  const trainTop = context.worldToScreen({ x: 160, y: -160 });
  const platformBoundary = context.worldToScreen({ x: 160, y: 0 });
  assert.ok(platformBoundary.y - trainTop.y > 70, 'landscape carriage should have a larger visual height');

  const worldPoint = { x: 123.5, y: 42.25 };
  const roundTrip = context.screenToWorld(context.worldToScreen(worldPoint));
  assertClose(roundTrip.x, worldPoint.x);
  assertClose(roundTrip.y, worldPoint.y);
});

test('landscape actors use a compact visual scale that fits the carriage', () => {
  const level = MVP_LEVELS[0];
  const simulation = new GameSimulation(level, 2026);
  const state = simulation.getState();
  state.phase = 'exiting';
  const passenger = state.passengers[0];
  assert.ok(passenger);
  passenger.kind = 'regular';
  passenger.role = 'waiting';
  passenger.position = { x: 160, y: 180 };
  for (const other of state.passengers.slice(1)) other.role = 'exited';

  const landscapeContext = new MockContext({ nativeRoundRect: false });
  const landscapeCanvas = makeCanvas(landscapeContext);
  const landscapeRenderer = GameRenderer.fromCanvas(landscapeCanvas, 667, 375, 1, {}, level);
  landscapeRenderer.render(state, level, { showControls: false });

  const uniformLandscapeScales = landscapeContext.operations
    .filter(([name, x, y]) => name === 'scale' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-8)
    .map(([, x]) => x)
    .filter((value) => value > 0 && value < 1);
  assert.ok(uniformLandscapeScales.some((value) => value < 0.7), 'the passenger body should be reduced in landscape');

  const portraitContext = new MockContext({ nativeRoundRect: false });
  const portraitCanvas = makeCanvas(portraitContext);
  const portraitRenderer = GameRenderer.fromCanvas(portraitCanvas, 375, 667, 1, {}, level);
  portraitRenderer.render(state, level, { showControls: false });
  const uniformPortraitScales = portraitContext.operations
    .filter(([name, x, y]) => name === 'scale' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-8)
    .map(([, x]) => x)
    .filter((value) => value > 0 && value < 1);
  assert.ok(!uniformPortraitScales.some((value) => value < 0.7), 'portrait actor sizing should remain unchanged');
});

test('landscape route cards use columns so all stations fit the wide screen', () => {
  const viewport = createViewportMetrics(667, 375);
  const first = routeCardRect(viewport, 0);
  const second = routeCardRect(viewport, 1);
  const third = routeCardRect(viewport, 2);
  assert.equal(first.y, second.y);
  assert.equal(second.y, third.y);
  assert.ok(first.x < second.x && second.x < third.x);
  assert.ok(third.x + third.width <= viewport.contentRect.x + viewport.contentRect.width);

  const narrowLandscape = createViewportMetrics(480, 320);
  for (let index = 0; index < 3; index += 1) {
    const card = routeCardRect(narrowLandscape, index);
    assert.ok(card.x >= narrowLandscape.contentRect.x);
    assert.ok(card.y >= narrowLandscape.contentRect.y);
    assert.ok(card.x + card.width <= narrowLandscape.contentRect.x + narrowLandscape.contentRect.width);
    assert.ok(card.y + card.height <= narrowLandscape.contentRect.y + narrowLandscape.contentRect.height);
  }
});

test('GameRenderer draws the horizontal world without rotating the canvas', () => {
  const context = new MockContext({ nativeRoundRect: false });
  const canvas = makeCanvas(context);
  const level = MVP_LEVELS[0];
  const renderer = GameRenderer.fromCanvas(canvas, 667, 375, 1, {}, level);
  renderer.render(new GameSimulation(level, 23).snapshot(), level, { showControls: true });
  assert.equal(renderer.context.layout.orientation, 'landscape');
  assert.equal(context.operations.some(([name]) => name === 'rotate'), false);
});

test('MVP stations progress through the three carriage themes', () => {
  assert.deepEqual(CARRIAGE_THEMES, ['pearl', 'yellow', 'seafoam']);
  assert.deepEqual(MVP_LEVELS.map((level) => level.carriageTheme), ['pearl', 'yellow', 'seafoam']);
  assert.deepEqual(MVP_LEVELS.map((level) => level.doors.length), [1, 1, 2]);
});

test('carriage palettes stay distinct and legacy levels fall back safely', () => {
  const palettes = CARRIAGE_THEMES.map((theme) => stationColorsFor(theme));
  assert.equal(new Set(palettes.map((palette) => palette.trainShell)).size, 3);
  assert.equal(new Set(palettes.map((palette) => palette.trainStripe)).size, 3);
  assert.equal(stationColorsFor().trainShell, stationColorsFor(DEFAULT_CARRIAGE_THEME).trainShell);
  assert.equal(STATION_COLORS.trainShell, stationColorsFor(DEFAULT_CARRIAGE_THEME).trainShell);
  assert.equal(stationColorsFor().platform, '#9aafbd');
  assert.equal(stationColorsFor().platformEdge, '#c4d2d9');
  assert.equal(CARRIAGE_COLORS.pearl.trainShell, '#e7edf0');
  assert.equal(CARRIAGE_COLORS.yellow.trainShell, '#f1dda0');
  assert.equal(CARRIAGE_COLORS.seafoam.trainShell, '#2d6b6a');
});

test('MVP carriage bounds leave a taller upper stage above the platform', () => {
  for (const level of MVP_LEVELS) {
    assert.equal(level.trainBounds.height, 300, `${level.id} should use the 300px carriage bounds`);
    assert.equal(level.trainBounds.y + level.trainBounds.height, level.platformBounds.y);
  }
});

test('closed carriage doors hide interior passengers until they open', () => {
  const level = MVP_LEVELS[0];
  const simulation = new GameSimulation(level, 4242);
  const state = simulation.getState();
  const passenger = state.passengers.find((item) => item.role === 'alighting');
  assert.ok(passenger);
  passenger.kind = 'regular';
  passenger.position = { x: level.doors[0].center.x, y: level.trainBounds.y + 72 };
  for (const other of state.passengers) {
    if (other !== passenger) other.role = 'exited';
  }

  const context = new MockContext({ nativeRoundRect: false });
  const metrics = createViewportMetrics(375, 667);
  const renderContext = new RenderContext(context, metrics, {
    x: 0,
    y: level.trainBounds.y,
    width: 320,
    height: level.trainBounds.height + level.platformBounds.height,
  });
  const bodyWasDrawn = () => context.operations.some(([name, x, y]) =>
    name === 'translate' && x === passenger.position.x && y === passenger.position.y,
  );

  state.doors[0].open = false;
  state.doors[0].blocked = false;
  renderActors(renderContext, state, level);
  assert.equal(bodyWasDrawn(), false);

  context.operations.length = 0;
  state.doors[0].open = true;
  renderActors(renderContext, state, level);
  assert.equal(bodyWasDrawn(), true);

  context.operations.length = 0;
  state.doors[0].blocked = true;
  renderActors(renderContext, state, level);
  assert.equal(bodyWasDrawn(), false);
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

test('roundRect falls back when a partially exposed native method throws', () => {
  const context = new MockContext({ throwingRoundRect: true });
  fillRoundRect(context, 4, 6, 30, 20, 8, '#fff');
  assert.ok(context.operations.some(([name]) => name === 'quadraticCurveTo'));
  assert.ok(context.operations.some(([name]) => name === 'fill'));

  const canvas = makeCanvas(context);
  const renderer = GameRenderer.fromCanvas(canvas, 375, 667, 1, {}, MVP_LEVELS[0]);
  const state = new GameSimulation(MVP_LEVELS[0], 7).snapshot();
  renderer.render(state, MVP_LEVELS[0], { screen: 'route', levels: MVP_LEVELS });
  assert.ok(context.operations.some(([name, text]) => name === 'fillText' && text === '1. 海风门'));
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
  renderer.render(state, level, {
    screen: 'route',
    levels: [],
    unlockedLevelIds: ['sea-gate'],
  });

  const names = context.operations.map(([name]) => name);
  assert.ok(names.includes('fillRect'));
  assert.ok(names.includes('strokeRect'));
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

test('M8 visual sample emits depth and character primitives', () => {
  const context = new MockContext({ nativeRoundRect: false });
  const canvas = makeCanvas(context);
  const level = MVP_LEVELS[1];
  const simulation = new GameSimulation(level, 31415);
  const state = simulation.getState();
  state.elapsed = 1.35;
  state.phase = 'boarding';

  const renderer = GameRenderer.fromCanvas(canvas, 375, 667, 1, {}, level);
  renderer.render(state, level, { showControls: false });

  const names = context.operations.map(([name]) => name);
  assert.ok(names.filter((name) => name === 'ellipse').length >= 2);
  assert.equal(names.includes('rotate'), false);
  assert.ok(names.filter((name) => name === 'roundRect' || name === 'quadraticCurveTo').length >= 8);
  assert.ok(names.filter((name) => name === 'lineTo').length >= 20);
});

test('each NPC kind renders an independent silhouette', () => {
  const kinds = ['regular', 'fast', 'slow', 'luggage', 'phone', 'group'];
  const silhouettes = kinds.map((kind) => NPC_VISUAL_PROFILES[kind].silhouette);
  assert.equal(new Set(silhouettes).size, kinds.length);

  const signatures = kinds.map((kind) => {
    const context = new MockContext({ nativeRoundRect: false });
    const metrics = createViewportMetrics(375, 667);
    const renderContext = new RenderContext(context, metrics, { x: 0, y: -160, width: 320, height: 728 });
    const simulation = new GameSimulation(MVP_LEVELS[2], 9090);
    const state = simulation.getState();
    state.phase = 'exiting';
    const target = state.passengers[0];
    assert.ok(target);
    target.kind = kind;
    target.role = 'waiting';
    target.position = { x: 160, y: 220 };
    for (const passenger of state.passengers.slice(1)) passenger.role = 'exited';
    renderActors(renderContext, state, MVP_LEVELS[2]);
    return context.operations
      .filter(([name]) => name !== 'save' && name !== 'restore')
      .map(([name, ...args]) => `${name}:${args.join(',')}`)
      .join('|');
  });

  assert.equal(new Set(signatures).size, kinds.length, 'NPC silhouettes should not collapse to one shared drawing');
});

test('player Sprite loads asynchronously, switches frames, and keeps geometry fallback', () => {
  const context = new MockContext({ nativeRoundRect: false });
  const canvas = makeCanvas(context);
  const image = {
    src: '',
    width: 0,
    height: 0,
    complete: false,
    onload: undefined,
    onerror: undefined,
  };
  const level = MVP_LEVELS[0];
  const simulation = new GameSimulation(level, 8080);
  const state = simulation.getState();
  state.elapsed = 1;
  state.player.velocity = { x: state.player.speed, y: 0 };
  state.events.push({ type: 'guide', at: 1, detail: state.passengers[0]?.id });
  const renderer = GameRenderer.fromCanvas(canvas, 667, 375, 1, {}, level, {
    imageFactory: () => image,
  });
  assert.equal(image.src, 'assets/generated/tideline-player-sprite.png');
  image.onload?.();
  renderer.render(state, level, { showControls: false });
  const firstSprite = context.operations.find(([name]) => name === 'drawImage');
  assert.ok(firstSprite);
  assert.equal(firstSprite[1], image);
  assert.equal(firstSprite[2], 192, 'guide action should use the waving frame');

  state.events = [];
  state.elapsed = 1.2;
  renderer.render(state, level, { showControls: false });
  const secondSprite = context.operations.filter(([name]) => name === 'drawImage').at(-1);
  assert.ok(secondSprite);
  assert.notEqual(secondSprite[2], firstSprite[2], 'walking should advance the sprite frame');

  image.onerror?.();
  renderer.render(state, level, { showControls: false });
  const spriteCallsAfterFailure = context.operations.filter(([name]) => name === 'drawImage').length;
  assert.equal(spriteCallsAfterFailure, 2, 'failed image decoding should use geometry fallback');
});

test('regular passenger Sprite loads, animates movement/guide, and falls back on decode failure', () => {
  const image = {
    src: '',
    width: 0,
    height: 0,
    complete: false,
    onload: undefined,
    onerror: undefined,
  };
  const sprite = loadPassengerRegularSprite(() => image);
  assert.ok(sprite);
  assert.equal(image.src, 'assets/generated/tideline-passenger-regular-sprite.png');
  assert.deepEqual(sprite.frames.map((frame) => frame.sx), [0, 64, 128, 192]);
  image.onload?.();

  const context = new MockContext({ nativeRoundRect: false });
  const metrics = createViewportMetrics(375, 667);
  const renderContext = new RenderContext(context, metrics, {
    x: 0,
    y: -300,
    width: 320,
    height: 868,
  });
  const level = MVP_LEVELS[0];
  const state = new GameSimulation(level, 6161).getState();
  state.phase = 'exiting';
  const target = state.passengers[0];
  assert.ok(target);
  target.kind = 'regular';
  target.role = 'waiting';
  target.position = { x: 160, y: 220 };
  target.guidedUntil = 0;
  for (const passenger of state.passengers.slice(1)) passenger.role = 'exited';

  renderActors(renderContext, state, level, undefined, sprite);
  const idleDraw = context.operations.find(([name]) => name === 'drawImage');
  assert.ok(idleDraw);
  assert.equal(idleDraw[1], image);
  assert.equal(idleDraw[2], 0);

  context.operations.length = 0;
  target.role = 'boarding';
  state.doors[0].open = true;
  state.doors[0].blocked = false;
  state.elapsed = 0.2;
  renderActors(renderContext, state, level, undefined, sprite);
  const walkingDraw = context.operations.find(([name]) => name === 'drawImage');
  assert.ok(walkingDraw);
  assert.ok([64, 128].includes(walkingDraw[2]), 'boarding should use a walking frame');

  context.operations.length = 0;
  target.role = 'waiting';
  target.guidedUntil = state.elapsed + 0.4;
  renderActors(renderContext, state, level, undefined, sprite);
  const guideDraw = context.operations.find(([name]) => name === 'drawImage');
  assert.ok(guideDraw);
  assert.equal(guideDraw[2], 192, 'guided passenger should use the wave frame');
  assert.equal(guideDraw[3], 0, 'regular passenger should use the first atlas row');

  context.operations.length = 0;
  target.kind = 'fast';
  target.guidedUntil = 0;
  const atlasImage = {
    src: '',
    width: 0,
    height: 0,
    complete: false,
    onload: undefined,
    onerror: undefined,
  };
  const atlasSprite = loadPassengerAtlasSprite(() => atlasImage);
  assert.ok(atlasSprite);
  atlasImage.onload?.();
  renderActors(renderContext, state, level, undefined, sprite, atlasSprite);
  const fastDraw = context.operations.find(([name]) => name === 'drawImage');
  assert.ok(fastDraw);
  assert.equal(fastDraw[3], 64, 'fast passenger should use the second atlas row');

  context.operations.length = 0;
  const fastImage = {
    src: '',
    width: 0,
    height: 0,
    complete: false,
    onload: undefined,
    onerror: undefined,
  };
  const fastSprite = loadPassengerFastSprite(() => fastImage);
  assert.ok(fastSprite);
  fastImage.onload?.();
  renderActors(renderContext, state, level, undefined, sprite, undefined, fastSprite);
  const dedicatedFastDraw = context.operations.find(([name]) => name === 'drawImage');
  assert.ok(dedicatedFastDraw);
  assert.equal(dedicatedFastDraw[1], fastImage, 'fast passenger should use the dedicated PNG when ready');
  assert.equal(dedicatedFastDraw[3], 0, 'dedicated fast PNG is a single row');
  context.operations.length = 0;
  fastImage.onerror?.();
  renderActors(renderContext, state, level, undefined, sprite, atlasSprite, fastSprite);
  const fallbackFastDraw = context.operations.find(([name]) => name === 'drawImage');
  assert.ok(fallbackFastDraw);
  assert.equal(fallbackFastDraw[1], atlasImage, 'failed dedicated fast Sprite should fall back to atlas');
  assert.equal(fallbackFastDraw[3], 64, 'fallback fast passenger should keep the second atlas row');

  context.operations.length = 0;
  image.onerror?.();
  renderActors(renderContext, state, level, undefined, sprite);
  assert.equal(context.operations.some(([name]) => name === 'drawImage'), false);
  assert.ok(context.operations.some(([name]) => name === 'roundRect' || name === 'quadraticCurveTo'));
});

test('passenger body is translated to its world position', () => {
  const context = new MockContext({ nativeRoundRect: false });
  const canvas = makeCanvas(context);
  const level = MVP_LEVELS[0];
  const simulation = new GameSimulation(level, 2718);
  const state = simulation.getState();
  state.phase = 'exiting';
  const target = state.passengers[0];
  assert.ok(target);
  const position = { x: 211.25, y: 301.75 };
  target.position = position;
  target.role = 'waiting';
  target.kind = 'regular';
  for (const passenger of state.passengers.slice(1)) passenger.role = 'exited';

  const renderer = GameRenderer.fromCanvas(canvas, 375, 667, 1, {}, level);
  renderer.render(state, level, { showControls: false });

  assert.ok(context.operations.some(([name, x, y]) =>
    name === 'translate' && x === position.x && y === position.y,
  ));
});

test('passenger rendering has no continuous target-direction overlay', () => {
  const source = readFileSync(new URL('../src/render/actor-renderer.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /drawDirectionHint|drawSpeedTrails/);
  assert.doesNotMatch(source, /distance\(passenger\.position, passenger\.target\)/);
});

test('下车乘客穿过门洞后仍参与站台人流', () => {
  const context = new MockContext({ nativeRoundRect: false });
  const metrics = createViewportMetrics(375, 667);
  const renderContext = new RenderContext(context, metrics, { x: 0, y: -160, width: 320, height: 728 });
  const simulation = new GameSimulation(MVP_LEVELS[0], 4242);
  const state = simulation.getState();
  state.phase = 'exiting';
  const target = state.passengers.find((item) => item.role === 'alighting');
  assert.ok(target);
  target.role = 'alighting';
  target.routeProgress = 1;
  target.doorId = 'a';
  target.desiredDoorId = 'a';
  target.position = { x: 160, y: 240 };
  target.target = { x: 160, y: 500 };
  const door = state.doors.find((item) => item.id === 'a');
  assert.ok(door);
  door.open = true;
  door.blocked = true;
  for (const passenger of state.passengers) {
    if (passenger.id !== target.id) passenger.role = 'exited';
  }
  renderActors(renderContext, state, MVP_LEVELS[0]);
  assert.ok(context.operations.some(([name, x, y]) => name === 'translate' && x === 160 && y === 240));
});
