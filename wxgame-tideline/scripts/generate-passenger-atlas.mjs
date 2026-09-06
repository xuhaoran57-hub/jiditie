import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(projectDir, 'assets/generated/tideline-passenger-atlas.svg');
const ink = '#15263c';
const skin = '#ffd0aa';
const highlight = '#f4fff8';

const profiles = [
  { kind: 'regular', shirt: '#b8ddec', shadow: '#7599b5', pants: '#314d6b', hair: '#3a4155', accent: '#8be3e5' },
  { kind: 'fast', shirt: '#ffb36b', shadow: '#c8734c', pants: '#3d536e', hair: '#563a43', accent: '#ffe1a0' },
  { kind: 'slow', shirt: '#c7b9ee', shadow: '#8979ba', pants: '#4c4a79', hair: '#4c3c60', accent: '#f2dcff' },
  { kind: 'luggage', shirt: '#e8ca82', shadow: '#b28d4d', pants: '#4b4650', hair: '#50382f', accent: '#ffe6a9' },
  { kind: 'phone', shirt: '#82dce7', shadow: '#4e9eaf', pants: '#2f5068', hair: '#293d52', accent: '#dcffff' },
  { kind: 'group', shirt: '#ee9fc5', shadow: '#bd6f9b', pants: '#59405b', hair: '#50354e', accent: '#fff0f8' },
];

