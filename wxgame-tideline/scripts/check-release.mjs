import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_LIMITS = Object.freeze({
  packageBytes: 4 * 1024 * 1024,
  distBytes: 1 * 1024 * 1024,
  wavBytes: 256 * 1024,
  svgBytes: 128 * 1024,
});

const REQUIRED_FILES = [
  'game.js',
  'game.json',
  'project.config.json',
  'dist/runtime/index.js',
  'dist/package.json',
  'assets/ASSET_MANIFEST.md',
  'assets/design-tokens.json',
  'assets/generated/tideline-sprite.svg',
  'assets/generated/tideline-player-sprite.svg',
  'assets/generated/tideline-player-sprite.png',
  'assets/generated/tideline-passenger-regular-sprite.png',
  'assets/audio/tideline-loop.wav',
  'assets/audio/ui-guide.wav',
  'assets/audio/ui-success.wav',
  'assets/audio/ui-failure.wav',
  'assets/audio/event-alert.wav',
];

const RELEASE_ROOTS = ['game.js', 'game.json', 'project.config.json', 'dist', 'assets'];

// 只扫描真正会被小游戏加载的文本；资源说明文档可能包含来源链接，不能把它们
// 误判成运行时外链依赖。
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.svg']);

const PLACEHOLDER_APP_IDS = new Set([
  '',
  'touristappid',
  'your-appid',
  'your_appid',
  '<appid>',
  '<your-appid>',
]);

