import type { SimulationInput, Vec2 } from '../../core/types.ts';

const KEY_DIRECTIONS: Record<string, Vec2> = {
  w: { x: 0, y: -1 },
  arrowup: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  arrowdown: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  arrowleft: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
  arrowright: { x: 1, y: 0 },
};

export interface DebugCommands {
  pause: boolean;
  restart: boolean;
}

function normalizedKey(key: string): string {
  // KeyboardEvent.key uses a literal single-space string for the Space key.
  // Preserve it before trimming aliases such as " Space ".
  if (key === ' ') return ' ';
  return key.trim().toLowerCase();
}

/**
 * 桌面调试输入状态，不绑定 KeyboardEvent/DOM。浏览器或测试适配层只需把
 * key 字符串转交进来，正式微信触摸输入可在 M4 另写一个同接口适配器。
 */
export class DebugInputController {
  private readonly pressed = new Set<string>();
  private guideQueued = false;
  private pauseQueued = false;
  private restartQueued = false;

  keyDown(key: string): void {
    const value = normalizedKey(key);
    if (!value) return;
    this.pressed.add(value);
    if (value === ' ' || value === 'space' || value === 'spacebar') this.guideQueued = true;
    if (value === 'escape' || value === 'esc') this.pauseQueued = true;
    if (value === 'r') this.restartQueued = true;
  }

  keyUp(key: string): void {
    this.pressed.delete(normalizedKey(key));
  }

  clear(): void {
    this.pressed.clear();
    this.guideQueued = false;
    this.pauseQueued = false;
    this.restartQueued = false;
  }

  sample(): SimulationInput {
    let x = 0;
    let y = 0;
    for (const key of this.pressed) {
      const direction = KEY_DIRECTIONS[key];
      if (direction) {
        x += direction.x;
        y += direction.y;
      }
    }
    const input: SimulationInput = {
      move: { x, y },
      useGuide: this.guideQueued,
    };
    this.guideQueued = false;
    return input;
  }

  consumeCommands(): DebugCommands {
    const commands = { pause: this.pauseQueued, restart: this.restartQueued };
    this.pauseQueued = false;
    this.restartQueued = false;
    return commands;
  }
}

export function debugDirection(keys: readonly string[]): Vec2 {
  const controller = new DebugInputController();
  keys.forEach((key) => controller.keyDown(key));
  return controller.sample().move ?? { x: 0, y: 0 };
}
