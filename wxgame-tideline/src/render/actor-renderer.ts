import type { GameState, LevelConfig, Passenger, PassengerKind, Vec2 } from '../core/types.ts';
import { normalize } from '../core/vector.ts';
import { fillRoundRect, RenderContext, strokeRoundRect } from './context.ts';
import { TIDELINE_TOKENS } from './design-tokens.ts';

interface CharacterPalette {
  shirt: string;
  shirtShadow: string;
  pants: string;
  hair: string;
  skin: string;
  accent: string;
}

const PASSENGER_PALETTES: Record<PassengerKind, CharacterPalette> = {
  regular: {
    shirt: '#b8ddec',
    shirtShadow: '#7599b5',
    pants: '#314d6b',
    hair: '#3a4155',
    skin: '#ffd0aa',
    accent: '#f1ffff',
  },
  fast: {
    shirt: '#ffb36b',
    shirtShadow: '#c8734c',
    pants: '#3d536e',
    hair: '#563a43',
    skin: '#ffd2a6',
    accent: '#fff0bc',
  },
  slow: {
    shirt: '#c7b9ee',
    shirtShadow: '#8979ba',
    pants: '#4c4a79',
    hair: '#4c3c60',
    skin: '#f4c8aa',
    accent: '#fbf4ff',
  },
  luggage: {
    shirt: '#e8ca82',
    shirtShadow: '#b28d4d',
    pants: '#4b4650',
    hair: '#50382f',
    skin: '#ffd0a7',
    accent: '#fff1bd',
  },
  phone: {
    shirt: '#82dce7',
    shirtShadow: '#4e9eaf',
    pants: '#2f5068',
    hair: '#293d52',
    skin: '#ffd0a8',
    accent: '#dcffff',
  },
  group: {
    shirt: '#ee9fc5',
    shirtShadow: '#bd6f9b',
    pants: '#59405b',
    hair: '#50354e',
    skin: '#ffd1aa',
    accent: '#fff0f8',
  },
};

const PASSENGER_COLORS: Record<PassengerKind, string> = Object.fromEntries(
  (Object.entries(PASSENGER_PALETTES) as Array<[PassengerKind, CharacterPalette]>).map(([kind, palette]) => [kind, palette.shirt]),
) as Record<PassengerKind, string>;

