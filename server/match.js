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
} from './sim/world.js';
import { newFlight, stepFlight } from './sim/flight.js';
import { acquire, updateWeapons, weapons } from './sim/mission.js';

export const STEP = 1 / 40;
export const ARENA_RADIUS = 1350;
export const OUTSIDE_SECONDS = 10;
export const ARENA_CENTER = [0, 0, 0];
const IDLE = {
  turn: 0,
  pitch: 0,
  boost: false,
  brake: false,
  fire: false,
  missile: false,
  rocket: false,
  flare: false,
  roll: false,
};
const DIFFICULTY = {
  standard: { reaction: 0.29, turn: 0.87, aim: 0.984, burst: 0.55, rest: 0.72, missiles: false, flare: false },
  veteran: { reaction: 0.14, turn: 0.98, aim: 0.976, burst: 1.0, rest: 0.52, missiles: true, flare: true },
  ace: { reaction: 0.054, turn: 1, aim: 0.961, burst: 1.32, rest: 0.38, missiles: true, flare: true },
};

export function validateRules(raw) {
  if (!raw || ![2, 4].includes(raw.seats) || ![180, 300].includes(raw.seconds) ||
      !['duel', 'bots'].includes(raw.mode) || !['standard', 'veteran', 'ace'].includes(raw.difficulty) ||
      ![0, 1].includes(raw.map) || typeof raw.night !== 'boolean') return null;
  const { seats, seconds, mode, difficulty, map, night } = raw;
  return { seats, seconds, mode, difficulty, map, night };
}

export function normalizeInput(input) {
  const axis = value => typeof value === 'number' && Number.isFinite(value) ? clamp(value, -1, 1) : 0;
  return {
    turn: axis(input?.turn),
    pitch: axis(input?.pitch),
    boost: input?.boost === true,
    brake: input?.brake === true,
    fire: input?.fire === true,
    missile: input?.missile === true,
    rocket: input?.rocket === true,
    flare: input?.flare === true,
    roll: input?.roll === true,
  };
}

function spawn(pilot, map) {
  const dir = pilot.team === 0 ? 1 : -1;
  const x = (pilot.slot - 1.5) * 102;
  const z = ARENA_CENTER[2] - dir * 460;
  const altitude = Math.max(550, height(x, z, map) + 125);
  if (pilot.flight) {
    Object.assign(pilot.flight, newFlight(pilot.type, [x, altitude, z]), { recovered: true });
  } else pilot.flight = newFlight(pilot.type, [x, altitude, z]);
  pilot.flight.yaw = dir === 1 ? 0 : Math.PI;
  pilot.outside = 0;
  pilot.spawnShield = 1.6;
  pilot.refuelCooldown = 0;
  pilot.armory.arms = weapons(pilot.type);
}

function makePilot(record, slot, team, map, bot = false) {
  const pilot = {
    id: record.id,
    name: record.name,
    type: planes[record.plane] ? record.plane : 0,
    slot,
    team,
    bot,
    points: 0,
    deaths: 0,
    outside: 0,
    spawnShield: 0,
    refuelCooldown: 0,
    reaction: 0,
    input: { ...IDLE },
    lastInput: -1e9,
    inputSequence: 0,
    inputAck: 0,
    armory: { arms: weapons(record.plane), phase: 'arena', effects: [], shots: [], event: 0, message: '' },
  };
  spawn(pilot, map);
  return pilot;
}

export function createMatch(rules, members, now) {
  const match = {
    rules,
    phase: 'playing',
    start: now,
    end: now + rules.seconds * 1000,
    time: 0,
    pilots: members.map((member, slot) => makePilot(member, slot, rules.mode === 'duel' ? slot % 2 : 0, rules.map)),
    shots: [],
    effects: [],
    winner: null,
    sequence: 0,
    nextEntityId: 0,
  };
  if (rules.mode === 'bots') {
    for (let slot = 0; slot < rules.seats; slot++) {
      match.pilots.push(
        makePilot({ id: 'bot-' + slot, name: 'Bandit ' + (slot + 1), plane: slot % planes.length }, slot, 1, rules.map, true)
      );
    }
  }
  return match;
}

