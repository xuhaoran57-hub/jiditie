import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GameSimulation,
  MVP_LEVELS,
  PhaseMachine,
  SeededRandom,
  cloneLevelConfig,
  createPassengers,
  emptySave,
  parseSave,
  resolveCollisions,
  serializeSave,
  unlockLevel,
  updateBestScore,
  updatePassengers,
  useGuideAbility,
} from '../src/core/index.ts';

test('相同种子产生完全相同的随机序列', () => {
  const first = new SeededRandom('m2-replay');
  const second = new SeededRandom('m2-replay');
  const sequenceA = Array.from({ length: 32 }, () => first.next());
  const sequenceB = Array.from({ length: 32 }, () => second.next());
  assert.deepEqual(sequenceA, sequenceB);
  assert.deepEqual(createPassengers(MVP_LEVELS[1], new SeededRandom(42)), createPassengers(MVP_LEVELS[1], new SeededRandom(42)));
});

test('阶段按时推进，并在关门时根据安全区成功或失败', () => {
  const machine = new PhaseMachine({
    phaseDurations: { intro: 0.1, arriving: 0.1, positioning: 0.1, exiting: 0.1 },
    boardingDuration: 0.4,
    warningThreshold: 0.15,
  });
  machine.update(0.4, false);
  assert.equal(machine.phase, 'boarding');
  machine.update(0.26, false);
  assert.equal(machine.phase, 'warning');
  machine.update(0.2, false);
  assert.equal(machine.phase, 'result');
  assert.equal(machine.outcome, 'failure');

  machine.reset();
  machine.update(1, true);
  assert.equal(machine.phase, 'result');
  assert.equal(machine.outcome, 'success');
});

test('玩家移动始终被限制在站台边界内', () => {
  const simulation = new GameSimulation('sea-gate', 7);
  simulation.movePlayer({ x: -100, y: -100 }, 100);
  const { player } = simulation.getState();
  const level = simulation.level;
  assert.ok(player.position.x >= level.platformBounds.x + player.radius - 1e-8);
  assert.ok(player.position.y >= level.platformBounds.y + player.radius - 1e-8);
  assert.ok(player.position.x <= level.platformBounds.x + level.platformBounds.width - player.radius + 1e-8);
  assert.ok(player.position.y <= level.platformBounds.y + level.platformBounds.height - player.radius + 1e-8);
});

test('空间哈希碰撞分离后角色不再重叠', () => {
  const actors = [
    { id: 'a', position: { x: 10, y: 10 }, velocity: { x: 0, y: 0 }, radius: 12, weight: 1 },
    { id: 'b', position: { x: 10, y: 10 }, velocity: { x: 0, y: 0 }, radius: 12, weight: 1 },
  ];
  const collisions = resolveCollisions(actors, 8, 16);
  assert.ok(collisions > 0);
  const dx = actors[0].position.x - actors[1].position.x;
  const dy = actors[0].position.y - actors[1].position.y;
  assert.ok(Math.hypot(dx, dy) >= actors[0].radius + actors[1].radius - 1e-5);
  assert.ok(actors.every((actor) => Number.isFinite(actor.position.x) && Number.isFinite(actor.position.y)));
});

test('疏导只影响前方目标，并消耗体力和触发冷却', () => {
  const simulation = new GameSimulation('sea-gate', 9);
  simulation.step(2.5); // 进入 positioning/exiting
  const state = simulation.getState();
  state.player.position = { x: 160, y: 120 };
  state.player.facing = { x: 0, y: -1 };
  const target = state.passengers.find((passenger) => passenger.role !== 'inside' && passenger.role !== 'exited');
  assert.ok(target);
  target.position = { x: 160, y: 72 };
  target.target = { x: 160, y: 32 };
  const before = { ...target.position };
  const staminaBefore = state.player.stamina;
  const result = useGuideAbility(state, simulation.level, state.elapsed);
  assert.equal(result.used, true);
  assert.ok(result.affectedPassengerIds.includes(target.id));
  assert.ok(state.player.stamina < staminaBefore);
  assert.ok(state.player.abilityCooldown > 0);
  assert.notDeepEqual(target.position, before);
  const blocked = useGuideAbility(state, simulation.level, state.elapsed);
  assert.equal(blocked.used, false);
  assert.equal(blocked.reason, 'cooldown');
});

