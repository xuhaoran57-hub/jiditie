import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const distDir = resolve(projectDir, 'dist');
// 直接调用 TypeScript 的 JS 入口，避免 Windows 下 spawnSync 不能直接执行
// .cmd shim 的差异。
const tscBin = resolve(projectDir, 'node_modules', 'typescript', 'bin', 'tsc');

if (!existsSync(tscBin)) {
  console.error('未找到 TypeScript，请先执行 npm install。');
  process.exit(1);
}

// dist 是可重复生成的构建目录，只清理工程内的这一明确目标。
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
const result = spawnSync(process.execPath, [tscBin, '-p', resolve(projectDir, 'tsconfig.wxgame.json')], {
  cwd: projectDir,
  stdio: 'inherit',
  shell: false,
});
if (result.status !== 0) process.exit(result.status ?? 1);

// 根 package.json 声明了 ESM；小游戏入口使用 require，因此给构建产物一个
// 局部 CommonJS 边界，Node 烟测和微信运行时都能按同一方式加载。
writeFileSync(
  resolve(distDir, 'package.json'),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
  'utf8',
);
console.log('微信小游戏构建完成：dist/');