export function setMatchInput(match, id, command, now, sequence) {
  const pilot = match.pilots.find(item => item.id === id && !item.bot);
  if (!pilot || match.phase !== 'playing') return;
  if (sequence !== undefined) {
    if (!Number.isSafeInteger(sequence) || sequence <= pilot.inputSequence) return;
    pilot.inputSequence = sequence;
  }
  if (command === null) {
    pilot.input = { ...IDLE };
    pilot.lastInput = -1e9;
    return;
  }
  const input = normalizeInput(command);
  for (const flag of ['missile', 'rocket', 'flare', 'roll']) input[flag] ||= pilot.input[flag];
  pilot.input = input;
  pilot.lastInput = now;
}

function separation(a, b) { return Math.hypot(...sub(a, b)); }

function closestOpponent(match, pilot) {
  let best = null;
  let range = Infinity;
  for (const other of match.pilots) {
    if (other.team === pilot.team || other.flight.death > 0) continue;
    const distance = separation(other.flight.pos, pilot.flight.pos);
    if (distance < range) { best = other; range = distance; }
  }
  return best;
}

function decideBot(match, pilot, dt) {
  const bot = DIFFICULTY[match.rules.difficulty];
  pilot.reaction -= dt;
  if (pilot.reaction > 0) return pilot.input;
  pilot.reaction = bot.reaction;
  const own = pilot.flight;
  const target = closestOpponent(match, pilot);
  const inbound = match.shots.some(shot => shot.target === own && separation(shot.pos, own.pos) < 330);
  const boundary = Math.hypot(own.pos[0] - ARENA_CENTER[0], own.pos[2] - ARENA_CENTER[2]);
  const ahead = add(own.pos, scale(forward(own.yaw), 135));
  const terrain = Math.max(height(ahead[0], ahead[2], match.rules.map), height(own.pos[0], own.pos[2], match.rules.map));
  const retreat = boundary > ARENA_RADIUS - 270;
  let goal = target?.flight.pos ?? ARENA_CENTER;
  if (target && !retreat) {
    const lead = clamp(separation(own.pos, goal) * 0.0014, 0.16, 1);
    goal = add(goal, scale(forward(target.flight.yaw, target.flight.pitch), target.flight.speed * lead));
  }
  if (!target || retreat) goal = [ARENA_CENTER[0], Math.max(550, terrain + 160), ARENA_CENTER[2]];
  const delta = sub(goal, own.pos);
  const heading = Math.atan2(delta[0], delta[2]) - own.yaw;
  const turn = Math.atan2(Math.sin(heading), Math.cos(heading));
  const distance = Math.hypot(...delta);
  const direction = norm(delta);
  const aim = dot(forward(own.yaw, own.pitch), direction);
  const firing = (match.time + pilot.slot * 0.37) % (bot.burst + bot.rest) < bot.burst;
  const tooLow = own.pos[1] < terrain + 90;
  const stealth = target ? (planes[target.flight.type]?.stealthFactor ?? 1) : 1;
  pilot.input = {
    turn: clamp(turn * 2.8, -bot.turn, bot.turn),
    pitch: tooLow ? 0.85 : clamp(Math.atan2(delta[1], Math.hypot(delta[0], delta[2])) * 1.45, -0.66, 0.72),
    boost: (distance > 390 && Math.abs(turn) < 0.4) || (inbound && match.rules.difficulty === 'ace'),
    brake: Math.abs(turn) > 1.05 && distance < 420,
    roll: false,
    fire: !retreat && firing && distance < 660 && aim > bot.aim && pilot.armory.arms.heat < 0.9,
    missile: !retreat && bot.missiles && distance > 125 && distance < 630 * stealth && aim > 0.972 && !tooLow,
    rocket: false,
    flare: bot.flare && inbound,
  };
  return pilot.input;
}