function parseArgs(argv) {
  const readNumber = (name, fallback) => {
    const prefix = `--${name}=`;
    const raw = argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
    const value = raw === undefined ? fallback : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  return {
    strict: argv.includes('--strict'),
    production: argv.includes('--production'),
    json: argv.includes('--json'),
    limits: {
      packageBytes: readNumber('max-package-kb', DEFAULT_LIMITS.packageBytes / 1024) * 1024,
      distBytes: readNumber('max-dist-kb', DEFAULT_LIMITS.distBytes / 1024) * 1024,
      wavBytes: readNumber('max-wav-kb', DEFAULT_LIMITS.wavBytes / 1024) * 1024,
      svgBytes: readNumber('max-svg-kb', DEFAULT_LIMITS.svgBytes / 1024) * 1024,
    },
  };
}

function normalizePath(value) {
  return value.split('\\').join('/');
}

function walkFiles(root, output = []) {
  if (!existsSync(root)) return output;
  const info = lstatSync(root);
  if (info.isFile()) {
    output.push(root);
    return output;
  }
  if (!info.isDirectory()) return output;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = resolve(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkFiles(child, output);
    else if (entry.isFile()) output.push(child);
  }
  return output;
}

function relativePath(file) {
  return normalizePath(relative(projectDir, file));
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function byteSize(file) {
  try {
    return lstatSync(file).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function pushIssue(report, severity, code, message, strict = true) {
  report.issues.push({ severity, code, message, strict });
}

function checkRequiredFiles(report) {
  for (const relative of REQUIRED_FILES) {
    const file = resolve(projectDir, relative);
    if (!existsSync(file) || !lstatSync(file).isFile()) {
      pushIssue(report, 'error', 'missing-file', `缺少发布文件：${relative}`);
    }
  }
}

function checkBuildOutput(report) {
  const entryPath = resolve(projectDir, 'dist/runtime/index.js');
  const packagePath = resolve(projectDir, 'dist/package.json');
  const entry = readText(entryPath);
  if (entry !== undefined && !/require\(["']\.\/game-runtime\.js["']\)/.test(entry)) {
    pushIssue(report, 'error', 'runtime-entry', 'dist/runtime/index.js 未导出 game-runtime.js');
  }

  const packageText = readText(packagePath);
  if (packageText === undefined) return;
  try {
    const packageData = JSON.parse(packageText);
    if (packageData.type !== 'commonjs') {
      pushIssue(report, 'error', 'dist-module-type', 'dist/package.json 必须声明 type=commonjs');
    }
  } catch {
    pushIssue(report, 'error', 'dist-package-json', 'dist/package.json 不是有效 JSON');
  }
}

function checkGameEntry(report) {
  const entry = readText(resolve(projectDir, 'game.js'));
  if (entry !== undefined && !/require\(["']\.\/dist\/runtime\/index\.js["']\)/.test(entry)) {
    pushIssue(report, 'error', 'game-entry', 'game.js 未加载 dist/runtime/index.js');
  }

  const gameConfigText = readText(resolve(projectDir, 'game.json'));
  if (gameConfigText === undefined) return;
  try {
    const gameConfig = JSON.parse(gameConfigText);
    if (!['portrait', 'landscape'].includes(gameConfig.deviceOrientation)) {
      pushIssue(report, 'error', 'orientation', 'game.json 的 deviceOrientation 必须为 portrait 或 landscape');
    }
  } catch {
    pushIssue(report, 'error', 'game-config-json', 'game.json 不是有效 JSON');
  }
}

function checkProjectConfig(report, options) {
  const configPath = resolve(projectDir, 'project.config.json');
  const text = readText(configPath);
  if (text === undefined) return;
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    pushIssue(report, 'error', 'project-config-json', 'project.config.json 不是有效 JSON');
    return;
  }

  if (config.compileType !== 'game') {
    pushIssue(report, 'error', 'compile-type', 'project.config.json 的 compileType 必须为 game');
  }
  if (typeof config.projectname !== 'string' || config.projectname.trim() === '') {
    pushIssue(report, 'error', 'project-name', 'project.config.json 缺少 projectname');
  }

  const appid = typeof config.appid === 'string' ? config.appid.trim().toLowerCase() : '';
  if (PLACEHOLDER_APP_IDS.has(appid)) {
    pushIssue(
      report,
      options.production ? 'error' : 'warning',
      'appid-placeholder',
      '当前 AppID 仍是 touristappid/占位值；提交生产版本前必须替换为主体已验证的小游戏 AppID',
      options.production,
    );
  }

  const setting = config.setting && typeof config.setting === 'object' ? config.setting : {};
  if (setting.minified !== true) {
    pushIssue(report, options.strict ? 'error' : 'warning', 'not-minified', 'setting.minified 未开启', true);
  }
  if (setting.compileHotReLoad === true) {
    pushIssue(
      report,
      options.strict ? 'error' : 'warning',
      'hot-reload-enabled',
      'setting.compileHotReLoad 仍开启，发布配置应关闭热更新',
      true,
    );
  }
  if (setting.urlCheck === false) {
    pushIssue(
      report,
      options.strict ? 'error' : 'warning',
      'url-check-disabled',
      'setting.urlCheck 未开启；即使当前离线，也建议生产配置开启域名校验',
      true,
    );
  }

  const ignored = Array.isArray(config.packOptions?.ignore) ? config.packOptions.ignore : [];
  for (const ignoredPath of ignored) {
    const normalized = normalizePath(String(ignoredPath)).replace(/^\.\//, '');
    if (RELEASE_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
      pushIssue(report, 'error', 'ignored-release-root', `packOptions.ignore 排除了发布内容：${normalized}`);
    }
  }
}

function checkPackageSize(report, options) {
  const releaseFiles = [];
  for (const root of RELEASE_ROOTS) walkFiles(resolve(projectDir, root), releaseFiles);
  const packageBytes = releaseFiles.reduce((sum, file) => sum + byteSize(file), 0);
  const distFiles = walkFiles(resolve(projectDir, 'dist'));
  const distBytes = distFiles.reduce((sum, file) => sum + byteSize(file), 0);
  report.summary.releaseFiles = releaseFiles.length;
  report.summary.packageBytes = packageBytes;
  report.summary.distBytes = distBytes;

  if (packageBytes > options.limits.packageBytes) {
    pushIssue(report, 'error', 'package-size', `发布内容 ${formatBytes(packageBytes)} 超过 ${formatBytes(options.limits.packageBytes)} 上限`);
  }
  if (distBytes > options.limits.distBytes) {
    pushIssue(report, 'error', 'dist-size', `dist ${formatBytes(distBytes)} 超过 ${formatBytes(options.limits.distBytes)} 上限`);
  }

  for (const file of releaseFiles) {
    const extension = extname(file).toLowerCase();
    const size = byteSize(file);
    if (extension === '.wav' && size > options.limits.wavBytes) {
      pushIssue(report, 'error', 'wav-size', `${relativePath(file)} 为 ${formatBytes(size)}，超过 ${formatBytes(options.limits.wavBytes)} 上限`);
    }
    if (extension === '.svg' && size > options.limits.svgBytes) {
      pushIssue(report, 'error', 'svg-size', `${relativePath(file)} 为 ${formatBytes(size)}，超过 ${formatBytes(options.limits.svgBytes)} 上限`);
    }
  }
}

function checkAssets(report) {
  const assetsDir = resolve(projectDir, 'assets');
  const manifest = readText(resolve(assetsDir, 'ASSET_MANIFEST.md')) ?? '';
  const assetFiles = walkFiles(assetsDir);
  report.summary.assetFiles = assetFiles.length;

  for (const file of assetFiles) {
    const relative = normalizePath(relativePath(file)).replace(/^assets\//, '');
    if (extname(file).toLowerCase() === '.md') continue;
    if (!manifest.includes(relative)) {
      pushIssue(report, 'warning', 'unregistered-asset', `资源未在 ASSET_MANIFEST.md 登记：assets/${relative}`, true);
    }
  }

  for (const file of assetFiles.filter((candidate) => extname(candidate).toLowerCase() === '.wav')) {
    const buffer = readFileSync(file);
    const relative = relativePath(file);
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      pushIssue(report, 'error', 'wav-header', `${relative} 不是 RIFF/WAVE 文件`);
      continue;
    }
    if (buffer.length < 36) {
      pushIssue(report, 'error', 'wav-short', `${relative} WAV 头不完整`);
      continue;
    }
    const channels = buffer.readUInt16LE(22);
    const sampleRate = buffer.readUInt32LE(24);
    const bits = buffer.readUInt16LE(34);
    if (channels !== 1 || sampleRate !== 22050 || bits !== 16) {
      pushIssue(report, 'error', 'wav-format', `${relative} 必须为 22050Hz/16-bit/mono`);
    }
  }

  const svgPath = resolve(assetsDir, 'generated/tideline-sprite.svg');
  const svg = readText(svgPath);
  if (svg !== undefined) {
    if (!svg.includes('<svg') || !svg.includes('</svg>')) {
      pushIssue(report, 'error', 'svg-structure', 'tideline-sprite.svg 结构不完整');
    }
    if (/(mtr|metro|subway|logo)/i.test(svg)) {
      pushIssue(report, 'error', 'svg-brand', 'SVG 含有现实交通品牌关键词');
    }
  }
}

function checkTextForReleaseRisks(report) {
  const roots = RELEASE_ROOTS.filter((root) => extname(root) || existsSync(resolve(projectDir, root)));
  const files = [];
  for (const root of roots) walkFiles(resolve(projectDir, root), files);
  const patterns = [
    {
      code: 'external-url',
      expression: /https?:\/\/(?!www\.w3\.org\/2000\/svg\b)[^\s"'<>]+/gi,
      message: '发现外部 URL（仅 SVG 标准命名空间允许）',
    },
    {
      code: 'network-api',
      expression: /\b(?:fetch|XMLHttpRequest|WebSocket)\b|\bwx\.(?:request|downloadFile|uploadFile|connectSocket|cloud)\b/g,
      message: '发现网络 API；MVP 必须保持离线可玩',
    },
    {
      code: 'dom-api',
      expression: /\bdocument(?:\.|\b)|\bwindow\.addEventListener\b|\b(?:createElement|innerHTML)\b/g,
      message: '发现 DOM/浏览器 API；小游戏入口应只使用 Canvas 和 wx 能力',
    },
    {
      code: 'external-font',
      expression: /@font-face|fonts?\.(?:googleapis|gstatic)|(?:loadFont|loadFontFace)|\.(?:woff2?|ttf|otf)\b/gi,
      message: '发现外部或未登记字体依赖',
    },
    {
      code: 'debug-hook',
      expression: /\bdebugger\b|__TIDELINE_RUNTIME__|\bconsole\.(?:log|debug|info|warn|error)\b/g,
      message: '发现发布调试接口或生产日志输出',
    },
    {
      code: 'source-map',
      expression: /sourceMappingURL|(?:^|[\\/"'])[^\\s"']+\.map(?:["']|$)/gim,
      message: '发现 source map 痕迹',
    },
  ];

  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const text = readText(file);
    if (text === undefined) continue;
    for (const pattern of patterns) {
      pattern.expression.lastIndex = 0;
      const match = pattern.expression.exec(text);
      if (!match) continue;
      const line = lineNumberAt(text, match.index);
      pushIssue(report, 'error', pattern.code, `${relativePath(file)}:${line} ${pattern.message}`);
    }
  }

  for (const file of files) {
    if (extname(file).toLowerCase() !== '.map') continue;
    pushIssue(report, 'error', 'source-map-file', `发布目录包含 source map：${relativePath(file)}`);
  }
}

function checkLicenseAndMetadata(report) {
  const licenseFiles = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];
  const hasLicense = licenseFiles.some((name) => existsSync(resolve(projectDir, name)));
  if (!hasLicense) {
    pushIssue(
      report,
      'warning',
      'license-pending',
      '尚未添加项目 LICENSE；M8 前需由权利人确认 MIT/Apache-2.0 或其他最终许可',
      false,
    );
  }
  const manifest = readText(resolve(projectDir, 'assets/ASSET_MANIFEST.md')) ?? '';
  if (!/许可证|license/i.test(manifest)) {
    pushIssue(report, 'error', 'asset-license-metadata', '资源清单缺少许可证字段');
  }
}

export function runReleaseAudit(options = {}) {
  const settings = {
    strict: Boolean(options.strict),
    production: Boolean(options.production),
    limits: { ...DEFAULT_LIMITS, ...(options.limits ?? {}) },
  };
  const report = {
    strict: settings.strict,
    production: settings.production,
    issues: [],
    summary: {
      releaseFiles: 0,
      assetFiles: 0,
      packageBytes: 0,
      distBytes: 0,
    },
  };

  checkRequiredFiles(report);
  checkBuildOutput(report);
  checkGameEntry(report);
  checkProjectConfig(report, settings);
  checkPackageSize(report, settings);
  checkAssets(report);
  checkTextForReleaseRisks(report);
  checkLicenseAndMetadata(report);

  const errors = report.issues.filter((issue) => issue.severity === 'error');
  const strictWarnings = settings.strict
    ? report.issues.filter((issue) => issue.severity === 'warning' && issue.strict)
    : [];
  report.ok = errors.length === 0 && strictWarnings.length === 0;
  report.errorCount = errors.length;
  report.warningCount = report.issues.filter((issue) => issue.severity === 'warning').length;
  report.strictFailureCount = strictWarnings.length;
  return report;
}

function printHumanReport(report) {
  const mode = report.production ? 'strict + production' : report.strict ? 'strict' : 'default';
  console.log(`M7 发布审计（${mode}）`);
  console.log(`发布文件：${report.summary.releaseFiles} 个，包体：${formatBytes(report.summary.packageBytes)}，dist：${formatBytes(report.summary.distBytes)}`);
  if (report.issues.length === 0) {
    console.log('通过：未发现阻断项。');
    return;
  }
  for (const issue of report.issues) {
    const label = issue.severity === 'error' ? 'ERROR' : 'WARN';
    const suffix = issue.severity === 'warning' && issue.strict ? ' [strict 阻断]' : '';
    console.log(`[${label}] ${issue.code}: ${issue.message}${suffix}`);
  }
  if (report.ok) console.log('结果：通过（默认/当前模式无阻断项）。');
  else console.log('结果：未通过，请修复上述阻断项后重试。');
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  const args = parseArgs(process.argv.slice(2));
  const report = runReleaseAudit(args);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);
  if (!report.ok) process.exitCode = 1;
}
