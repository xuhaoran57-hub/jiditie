import { CAMPAIGN_LEVELS, createEndlessLevel, GameSimulation } from '../../src/core/index.ts';
import { createRenderLayout, createViewportMetrics } from '../../src/render/context.ts';
import { GameRuntime } from '../../src/runtime/game-runtime.ts';

export const ENDLESS_STRATEGIES = [
  { id: 'rush', label: '直冲可用门', guideEvery: Infinity },
  { id: 'guide', label: '疏导并按预警改道', guideEvery: 1.05 },
  { id: 'align', label: '对齐门口并疏导', guideEvery: 1.05, align: true },
  { id: 'alternate', label: '选择另一扇门并疏导', guideEvery: 1.05, alternate: true },
];

export const endlessSeed = (wave, baseSeed = 1) => (baseSeed + CAMPAIGN_LEVELS.length * 1009 + wave * 7919) >>> 0;

export function endlessLayout(level, width = 667, height = 375) {
  const x = Math.min(level.platformBounds.x, level.trainBounds.x);
  const y = Math.min(level.platformBounds.y, level.trainBounds.y);
  const right = Math.max(level.platformBounds.x + level.platformBounds.width, level.trainBounds.x + level.trainBounds.width);
  const bottom = Math.max(level.platformBounds.y + level.platformBounds.height, level.trainBounds.y + level.trainBounds.height);
  return createRenderLayout(createViewportMetrics(width, height, 2), { x, y, width: right - x, height: bottom - y });
}

/** 仅使用玩家可见状态；每 0.1 秒调整摇杆，不使用道具、未来事件或改写模拟状态。 */
export function createEndlessPilot(level, layout, strategy) {
  let frame = 0;
  let nextGuide = 0;
  let move = { x: 0, y: 0 };
  return (state) => {
    const player = state.player;
    let doors = level.doors.filter(door => !state.doors.find(item => item.id === door.id)?.blocked);
    if (strategy.guideEvery !== Infinity && state.activeEvent?.kind === 'door-close' && state.activeEvent.phase === 'warning') {
      doors = doors.filter(door => door.id !== state.activeEvent.fromDoorId);
    }
    const preferred = strategy.alternate
      ? level.doors.find(door => door.id !== level.recommendedDoorId)?.id
      : level.recommendedDoorId;
    const door = doors.find(item => item.id === preferred) ?? doors[0] ?? level.doors[0];
    const dx = door.center.x - player.position.x;
    const targetY = strategy.align && player.position.y < 125 && Math.abs(dx) > door.width / 2 - player.radius - 3 ? 32 : -72;
    if (frame++ % 6 === 0) {
      const sx = dx * layout.worldScaleX;
      const sy = (targetY - player.position.y) * layout.worldScaleY;
      const length = Math.hypot(sx, sy);
      move = player.inCarriage || length < 0.01 ? { x: 0, y: 0 } : { x: sx / length, y: sy / length };
    }
    const useGuide = Number.isFinite(strategy.guideEvery) && !player.inCarriage && state.elapsed >= nextGuide;
    if (useGuide) nextGuide = state.elapsed + strategy.guideEvery;
    return { move: { ...move }, useGuide };
  };
}

export function runEndlessWave(wave, { baseSeed = 1, width = 667, height = 375,
  strategy = ENDLESS_STRATEGIES[0], record = false } = {}) {
  const level = createEndlessLevel(wave);
  const seed = endlessSeed(wave, baseSeed);
  const simulation = new GameSimulation(level, seed);
  const layout = endlessLayout(level, width, height);
  const pilot = createEndlessPilot(level, layout, strategy);
  let control;
  // 调用正式运行时的输入换算，避免重复实现后与手机的横屏速度脱节。
  const inputContext = { input: { sample: () => control }, renderer: { context: { layout } }, commitQueuedItem: () => false };
  const controls = record ? [] : undefined;
  let enteredAt = null;
  for (let frame = 0; frame < 45 * 60 && simulation.phase !== 'result'; frame++) {
    control = pilot(simulation.getState());
    controls?.push(control);
    const input = GameRuntime.prototype.sampleSimulationInput.call(inputContext);
    simulation.step(1 / 60, input);
    if (enteredAt === null && simulation.getState().player.inCarriage) enteredAt = simulation.getState().elapsed;
  }
  const state = simulation.getState();
  if (state.phase !== 'result') throw new Error(`Endless wave ${wave} failed to finish`);
  return { wave, seed, baseSeed, width, height, strategy: strategy.id, success: state.outcome === 'success',
    enteredAt, remaining: state.metrics.doorRemainingAtFinish, guides: state.metrics.guideUses,
    position: { ...state.player.position }, ...(controls ? { controls } : {}) };
}
