import type { CrewSnapshot } from './crew';
import { interpolateFlight, stepFlight } from './flight';
import type { ControlInput, FlightState, Vec3 } from './types';
import { add, clamp, forward, mix, scale, sub } from './world';

// Match the authoritative simulation in server/match.js.
export const CREW_STEP = 1 / 40;
const MAX_EXTRAPOLATION = 0.1;
const MAX_PENDING_INPUTS = 12;

type Pilot = CrewSnapshot['pilots'][number];
type MovingEntity = { id: number; pos: Vec3; velocity: Vec3 };
type TimelineSample = { from: CrewSnapshot; to: CrewSnapshot; time: number };

export class CrewTimeline {
  private frames: CrewSnapshot[] = [];
  private offset = 0;
  private jitter = 0;
  private arrival = 0;
  private cursor: number | undefined;
  private lastRender = 0;

  reset(): void {
    this.frames = [];
    this.jitter = 0;
    this.cursor = undefined;
  }

  push(frame: CrewSnapshot, now: number): void {
    const previous = this.frames.at(-1);
    if (previous && frame.sequence <= previous.sequence) return;
    const interval = now - this.arrival;
    if (interval > 1) this.reset();
    const observedOffset = now - frame.time;
    if (this.frames.length && previous) {
      const serverInterval = frame.time - previous.time;
      const variation = Math.min(0.2, Math.abs(interval - serverInterval));
      this.jitter = mix(this.jitter, variation, 0.12);
      this.offset = Math.min(observedOffset, this.offset + serverInterval * 0.025);
    } else {
      this.offset = observedOffset;
    }
    this.arrival = now;
    this.frames.push(frame);
    if (this.frames.length > 24) this.frames.shift();
  }

  sample(now: number): TimelineSample | null {
    const oldest = this.frames[0];
    const newest = this.frames.at(-1);
    if (!oldest || !newest) return null;

    const delay = 0.10 + Math.min(0.10, this.jitter * 2);
    const target = now - this.offset - delay;
    if (this.cursor === undefined || now - this.lastRender > 0.5) {
      this.cursor = target;
    } else {
      const elapsed = Math.max(0, now - this.lastRender);
      const rate = clamp(1 + (target - this.cursor - elapsed) * 5, 0.75, 1.25);
      this.cursor += elapsed * rate;
    }
    this.lastRender = now;
    this.cursor = clamp(this.cursor, oldest.time - delay, newest.time + MAX_EXTRAPOLATION);
    const time = Math.max(oldest.time, this.cursor);

    const right = this.frames.findIndex(frame => frame.time > time);
    if (right < 0) return { from: newest, to: newest, time };
    return { from: this.frames[right - 1], to: this.frames[right], time };
  }
}

export function sampleCrewPilot(pilot: Pilot, timeline: TimelineSample): FlightState {
  const { from, to, time } = timeline;
  const next = to.pilots.find(item => item.id === pilot.id);
  if (from !== to && next && pilot.deaths === next.deaths && !next.flight.recovered &&
      pilot.flight.death <= 0 && next.flight.death <= 0) {
    return interpolateFlight(pilot.flight, next.flight, (time - from.time) / (to.time - from.time));
  }
  if (from === to && pilot.flight.death <= 0 && !pilot.flight.recovered) {
    const { pos, yaw, pitch, speed } = pilot.flight;
    return { ...pilot.flight, pos: add(pos, scale(forward(yaw, pitch), speed * (time - from.time))) };
  }
  return pilot.flight;
}

export function sampleCrewEntities<T extends MovingEntity>(
  entities: T[],
  upcoming: T[],
  timeline: TimelineSample
): T[] {
  const { from, to, time } = timeline;
  const elapsed = time - from.time;
  if (elapsed <= 0) return entities;
  const byId = from === to ? null : new Map(upcoming.map(entity => [entity.id, entity]));
  return entities.map(entity => {
    const next = Number.isFinite(entity.id) ? byId?.get(entity.id) : undefined;
    if (next) {
      return { ...entity, pos: add(entity.pos, scale(sub(next.pos, entity.pos), elapsed / (to.time - from.time))) };
    }
    return entity.velocity ? { ...entity, pos: add(entity.pos, scale(entity.velocity, elapsed)) } : entity;
  });
}

function advance(flight: FlightState, command: ControlInput, map: number): FlightState {
  if (flight.death > 0) return flight;
  const predicted = { ...flight };
  stepFlight(predicted, command, map, CREW_STEP);
  return predicted.death > 0 ? flight : predicted;
}

const shortAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class CrewPrediction {
  private pending: Array<{ sequence: number; command: ControlInput }> = [];
  private positionError: Vec3 = [0, 0, 0];
  private yawError = 0;
  private pitchError = 0;
  private rollError = 0;

  reset(): void {
    this.clearPending();
    this.clearError();
  }

  clearPending(): void {
    this.pending = [];
  }

  private clearError(): void {
    this.positionError = [0, 0, 0];
    this.yawError = this.pitchError = this.rollError = 0;
  }

  step(flight: FlightState, command: ControlInput, map: number, sequence: number | null): FlightState {
    if (sequence !== null) {
      this.pending.push({ sequence, command });
      if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();
    }
    return advance(flight, command, map);
  }

  reconcile(
    flight: FlightState,
    authority: FlightState,
    ack: number,
    map: number,
    discontinuity: boolean
  ): FlightState {
    this.pending = this.pending.filter(input => input.sequence > ack);
    if (discontinuity) {
      this.clearError();
      return { ...authority };
    }

    let corrected = { ...authority };
    for (const { command } of this.pending) corrected = advance(corrected, command, map);

    const error = sub(flight.pos, corrected.pos);
    if (Math.hypot(...error) > 45) {
      this.clearError();
    } else {
      this.positionError = add(this.positionError, error);
      this.yawError += shortAngle(flight.yaw - corrected.yaw);
      this.pitchError += flight.pitch - corrected.pitch;
      this.rollError += shortAngle(flight.roll - corrected.roll);
    }
    return corrected;
  }

  smooth(pose: FlightState, dt: number): FlightState {
    const decay = Math.exp(-15 * dt);
    this.positionError = scale(this.positionError, decay);
    this.yawError *= decay;
    this.pitchError *= decay;
    this.rollError *= decay;
    return {
      ...pose,
      pos: add(pose.pos, this.positionError),
      yaw: pose.yaw + this.yawError,
      pitch: pose.pitch + this.pitchError,
      roll: pose.roll + this.rollError,
    };
  }
}