test('车门关闭前进入安全区会成功，离开安全区会失败', () => {
  const success = new GameSimulation('sea-gate', 11);
  const successState = success.getState();
  const door = success.level.doors[0];
  successState.player.position = {
    x: door.safeZone.x + door.safeZone.width / 2,
    y: door.safeZone.y + door.safeZone.height / 2,
  };
  success.runUntilResult(30);
  assert.equal(successState.outcome, 'success');

  const failure = new GameSimulation('sea-gate', 11);
  const failureState = failure.getState();
  failureState.player.position = { x: 20, y: 520 };
  failure.runUntilResult(30);
  assert.equal(failureState.outcome, 'failure');
});

test('容量达到上限时，后续乘客不能继续无条件进入', () => {
  const level = cloneLevelConfig(MVP_LEVELS[0]);
  level.passenger.count = 3;
  level.passenger.alightingCount = 0;
  level.carriageCapacity = 1;
  const random = new SeededRandom(5);
  const passengers = createPassengers(level, random);
  const door = level.doors[0];
  passengers.forEach((passenger) => {
    passenger.role = 'waiting';
    passenger.position = { x: door.center.x, y: 10 };
    passenger.target = { x: door.center.x, y: 24 };
  });
  const doorStates = [{ id: door.id, occupancy: 0, open: true, blocked: false }];
  const result = updatePassengers(passengers, {
    dt: 1 / 30,
    now: 2,
    platformBounds: level.platformBounds,
    trainBounds: level.trainBounds,
    doors: level.doors,
    doorStates,
    carriageCapacity: level.carriageCapacity,
    boardingOpen: true,
    alightingOpen: true,
  });
  assert.equal(result.boarded, 1);
  assert.equal(doorStates[0].occupancy, 1);
  assert.ok(result.blockedAttempts >= 1);
  assert.equal(passengers.filter((passenger) => passenger.role === 'waiting').length, 2);
});

test('上车角色能穿过门槛并落在车厢内', () => {
  const level = cloneLevelConfig(MVP_LEVELS[0]);
  level.passenger.count = 1;
  level.passenger.alightingCount = 0;
  const simulation = new GameSimulation(level, 17);
  for (let index = 0; index < 80 && simulation.phase !== 'boarding'; index += 1) {
    simulation.step(0.1, { move: { x: 0, y: 0 } });
  }
  assert.equal(simulation.phase, 'boarding');

  const state = simulation.getState();
  const door = level.doors[0];
  const passenger = state.passengers[0];
  assert.ok(door && passenger);
  state.player.position = { x: door.center.x, y: door.safeZone.y + 8 };
  passenger.position = { x: door.center.x, y: door.entryZone.y + door.entryZone.height / 2 };
  passenger.target = { x: door.center.x, y: door.safeZone.y + 24 };

  simulation.step(1 / 30, { move: { x: 0, y: 0 } });
  assert.equal(passenger.role, 'boarding');
  assert.ok(passenger.position.y < 0, 'boarding passenger should cross the platform edge');

  for (let index = 0; index < 60 && passenger.role !== 'inside'; index += 1) {
    simulation.step(1 / 30, { move: { x: 0, y: 0 } });
  }
  assert.equal(passenger.role, 'inside');
  assert.ok(passenger.position.y < 0);
});

test('门前上车通道不会被站在安全区的玩家堵住', () => {
  const level = cloneLevelConfig(MVP_LEVELS[0]);
  level.passenger.count = 1;
  level.passenger.alightingCount = 0;
  const simulation = new GameSimulation(level, 23);
  for (let index = 0; index < 80 && simulation.phase !== 'boarding'; index += 1) {
    simulation.step(0.1, { move: { x: 0, y: 0 } });
  }
  const state = simulation.getState();
  const door = level.doors[0];
  const passenger = state.passengers[0];
  assert.ok(door && passenger);
  state.player.position = { x: door.center.x, y: door.safeZone.y + door.safeZone.height / 2 };
  state.player.inSafeZone = false;
  passenger.position = { x: door.center.x, y: door.safeZone.y + door.safeZone.height + 2 };
  passenger.target = { x: door.center.x, y: door.safeZone.y + 24 };

  simulation.step(1 / 30, { move: { x: 0, y: 0 } });
  assert.equal(state.player.inSafeZone, true);
  assert.equal(passenger.role, 'boarding');
  assert.ok(passenger.target.y < level.trainBounds.y + 120);
});

