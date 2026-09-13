import { GameRuntime } from '../../src/runtime/game-runtime.ts';
import { emptySave, serializeSave } from '../../src/core/save-schema.ts';
import { DEFAULT_SAVE_KEY } from '../../src/platform/wx/storage.ts';
import { itemHitAreas } from '../../src/render/item-ui.ts';

export class MockContext {
  operations = [];
  fillStyle = '#000'; strokeStyle = '#000'; lineWidth = 1; globalAlpha = 1;
  font = ''; textAlign = 'left'; textBaseline = 'middle';
  save() {} restore() {} translate() {} scale() {} rotate() {} beginPath() {} closePath() {}
  moveTo() {} lineTo() {} quadraticCurveTo() {} arc() {} ellipse() {} rect() {} fill() {} stroke() {}
  fillRect() {} strokeRect() {} clearRect() {} setLineDash() {} setTransform() {} roundRect() {}
  fillText(...args) { this.operations.push(args); } strokeText() {}
  measureText(text) { return { width: text.length * 8 }; }
}

export function createHarness(options = {}) {
  const context = new MockContext();
  const canvas = { width: 0, height: 0, getContext: () => context };
  const listeners = {};
  const storage = new Map();
  if (options.save) storage.set(DEFAULT_SAVE_KEY, serializeSave(options.save));
  else if (options.fresh === false) storage.set(DEFAULT_SAVE_KEY, serializeSave(emptySave()));
  const adClose = new Set(); const adError = new Set();
  const writes = []; let failWrites = false; let failReads = false; let clock = 0;
  const ad = {
    loads: 0, shows: 0,
    async load() { this.loads++; }, async show() { this.shows++; },
    onClose: (fn) => adClose.add(fn), offClose: (fn) => adClose.delete(fn),
    onError: (fn) => adError.add(fn), offError: (fn) => adError.delete(fn),
    close: (res) => [...adClose].forEach((fn) => fn(res)),
    error: () => [...adError].forEach((fn) => fn({})), destroy() {},
  };
  const shares = [];
  const wx = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ windowWidth: options.width ?? 667, windowHeight: options.height ?? 375, pixelRatio: options.dpr ?? 1, safeArea: options.safeArea }),
    getStorageSync: (key) => { if (failReads) throw Error('read'); return storage.get(key); },
    setStorageSync: (key, value) => { if (failWrites) throw Error('write'); storage.set(key, value); writes.push(value); },
    removeStorageSync: (key) => storage.delete(key),
    shareAppMessage: (request) => shares.push(request),
    createRewardedVideoAd: () => ad,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  };
  for (const name of ['Show', 'Hide', 'TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Error', 'UnhandledRejection']) {
    wx[`on${name}`] = (fn) => { listeners[name] = fn; };
    wx[`off${name}`] = () => { delete listeners[name]; };
  }
  const runtime = new GameRuntime(wx, { rewardedAdUnitId: options.adUnitId ?? 'adunit-test', now: () => clock, levels: options.levels });
  runtime.start();
  return {
    runtime, wx, context, storage, writes, listeners, shares, ad, adClose,
    failWrites: (value) => { failWrites = value; }, failReads: (value) => { failReads = value; },
    elapse: (ms) => { clock += ms; },
    tap(action) {
      const areas = itemHitAreas(runtime.renderer.context.layout, runtime.screen, runtime.state ?? {}, runtime.getItemUi(), runtime.paused);
      const rect = areas.find((entry) => entry.id === action)?.rect;
      if (!rect) throw Error(`No item action: ${action}`);
      runtime.input.handleTouchStart({ changedTouches: [{ identifier: 42, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }] });
      runtime.tick(1 / 60);
      runtime.input.handleTouchEnd({ touches: [], changedTouches: [{ identifier: 42 }] });
    },
  };
}

export function startBoarding(runtime) {
  runtime.startLevel('sea-gate'); runtime.confirmStart();
  for (let i = 0; i < 500 && runtime.state.phase !== 'boarding'; i++) runtime.tick(1 / 30);
  if (runtime.state.phase !== 'boarding') throw Error('boarding phase not reached');
}
