import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = resolve(projectDir, 'assets');
const manifestPath = resolve(assetsDir, 'ASSET_MANIFEST.md');

const requiredFiles = [
  'generated/tideline-sprite.svg',
  'generated/tideline-player-sprite.svg',
  'generated/tideline-player-sprite.png',
  'generated/tideline-passenger-regular-sprite.png',
  'generated/tideline-passenger-fast-sprite.png',
  'generated/tideline-passenger-luggage-sprite.png',
  'generated/tideline-passenger-atlas.svg',
  'generated/tideline-passenger-atlas.png',
  'audio/tideline-loop.wav',
  'audio/tideline-loop.mp3',
  'audio/ui-guide.wav',
  'audio/ui-success.wav',
  'audio/ui-failure.wav',
  'audio/event-alert.wav',
  'design-tokens.json',
];

function fail(message) {
  console.error(`资源检查失败：${message}`);
  process.exitCode = 1;
}

for (const relative of requiredFiles) {
  const file = resolve(assetsDir, relative);
  if (!existsSync(file) || !statSync(file).isFile()) fail(`缺少 ${relative}`);
}

const manifest = readFileSync(manifestPath, 'utf8');
for (const relative of requiredFiles) {
  if (!manifest.includes(relative)) fail(`清单未登记 ${relative}`);
}

try {
  const tokens = JSON.parse(readFileSync(resolve(assetsDir, 'design-tokens.json'), 'utf8'));
  const requiredColors = ['ink', 'accent', 'safe', 'warning', 'gold', 'text', 'muted'];
  for (const key of requiredColors) {
    if (typeof tokens.color?.[key] !== 'string') fail(`tokens 缺少 color.${key}`);
  }
  if (tokens.typography?.family !== '"PingFang SC", "Microsoft YaHei", sans-serif') {
    fail('字体栈与 FONT_POLICY.md 不一致');
  }
} catch (error) {
  fail(`design-tokens.json 无法解析：${error instanceof Error ? error.name : 'unknown'}`);
}

try {
  const svg = readFileSync(resolve(assetsDir, 'generated/tideline-sprite.svg'), 'utf8');
  if (!svg.includes('<svg') || !svg.includes('</svg>')) fail('SVG 结构不完整');
  for (const id of ['player', 'passenger-regular', 'passenger-fast', 'passenger-slow', 'passenger-luggage', 'passenger-phone', 'passenger-group', 'station-badge', 'icon-guide', 'icon-pause', 'icon-route', 'icon-retry']) {
    if (!svg.includes(`id="${id}"`)) fail(`SVG 缺少符号 ${id}`);
  }
  if (/(mtr|metro|subway|logo)/i.test(svg)) fail('SVG 含有受限品牌关键词');
} catch (error) {
  fail(`SVG 无法读取：${error instanceof Error ? error.name : 'unknown'}`);
}

try {
  const playerSvg = readFileSync(resolve(assetsDir, 'generated/tideline-player-sprite.svg'), 'utf8');
  if (!playerSvg.includes('<svg') || !playerSvg.includes('</svg>')) fail('玩家 Sprite SVG 结构不完整');
  if (!/width="256"[^>]*height="64"/.test(playerSvg)) fail('玩家 Sprite SVG 必须是 256x64 四帧图集');
  if (/(mtr|metro|subway|logo)/i.test(playerSvg)) fail('玩家 Sprite SVG 含有受限品牌关键词');
} catch (error) {
  fail(`玩家 Sprite SVG 无法读取：${error instanceof Error ? error.name : 'unknown'}`);
}

function checkSpritePng(relative, label, expectedHeight = 64) {
  try {
    const spritePng = readFileSync(resolve(assetsDir, relative));
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!spritePng.subarray(0, 8).equals(pngSignature)) fail(`${label} PNG 不是有效 PNG`);
    if (spritePng.readUInt32BE(16) !== 256 || spritePng.readUInt32BE(20) !== expectedHeight) {
      fail(`${label} PNG 必须是 256x${expectedHeight} 图集`);
    }
    if (spritePng.length > 128 * 1024) fail(`${label} PNG 超过 128KB 包体预算`);
  } catch (error) {
    fail(`${label} PNG 无法读取：${error instanceof Error ? error.name : 'unknown'}`);
  }
}

