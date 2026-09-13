import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation, MVP_LEVELS, PhaseMachine } from '../src/core/index.ts';
import { emptySave, migrateSave, parseSave, serializeSave, updateBestScore } from '../src/core/save-schema.ts';
import { WxStorageAdapter } from '../src/platform/wx/storage.ts';
import { RewardService } from '../src/runtime/reward-service.ts';

const counts = { 'commute-horn': 0, 'delay-ticket': 0 };
function boarding() {
  const level = structuredClone(MVP_LEVELS[0]); level.events = []; level.passenger.count = 0; level.passenger.alightingCount = 0;
  const sim = new GameSimulation(level, 7);
  for (let i = 0; i < 500 && sim.phase !== 'boarding'; i++) sim.step(1 / 30);
  return sim;
}
function putCrowd(sim) {
  const state = sim.getState(); state.player.position = { x: 160, y: 250 }; state.player.facing = { x: 0, y: -1 };
  state.passengers = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, kind: 'regular', role: 'waiting', emotion: 'calm',
    position: { x: 150 + i * 4, y: 210 - i * 3 }, target: { x: 160, y: 0 }, velocity: { x: 0, y: 0 }, radius: 5, weight: 1,
    speed: 50, desiredDoorId: sim.level.doors[0].id, routeProgress: 0, guidedUntil: 0 }));
}

test('喇叭最多影响四人，绕过体力和普通冷却，每局只能一次', () => {
  const sim = boarding(); putCrowd(sim); const state = sim.getState(); state.player.stamina = 1; state.player.abilityCooldown = 0.8;
  assert.equal(sim.useItem('commute-horn').used, true);
  assert.equal(state.passengers.filter((p) => p.guidedUntil > 0).length, 4);
  assert.equal(state.player.stamina, 1); assert.equal(state.player.abilityCooldown, 0.8);
  assert.equal(state.metrics.guideUses, 1); assert.equal(state.metrics.staminaSpent, 0);
  assert.equal(state.events.filter((e) => e.type === 'item-horn').length, 1);
  assert.deepEqual(sim.useItem('commute-horn'), { used: false, reason: 'limit' });
});
test('无目标和无效阶段拒绝喇叭，普通疏导仍最多两人', () => {
  const sim = boarding(); assert.deepEqual(sim.useItem('commute-horn'), { used: false, reason: 'no-target' });
  assert.deepEqual(sim.getState().itemUses, counts); putCrowd(sim);
  assert.equal(sim.useGuide().affectedPassengerIds.length, 2);
  assert.equal(new GameSimulation().useItem('commute-horn').reason, 'phase');
});
test('延时准确加三秒、退出警告，不回退事件或随机数，结束后不能续命', () => {
  const sim = boarding();
  while (sim.phase !== 'warning') sim.step(1 / 30);
  const before = sim.snapshot();
  assert.equal(sim.useItem('delay-ticket').used, true);
  const after = sim.snapshot();
  assert.ok(Math.abs(after.doorRemaining - before.doorRemaining - 3) < 1e-8);
  assert.equal(after.phase, 'boarding'); assert.equal(after.elapsed, before.elapsed); assert.equal(after.rngState, before.rngState);
  assert.deepEqual(after.passengers, before.passengers);
  assert.equal(sim.useItem('delay-ticket').reason, 'limit');
  while (sim.phase !== 'warning') sim.step(1 / 30);
  sim.runUntilResult(); const result = sim.snapshot();
  assert.equal(sim.useItem('delay-ticket').used, false); assert.deepEqual(sim.snapshot(), result);
});
test('延时接口拒绝零、负数和非有限值', () => {
  const machine = new PhaseMachine({ phaseDurations: { intro: 0, arriving: 0, positioning: 0, exiting: 0 }, boardingDuration: 8, warningThreshold: 2 });
  machine.update(0.1, false); const before = machine.snapshot();
  for (const amount of [0, -3, Infinity, NaN]) assert.equal(machine.extendBoarding(amount), false);
  assert.deepEqual(machine.snapshot(), before);
});

