import type {
  AircraftEntity,
  BotDifficulty,
  ControlInput,
  FlightState,
  GroundTarget,
  MissionState,
  Vec3,
  WeaponsState,
} from './types';
import {
  add,
  clamp,
  dist3,
  dot,
  forward,
  height,
  norm,
  planes,
  pruneTrail,
  recordTrailSample,
  scale,
  solidAt,
  sub,
} from './world';

export const HOSTILE_TINT: Vec3 = [0.86, 0.23, 0.21];
export const BOSS_TINT: Vec3 = [0.98, 0.42, 0.12];
export const FRIENDLY_TINT: Vec3 = [0.2, 0.72, 0.86];

export const BOT_TUNING: Record<
  BotDifficulty,
  {
    turnRate: number;
    gunAim: number;
    gunRange: number;
    missileChance: number;
    missileCooldown: number;
    flareChance: number;
    speedMult: number;
  }
> = {
  standard: {
    turnRate: 1.05,
    gunAim: 0.982,
    gunRange: 480,
    missileChance: 0.4,
    missileCooldown: 10.5,
    flareChance: 0.15,
    speedMult: 0.92,
  },
  veteran: {
    turnRate: 1.28,
    gunAim: 0.972,
    gunRange: 620,
    missileChance: 0.75,
    missileCooldown: 7.4,
    flareChance: 0.45,
    speedMult: 1.04,
  },
  ace: {
    turnRate: 1.52,
    gunAim: 0.96,
    gunRange: 720,
    missileChance: 1.0,
    missileCooldown: 5.2,
    flareChance: 0.75,
    speedMult: 1.16,
  },
};

let killFeedSeq = 1;

export function pushKillFeed(mission: MissionState, text: string, color = '#9be8d2'): void {
  mission.killFeed.unshift({ id: killFeedSeq++, text, color, time: mission.time });
  if (mission.killFeed.length > 5) mission.killFeed.pop();
}

export function tell(mission: MissionState, message: string): void {
  mission.message = message;
  mission.event++;
}

export function createWeapons(planeType = 0): WeaponsState {
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

export function spawnEffect(
  mission: MissionState,
  kind: MissionState['effects'][number]['kind'],
  pos: Vec3,
  velocity: Vec3,
  life: number,
  size: number
): void {
  if (mission.effects.length < 320) {
    mission.effects.push({ kind, pos: [pos[0], pos[1], pos[2]], velocity, life, size });
  }
}

export function explosionBurst(mission: MissionState, pos: Vec3, big = false): void {
  mission.flash = Math.max(mission.flash, big ? 0.34 : 0.22);
  mission.shake = Math.max(mission.shake, big ? 0.42 : 0.24);
  const count = big ? 34 : 22;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996;
    const speed = (big ? 28 : 19) + (i % 7) * 11;
    const vy = ((i % 7) - 3) * (big ? 22 : 16);
    spawnEffect(
      mission,
      i % 3 === 0 ? 'fire' : i % 5 === 0 ? 'debris' : 'spark',
      pos,
      [Math.cos(angle) * speed, vy, Math.sin(angle) * speed],
      0.4 + i * 0.024,
      (big ? 7 : 5) + (i % 6)
    );
  }
  for (let s = 0; s < (big ? 8 : 4); s++) {
    const a = s * 1.1;
    spawnEffect(
      mission,
      'smoke',
      pos,
      [Math.cos(a) * 14, 18 + s * 4, Math.sin(a) * 14],
      1.1 + s * 0.14,
      9 + (s % 4) * 2
    );
  }
}

export function clearPath(from: Vec3, to: Vec3, map: number): boolean {
  const delta = sub(to, from);
  const steps = Math.max(3, Math.ceil(Math.hypot(delta[0], delta[1], delta[2]) / 23));
  for (let step = 1; step < steps; step++) {
    const p = add(from, scale(delta, step / steps));
    if (solidAt(p[0], p[1], p[2], map)) return false;
  }
  return true;
}

