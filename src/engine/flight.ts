import type { ControlInput, FlightModelMode, FlightState, Vec3 } from './types';
import { add, clamp, forward, mix, planes, respawnPosition, scale, solidAt } from './world';

export const SIM_STEP = 1 / 120;
export const views = ['Chase', 'Cockpit'] as const;

const approach = (current: number, target: number, rate: number, dt: number): number =>
  mix(current, target, 1 - Math.exp(-rate * dt));

export function newFlight(type: number, position: Vec3 = [0, 126, -45]): FlightState {
  const plane = planes[type] ?? planes[0];
  return {
    type: plane.id,
    pos: [position[0], position[1], position[2]],
    yaw: 0,
    pitch: 0,
    bank: 0,
    roll: 0,
    stunt: 0,
    speed: plane.speed,
    boost: 0,
    afterburnerFuel: 1,
    stalling: false,
    gLoad: 1,
    lives: 1,
    death: 0,
    recovered: false,
    hull: plane.hull,
    maxHull: plane.hull,
  };
}

export function stepFlight(
  flight: FlightState,
  input: Partial<ControlInput>,
  map: number,
  dt: number,
  flightModel: FlightModelMode = 'arcade'
): void {
  flight.recovered = false;
  if (flight.death > 0) {
    flight.death -= dt;
    if (flight.death > 0) return;
    const position = respawnPosition(flight.pos, map);
    const fresh = newFlight(flight.type, position);
    Object.assign(flight, fresh, {
      yaw: flight.yaw,
      lives: flight.lives + 1,
      recovered: true,
    });
    return;
  }

  const plane = planes[flight.type] ?? planes[0];
  const turnIn = clamp(input.turn ?? 0, -1, 1);
  const pitchIn = clamp(input.pitch ?? 0, -1, 1);
  const brakeIn = Boolean(input.brake);
  let boostWanted = Boolean(input.boost) && !brakeIn;

  if (flightModel === 'sim-lite') {
    if (boostWanted && flight.afterburnerFuel > 0.04) {
      flight.afterburnerFuel = Math.max(0, flight.afterburnerFuel - dt * 0.22);
    } else {
      boostWanted = false;
      flight.afterburnerFuel = Math.min(1, flight.afterburnerFuel + dt * 0.14);
    }
  } else {
    flight.afterburnerFuel = 1;
  }

  flight.boost = approach(flight.boost, Number(boostWanted), 4.7, dt);

  if (flightModel === 'sim-lite') {
    // Energy/gravity flight physics: dive accelerates, climb bleeds speed, hard turns bleed energy
    const throttleTarget = plane.speed * (brakeIn ? 0.56 : 1 + flight.boost * 0.85);
    const gravityAccel = -Math.sin(flight.pitch) * 62;
    const turnDrag = Math.abs(flight.bank) * 18;
    const desiredSpeed = clamp(throttleTarget, plane.speed * 0.44, plane.speed * 2.15);
    flight.speed = approach(flight.speed, desiredSpeed, 1.85, dt) + (gravityAccel - turnDrag) * dt;
    flight.speed = clamp(flight.speed, plane.speed * 0.36, plane.speed * 2.25);

    const stallThreshold = plane.speed * 0.52;
    flight.stalling = flight.speed < stallThreshold;
    flight.gLoad = 1 + Math.abs(flight.bank) * (flight.speed / plane.speed) * 4.2 + Math.max(0, pitchIn) * 2.1;

    const authority = flight.stalling ? 0.45 : clamp(flight.speed / plane.speed, 0.65, 1.15);
    flight.bank = approach(flight.bank, -turnIn * 0.9, 5.6 * authority, dt);
    const targetPitch = flight.stalling ? -0.45 : pitchIn * 0.88;
    flight.pitch = approach(flight.pitch, targetPitch, 4.8 * authority, dt);
    flight.yaw += -flight.bank * plane.turn * authority * dt;
  } else {
    flight.stalling = false;
    flight.gLoad = 1 + Math.abs(flight.bank) * 3.5;
    flight.speed = approach(
      flight.speed,
      plane.speed * (brakeIn && !boostWanted ? 0.63 : 1 + flight.boost * 0.8),
      3.4,
      dt
    );
    flight.bank = approach(flight.bank, -turnIn * 0.85, 6, dt);
    flight.pitch = approach(flight.pitch, pitchIn * 0.85, 5.4, dt);
    flight.yaw += -flight.bank * plane.turn * dt;
  }

  if (input.roll && !flight.stunt) flight.stunt = 0.001;
  if (flight.stunt) {
    flight.stunt += dt * 1.15;
    if (flight.stunt >= 1) flight.stunt = 0;
  }
  const progress = flight.stunt;
  flight.roll = flight.bank + Math.PI * 2 * progress * progress * (3 - 2 * progress);

  flight.pos = add(flight.pos, scale(forward(flight.yaw, flight.pitch), flight.speed * dt));
  flight.pos[1] = Math.min(920, flight.pos[1]);

  if (solidAt(flight.pos[0], flight.pos[1], flight.pos[2], map, 4)) {
    flight.hull = 0;
    flight.death = 1.45;
  }
}

export function interpolateFlight(before: FlightState, now: FlightState, fraction: number): FlightState {
  const pose: FlightState = {
    ...now,
    pos: [
      mix(before.pos[0], now.pos[0], fraction),
      mix(before.pos[1], now.pos[1], fraction),
      mix(before.pos[2], now.pos[2], fraction),
    ],
    yaw: mix(before.yaw, now.yaw, fraction),
    pitch: mix(before.pitch, now.pitch, fraction),
    bank: mix(before.bank, now.bank, fraction),
    speed: mix(before.speed, now.speed, fraction),
    boost: mix(before.boost, now.boost, fraction),
  };
  const delta = Math.atan2(Math.sin(now.roll - before.roll), Math.cos(now.roll - before.roll));
  pose.roll = before.roll + delta * fraction;
  return pose;
}
