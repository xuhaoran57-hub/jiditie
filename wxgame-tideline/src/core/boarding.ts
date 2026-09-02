import type { DoorConfig, DoorState, Vec2 } from './types.ts';
import { rectContains } from './vector.ts';

export function totalOccupancy(doors: readonly DoorState[]): number {
  return doors.reduce((sum, door) => sum + Math.max(0, door.occupancy), 0);
}

export function canBoard(
  doorId: string,
  doors: readonly DoorState[],
  carriageCapacity: number,
): boolean {
  const door = doors.find((item) => item.id === doorId);
  return Boolean(
      door &&
      door.open &&
      !door.blocked &&
      totalOccupancy(doors) < Math.max(0, carriageCapacity),
  );
}

export function reserveBoardingSlot(
  doorId: string,
  doors: DoorState[],
  carriageCapacity: number,
): boolean {
  if (!canBoard(doorId, doors, carriageCapacity)) return false;
  const door = doors.find((item) => item.id === doorId);
  if (!door) return false;
  door.occupancy += 1;
  return true;
}

export function isInDoorEntryZone(door: DoorConfig, position: Vec2): boolean {
  return rectContains(door.entryZone, position);
}

export function isInSafeZone(door: DoorConfig, position: Vec2): boolean {
  return rectContains(door.safeZone, position);
}
