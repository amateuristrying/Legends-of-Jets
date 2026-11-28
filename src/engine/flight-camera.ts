import type { FlightState, Vec3 } from './types';
import { add, AIRCRAFT_WING_GEOMETRY, clamp, forward, mix, norm, planes, scale, solidAt, sub } from './world';

const TRANSITION_SECONDS = 1.05;
const CLOSE_UP = 0.64;
const HANDOFF = 0.76;
const smooth = (value: number): number => {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

type CameraPose = { eye: Vec3; target: Vec3; roll: number; fov: number };

export function advanceFlightCamera(progress: number, cockpit: boolean, dt: number): number {
  return clamp(progress + (cockpit ? dt : -dt) / TRANSITION_SECONDS, 0, 1);
}

function flightCameraBlend(progress: number) {
  return {
    approach: smooth(progress / CLOSE_UP),
    exteriorOpacity: 1 - smooth((progress - CLOSE_UP) / (HANDOFF - CLOSE_UP)),
    cockpitOpacity: smooth((progress - HANDOFF) / (1 - HANDOFF)),
  };
}

function clearEye(position: Vec3, desired: Vec3, map: number): Vec3 {
  const offset = sub(desired, position);
  const point = (fraction: number) => add(position, scale(offset, fraction));
  const steps = Math.ceil(Math.hypot(...offset) / 9);
  for (let step = 1; step <= steps; step++) {
    let past = step / steps;
    if (!solidAt(...point(past), map, 3)) continue;
    let before = (step - 1) / steps;
    for (let refine = 0; refine < 4; refine++) {
      const middle = (before + past) / 2;
      if (solidAt(...point(middle), map, 3)) past = middle;
      else before = middle;
    }
    return point(before);
  }
  return desired;
}

function blendCamera(position: Vec3, from: CameraPose, to: CameraPose, fraction: number, map: number): CameraPose {
  const lerp = (a: Vec3, b: Vec3): Vec3 => [
    mix(a[0], b[0], fraction), mix(a[1], b[1], fraction), mix(a[2], b[2], fraction),
  ];
  const eye = clearEye(position, lerp(from.eye, to.eye), map);
  const direction = lerp(norm(sub(from.target, from.eye)), norm(sub(to.target, to.eye)));
  const rollDelta = Math.atan2(Math.sin(to.roll - from.roll), Math.cos(to.roll - from.roll));
  return { eye, target: add(eye, direction), roll: from.roll + rollDelta * fraction, fov: mix(from.fov, to.fov, fraction) };
}

export function sampleFlightCamera(
  flight: FlightState, progress: number, map: number, aspect: number, jitter: Vec3
): CameraPose & { exteriorOpacity: number; cockpitOpacity: number } {
  const { approach, exteriorOpacity, cockpitOpacity } = flightCameraBlend(progress);
  const front = forward(flight.yaw, flight.pitch);
  const cockpitEye = add(flight.pos, add(scale(front, 4), [jitter[0] * 0.2, 3 + jitter[1] * 0.2, 0]));
  const cockpit: CameraPose = { eye: cockpitEye, target: add(cockpitEye, front), roll: flight.roll, fov: 0.74 };
  if (progress >= 1) return { ...cockpit, exteriorOpacity, cockpitOpacity };

  const chaseDistance = 64 + flight.boost * 9;
  const chaseEye = add(flight.pos, add(scale(front, -chaseDistance), [jitter[0], 15 + jitter[1], 0]));
  const chase: CameraPose = {
    eye: clearEye(flight.pos, chaseEye, map),
    target: add(flight.pos, add(scale(front, 15), [0, 4, 0])),
    roll: flight.bank * 0.16,
    fov: 0.59 + flight.boost * 0.06,
  };
  if (progress <= 0) return { ...chase, exteriorOpacity, cockpitOpacity };

  const size = (planes[flight.type] ?? planes[0]).size;
  const span = (AIRCRAFT_WING_GEOMETRY[flight.type] ?? AIRCRAFT_WING_GEOMETRY[0]).span;
  const closeFov = 0.49;
  const closeDistance = clamp(size * (5 + span / (0.79 * closeFov * Math.max(0.85, aspect))),
    16 * size, chaseDistance * 0.82);
  const closeEye = add(flight.pos, add(scale(front, -closeDistance), [jitter[0] * 0.4, 6 * size + jitter[1] * 0.4, 0]));
  const close: CameraPose = {
    eye: clearEye(flight.pos, closeEye, map),
    target: add(flight.pos, add(scale(front, 2 * size), [0, 0.7 * size, 0])),
    roll: flight.bank * 0.22,
    fov: closeFov,
  };
  const camera = progress < CLOSE_UP
    ? blendCamera(flight.pos, chase, close, approach, map)
    : progress <= HANDOFF ? close : blendCamera(flight.pos, close, cockpit, cockpitOpacity, map);
  return { ...camera, exteriorOpacity, cockpitOpacity };
}
