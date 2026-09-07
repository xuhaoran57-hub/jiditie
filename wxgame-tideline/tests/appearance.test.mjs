import test from 'node:test';
import assert from 'node:assert/strict';
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

test('外观预览卡片在窄横屏和竖屏安全区内完整排列且不重叠', () => {
  for (const [width, height] of [[480, 320], [667, 375], [375, 667]]) {
    const viewport = createViewportMetrics(width, height, 2, { left: 10, right: 10, top: 8, bottom: 12 });
    const cards = Array.from({ length: 4 }, (_, i) => appearanceCardRect(viewport, i));
    const content = viewport.contentRect;
    for (const card of cards) {
      assert.ok(card.height >= 70);
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