function drawCircle(
  context: RenderContext,
  center: Vec2,
  radius: number,
  fill: string,
  stroke?: string,
  lineWidth = 1,
): void {
  const { ctx } = context;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawEllipse(
  context: RenderContext,
  center: Vec2,
  radiusX: number,
  radiusY: number,
  fill: string,
  stroke?: string,
  lineWidth = 1,
): void {
  const { ctx } = context;
  ctx.save();
  let usedNativeEllipse = false;
  if (typeof ctx.ellipse === 'function') {
    try {
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2);
      usedNativeEllipse = true;
    } catch {
      // 部分基础库会暴露 ellipse 名称，但调用时仍抛出异常；下面走缩放圆回退。
      usedNativeEllipse = false;
    }
  }
  if (!usedNativeEllipse) {
    ctx.beginPath();
    ctx.translate(center.x, center.y);
    ctx.scale(radiusX, radiusY);
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function actorSeed(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function drawShadow(context: RenderContext, position: Vec2, radius: number, alpha = 0.42): void {
  const shadow = { x: position.x, y: position.y + radius * 0.78 };
  const { ctx } = context;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (context.layout.orientation === 'landscape') {
    // 世界层旋转后，阴影也反向旋回，仍保持屏幕水平方向贴地。
    ctx.translate(shadow.x, shadow.y);
    ctx.rotate(Math.PI / 2);
    drawEllipse(context, { x: 0, y: 0 }, radius * 0.78, radius * 0.28, '#102b3a');
  } else {
    drawEllipse(context, shadow, radius * 0.78, radius * 0.28, '#102b3a');
  }
  ctx.restore();
}

function drawMiniCompanion(context: RenderContext, palette: CharacterPalette, offset: Vec2, alpha: number): void {
  const { ctx } = context;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(offset.x, offset.y);
  // 世界层横屏时逆时针旋转，角色几何体反向旋回，保证头部始终朝屏幕上方。
  if (context.layout.orientation === 'landscape') ctx.rotate(Math.PI / 2);
  ctx.scale(0.7, 0.7);
  drawEllipse(context, { x: 0, y: 5 }, 7, 3, '#173348');
  ctx.fillStyle = palette.pants;
  ctx.fillRect(-4, 1, 8, 9);
  ctx.fillStyle = palette.shirt;
  ctx.fillRect(-5, -4, 10, 8);
  drawCircle(context, { x: 0, y: -8 }, 4.2, palette.skin, '#f4fff8', 1.25);
  ctx.fillStyle = palette.hair;
  ctx.beginPath();
  ctx.arc(0, -9, 4.2, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCharacterBody(
  context: RenderContext,
  palette: CharacterPalette,
  radius: number,
  walkPhase: number,
  kind: PassengerKind,
  inside = false,
): void {
  const { ctx } = context;
  const scale = Math.max(0.76, Math.min(1.65, (radius / 9) * (inside ? 1.1 : 1)));
  const stride = Math.sin(walkPhase) * 1.8;
  const oppositeStride = Math.sin(walkPhase + Math.PI) * 1.8;

  ctx.save();
  // 角色不跟随横屏世界层旋转，始终保持头朝屏幕上方。
  if (context.layout.orientation === 'landscape') ctx.rotate(Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 背包/行李先画在身体后面，避免角色看起来像一个悬浮圆点。
  if (kind === 'luggage') {
    fillRoundRect(ctx, 7, -1, 8, 12, 2.5, '#79523d');
    strokeRoundRect(ctx, 7, -1, 8, 12, 2.5, '#e6c18b', 1);
    ctx.strokeStyle = '#efcf9a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(9, -1);
    ctx.lineTo(9, -5);
    ctx.lineTo(13, -5);
    ctx.lineTo(13, -1);
    ctx.stroke();
  }

  // 腿、鞋和身体投影。
  ctx.strokeStyle = palette.pants;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(-2.7, 7);
  ctx.lineTo(-3.1 + stride, 12);
  ctx.moveTo(2.7, 7);
  ctx.lineTo(3.1 + oppositeStride, 12);
  ctx.stroke();
  ctx.strokeStyle = '#101827';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-3.1 + stride, 12);
  ctx.lineTo(-5.2 + stride, 12);
  ctx.moveTo(3.1 + oppositeStride, 12);
  ctx.lineTo(5.2 + oppositeStride, 12);
  ctx.stroke();

  fillRoundRect(ctx, -6, -1, 12, 11, 4, palette.shirtShadow);
  fillRoundRect(ctx, -5.3, -2.4, 10.6, 9.5, 3.5, palette.shirt);
  strokeRoundRect(
    ctx,
    -6,
    -1,
    12,
    11,
    4,
    inside ? '#f4fff8' : TIDELINE_TOKENS.color.actorInk,
    inside ? 1.25 : 1,
  );
  // 衣服中心的高光和领口，提供身体朝向。
  ctx.fillStyle = palette.accent;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(-1, -1, 2, 7);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = palette.shirtShadow;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-3, -1);
  ctx.lineTo(0, 2);
  ctx.lineTo(3, -1);
  ctx.stroke();

  // 手臂随行走摆动；手机客的手臂会略微抬起。
  const armLift = kind === 'phone' ? -2 : 0;
  ctx.strokeStyle = palette.skin;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(-7.2 - oppositeStride * 0.55, 4 + armLift);
  ctx.moveTo(5, 0);
  ctx.lineTo(7.2 - stride * 0.55, 4 + armLift);
  ctx.stroke();

  // 头部、发型和面部方向点。
  drawCircle(context, { x: 0, y: -7.3 }, 4.7, palette.skin, inside ? '#f4fff8' : TIDELINE_TOKENS.color.actorInk, inside ? 1.7 : 1.5);
  ctx.fillStyle = palette.hair;
  ctx.beginPath();
  ctx.arc(0, -8.3, 4.8, Math.PI * 1.05, Math.PI * 1.98);
  ctx.lineTo(3.8, -8.2);
  ctx.lineTo(2.3, -5.2);
  ctx.lineTo(-3.8, -5.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = palette.accent;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(1.8, -7.8, 1.4, 1.4);
  ctx.globalAlpha = 1;

  if (kind === 'phone') {
    fillRoundRect(ctx, 6.3, -0.5, 3.4, 6.2, 1, '#15263b');
    ctx.fillStyle = '#b9fbff';
    ctx.fillRect(7.1, 0.6, 1.8, 3.1);
    ctx.fillStyle = '#6bd7e1';
    ctx.fillRect(7.6, 4.5, 0.8, 0.8);
  } else if (kind === 'slow') {
    ctx.strokeStyle = '#d9d2ba';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(7, 2);
    ctx.lineTo(9, 11);
    ctx.lineTo(8, 12);
    ctx.stroke();
  } else if (kind === 'regular') {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(-2, 1, 4, 2);
  }
  ctx.restore();
}

function drawPassenger(context: RenderContext, passenger: Passenger, now: number): void {
  const { ctx } = context;
  const palette = PASSENGER_PALETTES[passenger.kind];
  const inside = passenger.role === 'inside';
  const boarding = passenger.role === 'boarding';
  const phase = actorSeed(passenger.id) * Math.PI * 2;
  const walkPhase = now * (passenger.kind === 'fast' ? 11 : passenger.kind === 'slow' ? 4.5 : 7) + phase;
  const moving = passenger.role !== 'waiting' && passenger.role !== 'inside';
  const alphaBefore = ctx.globalAlpha;
  if (inside || boarding) {
    // 车内角色使用地板反光和高对比轮廓，明确表示已经越过门槛。
    ctx.save();
    ctx.globalAlpha *= inside ? 0.28 : 0.18;
    drawEllipse(
      context,
      { x: passenger.position.x, y: passenger.position.y + passenger.radius * 0.72 },
      passenger.radius * 1.02,
      passenger.radius * 0.34,
      '#b5fff0',
    );
    ctx.restore();
  }
  if (passenger.kind === 'group') {
    drawMiniCompanion(context, palette, { x: passenger.position.x - passenger.radius * 0.85, y: passenger.position.y + passenger.radius * 0.18 }, 0.9);
  }
  drawShadow(context, passenger.position, passenger.radius, inside ? 0.22 : 0.42);
  // 身体几何以角色位置为局部原点；没有这次平移时，头/身体会落在世界原点，
  // 乘客虽然在规则层移动，画面里却看起来像没有跟着走。
  ctx.save();
  ctx.translate(passenger.position.x, passenger.position.y);
  // 角色始终以屏幕上方为头部方向；行走状态只改变步伐，不旋转人物轮廓。
  drawCharacterBody(context, palette, passenger.radius, moving ? walkPhase : phase, passenger.kind, inside || boarding);
  ctx.restore();
  ctx.globalAlpha = alphaBefore;
}

function drawPlayer(context: RenderContext, state: GameState): void {
  const { ctx } = context;
  const player = state.player;
  const direction = normalize(player.facing, { x: 0, y: -1 });
  const phase = state.elapsed * 8;
  const stride = Math.sin(phase) * 1.8;

  drawShadow(context, player.position, player.radius, 0.52);
  ctx.save();
  if (player.inSafeZone) {
    ctx.globalAlpha = 0.2;
    drawCircle(context, player.position, player.radius + 11 + Math.sin(state.elapsed * 6) * 1.5, TIDELINE_TOKENS.color.safe);
    ctx.globalAlpha = 1;
  }
  ctx.translate(player.position.x, player.position.y);
  // 玩家角色保持屏幕朝向；移动箭头在世界层中绘制，仍然指向真实行进方向。
  if (context.layout.orientation === 'landscape') ctx.rotate(Math.PI / 2);
  ctx.scale(Math.max(0.78, Math.min(1.55, player.radius / 10)), Math.max(0.78, Math.min(1.55, player.radius / 10)));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 玩家专属背包、靴子和潮汐青外套。
  fillRoundRect(ctx, -8, -1, 5, 12, 2, '#28445a');
  ctx.strokeStyle = '#67d8d0';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-6, 1);
  ctx.lineTo(-6, 8);
  ctx.stroke();
  ctx.strokeStyle = '#162638';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-2.8, 7);
  ctx.lineTo(-3.1 + stride, 13);
  ctx.moveTo(2.8, 7);
  ctx.lineTo(3.1 - stride, 13);
  ctx.stroke();
  ctx.strokeStyle = '#07121e';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-3.1 + stride, 13);
  ctx.lineTo(-5.8 + stride, 13);
  ctx.moveTo(3.1 - stride, 13);
  ctx.lineTo(5.8 - stride, 13);
  ctx.stroke();
  fillRoundRect(ctx, -6.4, -1, 12.8, 12, 4.2, '#167c83');
  fillRoundRect(ctx, -5.3, -2.8, 10.6, 10, 3.5, '#36c8bb');
  ctx.fillStyle = '#d9fff5';
  ctx.globalAlpha = 0.78;
  ctx.fillRect(-1, -1, 2, 7);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#0b5e6a';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-3.2, -1);
  ctx.lineTo(0, 2);
  ctx.lineTo(3.2, -1);
  ctx.stroke();
  ctx.strokeStyle = '#f2c7a5';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-5.2, 0);
  ctx.lineTo(-7.8, 4 - stride * 0.45);
  ctx.moveTo(5.2, 0);
  ctx.lineTo(7.8, 4 + stride * 0.45);
  ctx.stroke();
  drawCircle(context, { x: 0, y: -7.8 }, 5, '#f3c5a2', TIDELINE_TOKENS.color.outline, 1.7);
  ctx.fillStyle = '#152c44';
  ctx.beginPath();
  ctx.arc(0, -9.1, 5.2, Math.PI * 1.02, Math.PI * 1.98);
  ctx.lineTo(4.2, -8.5);
  ctx.lineTo(-4.2, -8.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8df0df';
  ctx.fillRect(-4.8, -8.5, 9.6, 1.5);
  fillRoundRect(ctx, 2.7, 0.5, 4.3, 5.2, 1, '#f5cb66');
  ctx.fillStyle = '#fff4c6';
  ctx.fillRect(3.5, 1.3, 2.7, 1.2);
  ctx.restore();

  // 朝向箭头从身体外伸出，安全区时再叠一圈柔和的反馈。
  ctx.save();
  ctx.strokeStyle = TIDELINE_TOKENS.color.accent;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  const tip = {
    x: player.position.x + direction.x * (player.radius + 12),
    y: player.position.y + direction.y * (player.radius + 12),
  };
  ctx.beginPath();
  ctx.moveTo(player.position.x + direction.x * 4, player.position.y + direction.y * 4);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - direction.x * 5 - direction.y * 3, tip.y - direction.y * 5 + direction.x * 3);
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - direction.x * 5 + direction.y * 3, tip.y - direction.y * 5 - direction.x * 3);
  ctx.stroke();
  ctx.restore();
}

export function renderActors(
  renderContext: RenderContext,
  state: GameState,
  _level: LevelConfig,
): void {
  renderContext.withWorld(() => {
    // 先画车内的半透明乘客，再按 y 从后到前画站台角色，最后画玩家。
    const passengers = state.passengers
      .filter((passenger) => passenger.role !== 'exited')
      .slice()
      .sort((left, right) => {
        if (left.role === 'inside' && right.role !== 'inside') return -1;
        if (left.role !== 'inside' && right.role === 'inside') return 1;
        return left.position.y - right.position.y;
      });
    for (const passenger of passengers) drawPassenger(renderContext, passenger, state.elapsed);
    drawPlayer(renderContext, state);
  });
}

export function passengerColor(kind: PassengerKind): string {
  return PASSENGER_COLORS[kind];
}
