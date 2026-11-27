import {
  add,
  CENTRAL_REFUEL_RADIUS,
  centralRefuelPosition,
  clamp,
  dist3,
  dot,
  forward,
  height,
  norm,
  planes,
  scale,
  solidAt,
  sub,
  VOLCANO,
} from './world.js';

const hostileTint = [0.84, 0.23, 0.21];
const friendlyTint = [0.20, 0.70, 0.83];
const distance = (from, to) => Math.hypot(...sub(from, to));
const turnDifference = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export const RELAYS = [
  { id: 'A', name: 'Ridge Station', pos: [-960, 0, -180], detail: 'A ridge repeater west of the caldera.' },
  { id: 'B', name: 'Caldera Beacon', pos: [0, 0, VOLCANO.z - 410], detail: 'A short-range beacon at Ashmouth’s south entrance.' },
  { id: 'C', name: 'Needle Array', pos: [895, 0, 520], detail: 'A relay tower beyond the eastern peaks.' },
];

export function weapons(planeType = 0) {
  const spec = planes[planeType] ?? planes[0];
  return {
    heat: 0,
    overheated: false,
    gunDelay: 0,
    missileDelay: 0,
    rocketDelay: 0,
    missiles: spec.missiles,
    maxMissiles: spec.missiles,
    rockets: spec.rockets,
    maxRockets: spec.rockets,
    flare: 0,
    flaresLeft: spec.flares,
    maxFlares: spec.flares,
    evade: 0,
  };
}

function formationAircraft(type, pos, friendly, index) {
  const spec = planes[type] ?? planes[0];
  return {
    type: spec.id,
    pos,
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: spec.speed,
    tint: friendly ? friendlyTint : hostileTint,
    friendly,
    index,
    hp: spec.hull,
    fire: 2.4 + index * 2.5,
  };
}

function squadron(flight, count, rear) {
  return Array.from({ length: count }, (_, index) =>
    formationAircraft(
      index % 3,
      add(flight.pos, [(index - (count - 1) / 2) * 70, (index % 3 - 1) * 25, rear ? -285 - index * 33 : 470 + index * 30]),
      false,
      index
    )
  );
}

export function newMission(mode, flight) {
  return {
    mode,
    phase: mode === 'story' ? 'ambush' : 'free-flight',
    time: 0,
    phaseTime: 0,
    kills: 0,
    signal: false,
    chosen: null,
    refuelCooldown: 0,
    allies: mode === 'story' ? [-1, 1].map((side, i) =>
      formationAircraft(i, add(flight.pos, [side * 60, 1, 46]), true, i)) : [],
    enemies: mode === 'story' ? squadron(flight, 5, true) : [],
    shots: [],
    effects: [],
    arms: weapons(flight.type),
    target: null,
    message: '',
    flash: 0,
    event: 0,
  };
}

export function relayPosition(relay, map = 0) {
  return [relay.pos[0], Math.max(22, height(relay.pos[0], relay.pos[2], map)) + 42, relay.pos[2]];
}

export function selectRelay(mission, id) {
  if (mission.phase !== 'relay' || !RELAYS.some(relay => relay.id === id)) return;
  mission.chosen = id;
}

function tell(mission, message) {
  mission.message = message;
  mission.event++;
}

function effect(mission, kind, pos, velocity, life, size) {
  if (mission.effects.length < 170) mission.effects.push({ kind, pos, velocity, life, size });
}

function burst(mission, pos) {
  mission.flash = 0.24;
  for (let i = 0; i < 23; i++) {
    const angle = i * 2.39996;
    const speed = 19 + i % 7 * 10;
    effect(mission, 'spark', pos, [Math.cos(angle) * speed, (i % 7 - 3) * 16, Math.sin(angle) * speed],
      0.36 + i * 0.023, 5 + i % 6);
  }
}

function clearPath(from, to, map) {
  const delta = sub(to, from);
  const steps = Math.max(3, Math.ceil(Math.hypot(...delta) / 23));
  for (let step = 1; step < steps; step++) {
    if (solidAt(...add(from, scale(delta, step / steps)), map)) return false;
  }
  return true;
}

export function acquire(enemies, flight) {
  const heading = forward(flight.yaw, flight.pitch);
  let best = null;
  let bestScore = -Infinity;
  for (const enemy of enemies) {
    const delta = sub(enemy.pos, flight.pos);
    const range = Math.hypot(...delta);
    if (range > 960 || range < 12) continue;
    const aim = dot(scale(delta, 1 / range), heading);
    if (aim < 0.91) continue;
    const score = aim - range * 0.00015;
    if (score > bestScore) { best = enemy; bestScore = score; }
  }
  return best;
}

