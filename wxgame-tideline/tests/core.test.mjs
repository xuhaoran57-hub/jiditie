import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GameSimulation,
  CAMPAIGN_LEVELS,
  calculateScore,
  countObjectiveStars,
  isAppearanceUnlocked,
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
  updateBestStars,
  unlockedAppearanceIds,
  updatePassengers,
  useGuideAbility,
} from '../src/core/index.ts';

test('正式战役包含 12 站且关卡 ID 唯一', () => {
  assert.equal(CAMPAIGN_LEVELS.length, 12);
  assert.equal(new Set(CAMPAIGN_LEVELS.map((level) => level.id)).size, 12);
  assert.equal(CAMPAIGN_LEVELS.at(-1)?.id, 'morning-light');
  assert.deepEqual(
    CAMPAIGN_LEVELS.map((level) => level.passenger.count),
    [44, 48, 52, 58, 64, 70, 76, 72, 82, 86, 94, 100],
  );
  assert.deepEqual(CAMPAIGN_LEVELS.map((level) => level.doors.length), [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(
    CAMPAIGN_LEVELS
      .map((level, index) => (level.events ?? []).some((event) => event.kind === 'luggage-cart') ? index + 1 : null)
      .filter((index) => index !== null),
    [5, 7, 10, 11, 12],
  );
  assert.equal(
    CAMPAIGN_LEVELS.some((level) => level.objectives?.some((objective) => objective.id === 'no-collision')),
    false,
  );
  assert.ok(CAMPAIGN_LEVELS.every((level) => level.passenger.alightingCount < level.passenger.count));
});

test('三星目标按通关指标计数，并写入每关最高星数', () => {
  const simulation = new GameSimulation('sea-gate', 9);
  const state = simulation.snapshot();
  state.phase = 'result';
  state.outcome = 'success';
  state.metrics.alightingTotal = 10;
  state.metrics.alightingExited = 8;
  state.metrics.doorRemainingAtFinish = 3;
  state.metrics.guideUses = 1;
  assert.equal(countObjectiveStars(state, CAMPAIGN_LEVELS[0]), 3);
  state.metrics.collisions = 100;
  assert.equal(countObjectiveStars(state, CAMPAIGN_LEVELS[0]), 2);
  state.outcome = 'failure';
  assert.equal(countObjectiveStars(state, CAMPAIGN_LEVELS[0]), 0);
  const save = updateBestStars(emptySave(), 'sea-gate', 3);
  assert.equal(save.bestStars['sea-gate'], 3);
  assert.equal(updateBestStars(save, 'sea-gate', 1).bestStars['sea-gate'], 3);
});

test('外观按通关、累计星数和战役进度逐级解锁', () => {
  const save = emptySave();
  assert.deepEqual(unlockedAppearanceIds(save), ['default']);
  save.achievements.push('clear:sea-gate');
  assert.equal(isAppearanceUnlocked(save, 'seafoam'), true);
  save.bestStars = { 'sea-gate': 3, 'lighthouse-bay': 3 };
  assert.equal(isAppearanceUnlocked(save, 'sunset'), true);
  for (let index = 1; index <= 12; index += 1) save.achievements.push(`clear:level-${index}`);
  assert.equal(isAppearanceUnlocked(save, 'night'), true);
});

test('相同种子产生完全相同的随机序列', () => {
  const first = new SeededRandom('m2-replay');
  const second = new SeededRandom('m2-replay');
  const sequenceA = Array.from({ length: 32 }, () => first.next());
  const sequenceB = Array.from({ length: 32 }, () => second.next());
  assert.deepEqual(sequenceA, sequenceB);
  assert.deepEqual(createPassengers(MVP_LEVELS[1], new SeededRandom(42)), createPassengers(MVP_LEVELS[1], new SeededRandom(42)));
});

test('双门关卡的下车和上车客流会随机分布到左右两门', () => {
  const level = CAMPAIGN_LEVELS.find((item) => item.doors.length === 2);
  assert.ok(level);
  const countByDoor = (seed, start, end) => {
    const passengers = createPassengers(level, new SeededRandom(seed)).slice(start, end);
    return Object.fromEntries(level.doors.map((door) => [
      door.id,
      passengers.filter((passenger) => passenger.desiredDoorId === door.id).length,
    ]));
  };
  const alightingA = countByDoor(1, 0, level.passenger.alightingCount);
  const alightingB = countByDoor(2, 0, level.passenger.alightingCount);
  const boardingA = countByDoor(1, level.passenger.alightingCount, level.passenger.count);
  const boardingB = countByDoor(3, level.passenger.alightingCount, level.passenger.count);
  assert.ok(alightingA.a > alightingA.b && alightingB.b > alightingB.a);
  assert.ok(boardingA.a > boardingA.b && boardingB.b > boardingB.a);
});

test('阶段按时推进，并在关门时根据是否进入车厢成功或失败', () => {
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
  assert.equal(state.player.abilityCooldown, 1);
  assert.notDeepEqual(target.position, before);
  const blocked = useGuideAbility(state, simulation.level, state.elapsed);
  assert.equal(blocked.used, false);
  assert.equal(blocked.reason, 'cooldown');
});

test('只有真正进入车厢内部才会成功，站在门外安全区会失败', () => {
  const success = new GameSimulation('sea-gate', 11);
  const successState = success.getState();
  successState.player.position = {
    x: success.level.trainBounds.x + success.level.trainBounds.width / 2,
    y: success.level.trainBounds.y + success.level.trainBounds.height / 2,
  };
  success.runUntilResult(30);
  assert.equal(successState.outcome, 'success');

  const failure = new GameSimulation('sea-gate', 11);
  const failureState = failure.getState();
  const door = failure.level.doors[0];
  failureState.player.position = {
    x: door.safeZone.x + door.safeZone.width / 2,
    y: door.safeZone.y + door.safeZone.height / 2,
  };
  failure.runUntilResult(30);
  assert.equal(failureState.outcome, 'failure');
});

test('玩家只能从打开的车门进入车厢内部', () => {
  const level = cloneLevelConfig(MVP_LEVELS[0]);
  level.passenger.count = 0;
  level.passenger.alightingCount = 0;
  const simulation = new GameSimulation(level, 12);
  const state = simulation.getState();
  const door = level.doors[0];

  // 车门关闭时，向上移动只能停在站台侧。
  state.player.position = { x: door.center.x, y: door.safeZone.y + 4 };
  simulation.movePlayer({ x: 0, y: -1 }, 1);
  assert.ok(state.player.position.y >= level.platformBounds.y + state.player.radius);
  assert.equal(state.player.inCarriage, false);

  while (simulation.phase !== 'exiting') simulation.step(0.1, { move: { x: 0, y: 0 } });
  for (let index = 0; index < 12 && !state.player.inCarriage; index += 1) {
    simulation.step(1 / 30, { move: { x: 0, y: -1 } });
  }
  assert.equal(state.doors[0].open, true);
  assert.equal(state.player.inCarriage, true);
  assert.ok(state.player.position.y <= level.trainBounds.y + level.trainBounds.height - state.player.radius);
});

test('疏导最多影响两人，并按人流方向和敏感群组调整礼让值', () => {
  const simulation = new GameSimulation('sea-gate', 19);
  simulation.step(2.5);
  const state = simulation.getState();
  state.player.position = { x: 160, y: 120 };
  state.player.facing = { x: 0, y: -1 };
  const targets = state.passengers.filter((passenger) => passenger.role !== 'inside' && passenger.role !== 'exited').slice(0, 3);
  assert.equal(targets.length, 3);
  targets.forEach((passenger, index) => {
    passenger.position = { x: 150, y: 72 + index * 8 };
    passenger.target = { x: 160, y: 32 };
  });
  targets[0].role = 'alighting';
  targets[0].kind = 'group';
  targets[1].role = 'waiting';
  targets[1].kind = 'regular';
  targets[2].role = 'waiting';
  targets[2].kind = 'regular';
  const before = state.metrics.courtesyPoints;
  const result = useGuideAbility(state, simulation.level, state.elapsed);
  assert.equal(result.affectedPassengerIds.length, 2);
  assert.ok(state.metrics.courtesyPoints < before, '敏感群组或被阻挡的人流应降低礼让值');
});

test('礼让分不会因高密度碰撞直接归零', () => {
  const simulation = new GameSimulation('sea-gate', 2026);
  const state = simulation.snapshot();
  state.outcome = 'failure';
  state.metrics.collisions = 40;
  state.metrics.alightingTotal = 14;
  state.metrics.alightingExited = 4;
  state.metrics.courtesyPoints = -6;
  const score = calculateScore(state, simulation.level);
  assert.ok(score.courtesy > 0);
  assert.equal(score.medal, 'none', '失败局不应发放奖牌');

  state.metrics.collisions = 400;
  state.metrics.alightingExited = 0;
  assert.ok(calculateScore(state, simulation.level).courtesy >= 10);

  state.metrics.collisions = 0;
  state.metrics.alightingExited = state.metrics.alightingTotal;
  state.metrics.courtesyPoints = 0;
  assert.equal(calculateScore(state, simulation.level).courtesy, 100);
});

test('未选中的开放车门也允许玩家进入', () => {
  const level = cloneLevelConfig(MVP_LEVELS[2]);
  level.passenger.count = 0;
  level.passenger.alightingCount = 0;
  const simulation = new GameSimulation(level, 1212);
  const state = simulation.getState();
  const leftDoor = level.doors.find((door) => door.id === 'a');
  assert.ok(leftDoor);
  assert.equal(state.player.selectedDoorId, 'b', '默认仍高亮推荐的 B 门');
  state.player.position = { x: leftDoor.center.x, y: leftDoor.safeZone.y + 4 };

  while (simulation.phase !== 'exiting') simulation.step(0.1, { move: { x: 0, y: 0 } });
  for (let index = 0; index < 30 && !state.player.inCarriage; index += 1) {
    simulation.step(1 / 30, { move: { x: 0, y: -1 } });
  }
  assert.equal(state.player.inCarriage, true);
  assert.equal(state.player.selectedDoorId, 'b');
});

test('门输入不再改变推荐门状态', () => {
  const simulation = new GameSimulation('cloud-harbor', 1213);
  const state = simulation.getState();
  const selected = state.player.selectedDoorId;
  assert.equal(simulation.selectDoor('a'), true);
  assert.equal(state.player.selectedDoorId, selected);
});

test('车厢容量达到上限时仍不阻挡玩家抓住门口空隙', () => {
  const level = cloneLevelConfig(MVP_LEVELS[0]);
  level.passenger.count = 0;
  level.passenger.alightingCount = 0;
  level.carriageCapacity = 0;
  const simulation = new GameSimulation(level, 14);
  const state = simulation.getState();
  const door = level.doors[0];
  state.player.position = { x: door.center.x, y: 10 };

  while (simulation.phase !== 'exiting') simulation.step(0.1, { move: { x: 0, y: 0 } });
  for (let index = 0; index < 12 && !state.player.inCarriage; index += 1) {
    simulation.step(1 / 30, { move: { x: 0, y: -1 } });
  }
  assert.equal(state.doors[0].blocked, false);
  assert.equal(state.player.inCarriage, true);
});

test('门洞有多名活动 NPC 时仍允许玩家通过', () => {
  const level = cloneLevelConfig(MVP_LEVELS[0]);
  level.passenger.count = 4;
  level.passenger.alightingCount = 0;
  level.carriageCapacity = 20;
  const simulation = new GameSimulation(level, 1414);
  const state = simulation.getState();
  const door = level.doors[0];
  assert.ok(door);

  while (simulation.phase !== 'exiting') simulation.step(0.1, { move: { x: 0, y: 0 } });
  for (const [index, passenger] of state.passengers.entries()) {
    passenger.role = 'waiting';
    passenger.position = { x: door.center.x + (index - 1.5) * 8, y: 30 };
    passenger.target = { x: door.center.x, y: 24 };
  }
  state.player.position = { x: door.center.x, y: 72 };
  // 测试门洞本身的通行能力，使用较强输入避免测试被低速配置的加速段卡住。
  for (let index = 0; index < 180 && !state.player.inCarriage; index += 1) {
    simulation.step(1 / 30, { move: { x: 0, y: -1 }, moveScale: 1.4 });
  }
  assert.equal(state.player.inCarriage, true);
});

test('下车乘客在车门打开前留在车厢内部，开门后才走出', () => {
  const level = cloneLevelConfig(MVP_LEVELS[0]);
  level.passenger.count = 1;
  level.passenger.alightingCount = 1;
  const simulation = new GameSimulation(level, 13);
  const state = simulation.getState();
  const passenger = state.passengers[0];
  assert.ok(passenger);
  assert.equal(passenger.role, 'alighting');
  assert.ok(passenger.position.y < level.trainBounds.y + level.trainBounds.height);

  simulation.step(0.1);
  assert.equal(passenger.role, 'alighting');
  assert.ok(passenger.position.y < level.trainBounds.y + level.trainBounds.height);

  while (simulation.phase !== 'exiting') simulation.step(0.1);
  assert.equal(state.doors[0].open, true);
  const beforeExit = passenger.position.y;
  for (let index = 0; index < 120 && passenger.routeProgress < 1; index += 1) simulation.step(1 / 30);
  assert.equal(passenger.role, 'alighting');
  assert.equal(passenger.routeProgress, 1);
  assert.ok(passenger.position.y > beforeExit);
  assert.equal(state.metrics.alightingExited, 1);
  const crossedPosition = { ...passenger.position };
  simulation.step(0.5);
  assert.ok(passenger.position.y > crossedPosition.y, '下车完成后仍应继续向站台外侧行走');
});

test('车门打开后下车流与上车流同步移动', () => {
  const level = cloneLevelConfig(MVP_LEVELS[0]);
  level.passenger.count = 2;
  level.passenger.alightingCount = 1;
  const simulation = new GameSimulation(level, 1314);
  const state = simulation.getState();
  const waiting = state.passengers.find((passenger) => passenger.role === 'waiting');
  assert.ok(waiting);
  for (const passenger of state.passengers) {
    if (passenger !== waiting) passenger.role = 'exited';
  }
  waiting.position = { x: level.doors[0].center.x, y: 500 };
  waiting.target = { x: level.doors[0].center.x, y: 24 };

  while (simulation.phase !== 'exiting') simulation.step(0.1);
  const beforeBoardingFlow = waiting.position.y;
  simulation.step(1 / 30);
  assert.ok(waiting.position.y < beforeBoardingFlow, '上车流不应等待 boarding 阶段才开始移动');
});

test('阻塞车门不会让车内下车乘客提前移动', () => {
  const level = cloneLevelConfig(MVP_LEVELS[0]);
  level.passenger.count = 1;
  level.passenger.alightingCount = 1;
  const passenger = createPassengers(level, new SeededRandom(29))[0];
  assert.ok(passenger);
  const door = level.doors[0];
  const doorStates = [{ id: door.id, occupancy: 0, open: true, blocked: true }];
  const context = {
    dt: 1 / 30,
    now: 0,
    platformBounds: level.platformBounds,
    trainBounds: level.trainBounds,
    doors: level.doors,
    doorStates,
    carriageCapacity: level.carriageCapacity,
    boardingOpen: false,
    alightingOpen: true,
  };
  const before = { ...passenger.position };
  updatePassengers([passenger], context);
  assert.deepEqual(passenger.position, before);

  doorStates[0].blocked = false;
  updatePassengers([passenger], context);
  assert.ok(passenger.position.y > before.y);
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
    passenger.position = { x: door.center.x, y: 24 };
    passenger.target = { x: door.center.x, y: 24 };
  });
  const doorStates = [{ id: door.id, occupancy: 0, open: true, blocked: false }];
  const context = {
    dt: 1 / 30,
    now: 2,
    platformBounds: level.platformBounds,
    trainBounds: level.trainBounds,
    doors: level.doors,
    doorStates,
    carriageCapacity: level.carriageCapacity,
    boardingOpen: true,
    alightingOpen: true,
  };
  const result = updatePassengers(passengers, context);
  assert.equal(result.boarded, 0, '预留车位不等于已经走进车厢');
  assert.equal(doorStates[0].occupancy, 1);
  assert.ok(result.blockedAttempts >= 1);
  assert.equal(passengers.filter((passenger) => passenger.role === 'waiting').length, 2);
  let completedBoarding = 0;
  for (let index = 0; index < 120; index += 1) completedBoarding += updatePassengers(passengers, context).boarded;
  assert.equal(completedBoarding, 1);
  assert.equal(passengers.filter((passenger) => passenger.role === 'inside').length, 1);
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
  passenger.position = { x: door.center.x, y: door.safeZone.y + 24 };
  passenger.target = { x: door.center.x, y: door.safeZone.y + 24 };

  simulation.step(1 / 30, { move: { x: 0, y: 0 } });
  assert.equal(passenger.role, 'waiting');
  assert.ok(passenger.position.y > 0, '候车区内不能直接传送到车厢');

  for (let index = 0; index < 30 && passenger.role === 'waiting'; index += 1) {
    simulation.step(1 / 30, { move: { x: 0, y: 0 } });
  }
  assert.equal(passenger.role, 'boarding');
  assert.ok(passenger.position.y > 0, '开始上车时仍应位于门前，随后再穿过门槛');
  assert.ok(passenger.target.y >= level.trainBounds.y + 24, '上车目标不能贴近车厢顶端');
  assert.ok(passenger.target.y >= level.trainBounds.y + level.trainBounds.height - 132, '上车目标应保持在门后近处');

  for (let index = 0; index < 120 && passenger.role !== 'inside'; index += 1) {
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
  assert.equal(passenger.role, 'waiting');
  assert.ok(passenger.position.y > 24, '进入候车区后仍应先走向门前航点');
  for (let index = 0; index < 30 && passenger.role === 'waiting'; index += 1) {
    simulation.step(1 / 30, { move: { x: 0, y: 0 } });
  }
  assert.equal(passenger.role, 'boarding');
  assert.ok(passenger.target.y >= level.trainBounds.y + 24);
  assert.ok(passenger.target.y >= level.trainBounds.y + level.trainBounds.height - 132);
});

test('损坏或未来版本存档安全回退，正常存档可往返', () => {
  const fallback = emptySave();
  assert.deepEqual(parseSave('{not-json'), fallback);
  assert.deepEqual(parseSave({ version: 999, unlockedLevelIds: ['star-ring'] }), fallback);

  const old = parseSave({ version: 0, unlockedLevels: ['cloud-harbor'], scores: { 'sea-gate': 87 } });
  assert.equal(old.version, 2);
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

test('M5 提前关门会阻塞旧门并保持到本局结束', () => {
  const simulation = new GameSimulation('qixia-garden', 32);
  simulation.step(4.25);
  const state = simulation.getState();
  assert.equal(state.activeEvent?.kind, 'door-close');
  assert.equal(state.recommendedDoorId, simulation.level.recommendedDoorId);
  assert.equal(state.player.selectedDoorId, simulation.level.recommendedDoorId);
  assert.equal(state.doors.find((door) => door.id === 'b')?.blocked, false, '3 秒预警期间旧门仍开放');
  assert.equal(state.doors.find((door) => door.id === 'a')?.blocked, false);
  assert.equal(state.events.some((event) => event.type === 'event-door-close'), false);

  simulation.step(2.4);
  assert.equal(state.doors.find((door) => door.id === 'b')?.blocked, true);
  assert.ok(state.events.some((event) => event.type === 'event-door-close' && event.detail === 'b->a'));

  simulation.step(3);
  assert.equal(state.activeEvent, null);
  assert.equal(state.recommendedDoorId, simulation.level.recommendedDoorId);
  assert.equal(state.doors.find((door) => door.id === 'b')?.blocked, true);
  assert.equal(state.doors.find((door) => door.id === 'a')?.blocked, false);
});

test('M5 提前关门期间已经排到旧门的 NPC 也不能继续进车', () => {
  const simulation = new GameSimulation('qixia-garden', 321);
  simulation.step(4.25);
  const state = simulation.getState();
  const passenger = state.passengers.find((item) => item.role === 'waiting');
  assert.ok(passenger);
  const oldDoor = simulation.level.doors.find((door) => door.id === 'b');
  assert.ok(oldDoor);
  passenger.role = 'boarding';
  passenger.doorId = oldDoor.id;
  passenger.desiredDoorId = oldDoor.id;
  passenger.position = { x: oldDoor.center.x, y: -18 };
  passenger.target = { x: oldDoor.center.x, y: -250 };
  state.doors.find((door) => door.id === oldDoor.id).occupancy += 1;

  simulation.step(2.4 + 1 / 30);
  assert.equal(passenger.role, 'waiting');
  assert.equal(passenger.doorId, undefined);
  assert.equal(passenger.desiredDoorId, 'a');
  assert.equal(state.doors.find((door) => door.id === 'b')?.occupancy, 0);
  assert.ok(passenger.position.y >= passenger.radius, '撤回旧门的 NPC 应回到站台侧');
});

test('M5 行李车事件会以有限推力缓慢推开玩家', () => {
  const simulation = new GameSimulation('star-ring', 33);
  simulation.step(3.85);
  const state = simulation.getState();
  const zone = state.activeEvent?.zone;
  assert.equal(state.activeEvent?.kind, 'luggage-cart');
  assert.ok(zone);
  const enteringX = zone.x;
  assert.ok(enteringX < simulation.level.platformBounds.x, '行李车应从站台一侧驶入');

  simulation.step(2.35);
  const currentZone = state.activeEvent?.zone;
  assert.ok(currentZone);
  state.player.position = { x: currentZone.x + currentZone.width / 2, y: currentZone.y + currentZone.height / 2 };
  const beforeCartPush = { ...state.player.position };
  simulation.step(1 / 30);
  const pushDistance = Math.hypot(
    state.player.position.x - beforeCartPush.x,
    state.player.position.y - beforeCartPush.y,
  );
  assert.ok(pushDistance > 0 && pushDistance < 6, '行李车应以有限推力缓慢推开角色');

  const beforeSlowMoveX = zone.x;
  simulation.step(0.5);
  assert.ok(zone.x > enteringX, '行李车占用区应随车辆横向移动');
  assert.ok(zone.x - beforeSlowMoveX < 60, '行李车半秒内不应快速冲过站台');
});