test('损坏或未来版本存档安全回退，正常存档可往返', () => {
  const fallback = emptySave();
  assert.deepEqual(parseSave('{not-json'), fallback);
  assert.deepEqual(parseSave({ version: 999, unlockedLevelIds: ['star-ring'] }), fallback);

  const old = parseSave({ version: 0, unlockedLevels: ['cloud-harbor'], scores: { 'sea-gate': 87 } });
  assert.equal(old.version, 1);
  assert.ok(old.unlockedLevelIds.includes('sea-gate'));
  assert.equal(old.bestScores['sea-gate'], 87);
  const roundTrip = parseSave(serializeSave(old));
  assert.deepEqual(roundTrip, old);
  const improved = updateBestScore(unlockLevel(old, 'star-ring'), 'sea-gate', 95);
  assert.ok(improved.unlockedLevelIds.includes('star-ring'));
  assert.equal(improved.bestScores['sea-gate'], 95);
});

test('相同种子和相同输入得到相同的一局模拟结果', () => {
  const first = new GameSimulation('cloud-harbor', 12345);
  const second = new GameSimulation('cloud-harbor', 12345);
  const input = { move: { x: 0, y: -1 } };
  first.runUntilResult(30, input);
  second.runUntilResult(30, input);
  assert.deepEqual(first.snapshot(), second.snapshot());
});

test('result 是终态，继续更新不会改变结算快照', () => {
  const simulation = new GameSimulation('sea-gate', 23);
  simulation.runUntilResult(30);
  const before = simulation.snapshot();
  simulation.step(10, { move: { x: 1, y: 0 }, useGuide: true });
  assert.deepEqual(simulation.snapshot(), before);
});

test('M5 雨天事件会收窄可行走横向空间，并在结束后恢复', () => {
  const simulation = new GameSimulation('sea-gate', 31);
  simulation.step(3.45);
  const state = simulation.getState();
  assert.equal(state.activeEvent?.kind, 'rain');
  assert.ok(state.events.some((event) => event.type === 'event-start'));

  state.player.position = { x: 0, y: 300 };
  simulation.step(1 / 30, { move: { x: -1, y: 0 } });
  assert.ok(state.player.position.x >= simulation.level.platformBounds.x + 26 - state.player.radius - 1e-6);

  simulation.step(3.7);
  assert.equal(state.activeEvent, null);
  assert.ok(state.events.some((event) => event.type === 'event-end'));
});

test('M5 临时换门会阻塞旧门、切换推荐入口并恢复', () => {
  const simulation = new GameSimulation('cloud-harbor', 32);
  simulation.step(4.25);
  const state = simulation.getState();
  assert.equal(state.activeEvent?.kind, 'door-change');
  assert.equal(state.recommendedDoorId, 'a');
  assert.equal(state.doors.find((door) => door.id === 'b')?.blocked, true);
  assert.ok(state.events.some((event) => event.type === 'event-door-change' && event.detail === 'b->a'));

  simulation.step(3);
  assert.equal(state.activeEvent, null);
  assert.equal(state.recommendedDoorId, simulation.level.recommendedDoorId);
  assert.equal(state.doors.find((door) => door.id === 'b')?.blocked, false);
});

test('M5 行李车事件会把玩家推出临时占用区域', () => {
  const simulation = new GameSimulation('star-ring', 33);
  simulation.step(3.85);
  const state = simulation.getState();
  const zone = state.activeEvent?.zone;
  assert.equal(state.activeEvent?.kind, 'luggage-cart');
  assert.ok(zone);

  state.player.position = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
  simulation.step(1 / 30);
  const insideExpanded =
    state.player.position.x >= zone.x - state.player.radius &&
    state.player.position.x <= zone.x + zone.width + state.player.radius &&
    state.player.position.y >= zone.y - state.player.radius &&
    state.player.position.y <= zone.y + zone.height + state.player.radius;
  assert.equal(insideExpanded, false);
});