const turnDifference = (to: number, from: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function acquireTarget(
  enemies: AircraftEntity[],
  groundTargets: GroundTarget[],
  flight: FlightState
): AircraftEntity | GroundTarget | null {
  const heading = forward(flight.yaw, flight.pitch);
  let best: AircraftEntity | GroundTarget | null = null;
  let bestScore = -Infinity;

  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const delta = sub(enemy.pos, flight.pos);
    const range = Math.hypot(delta[0], delta[1], delta[2]);
    if (range > 1050 || range < 12) continue;
    const aim = dot(scale(delta, 1 / range), heading);
    if (aim < 0.9) continue;
    const score = aim - range * 0.00014 + (enemy.isBoss ? 0.02 : 0);
    if (score > bestScore) {
      best = enemy;
      bestScore = score;
    }
  }

  for (const gt of groundTargets) {
    if (gt.destroyed || gt.friendly) continue;
    const delta = sub(gt.pos, flight.pos);
    const range = Math.hypot(delta[0], delta[1], delta[2]);
    if (range > 1100 || range < 15) continue;
    const aim = dot(scale(delta, 1 / range), heading);
    if (aim < 0.91) continue;
    const score = aim - range * 0.00015 - 0.01;
    if (score > bestScore) {
      best = gt;
      bestScore = score;
    }
  }
  return best;
}

export function isAircraft(t: AircraftEntity | GroundTarget | FlightState | null | undefined): t is AircraftEntity {
  return Boolean(t && 'yaw' in t && 'hp' in t);
}

export function updatePlayerWeapons(
  mission: MissionState,
  flight: FlightState,
  command: ControlInput,
  map: number,
  dt: number
): { firedGun: boolean; firedMissile: boolean; firedRocket: boolean; firedFlare: boolean } {
  const arms = mission.arms;
  const spec = planes[flight.type] ?? planes[0];
  let firedGun = false;
  let firedMissile = false;
  let firedRocket = false;
  let firedFlare = false;

  arms.gunDelay = Math.max(0, arms.gunDelay - dt);
  arms.missileDelay = Math.max(0, arms.missileDelay - dt);
  arms.rocketDelay = Math.max(0, arms.rocketDelay - dt);
  arms.flare = Math.max(0, arms.flare - dt);
  arms.evade = Math.max(0, arms.evade - dt);

  arms.heat = Math.max(
    0,
    arms.heat - dt * (arms.overheated ? 0.46 : command.fire ? 0.03 : 0.34)
  );
  if (arms.overheated && arms.heat <= 0.24) arms.overheated = false;
  if (flight.death > 0 || mission.phase === 'complete' || mission.phase === 'failed') {
    return { firedGun, firedMissile, firedRocket, firedFlare };
  }

  const nose = forward(flight.yaw, flight.pitch);
  const muzzle = add(flight.pos, scale(nose, 15));

  if (command.fire && arms.gunDelay === 0 && !arms.overheated) {
    arms.gunDelay = spec.gunRate;
    arms.heat = Math.min(1, arms.heat + spec.gunHeatPerShot);
    firedGun = true;
    if (arms.heat >= 1) {
      arms.overheated = true;
      tell(mission, 'GUN OVERHEATED • Cooling');
    }
    let heading = nose;
    const target = mission.target;
    if (target) {
      const lead = dist3(muzzle, target.pos) / 1020;
      const aimPos = isAircraft(target)
        ? add(target.pos, scale(forward(target.yaw, target.pitch), target.speed * lead))
        : target.pos;
      const direction = norm(sub(aimPos, muzzle));
      if (dot(heading, direction) > 0.968 && clearPath(muzzle, target.pos, map)) {
        heading = direction;
      }
    }
    mission.shots.push({
      kind: 'tracer',
      pos: muzzle,
      velocity: scale(heading, 1020),
      life: 0.9,
      size: 2.8,
      damage: 28,
      ownerName: 'YOU',
    });
  }

  if (command.missile && arms.missileDelay === 0) {
    const target = mission.target;
    if (arms.missiles <= 0) {
      tell(mission, 'MISSILES EMPTY');
    } else if (!target || !clearPath(muzzle, target.pos, map)) {
      tell(mission, 'MISSILE • Acquire a target in sight');
    } else {
      arms.missiles--;
      arms.missileDelay = 0.45;
      firedMissile = true;
      mission.shots.push({
        kind: 'missile',
        pos: muzzle,
        velocity: scale(nose, 355),
        life: 5.0,
        size: 5.2,
        target,
        damage: 110,
        ownerName: 'YOU',
        smokeTimer: 0,
      });
    }
  }

  if (command.rocket && arms.rocketDelay === 0) {
    if (arms.rockets <= 0) {
      tell(mission, 'ROCKETS EMPTY');
    } else {
      arms.rockets--;
      arms.rocketDelay = 0.22;
      firedRocket = true;
      mission.shots.push({
        kind: 'rocket',
        pos: muzzle,
        velocity: scale(nose, 520),
        life: 2.8,
        size: 4.4,
        damage: 95,
        ownerName: 'YOU',
        smokeTimer: 0,
      });
    }
  }

  if (command.flare && arms.flare === 0) {
    if (arms.flaresLeft <= 0) {
      tell(mission, 'FLARES DEPLETED');
    } else {
      arms.flaresLeft--;
      arms.flare = 4.2;
      arms.evade = 1.35;
      firedFlare = true;
      const side: Vec3 = [Math.cos(flight.yaw), 0, -Math.sin(flight.yaw)];
      for (let i = 0; i < 12; i++) {
        const rear = add(flight.pos, scale(nose, -8 - i * 0.7));
        spawnEffect(
          mission,
          'flare',
          rear,
          add(scale(nose, -26), add(scale(side, (i - 5.5) * 10), [0, -8 - i, 0])),
          0.7 + i * 0.045,
          4 + (i % 3)
        );
      }
      let deflected = false;
      for (const shot of mission.shots) {
        if (shot.kind !== 'enemyMissile' || dist3(shot.pos, flight.pos) > 640) continue;
        shot.target = null;
        shot.life = Math.min(0.85, shot.life);
        deflected = true;
      }
      tell(mission, deflected ? 'FLARES • Incoming missile diverted' : 'FLARES • Released');
    }
  }

  return { firedGun, firedMissile, firedRocket, firedFlare };
}

