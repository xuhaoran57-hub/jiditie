import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_LEVELS, createEndlessLevel, emptySave } from '../src/core/index.ts';
import { ENDLESS_STRATEGIES, endlessSeed, runEndlessWave } from '../scripts/lib/endless-runner.mjs';
import { createHarness } from './helpers/item-harness.mjs';

test('无尽模式不会在模板循环时降低客流或退回单门，远期参数有界', () => {
  let previous = createEndlessLevel(1);
  for (let wave = 2; wave <= 50; wave++) {
    const level = createEndlessLevel(wave);
    assert.ok(level.passenger.count >= previous.passenger.count, `wave ${wave}: passenger rollback`);
    assert.ok(level.passenger.baseSpeed >= previous.passenger.baseSpeed);
    assert.equal(level.boardingDuration, previous.boardingDuration);
    if (wave >= 7) assert.equal(level.doors.length, 2, `wave ${wave}: missing second door`);
    assert.ok(level.carriageCapacity >= level.passenger.count - level.passenger.alightingCount,
      '候车客不会因容量耗尽停在门前形成永久障碍');
    previous = level;
  }
  const late = createEndlessLevel(Number.MAX_SAFE_INTEGER);
  assert.ok(late.passenger.count <= 180);
  assert.ok(late.passenger.baseSpeed <= 48);
  for (const door of late.doors) assert.ok(door.width >= 58);
  for (const value of [0, -10, NaN, Infinity]) assert.deepEqual(createEndlessLevel(value), createEndlessLevel(1));
});

test('提前关门仅在双门轮次出现，预警完整且不被前序事件吞掉', () => {
  for (let wave = 1; wave <= 30; wave++) {
    const level = createEndlessLevel(wave);
    let previousEnd = 0;
    for (const event of level.events ?? []) {
      assert.ok(event.at > previousEnd, `wave ${wave}: overlapping events`);
      if (event.kind === 'door-close') {
        assert.equal(level.doors.length, 2);
        assert.notEqual(event.fromDoorId, event.toDoorId);
        assert.ok(event.warningDuration >= 4);
        const finish = Object.values(level.phaseDurations).reduce((sum, value) => sum + value, 0) + level.boardingDuration;
        assert.ok(event.at + event.warningDuration < finish - 2, '关门后仍留有改道时间');
      }
      previousEnd = event.at + event.duration + (event.warningDuration ?? 0);
    }
  }
});

test('无尽配置的修改不污染战役模板或后续轮次', () => {
  const campaign = structuredClone(CAMPAIGN_LEVELS);
  const original = createEndlessLevel(20);
  const changed = createEndlessLevel(20);
  changed.doors[0].safeZone.x = 12345;
  changed.passenger.kindWeights.regular = 12345;
  changed.player.spawn.y = 12345;
  changed.guide.range = 12345;
  changed.events[0].speedMultiplier = 12345;
  assert.deepEqual(createEndlessLevel(20), original);
  assert.deepEqual(CAMPAIGN_LEVELS, campaign);
});

for (const [width, height] of [[667, 375], [844, 390]]) {
  test(`${width}×${height} 正式默认种子可用简单操作无道具连续通过 1～20 轮`, (t) => {
    const save = emptySave();
    save.endlessUnlocked = true;
    save.unlockedLevelIds.push('endless');
    const h = createHarness({ save, width, height });
    t.after(() => h.runtime.destroy());
    for (let i = 0; i < 4; i++) h.runtime.tick(1 / 60);
    h.runtime.startLevel('endless');
    h.runtime.confirmStart();
    for (let wave = 1; wave <= 20; wave++) {
      // 穷举四种固定、可解释的操作方式，不搜索微秒时机或读取未来人流。
      let witness;
      for (const strategy of ENDLESS_STRATEGIES) {
        const result = runEndlessWave(wave, { width, height, strategy, record: true });
        if (result.success && result.remaining >= 1) { witness = result; break; }
      }
      assert.ok(witness, `wave ${wave} needs a route with at least one second to spare`);
      assert.equal(h.runtime.endlessWave, wave);
      assert.equal(h.runtime.state.seed, endlessSeed(wave));
      for (const control of witness.controls) {
        assert.ok(Math.hypot(control.move.x, control.move.y) <= 1 + 1e-10);
        assert.equal(control.useItem, undefined);
        h.runtime.input.sample = () => ({ ...control });
        h.runtime.tick(1 / 60);
      }
      assert.equal(h.runtime.state.outcome, 'success', `wave ${wave} runtime replay`);
      assert.equal(h.runtime.saveData.endlessBestWave, wave);
      assert.equal(h.runtime.saveData.unassisted.endlessBestWave, wave);
      if (wave < 20) assert.equal(h.runtime.nextLevel(), true);
    }
  });
}
