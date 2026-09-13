import test from 'node:test';
import assert from 'node:assert/strict';
import { WxRewardedAdAdapter } from '../src/platform/wx/rewarded-ad.ts';
import { createHarness } from './helpers/item-harness.mjs';
import { GameRuntime } from '../src/runtime/game-runtime.ts';
import { DEFAULT_SAVE_KEY } from '../src/platform/wx/storage.ts';

test('首次进入各发一件并展示背包，关闭与重启不重复发放', () => {
  const h = createHarness();
  assert.equal(h.runtime.getItemUi().panel, 'welcome');
  assert.deepEqual(h.runtime.saveData.items.inventory, { 'commute-horn': 1, 'delay-ticket': 1 });
  h.tap('inventory'); assert.equal(h.runtime.getItemUi().panel, 'inventory');
  h.tap('close'); h.runtime.destroy();
  const reloaded = new GameRuntime(h.wx);
  assert.deepEqual(reloaded.saveData.items.inventory, { 'commute-horn': 1, 'delay-ticket': 1 });
  assert.equal(reloaded.getItemUi().panel, null); reloaded.destroy();
});
test('读存档失败不发新手礼，首次赠送写失败后可重试', () => {
  const h = createHarness({ fresh: false }); h.runtime.destroy(); h.storage.clear(); h.failWrites(true);
  const runtime = new GameRuntime(h.wx);
  assert.equal(runtime.saveData.items.welcomeGiftStatus, 'eligible');
  assert.equal(runtime.saveData.items.inventory['commute-horn'], 0);
  h.failWrites(false); runtime['handleItemAction']('welcome-retry');
  assert.equal(runtime.saveData.items.inventory['commute-horn'], 1); runtime.destroy();
  h.failReads(true); const unreadable = new GameRuntime(h.wx);
  assert.equal(unreadable.saveData.items.welcomeGiftStatus, 'ineligible'); unreadable.destroy();
});
test('分享参与奖励可自选，普通切后台不发，取消后返回与手动领取不重复', async () => {
  const h = createHarness(); h.tap('close');
  h.listeners.Hide(); h.listeners.Show(); assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  h.runtime.openSupply('delay-ticket'); await h.runtime.requestReward('share-participation');
  assert.equal(h.shares.length, 1); h.listeners.Hide(); h.listeners.Show();
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 2);
  h.listeners.Show(); assert.equal(h.runtime.claimShare(), false);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 2);
  h.tap('close'); h.runtime.openSupply('commute-horn'); await h.runtime.requestReward('share-participation');
  h.tap('claim-share'); assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 2);
  assert.equal(h.runtime.getItemUi().status, 'granted'); h.runtime.destroy();
});
test('广告完整观看发奖，所选道具在开始后冻结，过期监听不重复发', async () => {
  const h = createHarness(); h.tap('close'); h.runtime.openSupply('delay-ticket');
  const watch = h.runtime.requestReward('rewarded-ad');
  const old = [...h.adClose][0];
  await h.runtime.requestReward('share-participation'); assert.equal(h.shares.length, 0);
  h.runtime['handleItemAction']('select:commute-horn');
  h.ad.close({ isEnded: true }); await watch;
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 2);
  assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 1);
  old({ isEnded: true }); assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 2);
  h.tap('close'); h.runtime.openSupply('commute-horn');
  const second = h.runtime.requestReward('rewarded-ad'); old({ isEnded: true });
  assert.equal(h.runtime.getItemUi().status, 'watching'); h.ad.close({ isEnded: true }); await second;
  assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 2); h.runtime.destroy();
});
test('广告提前关闭和缺少观看结果不发，保存失败只重试保存', async () => {
  const h = createHarness(); h.tap('close'); h.runtime.openSupply('commute-horn');
  for (const result of [{ isEnded: false }, undefined]) {
    const wait = h.runtime.requestReward('rewarded-ad'); h.ad.close(result); await wait;
    assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 1);
  }
  h.failWrites(true); const wait = h.runtime.requestReward('rewarded-ad'); h.ad.close({ isEnded: true }); await wait;
  assert.equal(h.runtime.getItemUi().status, 'save-error'); assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 1);
  const shows = h.ad.shows; h.tap('close'); h.runtime.openSupply('delay-ticket');
  await h.runtime.requestReward('share-participation'); assert.equal(h.shares.length, 0);
  h.failWrites(false); h.tap('save-retry');
  assert.equal(h.ad.shows, shows); assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 2);
  assert.equal(JSON.parse(h.storage.get(DEFAULT_SAVE_KEY)).items.inventory['commute-horn'], 2); h.runtime.destroy();
});
test('未配置广告位时分享仍可用，销毁后的广告回调无效', async () => {
  const h = createHarness({ adUnitId: '' }); h.tap('close'); h.runtime.openSupply();
  await h.runtime.requestReward('rewarded-ad'); assert.equal(h.runtime.getItemUi().status, 'idle');
  await h.runtime.requestReward('share-participation'); h.runtime.claimShare();
  assert.equal(h.runtime.saveData.items.inventory['commute-horn'], 2); h.runtime.destroy();
  const a = createHarness(); a.tap('close'); a.runtime.openSupply(); const wait = a.runtime.requestReward('rewarded-ad');
  const old = [...a.adClose][0]; a.runtime.destroy(); old({ isEnded: true }); await wait;
  assert.equal(a.runtime.saveData.items.inventory['commute-horn'], 1);
});
test('广告展示失败只重载一次，最终失败返回不可用', async () => {
  const h = createHarness(); h.runtime.destroy();
  h.ad.shows = 0; h.ad.loads = 0; h.ad.show = async () => { h.ad.shows++; throw Error('no fill'); };
  const adapter = new WxRewardedAdAdapter(h.wx, 'adunit-test');
  assert.equal(await adapter.watch(), 'unavailable'); assert.equal(h.ad.shows, 2); assert.equal(h.ad.loads, 2); adapter.destroy();
});

test('未来版本与临时读取失败不会被启动游戏覆盖存档', () => {
  const h = createHarness({ fresh: false }); h.runtime.destroy();
  const future = JSON.stringify({ version: 999, valuableProgress: 42 });
  h.storage.set(DEFAULT_SAVE_KEY, future);
  const runtime = new GameRuntime(h.wx); runtime.startLevel('sea-gate'); runtime.confirmStart();
  assert.equal(h.storage.get(DEFAULT_SAVE_KEY), future); runtime.destroy();
  h.failReads(true);
  const unreadable = new GameRuntime(h.wx); unreadable.startLevel('sea-gate'); unreadable.confirmStart();
  assert.equal(h.storage.get(DEFAULT_SAVE_KEY), future); unreadable.destroy();
});
