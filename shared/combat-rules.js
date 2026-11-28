export const BOT_HULL = { standard: 100, veteran: 125, ace: 150 };
export const DIFFICULTY_LABELS = { standard: 'Easy', veteran: 'Medium', ace: 'Difficult' };
export const CANNON_DAMAGE = 20;
export const CANNON_SPEED = 1020;
export const MISSILE_DAMAGE = 80;
export const LOCK_SECONDS = 0.35;
const FLARE_COOLDOWN = 4.2;
const FLARE_SPACING = 0.44;
const FLARE_BLOOM = 0.14;
const REARM_COOLDOWN = 15;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const heading = (yaw, pitch) => [
  Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch),
];

export function cannonLead(from, target) {
  const offset = subtract(target.pos, from);
  const velocity = heading(target.yaw, target.pitch).map(value => value * target.speed);
  const a = CANNON_SPEED ** 2 - dot(velocity, velocity);
  const b = dot(offset, velocity);
  const time = a > 0 ? (b + Math.sqrt(b * b + a * dot(offset, offset))) / a : 0;
  return target.pos.map((value, i) => value + velocity[i] * time);
}

export function trackLock(current, targets, flight, dt, view, visible) {
  if (!targets.length) return current.target ? { target: null, progress: 0 } : current;
  const nose = heading(flight.yaw, flight.pitch);
  const chaseDistance = 64 + flight.boost * 9;
  const eye = nose.map((value, i) => value * (view.cockpit ? 4 : -chaseDistance) +
    (i === 1 ? (view.cockpit ? 3 : 15) : 0));
  const cameraPitch = view.cockpit ? flight.pitch : Math.atan2(
    nose[1] * (chaseDistance + 15) - 11,
    Math.cos(flight.pitch) * (chaseDistance + 15)
  );
  const front = heading(flight.yaw, cameraPitch);
  const right = [Math.cos(flight.yaw), 0, -Math.sin(flight.yaw)];
  const up = [-front[1] * Math.sin(flight.yaw), Math.cos(cameraPitch), -front[1] * Math.cos(flight.yaw)];
  const roll = view.cockpit ? flight.roll : flight.bank * 0.16;
  const sin = Math.sin(roll), cos = Math.cos(roll);
  const fov = view.cockpit ? 0.74 : 0.59 + flight.boost * 0.06;
  const project = offset => {
    const relative = subtract(offset, eye);
    const depth = dot(relative, front);
    if (depth < 4) return null;
    const horizontal = dot(relative, right), vertical = dot(relative, up);
    return {
      x: (horizontal * cos + vertical * sin) / (depth * fov * view.aspect),
      y: (vertical * cos - horizontal * sin) / (depth * fov),
    };
  };
  const point = target => {
    const offset = subtract(target.pos, flight.pos);
    const range = Math.hypot(...offset);
    if (dot(offset, nose) < 9 || range > 1350) return null;
    const marker = project(offset);
    return marker && { ...marker, range };
  };
  const previous = current.target;
  if (previous && current.progress >= 1 && targets.includes(previous)) {
    const marker = point(previous);
    if (marker && Math.abs(marker.x) <= 1 && Math.abs(marker.y) <= 1 && visible(previous)) return current;
  }

  let target = null, best = Infinity;
  const cursor = project(nose.map(value => value * 750));
  for (const candidate of targets) {
    const marker = point(candidate);
    if (!marker || !cursor) continue;
    const radius = Math.hypot((marker.x - cursor.x) / 0.22, (marker.y - cursor.y) / 0.27);
    const score = radius + marker.range / 3000;
    if (radius <= 1 && marker.range <= 1050 && score < best && visible(candidate)) {
      target = candidate;
      best = score;
    }
  }
  if (!target) return { target: null, progress: 0 };
  const progress = target === previous && current.progress < 1 ? current.progress : 0;
  return { target, progress: Math.min(1, progress + dt / LOCK_SECONDS) };
}

