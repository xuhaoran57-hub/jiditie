import type { Canvas2DContextLike } from './context.ts';

// Coordinates use the player's 64px frame, with its centre as the origin.
// Each pose has its own head and collar anchors; the raised hand stays uncovered.
const POSES = [
  { headX: 0, headY: -18, bodyX: 0, bodyY: 1 },
  { headX: -1, headY: -18, bodyX: -1, bodyY: 1 },
  { headX: 2, headY: -18, bodyX: 1, bodyY: 1 },
  { headX: 0, headY: -18, bodyX: 0, bodyY: 1 },
] as const;

const INK = '#14283d';
const NAVY = '#243e55';
const THEMES = {
  endless5: { cloth: '#a8c6d8', shade: '#608399', light: '#e0eff4', metal: '#cde7ef' },
  endless10: { cloth: '#579e9b', shade: '#306b74', light: '#aadad1', metal: '#d8eade' },
  endless15: { cloth: '#314b62', shade: '#203448', light: '#587087', metal: '#e5bb65' },
  endless20: { cloth: '#53698d', shade: '#304660', light: '#839bbe', metal: '#d3e5f3' },
} as const;

export function hasPlayerAccessory(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(THEMES, id);
}

/** Shared artwork for the cached sprite and the Canvas-only fallback. */
export function paintPlayerAccessory(
  ctx: Canvas2DContextLike,
  id: string,
  frameIndex = 0,
  geometry = false,
): void {
  if (!hasPlayerAccessory(id)) return;
  const theme = THEMES[id as keyof typeof THEMES];
  const pose = POSES[((Math.floor(frameIndex) % POSES.length) + POSES.length) % POSES.length] ?? POSES[0];
  const shape = (points: readonly number[], fill: string, outline = true) => {
    ctx.beginPath();
    ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
  };
  const seam = (points: readonly number[], color: string, width = 1) => {
    ctx.beginPath();
    ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  const badge = (x: number, y: number, color: string) => {
    shape([x - 2, y - 2, x + 2, y - 2, x + 2, y + 1, x, y + 3, x - 2, y + 1], color);
    seam([x - 0.8, y, x + 0.8, y], '#fff3cd', 0.8);
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.translate(geometry ? 0 : pose.bodyX, geometry ? 3 : pose.bodyY);
  if (geometry) ctx.scale(0.85, 0.85);
  // Small pieces sit inside the existing jacket, leaving its shading and arms visible.
  if (id === 'endless5') {
    shape([-8, -3, -5, -5, -2, -1, -4, 8, -7, 8], theme.shade);
    shape([5, -5, 8, -3, 7, 8, 4, 8, 2, -1], theme.shade);
    seam([-6, -2, -5, 6], theme.light, 1.5);
    seam([6, -2, 5, 6], theme.light, 1.5);
    shape([3, 1, 7, 1, 7, 4, 3, 4], NAVY);
    seam([4, 2, 6, 2], theme.metal);
  } else if (id === 'endless10') {
    shape([-7, -5, -2, -2, 5, -5, 7, -2, 2, 1, -5, -1], theme.shade);
    shape([2, 0, 6, -1, 7, 8, 4, 10, 2, 7], theme.cloth);
    seam([-5, -3, -1, -1, 4, -3], theme.light, 1.4);
    seam([4, 2, 5, 7], theme.light);
  } else if (id === 'endless15') {
    shape([-8, -4, -4, -5, 0, 0, -3, 4, -6, 0], NAVY);
    shape([4, -5, 8, -4, 6, 0, 3, 4, 0, 0], NAVY);
    seam([-7, -3, -4, -4, -1, 0], theme.metal);
    seam([7, -3, 4, -4, 1, 0], theme.metal);
    shape([-10, -2, -7, -4, -4, -2, -7, 0], theme.metal);
    shape([5, -2, 8, -4, 10, -2, 7, 0], theme.metal);
    badge(5, 4, theme.metal);
  } else {
    shape([-8, -5, -3, -3, 5, -5, 8, -2, 3, 1, -5, 0], theme.metal);
    shape([3, 0, 7, -1, 8, 7, 5, 10, 2, 7], '#9cb7d2');
    seam([-6, -3, -2, -1, 4, -3], '#f0f5fa', 1.4);
    seam([5, 2, 6, 6], theme.metal);
    shape([-10, -2, -7, -4, -4, -2, -7, 0], theme.cloth);
    seam([-9, -2, -6, -2], theme.metal);
    badge(-5, 4, theme.metal);
  }
  ctx.restore();

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.translate(geometry ? 0 : pose.headX, geometry ? -20 : pose.headY);
  if (geometry) ctx.scale(0.82, 0.82);
  if (id === 'endless5') {
    // Soft patrol cap: curved crown, shaded side panel and a connected dark bill.
    shape([-12, -1, -11, -6, -7, -10, 1, -11, 8, -8, 11, -3, 10, 1, -7, 2], theme.cloth);
    shape([2, -10, 8, -8, 11, -3, 10, 1, 4, 0, 4, -5], theme.shade, false);
    seam([-9, -5, -6, -8, 0, -9], theme.light, 1.5);
    seam([0, -9, 2, -5, 2, -2], '#7e9eaf');
    shape([-12, -1, -4, -2, 5, -1, 12, 2, 10, 4, 2, 4, -7, 2], NAVY);
    seam([-10, 0, -3, -1, 5, 0, 10, 2], theme.metal);
    badge(-3, -5, theme.metal);
  } else if (id === 'endless10') {
    // Ribbed knit cap and one compact ear cup, fitted around the face.
    shape([-11, -1, -11, -6, -7, -10, 1, -11, 8, -8, 11, -3, 10, 1], theme.cloth);
    shape([3, -10, 8, -8, 11, -3, 10, 1, 6, 0, 5, -5], theme.shade, false);
    seam([-7, -7, -8, -3], theme.light);
    seam([-3, -9, -4, -3], theme.light);
    seam([1, -9, 1, -3], theme.light);
    shape([-12, -2, -5, -3, 4, -2, 11, 0, 10, 3, 2, 1, -6, 0, -12, 1], theme.shade);
    seam([-10, -1, -4, -2, 4, -1], theme.light);
    shape([7, 0, 11, 0, 12, 3, 11, 8, 8, 8, 7, 5], NAVY);
    shape([9, 2, 11, 3, 10, 6, 9, 6], theme.metal, false);
    seam([10, 7, 8, 10, 5, 10], INK, 1.5);
  } else if (id === 'endless15') {
    // A navy conductor cap keeps gold as trim instead of a flat yellow slab.
    shape([-13, -3, -12, -7, -7, -10, 3, -11, 11, -8, 13, -4, 9, 0, -9, 0], theme.cloth);
    shape([3, -10, 11, -8, 13, -4, 9, 0, 4, -1], theme.shade, false);
    seam([-10, -6, -6, -8, 2, -9, 8, -7], theme.light, 1.4);
    shape([-11, -2, -3, -3, 10, -1, 9, 2, -10, 1], NAVY);
    seam([-10, -1, -3, -2, 9, 0], theme.metal, 1.8);
    shape([-10, 1, -2, 0, 9, 2, 11, 4, 7, 5, -1, 4, -8, 3], INK);
    seam([-7, 2, 0, 3, 7, 4], theme.metal);
    badge(-2, -6, theme.metal);
  } else {
    // An asymmetric beret and silver badge replace the disconnected halo blocks.
    shape([-13, -3, -11, -8, -5, -11, 4, -11, 12, -8, 13, -4, 9, -1, 3, 0, -10, 0], theme.cloth);
    shape([4, -10, 12, -8, 13, -4, 9, -1, 3, 0, 5, -4], theme.shade, false);
    seam([-10, -6, -5, -9, 2, -9], theme.light, 1.5);
    shape([-11, -2, -4, -3, 4, -2, 9, 0, 8, 2, 1, 0, -6, 0, -11, 1], NAVY);
    seam([-9, -1, -4, -2, 3, -1], theme.metal);
    badge(5, -5, theme.metal);
  }
  ctx.restore();
}