test('延时不重开提前关闭的门，喇叭侧移不穿过封闭车门', () => {
  const level = structuredClone(MVP_LEVELS[2]);
  level.events = [{ id: 'early', kind: 'door-close', at: 0.05, duration: 0.5, warningDuration: 0.1,
    label: '封门', description: '测试', fromDoorId: level.doors[0].id, toDoorId: level.doors[1].id }];
  const sim = new GameSimulation(level, 5);
  for (let i = 0; i < 500 && sim.phase !== 'boarding'; i++) sim.step(1 / 30);
  const blockedIds = sim.getState().doors.filter((d) => d.blocked).map((d) => d.id);
  assert.equal(blockedIds.length, 1); sim.useItem('delay-ticket'); sim.step(1 / 30);
  assert.deepEqual(sim.getState().doors.filter((d) => d.blocked).map((d) => d.id), blockedIds);
  const horn = boarding(); putCrowd(horn); const state = horn.getState();
  state.player.position = { x: 160, y: 5 }; state.player.facing = { x: 1, y: 0 };
  state.doors.forEach((d) => { d.open = false; d.blocked = true; });
  state.passengers.forEach((p, i) => { p.position = { x: 180 + i * 8, y: 5 }; });
  horn.useItem('commute-horn'); assert.ok(state.passengers.every((p) => p.position.y >= 0));
});
test('道具输入保持确定性，和普通疏导同一步只触发喇叭', () => {
  const a = boarding(); const b = boarding(); putCrowd(a); putCrowd(b);
  for (const sim of [a, b]) {
    sim.step(1 / 30, { useItem: 'commute-horn', useGuide: true });
    sim.step(1 / 30, { useItem: 'delay-ticket' });
    sim.runUntilResult();
  }
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.equal(a.getState().metrics.guideUses, 1);
});
test('v3 成绩迁移为无道具纪录，v4 库存清洗后可往返且更新成绩不会丢失', () => {
  const legacy = migrateSave({ version: 3, bestScores: { 'sea-gate': 86 }, bestStars: { 'sea-gate': 3 }, endlessBestWave: 4 });
  assert.equal(legacy.version, 4); assert.deepEqual(legacy.items.inventory, counts);
  assert.equal(legacy.items.welcomeGiftStatus, 'ineligible'); assert.equal(legacy.unassisted.bestScores['sea-gate'], 86);
  assert.equal(legacy.unassisted.endlessBestWave, 4);
  legacy.items.inventory['commute-horn'] = 6; legacy.items.welcomeGiftStatus = 'granted';
  assert.deepEqual(parseSave(serializeSave(legacy)), legacy);
  const next = updateBestScore(legacy, 'sea-gate', 95);
  assert.equal(next.items.inventory['commute-horn'], 6); assert.equal(next.unassisted.bestScores['sea-gate'], 86);
  const invalid = migrateSave({ version: 4, items: { inventory: { 'commute-horn': -2, 'delay-ticket': Infinity, bad: 99 } } });
  assert.deepEqual(invalid.items.inventory, counts);
});
test('存储读取状态区分新玩家、未来版本、不可用，损坏数据不判首次', () => {
  assert.equal(new WxStorageAdapter({ getStorageSync: () => '' }).loadWithStatus().status, 'missing');
  assert.notEqual(new WxStorageAdapter({ getStorageSync: () => '{bad' }).loadWithStatus().status, 'missing');
  assert.equal(new WxStorageAdapter({ getStorageSync: () => ({ version: 99 }) }).loadWithStatus().status, 'unsupported');
  assert.equal(new WxStorageAdapter({ getStorageSync: () => { throw Error(); } }).loadWithStatus().status, 'unavailable');
});
test('首礼、奖励和使用事务保存失败可重试，重复确认及崩溃补偿不多发', () => {
  let save = emptySave(); save.items.welcomeGiftStatus = 'eligible'; let fail = true;
  const service = new RewardService(() => save, (next) => { if (fail) return false; save = next; return true; });
  assert.equal(service.welcome(), false); assert.deepEqual(save.items.inventory, counts);
  fail = false; service.welcome(); service.welcome(); assert.equal(save.items.inventory['commute-horn'], 1);
  const request = { id: 'test', itemId: 'delay-ticket', source: 'rewarded-ad' };
  fail = true; assert.equal(service.grant(request), false); fail = false;
  assert.equal(service.grant(request), true); assert.equal(service.grant(request), true); assert.equal(save.items.inventory['delay-ticket'], 2);
  assert.equal(service.reserveUse('commute-horn', 'use', 'run'), true); assert.equal(save.items.inventory['commute-horn'], 0);
  assert.equal(service.reserveUse('delay-ticket', 'another', 'run'), false);
  service.recoverUse(); service.recoverUse(); assert.equal(save.items.inventory['commute-horn'], 1);
});
