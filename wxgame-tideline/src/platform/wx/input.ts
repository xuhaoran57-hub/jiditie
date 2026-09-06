import type { Rect, SimulationInput, Vec2 } from '../../core/types.ts';
import { clamp, distance, rectContains } from '../../core/vector.ts';

export interface WxTouchPointLike {
  identifier: number;
  pageX?: number;
  pageY?: number;
  clientX?: number;
  clientY?: number;
  x?: number;
  y?: number;
}

export interface WxTouchEventLike {
  touches?: readonly WxTouchPointLike[];
  changedTouches?: readonly WxTouchPointLike[];
}

export type WxTouchListener = (event: WxTouchEventLike) => void;

export interface WxTouchApi {
  onTouchStart?: (listener: WxTouchListener) => void;
  onTouchMove?: (listener: WxTouchListener) => void;
  onTouchEnd?: (listener: WxTouchListener) => void;
  onTouchCancel?: (listener: WxTouchListener) => void;
  offTouchStart?: (listener: WxTouchListener) => void;
  offTouchMove?: (listener: WxTouchListener) => void;
  offTouchEnd?: (listener: WxTouchListener) => void;
  offTouchCancel?: (listener: WxTouchListener) => void;
}

export interface TouchDoorHitArea {
  id: string;
  rect: Rect;
}

/** 页面级卡片命中区域；命名独立于 door，便于路线页复用同一套触摸管线。 */
export interface TouchLevelHitArea {
  id: string;
  rect: Rect;
}

export interface TouchMenuHitArea {
  id: string;
  rect: Rect;
}

export interface TouchControlsLayout {
  joystickCenter: Vec2;
  joystickRadius: number;
  guideButtonRect: Rect;
  pauseButtonRect?: Rect;
  restartButtonRect?: Rect;
  doorHitAreas?: readonly TouchDoorHitArea[];
  levelHitAreas?: readonly TouchLevelHitArea[];
  menuHitAreas?: readonly TouchMenuHitArea[];
  appearanceHitAreas?: readonly TouchMenuHitArea[];
  settingsHitAreas?: readonly TouchMenuHitArea[];
  routeDropdownRect?: Rect;
  routeListRect?: Rect;
  pageBackRect?: Rect;
  resultRetryRect?: Rect;
  resultNextRect?: Rect;
  resultRouteRect?: Rect;
  briefingConfirmRect?: Rect;
}

export type TouchCommand =
  | { type: 'pause' }
  | { type: 'restart' }
  | { type: 'select-door'; doorId: string }
  | { type: 'select-level'; levelId: string }
  | { type: 'menu'; id: string }
  | { type: 'toggle-route-menu' }
  | { type: 'scroll-route'; delta: number }
  | { type: 'confirm-start' }
  | { type: 'back' }
  | { type: 'select-appearance'; appearanceId: string }
  | { type: 'toggle-setting'; setting: 'sound' | 'music' | 'vibration' }
  | { type: 'retry' }
  | { type: 'next-level' }
  | { type: 'route' };

export interface WxTouchInputOptions {
  deadzone?: number;
  joystickHitSlop?: number;
  /** 任意有效触摸开始时触发一次，用于解锁微信音频的用户手势限制。 */
  onUserGesture?: () => void;
}

const DEFAULT_INPUT_OPTIONS: Required<WxTouchInputOptions> = {
  deadzone: 0.12,
  joystickHitSlop: 18,
  onUserGesture: () => undefined,
};

const ZERO: Vec2 = { x: 0, y: 0 };

