import { add, clamp, forward, mix, planes, respawnPosition, scale, solidAt } from './world.js';

export const SIM_STEP = 1 / 120;
export const views = ['Chase', 'Cockpit'];
const approach = (current, target, rate, dt) => mix(current, target, 1 - Math.exp(-rate * dt));

export function newFlight(type, position = [0, 126, -45]) {
  return {
    type, pos: [...position], yaw: 0, pitch: 0, bank: 0, roll: 0,
    stunt: 0, speed: planes[type].speed, boost: 0,
    death: 0, recovered: false, hull: 100,
  };
}

export function stepFlight(flight, input, map, dt) {
  flight.recovered = false;
  if (flight.death > 0) {
    flight.death -= dt;
    if (flight.death > 0) return;
    const position = respawnPosition(flight.pos, map);
    Object.assign(flight, newFlight(flight.type, position), {
      yaw: flight.yaw, recovered: true,
    });
    return;
  }
  const plane = planes[flight.type];
  flight.boost = approach(flight.boost, Number(input.boost), 4.7, dt);
  flight.speed = approach(flight.speed, plane.speed * (input.brake && !input.boost ? .63 : 1 + flight.boost * .8), 3.4, dt);
  flight.bank = approach(flight.bank, -input.turn * .85, 6, dt);
  flight.pitch = approach(flight.pitch, input.pitch * .85, 5.4, dt);
  flight.yaw += -flight.bank * plane.turn * dt;
  if (input.roll && !flight.stunt) flight.stunt = .001;
  if (flight.stunt) {
    flight.stunt += dt * 1.15;
    if (flight.stunt >= 1) flight.stunt = 0;
  }
  const progress = flight.stunt;
  flight.roll = flight.bank + Math.PI * 2 * progress * progress * (3 - 2 * progress);
  flight.pos = add(flight.pos, scale(forward(flight.yaw, flight.pitch), flight.speed * dt));
  flight.pos[1] = Math.min(850, flight.pos[1]);
  if (solidAt(...flight.pos, map, 4)) {
    flight.hull = 0;
    flight.death = 1.45;
  }
}

export function interpolateFlight(before, now, fraction) {
  const continuous = ['yaw', 'pitch', 'bank', 'speed', 'boost'];
  const pose = { ...now, pos: now.pos.map((value, axis) => mix(before.pos[axis], value, fraction)) };
  for (const key of continuous) pose[key] = mix(before[key], now[key], fraction);
  const delta = Math.atan2(Math.sin(now.roll - before.roll), Math.cos(now.roll - before.roll));
  pose.roll = before.roll + delta * fraction;
  return pose;
}