export function createAircraft(
  id: string,
  name: string,
  type: number,
  pos: Vec3,
  friendly: boolean,
  index: number,
  difficulty: BotDifficulty = 'standard',
  opts?: { isBoss?: boolean; isEscortTarget?: boolean; hp?: number }
): AircraftEntity {
  const spec = planes[type] ?? planes[0];
  const maxHp = opts?.hp ?? (opts?.isBoss ? 260 : opts?.isEscortTarget ? 180 : spec.hull);
  return {
    id,
    name,
    type: spec.id,
    pos: [pos[0], pos[1], pos[2]],
    yaw: 0,
    pitch: 0,
    roll: 0,
    bank: 0,
    speed: spec.speed,
    boost: 0,
    tint: friendly ? FRIENDLY_TINT : opts?.isBoss ? BOSS_TINT : HOSTILE_TINT,
    friendly,
    isBoss: opts?.isBoss,
    isEscortTarget: opts?.isEscortTarget,
    index,
    hp: maxHp,
    maxHp,
    fire: 2.2 + index * 1.4,
    gunBurst: 0,
    flareCooldown: 0,
    missiles: opts?.isBoss ? 8 : 3,
    difficulty,
    trail: [],
    lastTrailTime: -1,
  };
}

function recordAircraftTrail(ac: AircraftEntity, simTime: number): void {
  ac.lastTrailTime = recordTrailSample(
    ac.trail,
    ac.lastTrailTime,
    ac.pos,
    ac.type,
    ac.yaw,
    ac.pitch,
    ac.roll,
    simTime,
    0.06
  );
}

