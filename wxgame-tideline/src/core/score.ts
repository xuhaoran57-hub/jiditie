import type { GameState, LevelConfig, ScoreResult } from './types.ts';
import { getLevelConfig } from './levels.ts';
import { clamp } from './vector.ts';

function scoreNumber(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

/** 根据可解释的四项指标计算结算分，不依赖渲染或平台状态。 */
export function calculateScore(state: GameState, level?: LevelConfig): ScoreResult {
  let config = level;
  if (!config) {
    try {
      config = getLevelConfig(state.levelId);
    } catch {
      config = {
        boardingDuration: 1,
        recommendedDoorId: state.player.selectedDoorId,
      } as LevelConfig;
    }
  }
  const metrics = state.metrics;
  const boardingRatio = metrics.boardingTotal === 0 ? 1 : metrics.boarded / metrics.boardingTotal;

  const timeFactor = state.outcome === 'success'
    ? 45 + (metrics.doorRemainingAtFinish / Math.max(config.boardingDuration, 0.001)) * 55
    : 20;
  const efficiency = scoreNumber(timeFactor * 0.65 + boardingRatio * 35 - metrics.lateBoardingAttempts * 4);

  const missedAlighting = Math.max(0, metrics.alightingTotal - metrics.alightingExited);
  const courtesy = scoreNumber(
    100 - metrics.collisions * 4 - missedAlighting * 7 + metrics.courtesyPoints * 1.5,
  );

  const stamina = scoreNumber((state.player.stamina / Math.max(state.player.maxStamina, 1)) * 100);
  const recommendedDoorId = state.recommendedDoorId ?? config.recommendedDoorId;
  const routeBase = state.player.selectedDoorId === recommendedDoorId ? 100 : 68;
  const route = scoreNumber(routeBase - Math.max(0, metrics.doorSwitches - 1) * 6);

  const total = scoreNumber(
    efficiency * 0.35 + courtesy * 0.25 + stamina * 0.2 + route * 0.2,
  );
  const medal: ScoreResult['medal'] =
    total >= 85 ? 'gold' : total >= 65 ? 'silver' : total >= 45 ? 'bronze' : 'none';

  return {
    success: state.outcome === 'success',
    efficiency,
    courtesy,
    stamina,
    route,
    total,
    medal,
  };
}

export function medalLabel(medal: ScoreResult['medal']): string {
  switch (medal) {
    case 'gold':
      return '金牌';
    case 'silver':
      return '银牌';
    case 'bronze':
      return '铜牌';
    default:
      return '再试一次';
  }
}
