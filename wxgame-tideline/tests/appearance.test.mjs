import test from 'node:test';
import assert from 'node:assert/strict';
import { APPEARANCE_OPTIONS } from '../src/core/appearance.ts';
import { PlayerAppearanceSprites, recolorPlayerPixels } from '../src/render/player-appearance.ts';
import { PLAYER_SPRITE_FRAMES } from '../src/render/player-sprite.ts';
import { appearanceCardRect, createViewportMetrics } from '../src/render/context.ts';

test('外观只替换青色衣服，保留肤色、头发、透明度且配色不同', () => {
  const original = new Uint8ClampedArray([54, 200, 187, 255, 243, 197, 162, 255, 21, 44, 68, 255, 54, 200, 187, 0]);
  const signatures = new Set();
  for (const id of ['default', 'seafoam', 'sunset', 'night']) {
    const pixels = original.slice();
    recolorPlayerPixels(pixels, id);
    assert.deepEqual(pixels.slice(3), original.slice(3));
    signatures.add(String(pixels.slice(0, 3)));
  }
  assert.equal(signatures.size, 4);
});

test('外观在原图就绪后缓存独立图集，保留全部动作帧且不改写原图', () => {
  let created = 0;
  const writes = [];
  const source = { image: {}, frames: PLAYER_SPRITE_FRAMES, frameDuration: 0.1, ready: false, failed: false };
  const cache = new PlayerAppearanceSprites(() => {
    created++;
    return { width: 0, height: 0, getContext: () => ({
      drawImage: (image) => assert.equal(image, source.image),
      getImageData: () => ({ data: new Uint8ClampedArray([54, 200, 187, 255]), width: 1, height: 1 }),
      putImageData: (pixels) => writes.push([...pixels.data]),
    }) };
  });
  assert.equal(cache.get(source, 'sunset'), undefined);
  assert.equal(created, 0);
  source.ready = true;
  const orange = cache.get(source, 'sunset');
  assert.equal(cache.get(source, 'sunset'), orange);
  assert.equal(created, 1);
  assert.equal(orange.frames, source.frames);
  assert.equal(orange.frameDuration, source.frameDuration);
  assert.notEqual(orange.image, source.image);
  assert.equal(cache.get(source, 'default'), source);
  const blue = cache.get(source, 'night');
  assert.notEqual(blue.image, orange.image);
  assert.notDeepEqual(writes[0], writes[1]);
});

test('外观像素接口缺失或失败时安全回退，不每帧重试', () => {
  const source = { image: {}, frames: PLAYER_SPRITE_FRAMES, frameDuration: 0.1, ready: true, failed: false };
  assert.equal(new PlayerAppearanceSprites().get(source, 'sunset'), undefined);
  let attempts = 0;
  const cache = new PlayerAppearanceSprites(() => { attempts++; throw new Error('unsupported'); });
  assert.equal(cache.get(source, 'night'), undefined);
  assert.equal(cache.get(source, 'night'), undefined);
  assert.equal(attempts, 1);
});

test('endless appearances keep the pixel sprite and use distinct palettes', () => {
  const source = { image: {}, frames: PLAYER_SPRITE_FRAMES, frameDuration: 0.1, ready: true, failed: false };
  const writes = [];
  const sprites = new PlayerAppearanceSprites(() => ({ width: 0, height: 0, getContext: () => ({
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray([54, 200, 187, 255]), width: 1, height: 1 }),
    putImageData: (pixels) => writes.push([...pixels.data]),
  }) }));
  const silver = sprites.get(source, 'endless5');
  const gold = sprites.get(source, 'endless15');
  assert.ok(silver);
  assert.ok(gold);
  assert.equal(silver.frames, source.frames);
  assert.notEqual(silver.image, source.image);
  assert.notDeepEqual(writes[0], writes[1]);
  assert.equal(sprites.get(source, 'default'), source);
});