function line(d, color, width = 1.3) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function hairAndDetails(profile, x, y) {
  const h = profile.hair;
  switch (profile.kind) {
    case 'fast':
      return { hair: `<path d="M${x + 20} ${y + 18} Q${x + 21} ${y + 4} ${x + 33} ${y + 4} Q${x + 45} ${y + 4} ${x + 46} ${y + 15} L${x + 42} ${y + 12} L${x + 38} ${y + 15} L${x + 34} ${y + 10} Q${x + 28} ${y + 16} ${x + 22} ${y + 17} Z" fill="${h}" stroke="${ink}" stroke-width="1.5"/>${line(`M${x + 23} ${y + 9} Q${x + 32} ${y + 3} ${x + 42} ${y + 7}`, '#8a5b64', 1)}`, details: `<path d="M${x + 22} ${y + 29} L${x + 29} ${y + 34} L${x + 32} ${y + 29} L${x + 35} ${y + 34} L${x + 42} ${y + 29}" fill="${profile.accent}" stroke="${ink}" stroke-width="1.1"/>${line(`M${x + 32} ${y + 29} L${x + 32} ${y + 45}`, '#9c5d43', 1.1)}<rect x="${x + 24}" y="${y + 36}" width="5" height="4" rx="1" fill="#e18b59" stroke="${ink}" stroke-width="0.8"/><rect x="${x + 35}" y="${y + 36}" width="5" height="4" rx="1" fill="#e18b59" stroke="${ink}" stroke-width="0.8"/>` };
    case 'slow':
      return { hair: `<path d="M${x + 20} ${y + 18} Q${x + 21} ${y + 4} ${x + 32} ${y + 4} Q${x + 44} ${y + 4} ${x + 45} ${y + 18} L${x + 43} ${y + 23} L${x + 39} ${y + 18} L${x + 35} ${y + 14} Q${x + 32} ${y + 17} ${x + 29} ${y + 13} Q${x + 25} ${y + 18} ${x + 22} ${y + 23} Z" fill="${h}" stroke="${ink}" stroke-width="1.5"/>${line(`M${x + 23} ${y + 8} Q${x + 32} ${y + 2} ${x + 41} ${y + 8}`, '#796a9c', 1)}`, details: `<path d="M${x + 22} ${y + 29} L${x + 27} ${y + 34} L${x + 32} ${y + 29} L${x + 37} ${y + 34} L${x + 42} ${y + 29} V${y + 45} H${x + 22}Z" fill="#b6a4df" stroke="${ink}" stroke-width="1.1"/><path d="M${x + 32} ${y + 29} V${y + 45}" stroke="${profile.shadow}" stroke-width="1.1"/><circle cx="${x + 32}" cy="${y + 36}" r="1" fill="${ink}"/><circle cx="${x + 32}" cy="${y + 41}" r="1" fill="${ink}"/>` };
    case 'luggage':
      return { hair: `<path d="M${x + 21} ${y + 17} Q${x + 22} ${y + 5} ${x + 32} ${y + 5} Q${x + 42} ${y + 5} ${x + 44} ${y + 16} L${x + 41} ${y + 20} L${x + 37} ${y + 14} Q${x + 31} ${y + 17} ${x + 24} ${y + 17} L${x + 22} ${y + 22} Z" fill="${h}" stroke="${ink}" stroke-width="1.5"/>${line(`M${x + 25} ${y + 9} Q${x + 32} ${y + 5} ${x + 40} ${y + 9}`, '#8c6a4a', 1)}`, details: `<path d="M${x + 22} ${y + 29} H${x + 42} V${y + 45} H${x + 22}Z" fill="#d9b467" stroke="${ink}" stroke-width="1.1"/><path d="M${x + 25} ${y + 29} L${x + 32} ${y + 36} L${x + 39} ${y + 29}" fill="${profile.accent}" stroke="${ink}" stroke-width="1.1"/>${line(`M${x + 22} ${y + 37} H${x + 42}`, '#9c7d44', 1.1)}<rect x="${x + 24}" y="${y + 39}" width="5" height="3" rx="0.8" fill="#b28d4d" stroke="${ink}" stroke-width="0.7"/><rect x="${x + 35}" y="${y + 39}" width="5" height="3" rx="0.8" fill="#b28d4d" stroke="${ink}" stroke-width="0.7"/><rect x="${x + 48}" y="${y + 35}" width="8" height="12" rx="2" fill="#d9a94e" stroke="${ink}" stroke-width="1.2"/>${line(`M${x + 50} ${y + 35} V${y + 32} H${x + 54} V${y + 35}`, ink, 1.1)}<path d="M${x + 50} ${y + 39} H${x + 54}" stroke="#ffe7a8" stroke-width="1"/>` };
    case 'phone':
      return { hair: `<path d="M${x + 21} ${y + 17} Q${x + 22} ${y + 5} ${x + 32} ${y + 5} Q${x + 43} ${y + 5} ${x + 44} ${y + 17} L${x + 40} ${y + 14} L${x + 37} ${y + 10} L${x + 34} ${y + 14} L${x + 30} ${y + 9} L${x + 26} ${y + 14} L${x + 23} ${y + 12} Z" fill="${h}" stroke="${ink}" stroke-width="1.5"/>${line(`M${x + 24} ${y + 8} L${x + 27} ${y + 5} M${x + 30} ${y + 7} L${x + 33} ${y + 4} M${x + 36} ${y + 7} L${x + 39} ${y + 5}`, '#4d647c', 1)}`, details: `<path d="M${x + 22} ${y + 29} Q${x + 32} ${y + 34} ${x + 42} ${y + 29} V${y + 45} H${x + 22}Z" fill="#69cbd4" stroke="${ink}" stroke-width="1.1"/><path d="M${x + 25} ${y + 31} Q${x + 32} ${y + 36} ${x + 39} ${y + 31}" fill="none" stroke="${profile.accent}" stroke-width="1.3"/><path d="M${x + 27} ${y + 39} H${x + 37} V${y + 44} H${x + 27}Z" fill="#4e9eaf" stroke="${ink}" stroke-width="0.9"/><rect x="${x + 46}" y="${y + 26}" width="6" height="9" rx="1.2" fill="#ecffff" stroke="#1d596d" stroke-width="1.1"/><path d="M${x + 47.5} ${y + 28} H${x + 50.5}" stroke="#83cdd7" stroke-width="0.8"/>` };
    case 'group':
      return { hair: `<circle cx="${x + 44}" cy="${y + 7}" r="5" fill="${h}" stroke="${ink}" stroke-width="1.3"/><path d="M${x + 21} ${y + 17} Q${x + 22} ${y + 4} ${x + 32} ${y + 4} Q${x + 42} ${y + 4} ${x + 44} ${y + 15} L${x + 40} ${y + 11} Q${x + 36} ${y + 13} ${x + 32} ${y + 10} Q${x + 27} ${y + 13} ${x + 22} ${y + 11} Z" fill="${h}" stroke="${ink}" stroke-width="1.5"/>${line(`M${x + 24} ${y + 10} Q${x + 32} ${y + 7} ${x + 40} ${y + 10}`, '#7b5a78', 1)}<path d="M${x + 48} ${y + 6} l4 2 l-3 3 l-3 -2" fill="#fff0f8" stroke="#bd6f9b" stroke-width="1"/>`, details: `<path d="M${x + 22} ${y + 29} Q${x + 32} ${y + 25} ${x + 42} ${y + 29} V${y + 45} H${x + 22}Z" fill="#e59ac0" stroke="${ink}" stroke-width="1.1"/><path d="M${x + 25} ${y + 29} L${x + 32} ${y + 35} L${x + 39} ${y + 29}" fill="#fff2f8" stroke="${ink}" stroke-width="1.1"/><path d="M${x + 26} ${y + 39} Q${x + 32} ${y + 35} ${x + 38} ${y + 39}" fill="none" stroke="#fff0f8" stroke-width="1.1"/><circle cx="${x + 32}" cy="${y + 39}" r="1.2" fill="#fff0f8"/><path d="M${x + 15} ${y + 28} Q${x + 32} ${y + 23} ${x + 49} ${y + 28}" fill="none" stroke="#fff0f8" stroke-width="1.8"/>` };
    case 'regular':
    default:
      return { hair: `<path d="M${x + 21} ${y + 18} Q${x + 22} ${y + 4} ${x + 34} ${y + 5} Q${x + 44} ${y + 6} ${x + 44} ${y + 17} L${x + 42} ${y + 23} Q${x + 38} ${y + 18} ${x + 37} ${y + 14} Q${x + 31} ${y + 19} ${x + 25} ${y + 18} L${x + 22} ${y + 23} Z" fill="${h}" stroke="${ink}" stroke-width="1.5"/>${line(`M${x + 24} ${y + 11} Q${x + 30} ${y + 7} ${x + 38} ${y + 9}`, '#657086', 1)}`, details: `<path d="M${x + 24} ${y + 29} L${x + 32} ${y + 35} L${x + 40} ${y + 29}" fill="${profile.accent}" stroke="${ink}" stroke-width="1.1"/>${line(`M${x + 32} ${y + 35} L${x + 32} ${y + 45}`, profile.shadow, 1)}<rect x="${x + 13}" y="${y + 29}" width="6" height="13" rx="2" fill="#28445a" stroke="${ink}" stroke-width="1.5"/>` };
  }
}