export function updateWeapons(mission, flight, command, map, dt) {
  const arms = mission.arms;
  const spec = planes[flight.type] ?? planes[0];
  arms.gunDelay = Math.max(0, arms.gunDelay - dt);
  arms.missileDelay = Math.max(0, arms.missileDelay - dt);
  arms.rocketDelay = Math.max(0, (arms.rocketDelay ?? 0) - dt);
  arms.flare = Math.max(0, arms.flare - dt);
  arms.evade = Math.max(0, arms.evade - dt);
  arms.heat = Math.max(0, arms.heat - dt * (arms.overheated ? 0.46 : command.fire ? 0.03 : 0.34));
  if (arms.overheated && arms.heat <= 0.24) arms.overheated = false;
  if (flight.death > 0 || mission.phase === 'complete') return;

  const nose = forward(flight.yaw, flight.pitch);
  const muzzle = add(flight.pos, scale(nose, 15));

  if (command.fire && arms.gunDelay === 0 && !arms.overheated) {
    arms.gunDelay = spec.gunRate;
    arms.heat = Math.min(1, arms.heat + spec.gunHeatPerShot);
    if (arms.heat >= 1) {
      arms.overheated = true;
      tell(mission, 'GUN OVERHEATED • Cooling');
    }
    let heading = nose;
    const target = mission.target;
    if (target) {
      const lead = distance(muzzle, target.pos) / 1020;
      const aim = add(target.pos, scale(forward(target.yaw, target.pitch), target.speed * lead));
      const direction = norm(sub(aim, muzzle));
      if (dot(heading, direction) > 0.968 && clearPath(muzzle, target.pos, map)) heading = direction;
    }
    mission.shots.push({ kind: 'tracer', pos: muzzle, velocity: scale(heading, 1020), life: 0.9, size: 2.8, damage: 28 });
  }

  if (command.missile && arms.missileDelay === 0) {
    const target = mission.target;
    if (!arms.missiles) tell(mission, 'MISSILES EMPTY');
    else if (!target || !clearPath(muzzle, target.pos, map)) tell(mission, 'MISSILE • Acquire a target in sight');
    else {
      arms.missiles--;
      arms.missileDelay = 0.45;
      mission.shots.push({ kind: 'missile', pos: muzzle, velocity: scale(nose, 355), life: 5.0, size: 5.2, target, damage: 110 });
    }
  }

  if (command.rocket && arms.rocketDelay === 0) {
    if ((arms.rockets ?? 0) <= 0) {
      tell(mission, 'ROCKETS EMPTY');
    } else {
      arms.rockets--;
      arms.rocketDelay = 0.22;
      mission.shots.push({ kind: 'rocket', pos: muzzle, velocity: scale(nose, 520), life: 2.8, size: 4.4, damage: 95 });
    }
  }

  if (command.flare && arms.flare === 0) {
    const flaresLeft = arms.flaresLeft ?? 1;
    if (flaresLeft <= 0) {
      tell(mission, 'FLARES DEPLETED');
    } else {
      if (arms.flaresLeft !== undefined) arms.flaresLeft = Math.max(0, arms.flaresLeft - 1);
      arms.flare = 4.2;
      arms.evade = 1.35;
      const side = [Math.cos(flight.yaw), 0, -Math.sin(flight.yaw)];
      for (let i = 0; i < 12; i++) {
        const rear = add(flight.pos, scale(nose, -8 - i * 0.7));
        effect(mission, 'flare', rear, add(scale(nose, -26), add(scale(side, (i - 5.5) * 10), [0, -8 - i, 0])), 0.7 + i * 0.045, 4 + i % 3);
      }
      let deflected = false;
      for (const shot of mission.shots) {
        if (shot.kind !== 'enemyMissile' || distance(shot.pos, flight.pos) > 640) continue;
        shot.target = null;
        shot.life = Math.min(0.85, shot.life);
        deflected = true;
      }
      tell(mission, deflected ? 'FLARES • Incoming missile diverted' : 'FLARES • Released');
    }
  }
}