test('endless accessories are composed into every animation frame once without changing the source', () => {
  const originalPixels = new Uint8ClampedArray([54, 200, 187, 255, 243, 197, 162, 255]);
  const image = Object.freeze({ width: 256, height: 64 });
  const source = Object.freeze({ image, frames: PLAYER_SPRITE_FRAMES, frameDuration: 0.1, ready: true, failed: false });
  const originalFrames = structuredClone(source.frames);

  for (const id of ['endless5', 'endless10', 'endless15', 'endless20']) {
    let allocations = 0, imageReads = 0, pixelReads = 0, pixelWrites = 0;
    let transform = { x: 0, y: 0, sx: 1, sy: 1 };
    const stack = [], fills = [];
    let path = [];
    const context = {
      drawImage(value) { assert.equal(value, image); imageReads++; },
      getImageData() { pixelReads++; return { data: originalPixels.slice(), width: 2, height: 1 }; },
      putImageData() { pixelWrites++; },
      save() { stack.push({ ...transform }); },
      restore() { transform = stack.pop(); },
      translate(x, y) { transform.x += x * transform.sx; transform.y += y * transform.sy; },
      scale(x, y) { transform.sx *= x; transform.sy *= y; },
      beginPath() { path = []; },
      moveTo(x, y) { path.push([transform.x + x * transform.sx, transform.y + y * transform.sy]); },
      lineTo(x, y) { this.moveTo(x, y); },
      closePath() {},
      fill() { fills.push([...path]); },
      stroke() {},
    };
    const canvas = { width: 0, height: 0, getContext: () => context };
    const sprites = new PlayerAppearanceSprites(() => { allocations++; return canvas; });
    const composed = sprites.get(source, id);
    assert.ok(composed, id);
    assert.equal(composed.accessoryId, id);
    assert.equal(composed.frames, source.frames);
    assert.equal(composed.frameDuration, source.frameDuration);
    assert.notEqual(composed.image, source.image);
    for (const frame of source.frames) {
      assert.ok(fills.some((points) => points.length > 0 && points.every(([x, y]) =>
        x >= frame.sx && x <= frame.sx + frame.width && y >= frame.sy && y <= frame.sy + frame.height)),
      `${id} decorates the frame at ${frame.sx}`);
    }
    const paintedShapes = fills.length;
    for (let frame = 0; frame < 12; frame++) assert.equal(sprites.get(source, id), composed);
    assert.deepEqual([allocations, imageReads, pixelReads, pixelWrites], [1, 1, 1, 1]);
    assert.equal(fills.length, paintedShapes, 'rendering later frames must reuse the decorated atlas');
    assert.equal(stack.length, 0);
  }
  assert.deepEqual(originalPixels, new Uint8ClampedArray([54, 200, 187, 255, 243, 197, 162, 255]));
  assert.deepEqual(source.frames, originalFrames);
  assert.equal(source.accessoryId, undefined);
});

test('accessory composition errors discard the partial atlas and are not retried every frame', () => {
  const source = Object.freeze({ image: {}, frames: PLAYER_SPRITE_FRAMES, frameDuration: 0.1, ready: true, failed: false });
  let allocations = 0, strokes = 0;
  const sprites = new PlayerAppearanceSprites(() => {
    allocations++;
    return { width: 0, height: 0, getContext: () => ({
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray([54, 200, 187, 255]), width: 1, height: 1 }),
      putImageData() {},
      save() {}, restore() {}, translate() {}, scale() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fill() {},
      stroke() { strokes++; throw new Error('offscreen stroke unsupported'); },
    }) };
  });
  assert.equal(sprites.get(source, 'endless15'), undefined, 'a partially decorated atlas must not be displayed');
  assert.equal(strokes, 1, 'the failure occurs while composing accessories after recoloring');
  for (let frame = 0; frame < 12; frame++) assert.equal(sprites.get(source, 'endless15'), undefined);
  assert.equal(allocations, 1);
  assert.equal(strokes, 1);
  assert.equal(source.accessoryId, undefined);
  assert.equal(sprites.get(source, 'default'), source);
});

test('外观预览卡片在窄横屏和竖屏安全区内完整排列且不重叠', () => {
  for (const [width, height] of [[480, 320], [667, 375], [375, 667]]) {
    const viewport = createViewportMetrics(width, height, 2, { left: 10, right: 10, top: 8, bottom: 12 });
    const cards = APPEARANCE_OPTIONS.map((_, i) => appearanceCardRect(viewport, i));
    const content = viewport.contentRect;
    for (const card of cards) {
      assert.ok(card.width > 0 && card.height > 0, '所有已配置外观都应有可见卡片');
      assert.ok(card.x >= content.x && card.y >= content.y + 90);
      assert.ok(card.x + card.width <= content.x + content.width);
      assert.ok(card.y + card.height <= content.y + content.height);
    }
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
  }
});