export function stepAircraftAI(
  ac: AircraftEntity,
  mission: MissionState,
  flight: FlightState,
  map: number,
  dt: number
): void {
  const tuning = BOT_TUNING[ac.difficulty];
  ac.flareCooldown = Math.max(0, ac.flareCooldown - dt);

  // Low-hull damage smoke
  if (ac.hp < ac.maxHp * 0.45 && Math.random() < dt * 16) {
    spawnEffect(
      mission,
      ac.hp < ac.maxHp * 0.25 ? 'fire' : 'smoke',
      ac.pos,
      [0, 6, 0],
      0.55,
      4.5
    );
  }

  // Pick target
  let targetPos: Vec3;
  let targetSpeed = 100;
  let targetYaw = 0;
  let targetPitch = 0;
  let liveTarget: AircraftEntity | FlightState | null = null;

  if (ac.isEscortTarget) {
    // Escort transport flies steadily toward destination waypoint
    const goal: Vec3 = [ac.index * 90 - 45, 220, 1450];
    targetPos = goal;
  } else if (ac.friendly) {
    // Friendly wingman attacks nearest enemy or forms up with player
    let bestEnemy: AircraftEntity | null = null;
    let bestD = Infinity;
    for (const e of mission.enemies) {
      if (e.hp <= 0) continue;
      const d = dist3(ac.pos, e.pos);
      if (d < bestD) {
        bestD = d;
        bestEnemy = e;
      }
    }
    if (bestEnemy && mission.phase !== 'ambush') {
      liveTarget = bestEnemy;
      targetPos = bestEnemy.pos;
      targetSpeed = bestEnemy.speed;
      targetYaw = bestEnemy.yaw;
      targetPitch = bestEnemy.pitch;
    } else {
      const side: Vec3 = [Math.cos(flight.yaw), 0, -Math.sin(flight.yaw)];
      targetPos = add(
        flight.pos,
        add(scale(side, (ac.index % 2 === 0 ? -1 : 1) * 65), scale(forward(flight.yaw), 45))
      );
    }
  } else {
    // Hostile AI: target player or friendly escort/wingman
    let chosen: AircraftEntity | FlightState = flight;
    let bestD = flight.death > 0 ? Infinity : dist3(ac.pos, flight.pos);
    for (const ally of mission.allies) {
      if (ally.hp <= 0) continue;
      const d = dist3(ac.pos, ally.pos) * (ally.isEscortTarget ? 0.72 : 1.15);
      if (d < bestD) {
        bestD = d;
        chosen = ally;
      }
    }
    liveTarget = chosen;
    const offset = ac.index * 1.27 + mission.time * (0.26 + ac.index * 0.015);
    const orbit: Vec3 =
      mission.phase === 'ambush'
        ? [0, 0, -220]
        : [
            Math.sin(offset) * (150 + ac.index * 18),
            Math.cos(offset * 0.8) * 48,
            Math.cos(offset) * (205 + ac.index * 12),
          ];
    targetPos = add(chosen.pos, orbit);
    targetSpeed = chosen.speed;
    targetYaw = chosen.yaw;
    targetPitch = chosen.pitch;
  }

  // Lead pursuit
  const leadTime = clamp(dist3(ac.pos, targetPos) * 0.0012, 0.1, 0.75);
  const aimedPos = liveTarget
    ? add(targetPos, scale(forward(targetYaw, targetPitch), targetSpeed * leadTime))
    : targetPos;
  aimedPos[1] = Math.max(aimedPos[1], height(aimedPos[0], aimedPos[2], map) + 72, 92);

  const delta = sub(aimedPos, ac.pos);
  const desiredYaw = Math.atan2(delta[0], delta[2]);
  const rawTurn = turnDifference(desiredYaw, ac.yaw);
  ac.yaw += clamp(rawTurn, -tuning.turnRate * dt, tuning.turnRate * dt);
  ac.bank = clamp(-rawTurn * 0.85, -0.85, 0.85);
  ac.roll = ac.bank;
  ac.pitch = clamp(Math.atan2(delta[1], Math.hypot(delta[0], delta[2])), -0.62, 0.74);
  ac.speed = ac.isEscortTarget
    ? 86
    : clamp((flight.speed * 0.72 + Math.hypot(delta[0], delta[1], delta[2]) * 0.22) * tuning.speedMult, 86, 210);

  const proposed = add(ac.pos, scale(forward(ac.yaw, ac.pitch), ac.speed * dt));
  if (solidAt(proposed[0], proposed[1], proposed[2], map, 10)) {
    ac.pos[1] += 120 * dt;
    ac.pitch = 0.65;
  } else {
    ac.pos = proposed;
  }

  recordAircraftTrail(ac, mission.time);

  // Bot flare defense against incoming player missiles
  if (!ac.friendly && ac.flareCooldown <= 0 && tuning.flareChance > 0) {
    const threat = mission.shots.find(
      (s) => s.kind === 'missile' && s.target === ac && dist3(s.pos, ac.pos) < 220
    );
    if (threat && Math.random() < tuning.flareChance * dt * 6) {
      ac.flareCooldown = 6.5;
      threat.target = null;
      threat.life = Math.min(0.6, threat.life);
      spawnEffect(mission, 'flare', ac.pos, [0, -18, 0], 0.7, 5);
    }
  }

  // Combat firing
  if (
    ac.isEscortTarget ||
    !liveTarget ||
    mission.phase === 'ambush' ||
    mission.phase === 'complete' ||
    mission.phase === 'failed'
  ) {
    return;
  }
  if (!ac.friendly && liveTarget === flight && (flight.death > 0 || mission.phaseTime < 1.8)) return;

  const range = dist3(ac.pos, liveTarget.pos);
  const toTarget = norm(sub(liveTarget.pos, ac.pos));
  const aimDot = dot(forward(ac.yaw, ac.pitch), toTarget);

  // Cannon bursts (hostiles & friendly wingmen now both fire cannons!)
  ac.gunBurst = Math.max(0, ac.gunBurst - dt);
  if (
    range < tuning.gunRange &&
    range > 45 &&
    aimDot > tuning.gunAim &&
    ac.gunBurst <= 0 &&
    clearPath(ac.pos, liveTarget.pos, map)
  ) {
    ac.gunBurst = ac.difficulty === 'ace' ? 0.16 : 0.26;
    mission.shots.push({
      kind: ac.friendly ? 'tracer' : 'enemyTracer',
      pos: add(ac.pos, scale(forward(ac.yaw, ac.pitch), 14)),
      velocity: scale(toTarget, 880),
      life: 0.85,
      size: 2.5,
      damage: ac.friendly ? 22 : ac.difficulty === 'ace' ? 12 : 8,
      ownerName: ac.name,
    });
  }

  // Missile launches
  ac.fire -= dt;
  const playerStealth = !ac.friendly && liveTarget === flight ? (planes[flight.type]?.stealthFactor ?? 1) : 1;
  const maxLockRange = 710 * playerStealth;
  if (
    ac.fire <= 0 &&
    ac.missiles > 0 &&
    range > 180 &&
    range < maxLockRange &&
    aimDot > 0.9 &&
    clearPath(ac.pos, liveTarget.pos, map)
  ) {
    const alreadyTargeted =
      !ac.friendly &&
      liveTarget === flight &&
      mission.shots.some((s) => s.kind === 'enemyMissile' && s.target === flight);
    if (!alreadyTargeted) {
      ac.fire = tuning.missileCooldown + ac.index * 0.55;
      if (Math.random() <= tuning.missileChance || ac.friendly) {
        ac.missiles--;
        mission.shots.push({
          kind: ac.friendly ? 'missile' : 'enemyMissile',
          pos: ac.pos,
          velocity: scale(toTarget, ac.friendly ? 340 : 230),
          life: 4.8,
          size: 5.5,
          target: liveTarget,
          damage: ac.friendly ? 95 : 36,
          ownerName: ac.name,
          smokeTimer: 0,
        });
      }
    }
  }
}