function updateAmbush(mission, flight) {
  for (const ally of mission.allies) {
    const side = [Math.cos(flight.yaw), 0, -Math.sin(flight.yaw)];
    ally.pos = add(flight.pos, add(scale(side, ally.index ? 57 : -57), scale(forward(flight.yaw), 47)));
    ally.yaw = flight.yaw;
    ally.pitch = flight.pitch * 0.6;
    ally.roll = flight.roll * 0.6;
  }
  if (mission.phaseTime >= 0.22 && !mission.ambushVisual) {
    mission.ambushVisual = true;
    tell(mission, 'WING TWO • Five contacts, six o’clock!');
    for (const [index, ally] of mission.allies.entries()) {
      const origin = mission.enemies[index * 3].pos;
      mission.shots.push({ kind: 'enemyMissile', pos: origin, velocity: scale(norm(sub(ally.pos, origin)), 510), target: ally, visual: true, life: 1.45, size: 5 });
    }
  }
  if (mission.phaseTime >= 1 && mission.allies.length === 2) {
    const ally = mission.allies.shift();
    burst(mission, ally.pos);
    tell(mission, 'WING TWO • I’m hit!');
  }
  if (mission.phaseTime >= 1.82 && mission.allies.length === 1) {
    const ally = mission.allies.shift();
    burst(mission, ally.pos);
    mission.phase = 'combat';
    mission.phaseTime = 0;
    tell(mission, 'WING THREE LOST • Clear all five hostiles');
  }
}

function updateEnemy(enemy, mission, flight, map, dt) {
  const offset = enemy.index * 1.27 + mission.time * (0.24 + enemy.index * 0.012);
  const orbit = mission.phase === 'ambush' ? [0, 0, -220] :
    [Math.sin(offset) * (170 + enemy.index * 20), Math.cos(offset * 0.8) * 53, Math.cos(offset) * (240 + enemy.index * 11)];
  const target = add(flight.pos, orbit);
  target[1] = Math.max(target[1], height(target[0], target[2], map) + 67, 85);
  const delta = sub(target, enemy.pos);
  const desiredYaw = Math.atan2(delta[0], delta[2]);
  const rawTurn = turnDifference(desiredYaw, enemy.yaw);
  enemy.yaw += clamp(rawTurn, -1.24 * dt, 1.24 * dt);
  enemy.roll = clamp(-rawTurn * 0.80, -0.8, 0.8);
  enemy.pitch = clamp(Math.atan2(delta[1], Math.hypot(delta[0], delta[2])), -0.62, 0.76);
  enemy.speed = clamp(flight.speed * 0.7 + Math.hypot(...delta) * 0.22, 84, 198);
  const proposed = add(enemy.pos, scale(forward(enemy.yaw, enemy.pitch), enemy.speed * dt));
  if (solidAt(...proposed, map, 9)) {
    enemy.pos[1] += 110 * dt;
    enemy.pitch = 0.65;
  } else enemy.pos = proposed;
  if (mission.mode !== 'story' || mission.phase !== 'combat' || flight.death > 0 || mission.phaseTime < 2) return;
  enemy.fire -= dt;
  const range = distance(enemy.pos, flight.pos);
  const stealthRange = 690 * (planes[flight.type]?.stealthFactor ?? 1);
  if (enemy.fire > 0 || range < 190 || range > stealthRange || mission.shots.some(shot => shot.kind === 'enemyMissile' && shot.target === flight)) return;
  if (!clearPath(enemy.pos, flight.pos, map)) { enemy.fire = 0.8; return; }
  enemy.fire = 8 + enemy.index * 0.55;
  const heading = norm(sub(flight.pos, enemy.pos));
  mission.shots.push({ kind: 'enemyMissile', pos: enemy.pos, velocity: scale(heading, 220), target: flight, life: 4.8, size: 5.6 });
}

