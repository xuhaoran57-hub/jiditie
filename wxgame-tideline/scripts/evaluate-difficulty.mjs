import { CAMPAIGN_LEVELS, GameSimulation } from '../src/core/index.ts';

const seeds = Number(process.argv.find((value) => value.startsWith('--seeds='))?.slice(8) ?? 100);
const safeSeeds = Number.isFinite(seeds) ? Math.max(1, Math.min(5000, Math.floor(seeds))) : 100;
const strategies = [
  { id: 'rush', label: '直冲门口', guideEvery: Infinity, moveScale: 1 },
  { id: 'steady', label: '稳定移动', guideEvery: 1.25, moveScale: 0.82 },
  { id: 'guide', label: '定时疏导', guideEvery: 0.9, moveScale: 0.82 },
];

function usableDoors(state, level) {
  const states = new Map(state.doors.map((item) => [item.id, item]));
  return level.doors.filter((door) => {
    const runtime = states.get(door.id);
    return !runtime || (runtime.open && !runtime.blocked);
  });
}

function targetDoor(state, level) {
  const available = usableDoors(state, level);
  const recommended = level.doors.find((item) => item.id === level.recommendedDoorId);
  if (recommended && available.some((item) => item.id === recommended.id)) return recommended;
  if (available.length > 0) {
    return available
      .slice()
      .sort((a, b) => Math.abs(a.center.x - state.player.position.x) - Math.abs(b.center.x - state.player.position.x))[0];
  }
  // 进站和开门前没有可用门状态；先接近推荐门，开门后再动态改道。
  return recommended ?? level.doors[0];
}

function directionToDoor(state, level) {
  const door = targetDoor(state, level);
  if (!door) return { x: 0, y: 0 };
  const dx = door.center.x - state.player.position.x;
  const dy = -72 - state.player.position.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function run(level, seed, strategy) {
  const simulation = new GameSimulation(level, seed);
  let guideAt = strategy.guideEvery;
  let elapsed = 0;
  let terminalPhase = simulation.phase;
  while (simulation.phase !== 'result' && elapsed < 60) {
    const state = simulation.getState();
    terminalPhase = state.phase;
    const nearbyPassenger = state.passengers.some((passenger) => {
      if (passenger.role === 'exited' || passenger.role === 'inside') return false;
      return Math.hypot(passenger.position.x - state.player.position.x, passenger.position.y - state.player.position.y) <= level.guide.range;
    });
    const useGuide = strategy.guideEvery !== Infinity
      && nearbyPassenger
      && state.phase !== 'intro'
      && state.phase !== 'arriving'
      && state.elapsed >= guideAt;
    if (useGuide) guideAt += strategy.guideEvery;
    simulation.step(1 / 30, { move: directionToDoor(state, level), moveScale: strategy.moveScale, useGuide });
    elapsed += 1 / 30;
  }
  const state = simulation.getState();
  const resultTransition = [...state.events].reverse().find((event) => event.type === 'phase' && event.detail?.endsWith('->result'));
  if (resultTransition?.detail) terminalPhase = resultTransition.detail.split('->')[0] ?? terminalPhase;
  const boardingRatio = state.metrics.boardingTotal === 0 ? 1 : state.metrics.boarded / state.metrics.boardingTotal;
  const alightingRatio = state.metrics.alightingTotal === 0 ? 1 : state.metrics.alightingExited / state.metrics.alightingTotal;
  return {
    success: state.outcome === 'success',
    stars: state.score?.stars ?? 0,
    total: state.score?.total ?? 0,
    elapsed: state.elapsed,
    collisions: state.metrics.collisions,
    guideUses: state.metrics.guideUses,
    staminaSpent: state.metrics.staminaSpent,
    lateBoardingAttempts: state.metrics.lateBoardingAttempts,
    boarded: state.metrics.boarded,
    boardingRatio,
    alightingExited: state.metrics.alightingExited,
    alightingRatio,
    doorRemainingAtFinish: state.metrics.doorRemainingAtFinish,
    terminalPhase,
  };
}

function summarize(runs) {
  const average = (key) => runs.reduce((sum, item) => sum + item[key], 0) / runs.length;
  const successful = runs.filter((item) => item.success);
  const successAverage = (key) => successful.length === 0
    ? 0
    : successful.reduce((sum, item) => sum + item[key], 0) / successful.length;
  const phases = Object.fromEntries([...new Set(runs.map((item) => item.terminalPhase))]
    .map((phase) => [phase, runs.filter((item) => item.terminalPhase === phase).length]));
  const failurePhases = Object.fromEntries([...new Set(runs.filter((item) => !item.success).map((item) => item.terminalPhase))]
    .map((phase) => [phase, runs.filter((item) => !item.success && item.terminalPhase === phase).length]));
  return {
    successRate: Number((successful.length / runs.length * 100).toFixed(1)),
    threeStarRate: Number((runs.filter((item) => item.stars === 3).length / runs.length * 100).toFixed(1)),
    averageScore: Number(average('total').toFixed(1)),
    averageElapsed: Number(average('elapsed').toFixed(2)),
    averageCollisions: Number(average('collisions').toFixed(1)),
    averageGuideUses: Number(average('guideUses').toFixed(1)),
    averageStaminaSpent: Number(average('staminaSpent').toFixed(1)),
    averageLateBoardingAttempts: Number(average('lateBoardingAttempts').toFixed(1)),
    averageBoardingRatio: Number(average('boardingRatio').toFixed(3)),
    averageAlightingRatio: Number(average('alightingRatio').toFixed(3)),
    averageDoorRemainingAtFinish: Number(average('doorRemainingAtFinish').toFixed(2)),
    successAverageScore: Number(successAverage('total').toFixed(1)),
    successAverageCollisions: Number(successAverage('collisions').toFixed(1)),
    successAverageDoorRemainingAtFinish: Number(successAverage('doorRemainingAtFinish').toFixed(2)),
    successAverageBoardingRatio: Number(successAverage('boardingRatio').toFixed(3)),
    terminalPhases: phases,
    failurePhases,
  };
}

const report = { seeds: safeSeeds, levels: [] };
for (const [index, level] of CAMPAIGN_LEVELS.entries()) {
  const levelReport = { index: index + 1, id: level.id, name: level.name, strategies: {} };
  for (const strategy of strategies) {
    const runs = Array.from({ length: safeSeeds }, (_, offset) => run(level, `${level.id}-${offset + 1}`, strategy));
    levelReport.strategies[strategy.id] = { label: strategy.label, ...summarize(runs) };
  }
  report.levels.push(levelReport);
}
console.log(JSON.stringify(report, null, 2));
