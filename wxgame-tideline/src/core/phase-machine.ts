import type { Phase, PhaseDurations } from './types.ts';
import { EPSILON, clamp } from './vector.ts';

export interface PhaseMachineConfig {
  phaseDurations: PhaseDurations;
  boardingDuration: number;
  warningThreshold: number;
}

export interface PhaseTransition {
  from: Phase;
  to: Phase;
  elapsedInUpdate: number;
}

export interface PhaseMachineSnapshot {
  phase: Phase;
  phaseElapsed: number;
  doorRemaining: number;
  outcome: 'success' | 'failure' | null;
}

const NEXT_TIMED_PHASE: Partial<Record<Phase, Phase>> = {
  intro: 'arriving',
  arriving: 'positioning',
  positioning: 'exiting',
  exiting: 'boarding',
};

function safeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * 负责“进站 → 下车 → 上车 → 关门 → 结算”的纯时间状态机。
 * 它不读取玩家对象，只在关门时询问调用方是否已进入车厢，因此可以单独
 * 在回放、服务器验证或单元测试中运行。
 */
export class PhaseMachine {
  private readonly config: PhaseMachineConfig;
  private _phase: Phase = 'intro';
  private _phaseElapsed = 0;
  private _doorRemaining = 0;
  private _outcome: 'success' | 'failure' | null = null;

  constructor(config: PhaseMachineConfig) {
    const boardingDuration = safeDuration(config.boardingDuration);
    this.config = {
      phaseDurations: {
        intro: safeDuration(config.phaseDurations.intro),
        arriving: safeDuration(config.phaseDurations.arriving),
        positioning: safeDuration(config.phaseDurations.positioning),
        exiting: safeDuration(config.phaseDurations.exiting),
      },
      boardingDuration,
      warningThreshold: Math.max(0, Math.min(safeDuration(config.warningThreshold), boardingDuration)),
    };
  }

  get phase(): Phase {
    return this._phase;
  }

  get phaseElapsed(): number {
    return this._phaseElapsed;
  }

  get doorRemaining(): number {
    return this._doorRemaining;
  }

  get outcome(): 'success' | 'failure' | null {
    return this._outcome;
  }

  get isTerminal(): boolean {
    return this._phase === 'result';
  }

  get boardingDuration(): number {
    return this.config.boardingDuration;
  }

  get warningThreshold(): number {
    return this.config.warningThreshold;
  }

  reset(): void {
    this._phase = 'intro';
    this._phaseElapsed = 0;
    this._doorRemaining = 0;
    this._outcome = null;
  }

  snapshot(): PhaseMachineSnapshot {
    return {
      phase: this._phase,
      phaseElapsed: this._phaseElapsed,
      doorRemaining: this._doorRemaining,
      outcome: this._outcome,
    };
  }

  /**
   * 推进 dt 秒。一次较大的 dt 也会按边界依次走完多个阶段，避免快进时跳过
   * warning 或 result。返回值记录本次发生的阶段切换，便于事件日志和测试。
   */
  update(dt: number, playerInCarriage: boolean): PhaseTransition[] {
    if (this.isTerminal || !Number.isFinite(dt) || dt <= 0) return [];

    let remaining = dt;
    let elapsedInUpdate = 0;
    const transitions: PhaseTransition[] = [];
    let guard = 0;

    while (remaining > EPSILON && !this.isTerminal && guard < 64) {
      guard += 1;

      if (this._phase === 'boarding' || this._phase === 'warning') {
        // boarding 的最后 warningThreshold 秒单独显示 warning，但不额外增加
        // 倒计时；这样“警告”不会偷偷延长关门时间。
        if (
          this._phase === 'boarding' &&
          this._doorRemaining <= this.config.warningThreshold + EPSILON
        ) {
          this.transition('warning', transitions, elapsedInUpdate);
          continue;
        }

        const available = Math.max(0, this._doorRemaining);
        const consume = Math.min(remaining, available);
        this._doorRemaining = Math.max(0, this._doorRemaining - consume);
        this._phaseElapsed += consume;
        remaining -= consume;
        elapsedInUpdate += consume;

        if (this._doorRemaining <= EPSILON) {
          this._doorRemaining = 0;
          this.finish(playerInCarriage, transitions, elapsedInUpdate);
        }
        continue;
      }

      const next = NEXT_TIMED_PHASE[this._phase];
      if (!next) break;
      const duration = safeDuration(this.config.phaseDurations[this._phase as keyof PhaseDurations]);
      const available = Math.max(0, duration - this._phaseElapsed);

      if (available <= EPSILON) {
        this.transition(next, transitions, elapsedInUpdate);
        continue;
      }

      const consume = Math.min(remaining, available);
      this._phaseElapsed += consume;
      remaining -= consume;
      elapsedInUpdate += consume;

      if (this._phaseElapsed >= duration - EPSILON) {
        this._phaseElapsed = duration;
        this.transition(next, transitions, elapsedInUpdate);
      }
    }

    // dt 可能恰好落在边界上，此处补一次零剩余的边界检查，保证例如
    // boardingDuration=0 时不会卡在 boarding。
    if (!this.isTerminal && (this._phase === 'boarding' || this._phase === 'warning')) {
      if (this._doorRemaining <= EPSILON) this.finish(playerInCarriage, transitions, elapsedInUpdate);
      else if (
        this._phase === 'boarding' &&
        this._doorRemaining <= this.config.warningThreshold + EPSILON
      ) {
        this.transition('warning', transitions, elapsedInUpdate);
      }
    }

    return transitions;
  }

  tick(dt: number, playerInCarriage: boolean): PhaseTransition[] {
    return this.update(dt, playerInCarriage);
  }

  getState(): PhaseMachineSnapshot {
    return this.snapshot();
  }

  forceResult(success: boolean): void {
    if (this.isTerminal) return;
    this._phase = 'result';
    this._phaseElapsed = 0;
    this._doorRemaining = 0;
    this._outcome = success ? 'success' : 'failure';
  }

  private transition(
    next: Phase,
    transitions: PhaseTransition[],
    elapsedInUpdate: number,
  ): void {
    const previous = this._phase;
    this._phase = next;
    this._phaseElapsed = 0;
    if (next === 'boarding') {
      this._doorRemaining = this.config.boardingDuration;
      if (this._doorRemaining <= this.config.warningThreshold + EPSILON) {
        // 下一轮循环会转成 warning，保留一个可观察的 boarding → warning 顺序。
      }
    }
    transitions.push({ from: previous, to: next, elapsedInUpdate });
  }

  private finish(
    playerInCarriage: boolean,
    transitions: PhaseTransition[],
    elapsedInUpdate: number,
  ): void {
    if (this.isTerminal) return;
    const previous = this._phase;
    this._phase = 'result';
    this._phaseElapsed = 0;
    this._doorRemaining = 0;
    this._outcome = playerInCarriage ? 'success' : 'failure';
    transitions.push({ from: previous, to: 'result', elapsedInUpdate });
  }
}

export function phaseProgress(machine: PhaseMachine): number {
  if (machine.phase === 'result') return 1;
  if (machine.phase === 'boarding' || machine.phase === 'warning') {
    return clamp(
      1 - machine.doorRemaining / Math.max(machine.boardingDuration, EPSILON),
      0,
      1,
    );
  }
  return 0;
}