checkSpritePng('generated/tideline-player-sprite.png', '玩家 Sprite');
checkSpritePng('generated/tideline-passenger-regular-sprite.png', '普通 NPC Sprite');
checkSpritePng('generated/tideline-passenger-fast-sprite.png', '快步 NPC Sprite');
checkSpritePng('generated/tideline-passenger-luggage-sprite.png', '行李 NPC Sprite');
checkSpritePng('generated/tideline-passenger-atlas.png', 'NPC PNG 图集', 384);

try {
  const atlas = readFileSync(resolve(assetsDir, 'generated/tideline-passenger-atlas.svg'), 'utf8');
  if (!atlas.includes('<svg') || !atlas.includes('</svg>')) fail('NPC Sprite 图集 SVG 结构不完整');
  if (!/width="256"[^>]*height="384"/.test(atlas)) fail('NPC Sprite 图集必须是 256x384 六行四帧图集');
  if (/(mtr|metro|subway|logo)/i.test(atlas)) fail('NPC Sprite 图集含有受限品牌关键词');
} catch (error) {
  fail(`NPC Sprite 图集无法读取：${error instanceof Error ? error.name : 'unknown'}`);
}

for (const relative of requiredFiles.filter((file) => file.endsWith('.wav'))) {
  try {
    const buffer = readFileSync(resolve(assetsDir, relative));
    const maxBytes = relative === 'audio/tideline-loop.wav' ? 1024 * 1024 : 256 * 1024;
    const channels = buffer.readUInt16LE(22);
    const sampleRate = buffer.readUInt32LE(24);
    const bits = buffer.readUInt16LE(34);
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      fail(`${relative} 不是 RIFF/WAVE`);
    }
    if (channels !== 1 || sampleRate !== 22050 || bits !== 16) {
      fail(`${relative} 音频格式不是 22050Hz/16-bit/mono`);
    }
    if (buffer.length > maxBytes) fail(`${relative} 超过 ${Math.round(maxBytes / 1024)}KB 包体预算`);
  } catch (error) {
    fail(`${relative} 无法读取：${error instanceof Error ? error.name : 'unknown'}`);
  }
}

// 生产 BGM 为带 LAME 延迟/填充信息的 MPEG-2 Layer III；逐帧检查，防止误传 WAV 或截断文件。
try {
  const mp3 = readFileSync(resolve(assetsDir, 'audio/tideline-loop.mp3'));
  let offset = 0;
  let frames = 0;
  while (offset + 4 <= mp3.length) {
    const header = mp3.readUInt32BE(offset);
    if ((header >>> 21) !== 0x7ff || ((header >>> 19) & 3) !== 2 || ((header >>> 17) & 3) !== 1
      || ((header >>> 12) & 15) !== 10 || ((header >>> 10) & 3) !== 0 || ((header >>> 6) & 3) !== 3) {
      throw new Error('需要 22050Hz / 96kbps / mono MPEG-2 Layer III');
    }
    offset += Math.floor(72 * 96000 / 22050) + ((header >>> 9) & 1);
    frames += 1;
  }
  if (offset !== mp3.length || frames < 700 || frames > 730) throw new Error('帧数、时长或完整性异常');
  if (!mp3.subarray(0, 313).includes(Buffer.from('Info')) || !mp3.subarray(0, 313).includes(Buffer.from('LAME'))) {
    throw new Error('缺少循环所需的 LAME 延迟/填充元数据');
  }
  const tag = mp3.indexOf(Buffer.from('LAME'));
  const encoderDelay = (mp3[tag + 21] << 4) | (mp3[tag + 22] >>> 4);
  const encoderPadding = ((mp3[tag + 22] & 15) << 8) | mp3[tag + 23];
  const source = readFileSync(resolve(assetsDir, 'audio/tideline-loop.wav'));
  if ((frames - 1) * 576 - encoderDelay - encoderPadding !== source.readUInt32LE(40) / 2) {
    throw new Error('MP3 的有效采样数与源 WAV 不一致，请重新压缩背景音乐');
  }
  if (mp3.length > 256 * 1024) throw new Error('超过 256KiB 预算');
} catch (error) {
  fail(`BGM MP3 无法验证：${error.message}`);
}

if (!process.exitCode) console.log(`资源检查通过：${requiredFiles.length} 个条目`);
