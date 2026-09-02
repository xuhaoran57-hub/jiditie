/** 可回放的确定性随机数。规则层只依赖这个接口，不直接调用 Math.random。 */
export interface RandomSource {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
  snapshot(): number;
  restore(state: number): void;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number | string): number {
  const numeric = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  // mulberry32 在状态为 0 时也能工作，但把空种子规范化便于日志与回放。
  return numeric === 0 ? 0x6d2b79f5 : numeric;
}

export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number | string) {
    this.state = normalizeSeed(seed);
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`invalid random integer range: ${min}..${max}`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new RangeError('cannot pick from an empty list');
    return values[this.int(0, values.length - 1)]!;
  }

  snapshot(): number {
    return this.state >>> 0;
  }

  restore(state: number): void {
    if (!Number.isFinite(state)) throw new TypeError('random state must be finite');
    this.state = state >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
  }

  clone(): SeededRandom {
    const copy = new SeededRandom(this.state);
    copy.restore(this.state);
    return copy;
  }
}

export function randomSequence(seed: number | string, count: number): number[] {
  const random = new SeededRandom(seed);
  return Array.from({ length: Math.max(0, count) }, () => random.next());
}