function frame(profile, frameIndex, x, y) {
  const stride = frameIndex === 1 ? -3 : frameIndex === 2 ? 3 : 0;
  const guide = frameIndex === 3;
  const leftArm = guide ? `M${x + 21} ${y + 31} L${x + 13} ${y + 23}` : `M${x + 21} ${y + 31} L${x + 14} ${y + 38}`;
  const rightArm = guide ? `M${x + 43} ${y + 31} L${x + 52} ${y + 18}` : `M${x + 43} ${y + 31} L${x + 50} ${y + 38}`;
  const { hair, details } = hairAndDetails(profile, x, y);
  return `<g><ellipse cx="${x + 32}" cy="${y + 57}" rx="13" ry="3.3" fill="#102b3a" opacity="0.65"/>${line(`M${x + 26} ${y + 45} L${x + 23 + stride} ${y + 55} M${x + 38} ${y + 45} L${x + 41 - stride} ${y + 55}`, '#07121e', 4)}${line(leftArm, skin, 3)}${line(rightArm, skin, 3)}<rect x="${x + 20}" y="${y + 27}" width="24" height="21" rx="7" fill="${profile.shadow}" stroke="${ink}" stroke-width="2"/><rect x="${x + 22}" y="${y + 25}" width="20" height="19" rx="6" fill="${profile.shirt}" stroke="${ink}" stroke-width="2"/><path d="M${x + 24} ${y + 43} Q${x + 32} ${y + 46} ${x + 40} ${y + 43}" fill="none" stroke="${highlight}" stroke-width="1" opacity="0.75"/><circle cx="${x + 32}" cy="${y + 17}" r="12" fill="${skin}" stroke="${ink}" stroke-width="2"/>${hair}<circle cx="${x + 28}" cy="${y + 18}" r="1.5" fill="${ink}"/><circle cx="${x + 36}" cy="${y + 18}" r="1.5" fill="${ink}"/><path d="M${x + 28} ${y + 24} Q${x + 32} ${y + 26} ${x + 36} ${y + 24}" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linecap="round"/>${details}</g>`;
}

const rows = profiles.map((profile, row) => Array.from({ length: 4 }, (_, frameIndex) => frame(profile, frameIndex, frameIndex * 64, row * 64)).join('')).join('');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="256" height="384" viewBox="0 0 256 384">${rows}</svg>\n`);
console.log(`generated ${output}`);