export function stepGroundTargets(
  mission: MissionState,
  flight: FlightState,
  map: number,
  dt: number
): void {
  for (const gt of mission.groundTargets) {
    if (gt.destroyed || gt.friendly || gt.kind !== 'aa' || flight.death > 0) continue;
    gt.fireCooldown -= dt;
    const range = dist3(gt.pos, flight.pos);
    if (gt.fireCooldown <= 0 && range < 780 && range > 60 && clearPath(gt.pos, flight.pos, map)) {
      gt.fireCooldown = 4.6;
      const dir = norm(sub(flight.pos, gt.pos));
      mission.shots.push({
        kind: 'enemyTracer',
        pos: add(gt.pos, [0, 12, 0]),
        velocity: scale(dir, 720),
        life: 1.3,
        size: 3.4,
        damage: 14,
        ownerName: gt.name,
      });
    }
  }
}

export function updateShots(
  mission: MissionState,
  flight: FlightState,
  map: number,
  dt: number
): { hitEnemy: boolean; killedEnemy: boolean; airKillsDelta: number; groundKillsDelta: number; hitPlayer: boolean } {
  let hitEnemy = false;
  let airKillsDelta = 0;
  let groundKillsDelta = 0;
  let hitPlayer = false;

  for (const shot of mission.shots) {
    shot.life -= dt;
    if (shot.life <= 0) continue;

    // Missile & rocket smoke trail
    if (shot.kind === 'missile' || shot.kind === 'enemyMissile' || shot.kind === 'rocket') {
      shot.smokeTimer = (shot.smokeTimer ?? 0) + dt;
      if (shot.smokeTimer >= 0.045) {
        shot.smokeTimer = 0;
        spawnEffect(mission, 'smoke', shot.pos, [0, 2, 0], 0.55, 3.6);
      }
    }

    const target = shot.target;
    if (target) {
      const speed = Math.hypot(shot.velocity[0], shot.velocity[1], shot.velocity[2]);
      const guidance = Math.min(1, dt * (shot.kind === 'missile' ? 4.8 : 2.6));
      const goal = norm(sub(target.pos, shot.pos));
      shot.velocity = scale(
        norm(add(scale(shot.velocity, (1 - guidance) / (speed || 1)), scale(goal, guidance))),
        speed
      );
    }

    shot.pos = add(shot.pos, scale(shot.velocity, dt));
    if (solidAt(shot.pos[0], shot.pos[1], shot.pos[2], map)) {
      shot.life = 0;
      if (shot.kind === 'rocket' || shot.kind === 'missile') {
        spawnEffect(mission, 'spark', shot.pos, [0, 12, 0], 0.28, 7);
      }
      continue;
    }

    if (shot.kind === 'enemyMissile' || shot.kind === 'enemyTracer') {
      if (shot.visual) {
        if (target && dist3(target.pos, shot.pos) < 13) shot.life = 0;
        continue;
      }
      const arms = mission.arms;
      if (
        shot.kind === 'enemyMissile' &&
        target === flight &&
        (arms.evade > 0 ||
          (flight.boost > 0.64 &&
            Math.abs(flight.bank) > 0.53 &&
            dist3(shot.pos, flight.pos) < 135))
      ) {
        shot.target = null;
        shot.life = Math.min(0.8, shot.life);
        if (arms.evade <= 0) tell(mission, 'BOOST EVADE • Lock broken');
        continue;
      }
      // Hit player
      if (!flight.death && dist3(shot.pos, flight.pos) < (shot.kind === 'enemyMissile' ? 15 : 12)) {
        flight.hull = Math.max(0, flight.hull - shot.damage);
        mission.damageFlash = 0.35;
        mission.shake = Math.max(mission.shake, 0.3);
        hitPlayer = true;
        if (flight.hull <= 0) {
          flight.death = 1.45;
          explosionBurst(mission, flight.pos, true);
          pushKillFeed(mission, `${shot.ownerName ?? 'HOSTILE'} ✕ YOU`, '#ff7d6e');
        } else {
          explosionBurst(mission, shot.pos, false);
        }
        shot.life = 0;
        tell(mission, 'HULL HIT');
        continue;
      }
      // Hit friendly ally
      for (const ally of mission.allies) {
        if (ally.hp <= 0) continue;
        if (dist3(shot.pos, ally.pos) < 16) {
          ally.hp -= shot.damage;
          shot.life = 0;
          if (ally.hp <= 0) {
            explosionBurst(mission, ally.pos, true);
            pushKillFeed(mission, `${shot.ownerName ?? 'HOSTILE'} ✕ ${ally.name}`, '#ffb480');
            tell(mission, `${ally.name} DOWN!`);
          }
          break;
        }
      }
      continue;
    }

    if (mission.phase === 'ambush') continue;

    // Player / ally shots hitting enemy aircraft
    let consumed = false;
    for (const enemy of mission.enemies) {
      if (enemy.hp <= 0) continue;
      const hitRadius = shot.kind === 'missile' ? 22 : shot.kind === 'rocket' ? 20 : 15;
      if (dist3(shot.pos, enemy.pos) >= hitRadius) continue;
      enemy.hp -= shot.damage;
      shot.life = 0;
      consumed = true;
      if (shot.ownerName === 'YOU') {
        hitEnemy = true;
        mission.hitMarker = 0.22;
      }
      if (enemy.hp <= 0) {
        mission.kills++;
        airKillsDelta++;
        explosionBurst(mission, enemy.pos, Boolean(enemy.isBoss));
        pushKillFeed(
          mission,
          `${shot.ownerName ?? 'YOU'} ✕ ${enemy.name}`,
          enemy.isBoss ? '#ffd966' : '#8ef4ce'
        );
        tell(mission, enemy.isBoss ? `ACE DOWN • ${enemy.name}` : `HOSTILE DOWN • ${enemy.name}`);
      } else {
        spawnEffect(mission, 'spark', shot.pos, [0, 0, 0], 0.14, 7);
      }
      break;
    }
    if (consumed) continue;

    // Player / ally shots hitting ground targets
    for (const gt of mission.groundTargets) {
      if (gt.destroyed || gt.friendly) continue;
      const hitRadius = shot.kind === 'rocket' ? 28 : shot.kind === 'missile' ? 26 : 19;
      if (dist3(shot.pos, gt.pos) >= hitRadius) continue;
      gt.hp -= shot.damage * (shot.kind === 'rocket' ? 1.4 : 1);
      shot.life = 0;
      if (shot.ownerName === 'YOU') {
        hitEnemy = true;
        mission.hitMarker = 0.22;
      }
      if (gt.hp <= 0) {
        gt.destroyed = true;
        mission.groundKills++;
        groundKillsDelta++;
        explosionBurst(mission, gt.pos, true);
        pushKillFeed(mission, `${shot.ownerName ?? 'YOU'} ✕ ${gt.name}`, '#ffd37a');
        tell(mission, `TARGET DESTROYED • ${gt.name}`);
      } else {
        spawnEffect(mission, 'spark', shot.pos, [0, 6, 0], 0.16, 7);
      }
      break;
    }
  }

  mission.shots = mission.shots.filter(
    (shot) =>
      shot.life > 0 &&
      (!isAircraft(shot.target) || shot.target.hp > 0)
  );
  mission.enemies = mission.enemies.filter((e) => e.hp > 0);
  mission.allies = mission.allies.filter((a) => a.hp > 0);

  return {
    hitEnemy,
    killedEnemy: airKillsDelta > 0 || groundKillsDelta > 0,
    airKillsDelta,
    groundKillsDelta,
    hitPlayer,
  };
}

export function missileWarning(mission: MissionState, flight: FlightState): boolean {
  return mission.shots.some((s) => s.kind === 'enemyMissile' && s.target === flight);
}