function defeat(match, pilot, killer, cause) {
  pilot.flight.hull = 0;
  pilot.flight.death = 1.45;
  pilot.deaths++;
  pilot.armory.message = cause;
  pilot.armory.event++;
  if (killer && pilot.team !== killer.team) killer.points++;
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.4;
    match.effects.push({
      id: ++match.nextEntityId,
      kind: 'spark',
      pos: pilot.flight.pos,
      velocity: [Math.cos(angle) * 50, (i - 4) * 12, Math.sin(angle) * 50],
      life: 0.4 + i * 0.021,
      size: 5 + i % 3,
    });
  }
}

function segmentDistance(point, from, to) {
  const length = sub(to, from);
  const lambda = clamp(dot(sub(point, from), length) / (dot(length, length) || 1), 0, 1);
  return separation(point, add(from, scale(length, lambda)));
}

function flyShot(match, shot, dt) {
  shot.life -= dt;
  if (shot.life <= 0) return;
  const from = shot.pos;
  if (shot.target) {
    const victim = match.pilots.find(pilot => pilot.flight === shot.target);
    if (!victim || victim.flight.death > 0 || victim.spawnShield > 0 || victim.armory.arms.evade > 0 ||
        (victim.flight.boost > 0.64 && Math.abs(victim.flight.bank) > 0.53 && separation(from, victim.flight.pos) < 140)) {
      shot.target = null;
      shot.velocity = add(shot.velocity, [shot.velocity[2] * 0.8, 140, -shot.velocity[0] * 0.8]);
      shot.decoyed = true;
      shot.life = Math.min(0.6, shot.life);
    } else {
      const speed = Math.hypot(...shot.velocity);
      const guide = 1 - Math.exp(-4.3 * dt);
      shot.velocity = scale(norm(add(scale(shot.velocity, (1 - guide) / speed),
        scale(norm(sub(shot.target.pos, from)), guide))), speed);
    }
  }
  shot.pos = add(from, scale(shot.velocity, dt));
  if (solidAt(...shot.pos, match.rules.map) || solidAt(...add(from, scale(shot.velocity, dt * 0.5)), match.rules.map)) {
    shot.life = 0;
    return;
  }
  if (shot.decoyed) return;
  const hitRadius = shot.kind === 'missile' ? 18 : shot.kind === 'rocket' ? 17 : 11;
  const damage = shot.kind === 'missile' ? 68 : shot.kind === 'rocket' ? 58 : 19;
  for (const pilot of match.pilots) {
    if (pilot.team === shot.owner.team || pilot.flight.death > 0 || pilot.spawnShield > 0) continue;
    if (segmentDistance(pilot.flight.pos, from, shot.pos) > hitRadius) continue;
    shot.life = 0;
    pilot.flight.hull = Math.max(0, pilot.flight.hull - damage);
    if (!pilot.flight.hull) defeat(match, pilot, shot.owner, 'SHOT DOWN');
    break;
  }
}

export function standings(match) {
  return [0, 1].map(team => match.pilots.filter(pilot => pilot.team === team).reduce((score, pilot) => score + pilot.points, 0));
}

