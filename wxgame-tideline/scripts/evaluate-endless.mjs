import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createEndlessLevel } from '../src/core/index.ts';
import { ENDLESS_STRATEGIES, runEndlessWave } from './lib/endless-runner.mjs';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const seeds = Number(option('seeds', '30'));
const from = Number(option('from', '1'));
const to = Number(option('to', '20'));
if (![seeds, from, to].every(Number.isInteger) || seeds < 1 || seeds > 500 || from < 1 || to < from || to > 100) {
  throw new Error('Use --seeds=1..500 and --from / --to within 1..100.');
}
const viewports = option('viewports', '667x375,844x390').split(',').map(value => {
  const [width, height] = value.split('x').map(Number);
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error(`Invalid viewport: ${value}`);
  return { width, height };
});
const strategies = ENDLESS_STRATEGIES.filter(strategy => option('strategies', 'rush,guide,align,alternate').split(',').includes(strategy.id));
if (!strategies.length) throw new Error('Select at least one of rush,guide,align,alternate.');
const report = { seeds, from, to, timestep: 1 / 60, reactionSeconds: 0.1, items: false,
  note: '脚本通过比例不是玩家通过率；相同种子共用多种策略不代表独立玩家样本。', rows: [] };
const round = value => Math.round(value * 100) / 100;
for (const viewport of viewports) {
  for (let wave = from; wave <= to; wave++) {
    const level = createEndlessLevel(wave);
    const row = { wave, ...viewport, passengers: level.passenger.count, alighting: level.passenger.alightingCount,
      doors: level.doors.map(door => door.width), boardingSeconds: level.boardingDuration, strategies: {} };
    const successfulSeeds = new Set();
    for (const strategy of strategies) {
      const runs = Array.from({ length: seeds }, (_, index) => runEndlessWave(wave, { ...viewport, baseSeed: index + 1, strategy }));
      const wins = runs.filter(run => run.success);
      for (const run of wins) successfulSeeds.add(run.baseSeed);
      row.strategies[strategy.id] = { successes: wins.length, attempts: seeds,
        averageRemaining: wins.length ? round(wins.reduce((sum, run) => sum + run.remaining, 0) / wins.length) : null,
        defaultSeed: { success: runs[0].success, remaining: round(runs[0].remaining) },
        failedSeeds: runs.filter(run => !run.success).map(run => run.baseSeed) };
    }
    row.seedsWithRoute = successfulSeeds.size;
    report.rows.push(row);
    console.log(JSON.stringify(row));
  }
}
const output = option('output', '');
if (output) {
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Saved ${path}`);
}
