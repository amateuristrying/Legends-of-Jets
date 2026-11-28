import type { BotDifficulty, FlightState, Vec3, WeaponsState } from '../src/engine/types';

export const BOT_HULL: Record<BotDifficulty, number>;
export const DIFFICULTY_LABELS: Record<BotDifficulty, string>;
export const CANNON_DAMAGE: number;
export const CANNON_SPEED: number;
export const MISSILE_DAMAGE: number;
export const LOCK_SECONDS: number;
export type LockView = { cockpit: boolean; aspect: number };
export type RearmRing = { id: number; pos: Vec3; yaw: number; radius: number; readyAt: number };
export function cannonLead(from: Vec3, target: { pos: Vec3; yaw: number; pitch: number; speed: number }): Vec3;
export function trackLock<T extends { pos: Vec3 }>(
  current: { target: T | null; progress: number }, targets: T[], flight: FlightState,
  dt: number, view: LockView, visible: (target: T) => boolean
): { target: T | null; progress: number };
export function hitSegment(point: Vec3, from: Vec3, to: Vec3, radius: number): boolean;
export function stepFlarePattern(
  arms: WeaponsState, flight: FlightState, requested: boolean, dt: number,
  emit: (pos: Vec3, velocity: Vec3, life: number, size: number) => void
): boolean;
export function createRearmRings(map: number, height: (x: number, z: number, map: number) => number): RearmRing[];
export function rearmThroughRing(rings: RearmRing[], arms: WeaponsState, previous: Vec3, current: Vec3, now: number): boolean;