export function tickMatch(match, now, dt = STEP) {
  if (match.phase !== 'playing') return;
  if (now >= match.end) {
    const [a, b] = standings(match);
    match.phase = 'finished';
    match.winner = a === b ? null : Number(b > a);
    return;
  }
  match.time += dt;
  const { map } = match.rules;
  const depot = centralRefuelPosition(map);
  for (const pilot of match.pilots) {
    pilot.spawnShield = Math.max(0, pilot.spawnShield - dt);
    pilot.refuelCooldown = Math.max(0, (pilot.refuelCooldown ?? 0) - dt);
    const command = pilot.bot ? decideBot(match, pilot, dt) : now - pilot.lastInput < 450 ? pilot.input : IDLE;
    pilot.inputAck = pilot.inputSequence;
    const alive = pilot.flight.death <= 0;
    stepFlight(pilot.flight, command, map, dt);
    if (pilot.flight.recovered) { spawn(pilot, map); continue; }
    if (alive && pilot.flight.death > 0) { defeat(match, pilot, null, 'TERRAIN COLLISION'); continue; }
    if (!alive) {
      if (!pilot.bot) pilot.input.missile = pilot.input.rocket = pilot.input.flare = pilot.input.roll = false;
      continue;
    }

    // Central Volcano / Glacier Vault Refuel & Rearm Station
    if (pilot.refuelCooldown <= 0 && dist3(pilot.flight.pos, depot) <= CENTRAL_REFUEL_RADIUS) {
      pilot.flight.fuel = pilot.flight.maxFuel;
      pilot.flight.lowFuel = false;
      pilot.flight.flameout = false;
      pilot.flight.hull = pilot.flight.maxHull;
      pilot.armory.arms = weapons(pilot.type);
      pilot.refuelCooldown = 4.0;
      pilot.armory.message = 'VOLCANO CORE DEPOT • Fuel 100%, Hull repaired & Weapons rearmed!';
      pilot.armory.event++;
    }

    const [x, , z] = pilot.flight.pos;
    const outside = Math.hypot(x - ARENA_CENTER[0], z - ARENA_CENTER[2]) > ARENA_RADIUS;
    pilot.outside = outside ? pilot.outside + dt : 0;
    if (pilot.outside + 1e-8 >= OUTSIDE_SECONDS) { defeat(match, pilot, null, 'LEFT THE COMBAT ZONE'); continue; }
    const hostiles = match.pilots.filter(enemy => enemy.team !== pilot.team && enemy.flight.death <= 0 && enemy.spawnShield <= 0).map(enemy => enemy.flight);
    pilot.armory.target = acquire(hostiles, pilot.flight);
    updateWeapons(
      pilot.armory,
      pilot.flight,
      pilot.spawnShield > 0 ? { ...command, fire: false, missile: false, rocket: false } : command,
      map,
      dt
    );
    for (const shot of pilot.armory.shots) match.shots.push({ ...shot, owner: pilot, id: ++match.nextEntityId });
    for (const effect of pilot.armory.effects) match.effects.push({ ...effect, id: ++match.nextEntityId });
    pilot.armory.shots.length = pilot.armory.effects.length = 0;
    if (!pilot.bot) pilot.input.missile = pilot.input.rocket = pilot.input.flare = pilot.input.roll = false;
  }
  for (const shot of match.shots) flyShot(match, shot, dt);
  match.shots = match.shots.filter(shot => shot.life > 0);
  for (const effect of match.effects) { effect.life -= dt; effect.pos = add(effect.pos, scale(effect.velocity, dt)); }
  match.effects = match.effects.filter(effect => effect.life > 0);
}

export function snapshot(match, now) {
  return {
    t: 'frame',
    phase: match.phase,
    rules: match.rules,
    winner: match.winner,
    score: standings(match),
    matchId: match.start,
    sequence: ++match.sequence,
    time: match.time,
    remaining: Math.max(0, (match.end - now) / 1000),
    arena: { center: ARENA_CENTER, radius: ARENA_RADIUS },
    pilots: match.pilots.map(pilot => ({
      id: pilot.id,
      name: pilot.name,
      team: pilot.team,
      bot: pilot.bot,
      points: pilot.points,
      deaths: pilot.deaths,
      inputAck: pilot.inputAck,
      flight: pilot.flight,
      arms: pilot.armory.arms,
      outside: pilot.outside > 0 ? Math.max(0, OUTSIDE_SECONDS - pilot.outside) : null,
      target: match.pilots.find(p => p.flight === pilot.armory.target)?.id ?? null,
      incoming: match.shots.some(shot => shot.kind === 'missile' && shot.target === pilot.flight),
      event: pilot.armory.event,
      message: pilot.armory.message,
    })),
    shots: match.shots.map(shot => ({ id: shot.id, kind: shot.kind, pos: shot.pos, velocity: shot.velocity, size: shot.size, fromTeam: shot.owner.team })),
    effects: match.effects.map(effect => ({ id: effect.id, kind: effect.kind, pos: effect.pos, velocity: effect.velocity, size: effect.size })),
  };
}