export function hitSegment(point, from, to, radius) {
  const delta = subtract(to, from);
  const offset = subtract(point, from);
  const fraction = Math.max(0, Math.min(1, dot(offset, delta) / (dot(delta, delta) || 1)));
  return (offset[0] - delta[0] * fraction) ** 2 +
    (offset[1] - delta[1] * fraction) ** 2 + (offset[2] - delta[2] * fraction) ** 2 <= radius ** 2;
}

export function stepFlarePattern(arms, flight, requested, dt, emit) {
  const oldAge = arms.flare > 0 ? FLARE_COOLDOWN - arms.flare : Infinity;
  arms.flare = Math.max(0, arms.flare - dt);
  arms.evade = Math.max(0, arms.evade - dt);
  const started = requested && arms.flare === 0 && arms.flaresLeft > 0;
  if (started) {
    arms.flaresLeft--;
    arms.flare = FLARE_COOLDOWN;
  }
  if (arms.flare === 0) return false;

  const age = FLARE_COOLDOWN - arms.flare;
  const before = started ? -1 : oldAge;
  if (before + 1e-9 >= 2 * FLARE_SPACING + FLARE_BLOOM) return false;
  const nose = heading(flight.yaw, flight.pitch);
  const side = [Math.cos(flight.yaw), 0, -Math.sin(flight.yaw)];
  let dropped = false;
  for (let stage = 0; stage < 3; stage++) {
    const release = stage * FLARE_SPACING;
    if (before + 1e-9 < release && age + 1e-9 >= release) {
      const lateral = (stage - 1) * 16;
      const pos = flight.pos.map((value, i) => value - nose[i] * 9 + side[i] * lateral * 0.24);
      const velocity = nose.map((value, i) => -value * 40 + side[i] * lateral - (i === 1 ? 18 : 0));
      arms.flarePod = { pos, velocity };
      emit(pos, velocity, FLARE_BLOOM + 0.04, 7);
      arms.evade = Math.max(arms.evade, 0.23);
      dropped = true;
    }
    const bloom = release + FLARE_BLOOM;
    if (before + 1e-9 < bloom && age + 1e-9 >= bloom && arms.flarePod) {
      const { pos, velocity } = arms.flarePod;
      const origin = pos.map((value, i) => value + velocity[i] * FLARE_BLOOM);
      for (let pellet = 0; pellet < 7; pellet++) {
        const spread = (pellet - 3) * 15;
        const drift = velocity.map((value, i) => value + side[i] * spread - (i === 1 ? 4 + pellet * 3 : 0));
        emit(origin, drift, 0.55 + pellet * 0.07, 3 + pellet % 3);
      }
      arms.flarePod = undefined;
      arms.evade = Math.max(arms.evade, 0.35);
    }
  }
  return dropped;
}

export function createRearmRings(map, height) {
  return [[-630, -430, Math.PI / 4], [630, -180, -Math.PI / 3], [130, 730, 0]].map(([x, z, yaw], index) => ({
    id: index + 1, pos: [x, Math.max(325, height(x, z, map) + 140), z],
    yaw, radius: 64, readyAt: 0,
  }));
}

export function rearmThroughRing(rings, arms, previous, current, now) {
  if (arms.missiles >= arms.maxMissiles && arms.flaresLeft >= arms.maxFlares) return false;
  for (const ring of rings) {
    if (ring.readyAt > now) continue;
    const normal = heading(ring.yaw, 0);
    const a = subtract(previous, ring.pos), b = subtract(current, ring.pos);
    const from = dot(a, normal), to = dot(b, normal);
    if ((from < 0) === (to < 0) || from === to) continue;
    const t = from / (from - to);
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    if (x * x + y * y + z * z > ring.radius ** 2) continue;
    arms.missiles = arms.maxMissiles;
    arms.flaresLeft = arms.maxFlares;
    ring.readyAt = now + REARM_COOLDOWN;
    return true;
  }
  return false;
}