function finiteCoordinate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function touchPointPosition(point: WxTouchPointLike): Vec2 | undefined {
  const x = finiteCoordinate(point.pageX) ?? finiteCoordinate(point.clientX) ?? finiteCoordinate(point.x);
  const y = finiteCoordinate(point.pageY) ?? finiteCoordinate(point.clientY) ?? finiteCoordinate(point.y);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

export function hitTestRect(rect: Rect, point: Vec2): boolean {
  return rectContains(rect, point);
}

function eventPoints(event: WxTouchEventLike): readonly WxTouchPointLike[] {
  if (event.changedTouches && event.changedTouches.length > 0) return event.changedTouches;
  return event.touches ?? [];
}

function containsIdentifier(points: readonly WxTouchPointLike[] | undefined, identifier: number): boolean {
  return Boolean(points?.some((point) => point.identifier === identifier));
}

function sameRect(first: Rect | undefined, second: Rect | undefined): boolean {
  if (!first || !second) return first === second;
  return first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
}

function sameAreas<T extends { id: string; rect: Rect }>(
  first: readonly T[] | undefined,
  second: readonly T[] | undefined,
): boolean {
  if (!first || !second) return first === second;
  if (first.length !== second.length) return false;
  return first.every((area, index) => {
    const other = second[index];
    return Boolean(other && area.id === other.id && sameRect(area.rect, other.rect));
  });
}

function sameLayout(first: TouchControlsLayout, second: TouchControlsLayout): boolean {
  return first.joystickCenter.x === second.joystickCenter.x
    && first.joystickCenter.y === second.joystickCenter.y
    && first.joystickRadius === second.joystickRadius
    && sameRect(first.guideButtonRect, second.guideButtonRect)
    && sameRect(first.pauseButtonRect, second.pauseButtonRect)
    && sameRect(first.restartButtonRect, second.restartButtonRect)
    && sameAreas(first.doorHitAreas, second.doorHitAreas)
    && sameAreas(first.levelHitAreas, second.levelHitAreas)
    && sameAreas(first.menuHitAreas, second.menuHitAreas)
    && sameAreas(first.appearanceHitAreas, second.appearanceHitAreas)
    && sameAreas(first.settingsHitAreas, second.settingsHitAreas)
    && sameRect(first.routeDropdownRect, second.routeDropdownRect)
    && sameRect(first.routeListRect, second.routeListRect)
    && sameRect(first.pageBackRect, second.pageBackRect)
    && sameRect(first.resultRetryRect, second.resultRetryRect)
    && sameRect(first.resultNextRect, second.resultNextRect)
    && sameRect(first.resultRouteRect, second.resultRouteRect)
    && sameRect(first.briefingConfirmRect, second.briefingConfirmRect);
}

/**
 * 微信触摸适配器：把摇杆和按钮触摸转换成规则层可识别的输入脉冲。
 * 适配器不推进模拟、不读取 wx 全局对象，便于在 Node 中回归测试。
 */
export class WxTouchInputAdapter {
  private readonly api: WxTouchApi;
  private readonly options: Required<WxTouchInputOptions>;
  private layout: TouchControlsLayout;
  private joystickId: number | null = null;
  private move: Vec2 = { ...ZERO };
  private guideQueued = false;
  private pendingDoorId: string | undefined;
  private commands: TouchCommand[] = [];
  private routeTouchId: number | null = null;
  private routeTouchStartY = 0;
  private routeTouchLastY = 0;
  private routeTouchLevelId: string | undefined;
  private _attached = false;

  private readonly startListener: WxTouchListener = (event) => this.handleTouchStart(event);
  private readonly moveListener: WxTouchListener = (event) => this.handleTouchMove(event);
  private readonly endListener: WxTouchListener = (event) => this.handleTouchEnd(event);
  private readonly cancelListener: WxTouchListener = (event) => this.handleTouchCancel(event);

  constructor(
    api: WxTouchApi,
    layout: TouchControlsLayout,
    options: WxTouchInputOptions = {},
  ) {
    this.api = api;
    this.layout = layout;
    this.options = {
      ...DEFAULT_INPUT_OPTIONS,
      ...options,
      deadzone: clamp(options.deadzone ?? DEFAULT_INPUT_OPTIONS.deadzone, 0, 0.95),
      joystickHitSlop: Math.max(0, options.joystickHitSlop ?? DEFAULT_INPUT_OPTIONS.joystickHitSlop),
      onUserGesture: options.onUserGesture ?? (() => undefined),
    };
  }

  get attached(): boolean {
    return this._attached;
  }

  get activeJoystickId(): number | null {
    return this.joystickId;
  }

  setLayout(layout: TouchControlsLayout): void {
    if (sameLayout(this.layout, layout)) return;
    this.layout = layout;
    // 当前触点的位置无法从布局变化事件中恢复，先清零方向，等待下一次 move。
    if (this.joystickId !== null) this.move = { ...ZERO };
  }

  attach(): void {
    if (this._attached) return;
    this.api.onTouchStart?.(this.startListener);
    this.api.onTouchMove?.(this.moveListener);
    this.api.onTouchEnd?.(this.endListener);
    this.api.onTouchCancel?.(this.cancelListener);
    this._attached = true;
  }

  detach(): void {
    if (!this._attached) {
      this.reset();
      return;
    }
    this.api.offTouchStart?.(this.startListener);
    this.api.offTouchMove?.(this.moveListener);
    this.api.offTouchEnd?.(this.endListener);
    this.api.offTouchCancel?.(this.cancelListener);
    this._attached = false;
    this.reset();
  }

  reset(): void {
    this.joystickId = null;
    this.move = { ...ZERO };
    this.guideQueued = false;
    this.pendingDoorId = undefined;
    this.commands = [];
    this.routeTouchId = null;
    this.routeTouchLevelId = undefined;
  }

  handleTouchStart(event: WxTouchEventLike): void {
    let gestureNotified = false;
    for (const point of eventPoints(event)) {
      const position = touchPointPosition(point);
      if (!position) continue;
      if (!gestureNotified) {
        gestureNotified = true;
        try {
          this.options.onUserGesture();
        } catch {
          // 手势回调通常只负责解锁音频；回调失败不能阻断触摸输入。
        }
      }

      if (
        this.joystickId === null &&
        distance(position, this.layout.joystickCenter) <=
          Math.max(0, this.layout.joystickRadius) + this.options.joystickHitSlop
      ) {
        this.joystickId = point.identifier;
        this.updateJoystick(position);
        continue;
      }

      if (hitTestRect(this.layout.guideButtonRect, position)) {
        this.guideQueued = true;
        continue;
      }
      if (this.layout.pauseButtonRect && hitTestRect(this.layout.pauseButtonRect, position)) {
        this.commands.push({ type: 'pause' });
        continue;
      }
      if (this.layout.restartButtonRect && hitTestRect(this.layout.restartButtonRect, position)) {
        this.commands.push({ type: 'restart' });
        continue;
      }
      if (this.layout.resultRetryRect && hitTestRect(this.layout.resultRetryRect, position)) {
        this.commands.push({ type: 'retry' });
        continue;
      }
      if (this.layout.resultNextRect && hitTestRect(this.layout.resultNextRect, position)) {
        this.commands.push({ type: 'next-level' });
        continue;
      }
      if (this.layout.resultRouteRect && hitTestRect(this.layout.resultRouteRect, position)) {
        this.commands.push({ type: 'route' });
        continue;
      }
      if (this.layout.briefingConfirmRect && hitTestRect(this.layout.briefingConfirmRect, position)) {
        this.commands.push({ type: 'confirm-start' });
        continue;
      }
      if (this.layout.pageBackRect && hitTestRect(this.layout.pageBackRect, position)) {
        this.commands.push({ type: 'back' });
        continue;
      }
      if (this.layout.routeDropdownRect && hitTestRect(this.layout.routeDropdownRect, position)) {
        this.commands.push({ type: 'toggle-route-menu' });
        continue;
      }
      if (this.layout.routeListRect && hitTestRect(this.layout.routeListRect, position)) {
        const level = this.layout.levelHitAreas?.find((area) => hitTestRect(area.rect, position));
        this.routeTouchId = point.identifier;
        this.routeTouchStartY = position.y;
        this.routeTouchLastY = position.y;
        this.routeTouchLevelId = level?.id;
        continue;
      }
      const menu = this.layout.menuHitAreas?.find((area) => hitTestRect(area.rect, position));
      if (menu) {
        this.commands.push({ type: 'menu', id: menu.id });
        continue;
      }
      const appearance = this.layout.appearanceHitAreas?.find((area) => hitTestRect(area.rect, position));
      if (appearance) {
        this.commands.push({ type: 'select-appearance', appearanceId: appearance.id });
        continue;
      }
      const setting = this.layout.settingsHitAreas?.find((area) => hitTestRect(area.rect, position));
      if (setting) {
        this.commands.push({ type: 'toggle-setting', setting: setting.id as 'sound' | 'music' | 'vibration' });
        continue;
      }
      const level = this.layout.levelHitAreas?.find((area) => hitTestRect(area.rect, position));
      if (level) {
        this.commands.push({ type: 'select-level', levelId: level.id });
        continue;
      }
      const door = this.layout.doorHitAreas?.find((area) => hitTestRect(area.rect, position));
      if (door) {
        this.pendingDoorId = door.id;
        this.commands.push({ type: 'select-door', doorId: door.id });
      }
    }
  }

  handleTouchMove(event: WxTouchEventLike): void {
    const routePoint = this.routeTouchId === null
      ? undefined
      : eventPoints(event).find((item) => item.identifier === this.routeTouchId);
    if (routePoint) {
      const position = touchPointPosition(routePoint);
      if (position) this.routeTouchLastY = position.y;
    }
    if (this.joystickId === null) return;
    const point = eventPoints(event).find((item) => item.identifier === this.joystickId);
    const position = point ? touchPointPosition(point) : undefined;
    if (position) this.updateJoystick(position);
  }

  handleTouchEnd(event: WxTouchEventLike): void {
    if (this.routeTouchId !== null && containsIdentifier(event.changedTouches, this.routeTouchId)) {
      const delta = this.routeTouchStartY - this.routeTouchLastY;
      if (Math.abs(delta) >= 8) this.commands.push({ type: 'scroll-route', delta });
      else if (this.routeTouchLevelId) this.commands.push({ type: 'select-level', levelId: this.routeTouchLevelId });
      this.routeTouchId = null;
      this.routeTouchLevelId = undefined;
    }
    this.releaseIfMissing(event);
  }

  handleTouchCancel(event: WxTouchEventLike): void {
    if (this.routeTouchId !== null && containsIdentifier(event.changedTouches, this.routeTouchId)) {
      this.routeTouchId = null;
      this.routeTouchLevelId = undefined;
    }
    this.releaseIfMissing(event);
  }

  sample(): SimulationInput {
    const input: SimulationInput = {
      move: { ...this.move },
      useGuide: this.guideQueued,
    };
    if (this.pendingDoorId) input.selectDoorId = this.pendingDoorId;
    this.guideQueued = false;
    this.pendingDoorId = undefined;
    return input;
  }

  consumeCommands(): TouchCommand[] {
    const commands = this.commands.slice();
    this.commands = [];
    return commands;
  }

  private releaseIfMissing(event: WxTouchEventLike): void {
    if (this.joystickId === null) return;
    const id = this.joystickId;
    const changed = containsIdentifier(event.changedTouches, id);
    const stillActive = containsIdentifier(event.touches, id);
    const malformedEnd = event.touches === undefined && event.changedTouches === undefined;
    if (changed || (event.touches !== undefined && !stillActive) || malformedEnd) {
      this.joystickId = null;
      this.move = { ...ZERO };
    }
  }

  private updateJoystick(position: Vec2): void {
    const radius = Math.max(1, this.layout.joystickRadius);
    const dx = (position.x - this.layout.joystickCenter.x) / radius;
    const dy = (position.y - this.layout.joystickCenter.y) / radius;
    const magnitude = Math.hypot(dx, dy);
    if (!Number.isFinite(magnitude) || magnitude <= this.options.deadzone) {
      this.move = { ...ZERO };
      return;
    }
    const scale = Math.min(1, 1 / magnitude);
    this.move = { x: dx * scale, y: dy * scale };
  }
}

export { WxTouchInputAdapter as WxInputAdapter };
