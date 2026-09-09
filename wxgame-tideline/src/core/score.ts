import type { GameState, LevelConfig, LevelObjective, ScoreResult } from './types.ts';
import { getLevelConfig } from './levels.ts';
import { clamp } from './vector.ts';

function scoreNumber(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

export function objectiveCompleted(state: GameState, objective: LevelObjective): boolean {
  if (state.outcome !== 'success') return false;
  switch (objective.id) {
    case 'no-collision':
      return state.metrics.collisions === 0;
    case 'alighting-rate':
      return state.metrics.alightingTotal <= 0
        || state.metrics.alightingExited / state.metrics.alightingTotal >= clamp(objective.minRatio, 0, 1);
    case 'finish-time':
      return state.metrics.doorRemainingAtFinish >= Math.max(0, objective.minRemaining);
    case 'guide-limit':
      return state.metrics.guideUses <= Math.max(0, Math.floor(objective.maxUses));
    case 'courtesy-score':
      return calculateCourtesyScore(state) >= Math.max(0, Math.min(100, objective.minScore));
    case 'stamina':
      return state.player.stamina / Math.max(1, state.player.maxStamina) >= clamp(objective.minRatio, 0, 1);
    default:
      return false;
  }
}

export function countObjectiveStars(state: GameState, level: LevelConfig): 0 | 1 | 2 | 3 {
  if (state.outcome !== 'success') return 0;
  const objectives = (level.objectives ?? []).slice(0, 3);
  if (objectives.length === 0) return 0;
  return Math.min(3, objectives.filter((objective) => objectiveCompleted(state, objective)).length) as 0 | 1 | 2 | 3;
}

export function calculateCourtesyScore(state: GameState): number {
  const metrics = state.metrics;
  const missedAlighting = Math.max(0, metrics.alightingTotal - metrics.alightingExited);
  const collisionLoad = Math.max(0, metrics.collisions) / Math.max(1, metrics.boardingTotal + metrics.alightingTotal);
  const collisionPenalty = Math.min(55, collisionLoad * 36);
  const alightingPenalty = metrics.alightingTotal > 0
    ? (missedAlighting / metrics.alightingTotal) * 22
    : 0;
  const guideBonus = Math.max(0, metrics.courtesyPoints) * 0.5;
  return scoreNumber(Math.max(10, 100 - collisionPenalty - alightingPenalty + guideBonus));
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

  const courtesy = calculateCourtesyScore(state);

  const stamina = scoreNumber((state.player.stamina / Math.max(state.player.maxStamina, 1)) * 100);
  const total = scoreNumber(efficiency * 0.45 + courtesy * 0.35 + stamina * 0.2);
  // 失败局仍保留各项分数用于复盘，但不发放奖牌；否则“错过列车”
  // 也可能显示铜牌，玩家会误以为已经完成了关卡目标。
  const medal: ScoreResult['medal'] = state.outcome === 'success'
    ? (total >= 85 ? 'gold' : total >= 65 ? 'silver' : total >= 45 ? 'bronze' : 'none')
    : 'none';

  return {
    success: state.outcome === 'success',
    efficiency,
    courtesy,
    stamina,
    total,
    stars: countObjectiveStars(state, config),
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
