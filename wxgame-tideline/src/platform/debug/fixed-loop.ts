import type { GameState, SimulationInput } from '../../core/types.ts';

export interface StepTarget {
  step(dt: number, input?: SimulationInput): GameState;
}

export type InputProvider = SimulationInput | (() => SimulationInput);

/**
 * 与具体计时 API 无关的固定步长调度器。宿主可以把 requestAnimationFrame、
 * 微信 ticker 或测试时钟的帧间隔传给 advance；规则层始终收到相同 dt。
 */
export class FixedTimestepLoop {
  readonly fixedDelta: number;
  readonly maxFrameDelta: number;
  private accumulator = 0;
  private _paused = false;
  private _totalSteps = 0;

  constructor(fixedDelta = 1 / 60, maxFrameDelta = 0.25) {
    this.fixedDelta = Number.isFinite(fixedDelta) && fixedDelta > 0 ? fixedDelta : 1 / 60;
    this.maxFrameDelta = Number.isFinite(maxFrameDelta) && maxFrameDelta > 0 ? maxFrameDelta : 0.25;
  }

  get paused(): boolean {
    return this._paused;
  }

  get totalSteps(): number {
    return this._totalSteps;
  }

  get interpolationAlpha(): number {
    return this.accumulator / this.fixedDelta;
  }

  setPaused(paused: boolean): void {
    this._paused = paused;
    if (paused) this.accumulator = 0;
  }

  togglePaused(): boolean {
    this.setPaused(!this._paused);
    return this._paused;
  }

  reset(): void {
    this.accumulator = 0;
    this._totalSteps = 0;
    this._paused = false;
  }

  advance(frameDelta: number, target: StepTarget, input: InputProvider = {}): number {
    if (this._paused || !Number.isFinite(frameDelta) || frameDelta <= 0) return 0;
    const safeDelta = Math.min(frameDelta, this.maxFrameDelta);
    this.accumulator += safeDelta;
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.fixedDelta) {
      const currentInput = typeof input === 'function' ? input() : input;
      target.step(this.fixedDelta, currentInput);
      this.accumulator -= this.fixedDelta;
      this._totalSteps += 1;
      steps += 1;
      // 防御异常宿主传入极大帧间隔时的长循环；剩余时间留到下一帧。
      if (steps >= 120) {
        this.accumulator = Math.min(this.accumulator, this.fixedDelta);
        break;
      }
    }
    return steps;
  }

  runFrame(frameDelta: number, target: StepTarget, input: InputProvider = {}): number {
    return this.advance(frameDelta, target, input);
  }
}