function updateShots(mission, flight, map, dt) {
  for (const shot of mission.shots) {
    shot.life -= dt;
    if (shot.life <= 0) continue;
    const target = shot.target;
    if (target) {
      const speed = Math.hypot(...shot.velocity);
      const guidance = Math.min(1, dt * (shot.kind === 'missile' ? 4.8 : 2.6));
      const goal = norm(sub(target.pos, shot.pos));
      shot.velocity = scale(norm(add(scale(shot.velocity, (1 - guidance) / speed), scale(goal, guidance))), speed);
    }
    shot.pos = add(shot.pos, scale(shot.velocity, dt));
    if (solidAt(...shot.pos, map)) { shot.life = 0; continue; }
    if (shot.kind === 'enemyMissile') {
      if (shot.visual) {
        if (target && distance(target.pos, shot.pos) < 13) shot.life = 0;
        continue;
      }
      const arms = mission.arms;
      if (target && (arms.evade > 0 || (flight.boost > 0.64 && Math.abs(flight.bank) > 0.53 && distance(shot.pos, flight.pos) < 135))) {
        shot.target = null;
        shot.life = Math.min(0.8, shot.life);
        if (arms.evade <= 0) tell(mission, 'BOOST EVADE • Lock broken');
        continue;
      }
      if (target && !flight.death && distance(shot.pos, flight.pos) < 15) {
        flight.hull = Math.max(0, flight.hull - 36);
        if (!flight.hull) flight.death = 1.45;
        burst(mission, shot.pos);
        shot.life = 0;
        tell(mission, 'HULL HIT');
      }
      continue;
    }
    if (mission.phase === 'ambush') continue;
    for (const enemy of mission.enemies) {
      const hitRadius = shot.kind === 'missile' ? 22 : shot.kind === 'rocket' ? 20 : 15;
      if (enemy.hp <= 0 || distance(shot.pos, enemy.pos) >= hitRadius) continue;
      enemy.hp -= shot.damage;
      shot.life = 0;
      if (enemy.hp <= 0) {
        mission.kills++;
        burst(mission, enemy.pos);
        tell(mission, 'HOSTILE DOWN');
      } else effect(mission, 'spark', shot.pos, [0, 0, 0], 0.14, 7);
      break;
    }
  }
  mission.shots = mission.shots.filter(shot => shot.life > 0 && (shot.target?.hp === undefined || shot.target.hp > 0));
  mission.enemies = mission.enemies.filter(enemy => enemy.hp > 0);
}

export function stepMission(mission, flight, command, map, dt) {
  mission.time += dt;
  mission.phaseTime += dt;
  mission.flash = Math.max(0, mission.flash - dt);
  mission.refuelCooldown = Math.max(0, (mission.refuelCooldown ?? 0) - dt);

  if (flight.recovered) {
    mission.arms = weapons(flight.type);
    mission.shots = [];
    tell(mission, 'RESPAWN COMPLETE • Systems & weapons restored');
  }

  // Central Volcano Refuel & Rearm Station (all maps & modes)
  if (
    flight.death <= 0 &&
    mission.phase !== 'complete' &&
    mission.refuelCooldown <= 0 &&
    dist3(flight.pos, centralRefuelPosition(map)) <= CENTRAL_REFUEL_RADIUS
  ) {
    const fresh = weapons(flight.type);
    flight.fuel = flight.maxFuel;
    flight.lowFuel = false;
    flight.flameout = false;
    flight.hull = flight.maxHull;
    mission.arms = fresh;
    mission.refuelCooldown = 4.0;
    tell(mission, 'VOLCANO CORE DEPOT • Fuel 100%, Hull repaired & Weapons rearmed!');
  }

  if (mission.phase === 'ambush') updateAmbush(mission, flight);
  mission.target = acquire(mission.enemies, flight);
  updateWeapons(mission, flight, command, map, dt);
  for (const enemy of mission.enemies) updateEnemy(enemy, mission, flight, map, dt);
  updateShots(mission, flight, map, dt);
  mission.target = acquire(mission.enemies, flight);
  for (const item of mission.effects) {
    item.pos = add(item.pos, scale(item.velocity, dt));
    item.life -= dt;
  }
  mission.effects = mission.effects.filter(item => item.life > 0);

  if (mission.phase === 'combat' && mission.enemies.length === 0) {
    mission.phase = 'jammed';
    mission.phaseTime = 0;
    tell(mission, 'RADIO JAMMED • Command cannot hear you');
  } else if (mission.phase === 'jammed' && mission.phaseTime >= 2.2) {
    mission.phase = 'relay';
    mission.phaseTime = 0;
    tell(mission, 'THREE RELAYS FOUND • Choose one on the map');
  } else if (mission.phase === 'relay' && !flight.death) {
    const next = RELAYS.find(relay => relay.id === mission.chosen);
    if (next) {
      const delta = sub(flight.pos, relayPosition(next, map));
      if (Math.hypot(delta[0], delta[2]) <= 100 && Math.abs(delta[1]) <= 150) {
        mission.signal = true;
        mission.phase = 'complete';
        tell(mission, 'SIGNAL RESTORED • ' + next.name);
      }
    }
  }
}

export function missileWarning(mission, flight) {
  return mission.shots.some(shot => shot.kind === 'enemyMissile' && shot.target === flight);
}
