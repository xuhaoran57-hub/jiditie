import { performance } from 'node:perf_hooks';

import { cloneLevelConfig, GameSimulation, MVP_LEVELS } from '../src/core/index.ts';

function numericOption(name, fallback, min, max) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

const actorCount = numericOption('actors', 220, 1, 1000);
const frames = numericOption('frames', 180, 1, 10000);
const warmupFrames = numericOption('warmup', 30, 0, 1000);
const budgetMs = Number(process.argv.find((value) => value.startsWith('--budget='))?.slice(9) ?? 33.3);
const safeBudgetMs = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : 33.3;

const level = cloneLevelConfig(MVP_LEVELS[2]);
level.passenger.count = actorCount;
level.passenger.alightingCount = Math.min(48, actorCount);
level.carriageCapacity = Math.max(actorCount, level.carriageCapacity);
// Keep the benchmark in a non-terminal phase so every sample represents a full update.
level.boardingDuration = 30;

const simulation = new GameSimulation(level, 'm7-benchmark');
const input = { move: { x: 0.2, y: -0.8 } };
for (let frame = 0; frame < warmupFrames; frame += 1) simulation.step(1 / 30, input);

const samples = [];
const heapBefore = process.memoryUsage().heapUsed;
for (let frame = 0; frame < frames; frame += 1) {
  const start = performance.now();
  simulation.step(1 / 30, input);
  samples.push(performance.now() - start);
}
const heapAfter = process.memoryUsage().heapUsed;
const sorted = [...samples].sort((a, b) => a - b);
const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
const report = {
  actors: actorCount,
  frames,
  warmupFrames,
  averageMs: Number(average.toFixed(3)),
  p50Ms: Number(percentile(sorted, 0.5).toFixed(3)),
  p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
  maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
  estimatedFpsAtP95: Number((1000 / Math.max(0.001, percentile(sorted, 0.95))).toFixed(1)),
  heapDeltaBytes: heapAfter - heapBefore,
  phase: simulation.getState().phase,
  budgetMs: safeBudgetMs,
};

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--strict') && report.p95Ms > safeBudgetMs) {
  console.error(`性能基线未通过：p95 ${report.p95Ms}ms > ${safeBudgetMs}ms`);
  process.exitCode = 1;
}
