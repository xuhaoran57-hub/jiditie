import test from 'node:test';
import assert from 'node:assert/strict';
import { WxRewardedAdAdapter } from '../src/platform/wx/rewarded-ad.ts';
import { createHarness } from './helpers/item-harness.mjs';
import { GameRuntime } from '../src/runtime/game-runtime.ts';
import { DEFAULT_SAVE_KEY } from '../src/platform/wx/storage.ts';
import { emptySave, serializeSave } from '../src/core/save-schema.ts';

test('首次进入各发一件并提示局内使用，关闭与重启不重复发放', () => {
  const h = createHarness();
  assert.equal(h.runtime.getItemUi().panel, 'welcome');
  assert.equal(h.writes.length, 0, '首屏提交前不写入欢迎礼包');
  h.runtime.tick(0);
  assert.deepEqual(h.runtime.saveData.items.inventory, { 'commute-horn': 1, 'delay-ticket': 1 });
  h.tap('close'); assert.equal(h.runtime.getItemUi().panel, null); h.runtime.destroy();
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
  const wait = h.runtime.requestReward('rewarded-ad'); h.failWrites(true); h.ad.close({ isEnded: true }); await wait;
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

test('读取仍不可用时不调起广告或分享，也不覆盖原存档', async (t) => {
  const h = createHarness({ fresh: false }); h.runtime.destroy();
  const original = h.storage.get(DEFAULT_SAVE_KEY);
  h.failReads(true);
  const runtime = new GameRuntime(h.wx); t.after(() => runtime.destroy());
  runtime.openSupply();
  const watch = runtime.requestReward('rewarded-ad'); h.ad.close({ isEnded: false }); await watch;
  await runtime.requestReward('share-participation');
  assert.equal(h.ad.shows, 0);
  assert.equal(h.shares.length, 0);
  assert.equal(runtime.getItemUi().status, 'idle');
  assert.match(runtime.getItemUi().message, /存档/);
  assert.equal(h.storage.get(DEFAULT_SAVE_KEY), original);
});

test('重读保留历史库存并合并临时成绩，领奖保存失败后可重试且不重复发奖', async (t) => {
  const save = emptySave();
  save.items.inventory = { 'commute-horn': 3, 'delay-ticket': 5 };
  save.items.welcomeGiftStatus = 'granted';
  save.items.recentGrantedRequestIds = ['old-reward'];
  save.unlockedLevelIds.push('cloud-harbor');
  save.bestScores = { 'sea-gate': 88, 'cloud-harbor': 90 };
  save.bestStars = { 'sea-gate': 2, 'cloud-harbor': 3 };
  save.unassisted.bestScores = { 'cloud-harbor': 90 };
  save.unassisted.bestStars = { 'cloud-harbor': 3 };
  save.endlessUnlocked = true; save.endlessBestWave = 8; save.endlessBestScore = 89;
  save.unassisted.endlessBestWave = 7; save.unassisted.endlessBestScore = 85;
  save.achievements = ['clear:sea-gate', 'clear:cloud-harbor'];
  save.appearanceId = 'seafoam';
  save.settings = { soundEnabled: false, musicEnabled: false, vibrationEnabled: false };
  save.stats = { plays: 20, clears: 6, totalGuides: 30 };
  const h = createHarness({ save }); h.runtime.destroy(); h.failReads(true);
  const runtime = new GameRuntime(h.wx); t.after(() => runtime.destroy());
  runtime.setSoundEnabled(true);
  runtime.startLevel('sea-gate'); runtime.confirmStart();
  const state = runtime.state;
  state.phase = 'result'; state.outcome = 'success'; state.metrics.guideUses = 2;
  state.score = { total: 92, stars: 3, success: true, medal: 'gold', efficiency: 90, courtesy: 90, stamina: 90 };
  runtime.tick(0);
  assert.equal(h.storage.get(DEFAULT_SAVE_KEY), serializeSave(save));

  h.failReads(false); runtime.openSupply('delay-ticket');
  assert.deepEqual(runtime.saveData.items.inventory, save.items.inventory);
  assert.deepEqual(runtime.saveData.stats, { plays: 21, clears: 7, totalGuides: 32 });
  assert.deepEqual(runtime.saveData.bestScores, { 'sea-gate': 92, 'cloud-harbor': 90 });
  assert.deepEqual(runtime.saveData.bestStars, { 'sea-gate': 3, 'cloud-harbor': 3 });
  assert.deepEqual(runtime.saveData.unassisted.bestScores, { 'cloud-harbor': 90, 'sea-gate': 92 });
  assert.deepEqual(runtime.saveData.unassisted.bestStars, { 'cloud-harbor': 3, 'sea-gate': 3 });
  assert.equal(runtime.saveData.endlessBestWave, 8);
  assert.equal(runtime.saveData.unassisted.endlessBestWave, 7);
  assert.ok(runtime.saveData.unlockedLevelIds.includes('cloud-harbor'));
  assert.ok(runtime.saveData.unlockedLevelIds.includes('lighthouse-bay'));
  assert.ok(runtime.saveData.achievements.includes('clear:cloud-harbor'));
  assert.equal(runtime.saveData.appearanceId, 'seafoam');
  assert.deepEqual(runtime.saveData.settings, { soundEnabled: true, musicEnabled: false, vibrationEnabled: false });
  assert.equal(runtime.audio.settings.musicEnabled, false);

  const watch = runtime.requestReward('rewarded-ad');
  h.failWrites(true); h.ad.close({ isEnded: true }); await watch;
  assert.equal(runtime.getItemUi().status, 'save-error');
  h.failWrites(false); runtime['handleItemAction']('save-retry');
  assert.equal(runtime.getItemUi().status, 'granted');
  assert.equal(runtime.saveData.items.inventory['delay-ticket'], 6);
  assert.equal(runtime.saveData.items.inventory['commute-horn'], 3);
  assert.ok(runtime.saveData.items.recentGrantedRequestIds.includes('old-reward'));
  runtime['handleItemAction']('save-retry');
  assert.equal(h.ad.shows, 1);
  assert.equal(runtime.saveData.items.inventory['delay-ticket'], 6);
  const reloaded = new GameRuntime(h.wx); t.after(() => reloaded.destroy());
  assert.deepEqual(reloaded.saveData, runtime.saveData);
});

test('确认恢复后存档缺失才补发首礼，反复打开与重启只发一次', (t) => {
  const h = createHarness({ fresh: false }); h.runtime.destroy(); h.storage.clear(); h.failReads(true);
  const runtime = new GameRuntime(h.wx); t.after(() => runtime.destroy());
  runtime.openSupply();
  assert.equal(runtime.saveData.items.welcomeGiftStatus, 'ineligible');
  assert.equal(runtime.saveData.items.inventory['delay-ticket'], 0);
  h.failReads(false); runtime.openSupply();
  assert.equal(runtime.getItemUi().panel, 'welcome');
  assert.deepEqual(runtime.saveData.items.inventory, { 'commute-horn': 1, 'delay-ticket': 1 });
  runtime.openSupply(); runtime.openSupply();
  const reloaded = new GameRuntime(h.wx); t.after(() => reloaded.destroy());
  assert.deepEqual(reloaded.saveData.items.inventory, { 'commute-horn': 1, 'delay-ticket': 1 });
});

test('重读发现未来版本仍保护原文件并拦截领取', async (t) => {
  for (const failFirstRead of [false, true]) {
    const h = createHarness({ fresh: false }); h.runtime.destroy();
    const future = JSON.stringify({ version: 999, valuableProgress: 42 });
    h.storage.set(DEFAULT_SAVE_KEY, future); h.failReads(failFirstRead);
    const runtime = new GameRuntime(h.wx); t.after(() => runtime.destroy());
    h.failReads(false);
    runtime.startLevel('sea-gate'); runtime.confirmStart();
    runtime.openSupply();
    const watch = runtime.requestReward('rewarded-ad'); h.ad.close({ isEnded: false }); await watch;
    await runtime.requestReward('share-participation');
    assert.equal(h.ad.shows, 0); assert.equal(h.shares.length, 0);
    assert.equal(h.storage.get(DEFAULT_SAVE_KEY), future);
  }
});

test('领取前保存检查失败不调起外部流程，写入恢复后可领取', async (t) => {
  const h = createHarness({ fresh: false }); t.after(() => h.runtime.destroy());
  h.runtime.openSupply('delay-ticket'); h.failWrites(true);
  const watch = h.runtime.requestReward('rewarded-ad'); h.ad.close({ isEnded: false }); await watch;
  await h.runtime.requestReward('share-participation');
  assert.equal(h.ad.shows, 0); assert.equal(h.shares.length, 0);
  assert.equal(h.runtime.getItemUi().status, 'idle');
  h.failWrites(false);
  await h.runtime.requestReward('share-participation');
  assert.equal(h.runtime.claimShare(), true);
  assert.equal(h.runtime.saveData.items.inventory['delay-ticket'], 1);
  assert.equal(h.runtime.claimShare(), false);
});

test('重读后的未完成使用在写入恢复后补偿一次', (t) => {
  const h = createHarness({ fresh: false }); h.runtime.destroy();
  const save = emptySave();
  save.items.pendingUse = { requestId: 'interrupted-use', itemId: 'delay-ticket', runId: 'old-run' };
  h.storage.set(DEFAULT_SAVE_KEY, serializeSave(save)); h.failReads(true);
  const runtime = new GameRuntime(h.wx); t.after(() => runtime.destroy());
  h.failReads(false); h.failWrites(true); runtime.openSupply();
  assert.equal(runtime.saveData.items.inventory['delay-ticket'], 0);
  h.failWrites(false); runtime.openSupply(); runtime.openSupply();
  assert.equal(runtime.saveData.items.inventory['delay-ticket'], 1);
  assert.equal(runtime.saveData.items.pendingUse, null);
  const reloaded = new GameRuntime(h.wx); t.after(() => reloaded.destroy());
  assert.equal(reloaded.saveData.items.inventory['delay-ticket'], 1);
});
