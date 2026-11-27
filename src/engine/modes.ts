import type {
  AircraftEntity,
  BotDifficulty,
  CampaignLevel,
  ControlInput,
  FlightState,
  GameMode,
  GroundTarget,
  MedalRank,
  MissionState,
  RingCheckpoint,
  SkirmishConfig,
  Vec3,
} from './types';
import {
  add,
  CENTRAL_REFUEL_RADIUS,
  centralRefuelPosition,
  clamp,
  dist3,
  forward,
  GLACIER_VAULT,
  height,
  norm,
  scale,
  sub,
  VOLCANO,
} from './world';
import {
  acquireTarget,
  createAircraft,
  createWeapons,
  explosionBurst,
  pushKillFeed,
  stepAircraftAI,
  stepGroundTargets,
  tell,
  updatePlayerWeapons,
  updateShots,
} from './combat';
import { getCampaignLevel, RELAYS, relayPosition } from './campaign';

export function buildCalderaRings(): RingCheckpoint[] {
  const vy = VOLCANO.tunnelAltitude;
  const vx = VOLCANO.x;
  const vz = VOLCANO.z;
  const outsideY = Math.max(vy + 35, height(vx + 390, vz + 160, 0) + 55);
  return [
    { id: 1, pos: [vx, vy, vz - 320], radius: 44, passed: false },
    { id: 2, pos: [vx, vy, vz - 150], radius: 44, passed: false },
    { id: 3, pos: [vx + 65, vy + 10, vz], radius: 48, passed: false },
    { id: 4, pos: [vx + 220, vy, vz], radius: 44, passed: false },
    { id: 5, pos: [vx + 390, outsideY, vz + 160], radius: 52, passed: false },
    { id: 6, pos: [vx, vy, vz + 320], radius: 44, passed: false },
    { id: 7, pos: [vx - 70, vy + 8, vz], radius: 48, passed: false },
    { id: 8, pos: [vx - 260, vy, vz], radius: 44, passed: false },
  ];
}

export function buildGlacierRings(): RingCheckpoint[] {
  const gy = GLACIER_VAULT.tunnelAltitude;
  const gx = GLACIER_VAULT.x;
  const gz = GLACIER_VAULT.z;
  const outsideY = Math.max(gy + 85, height(gx + 160, gz + 260, 1) + 55);
  return [
    { id: 1, pos: [gx, gy, gz - 300], radius: 46, passed: false },
    { id: 2, pos: [gx, gy, gz - 120], radius: 46, passed: false },
    { id: 3, pos: [gx + 75, gy + 12, gz], radius: 50, passed: false },
    { id: 4, pos: [gx + 240, gy, gz], radius: 46, passed: false },
    { id: 5, pos: [gx + 160, outsideY, gz + 260], radius: 54, passed: false },
    { id: 6, pos: [gx, gy, gz + 290], radius: 46, passed: false },
    { id: 7, pos: [gx - 65, gy + 10, gz], radius: 50, passed: false },
    { id: 8, pos: [gx - 240, gy, gz], radius: 46, passed: false },
  ];
}

function buildCanyonRings(
  count: number,
  map: number,
  lowCeiling?: number,
  anchorPos?: Vec3
): RingCheckpoint[] {
  const rings: RingCheckpoint[] = [];
  const baseX = anchorPos ? anchorPos[0] : map === 1 ? -580 : 560;
  const baseZ = anchorPos ? anchorPos[2] + 260 : -540;
  for (let i = 0; i < count; i++) {
    const z = baseZ + i * 240;
    const x = baseX + Math.sin(i * 0.85) * 180;
    const ground = height(x, z, map);
    const y = lowCeiling ? Math.min(ground + lowCeiling - 45, ground + 115) : ground + 120 + (i % 3) * 35;
    rings.push({ id: i + 1, pos: [x, Math.max(95, y), z], radius: 52, passed: false });
  }
  return rings;
}

function buildGroundTargets(level: CampaignLevel): GroundTarget[] {
  const count = level.groundTargets ?? 0;
  const targets: GroundTarget[] = [];
  if (count <= 0) return targets;

  if (level.archetype === 'tunnel') {
    const center = level.map === 0 ? VOLCANO : GLACIER_VAULT;
    const offsets: Vec3[] = [
      [0, center.tunnelAltitude, -170],
      [170, center.tunnelAltitude, 0],
      [0, center.tunnelAltitude, 170],
      [-170, center.tunnelAltitude, 0],
    ];
    for (let i = 0; i < Math.min(count, offsets.length); i++) {
      targets.push({
        id: `core-${i + 1}`,
        name: `${level.map === 0 ? 'Magma' : 'Vault'} Core ${i + 1}`,
        kind: 'core',
        pos: [center.x + offsets[i][0], offsets[i][1], center.z + offsets[i][2]],
        hp: 110,
        maxHp: 110,
        fireCooldown: 99,
        destroyed: false,
      });
    }
    return targets;
  }

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + 0.4;
    const radius = 520 + (i % 2) * 320;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = height(x, z, level.map) + 8;
    const kind: GroundTarget['kind'] =
      level.archetype === 'relay-blitz'
        ? 'relay'
        : i % 2 === 0
          ? 'radar'
          : 'aa';
    targets.push({
      id: `gt-${i + 1}`,
      name:
        kind === 'relay'
          ? `Blackout Relay ${i + 1}`
          : kind === 'radar'
            ? `Radar Dome ${i + 1}`
            : `AA Battery ${i + 1}`,
      kind,
      pos: [x, y, z],
      hp: kind === 'relay' ? 120 : 140,
      maxHp: kind === 'relay' ? 120 : 140,
      fireCooldown: 3 + i * 1.1,
      destroyed: false,
    });
  }
  return targets;
}

function spawnEnemyWave(
  flight: FlightState,
  count: number,
  difficulty: BotDifficulty,
  waveNum: number,
  rear = false,
  boss?: { name: string; plane: number }
): AircraftEntity[] {
  const list: AircraftEntity[] = [];
  for (let i = 0; i < count; i++) {
    const pos = add(flight.pos, [
      (i - (count - 1) / 2) * 80,
      ((i % 3) - 1) * 30,
      rear ? -285 - i * 33 : 560 + i * 45,
    ]);
    list.push(
      createAircraft(
        `enemy-w${waveNum}-${i}`,
        `Obsidian-${waveNum}${i + 1}`,
        i % 3,
        pos,
        false,
        i,
        difficulty
      )
    );
  }
  if (boss) {
    const bPos = add(flight.pos, [0, 55, 680]);
    list.push(
      createAircraft(`boss-${boss.name}`, boss.name, boss.plane, bPos, false, count, 'ace', {
        isBoss: true,
        hp: 260,
      })
    );
  }
  return list;
}

function spawnRearmRing(flight: FlightState, map: number): RingCheckpoint {
  const ahead = add(flight.pos, scale(forward(flight.yaw), 420));
  const y = Math.max(height(ahead[0], ahead[2], map) + 110, 190);
  return { id: 99, pos: [ahead[0], y, ahead[2]], radius: 58, passed: false, isRearm: true };
}

export function createMission(
  mode: GameMode,
  flight: FlightState,
  opts?: {
    levelId?: number;
    skirmish?: SkirmishConfig;
    timeTrialCourse?: 'caldera' | 'glacier';
    map?: number;
  }
): MissionState {
  const base: MissionState = {
    mode,
    phase: 'free-flight',
    time: 0,
    phaseTime: 0,
    kills: 0,
    groundKills: 0,
    wave: 1,
    maxWaves: 1,
    signal: false,
    chosenRelay: null,
    allies: [],
    enemies: [],
    groundTargets: [],
    rings: [],
    nextRingIndex: 0,
    shots: [],
    effects: [],
    arms: createWeapons(flight.type),
    target: null,
    message: '',
    flash: 0,
    shake: 0,
    hitMarker: 0,
    damageFlash: 0,
    event: 0,
    killFeed: [],
    ceilingViolationTime: 0,
    timeLimitRemaining: null,
    refuelCooldown: 0,
    triggeredBeats: new Set(),
  };

  if (mode === 'story') {
    const level = getCampaignLevel(opts?.levelId ?? 1);
    base.levelId = level.id;
    base.level = level;
    base.maxWaves = level.waves ?? 1;
    base.timeLimitRemaining = level.timeLimitSec ?? null;

    if (level.archetype === 'dead-air') {
      base.phase = 'ambush';
      base.allies = [-1, 1].map((side, i) =>
        createAircraft(
          `wing-${i + 2}`,
          `WING ${i === 0 ? 'TWO' : 'THREE'}`,
          i,
          add(flight.pos, [side * 60, 1, 46]),
          true,
          i,
          'standard'
        )
      );
      base.enemies = spawnEnemyWave(flight, 5, 'standard', 1, true);
    } else {
      base.phase = level.archetype === 'recon-rings' || level.archetype === 'low-ceiling' ? 'rings' : 'combat';
      for (let i = 0; i < level.allyCount; i++) {
        const isEscort = level.archetype === 'escort';
        base.allies.push(
          createAircraft(
            `ally-${i + 1}`,
            isEscort ? `CARGO-${i + 1}` : i === 0 ? 'KESTREL' : `WING-${i + 2}`,
            isEscort ? 1 : 2,
            add(flight.pos, [(i % 2 === 0 ? -1 : 1) * 70, 5, 65 + i * 35]),
            true,
            i,
            'veteran',
            { isEscortTarget: isEscort }
          )
        );
      }
      base.enemies = spawnEnemyWave(
        flight,
        level.enemyCount,
        level.difficulty,
        1,
        false,
        level.bossName ? { name: level.bossName, plane: level.bossPlane ?? 2 } : undefined
      );
      base.groundTargets = buildGroundTargets(level);
      if (level.ringCount) {
        base.rings =
          level.id === 26
            ? buildCalderaRings()
            : buildCanyonRings(level.ringCount, level.map, level.ceilingLimit, level.spawnPos);
      }
      if (level.archetype === 'survival') {
        base.rings = [spawnRearmRing(flight, level.map)];
      }
    }
    const firstBeat = level.script.find((b) => b.trigger === 'start');
    if (firstBeat) {
      base.triggeredBeats.add('start');
      tell(base, `${firstBeat.speaker} • ${firstBeat.line}`);
    }
    return base;
  }

  if (mode === 'skirmish') {
    const cfg: SkirmishConfig = opts?.skirmish ?? {
      map: 0,
      atmosphere: 'day',
      difficulty: 'veteran',
      preset: '2v2',
    };
    base.skirmishConfig = cfg;
    base.phase = 'combat';
    const counts = { '1v1': [0, 1], '1v3': [0, 3], '2v2': [1, 2], '3v3': [2, 3] }[cfg.preset];
    for (let i = 0; i < counts[0]; i++) {
      base.allies.push(
        createAircraft(
          `wing-${i + 1}`,
          i === 0 ? 'KESTREL' : `VIPER-${i + 1}`,
          (i + 1) % 3,
          add(flight.pos, [(i % 2 === 0 ? -1 : 1) * 75, 10, 50]),
          true,
          i,
          cfg.difficulty
        )
      );
    }
    base.enemies = spawnEnemyWave(flight, counts[1], cfg.difficulty, 1, false);
    tell(base, `SKIRMISH ${cfg.preset.toUpperCase()} • ${cfg.difficulty.toUpperCase()} BOTS`);
    return base;
  }

  if (mode === 'timetrial') {
    const course = opts?.timeTrialCourse ?? 'caldera';
    base.timeTrialCourse = course;
    base.phase = 'rings';
    base.rings = course === 'caldera' ? buildCalderaRings() : buildGlacierRings();
    tell(
      base,
      course === 'caldera'
        ? 'CALDERA TIME TRIAL • Thread all 8 volcanic rings!'
        : 'GLACIER VAULT TRIAL • Thread all 8 arctic rings!'
    );
    return base;
  }

  if (mode === 'survival') {
    base.phase = 'combat';
    base.maxWaves = 999;
    base.enemies = spawnEnemyWave(flight, 3, 'standard', 1, false);
    base.rings = [spawnRearmRing(flight, opts?.map ?? 0)];
    tell(base, 'WAVE 1 • Survive & fly through green rings to rearm');
    return base;
  }

  return base;
}

export function selectRelay(mission: MissionState, id: string | undefined): void {
  if (!id || mission.phase !== 'relay' || !RELAYS.some((r) => r.id === id)) return;
  mission.chosenRelay = id;
}

export function computeRank(elapsed: number, parTime: number, hullRatio: number): MedalRank {
  const integrity = clamp(hullRatio, 0, 1);
  if (elapsed <= parTime * 0.85 && integrity >= 0.75) return 'S';
  if (elapsed <= parTime * 1.15 && integrity >= 0.45) return 'A';
  if (elapsed <= parTime * 1.5 && integrity > 0) return 'B';
  return 'C';
}

function updateDeadAirAmbush(mission: MissionState, flight: FlightState): void {
  for (const ally of mission.allies) {
    const side: Vec3 = [Math.cos(flight.yaw), 0, -Math.sin(flight.yaw)];
    ally.pos = add(
      flight.pos,
      add(scale(side, ally.index ? 57 : -57), scale(forward(flight.yaw), 47))
    );
    ally.yaw = flight.yaw;
    ally.pitch = flight.pitch * 0.6;
    ally.roll = flight.roll * 0.6;
  }
  if (mission.phaseTime >= 0.22 && !mission.triggeredBeats.has('ambush-visual')) {
    mission.triggeredBeats.add('ambush-visual');
    tell(mission, 'WING TWO • Five contacts, six o’clock!');
    for (const [index, ally] of mission.allies.entries()) {
      const origin = mission.enemies[index * 3]?.pos ?? add(flight.pos, [0, 0, -240]);
      mission.shots.push({
        kind: 'enemyMissile',
        pos: origin,
        velocity: scale(norm(sub(ally.pos, origin)), 510),
        target: ally,
        visual: true,
        life: 1.45,
        size: 5,
        damage: 0,
      });
    }
  }
  if (mission.phaseTime >= 1 && mission.allies.length === 2) {
    const ally = mission.allies.shift()!;
    explosionBurst(mission, ally.pos, true);
    pushKillFeed(mission, 'OBSIDIAN ✕ WING TWO', '#ff8c7a');
    tell(mission, 'WING TWO • I’m hit!');
  }
  if (mission.phaseTime >= 1.82 && mission.allies.length === 1) {
    const ally = mission.allies.shift()!;
    explosionBurst(mission, ally.pos, true);
    pushKillFeed(mission, 'OBSIDIAN ✕ WING THREE', '#ff8c7a');
    mission.phase = 'combat';
    mission.phaseTime = 0;
    tell(mission, 'WING THREE LOST • Clear all five hostiles');
  }
}

export interface StepMissionEvents {
  firedGun: boolean;
  firedMissile: boolean;
  firedRocket: boolean;
  firedFlare: boolean;
  hitEnemy: boolean;
  killedEnemy: boolean;
  airKillsDelta: number;
  groundKillsDelta: number;
  hitPlayer: boolean;
  ringPassed: boolean;
  rearmed: boolean;
  phaseChanged: boolean;
}

export function stepMission(
  mission: MissionState,
  flight: FlightState,
  command: ControlInput,
  map: number,
  dt: number
): StepMissionEvents {
  const phaseBefore = mission.phase;
  mission.time += dt;
  mission.phaseTime += dt;
  mission.flash = Math.max(0, mission.flash - dt);
  mission.shake = Math.max(0, mission.shake - dt * 1.8);
  mission.hitMarker = Math.max(0, mission.hitMarker - dt);
  mission.damageFlash = Math.max(0, mission.damageFlash - dt);
  mission.refuelCooldown = Math.max(0, mission.refuelCooldown - dt);

  if (flight.recovered) {
    mission.arms = createWeapons(flight.type);
    mission.shots = mission.shots.filter((s) => s.kind !== 'enemyMissile' || s.target !== flight);
    tell(mission, 'RESPAWN COMPLETE • Systems & weapons restored');
  }

  // Player low-hull smoke VFX
  if (flight.death <= 0 && flight.hull < flight.maxHull * 0.42 && Math.random() < dt * 18) {
    mission.effects.push({
      kind: flight.hull < flight.maxHull * 0.22 ? 'fire' : 'smoke',
      pos: [flight.pos[0], flight.pos[1], flight.pos[2]],
      velocity: [0, 5, 0],
      life: 0.5,
      size: 4.2,
    });
  }

  if (mission.phase === 'ambush') updateDeadAirAmbush(mission, flight);

  mission.target = acquireTarget(mission.enemies, mission.groundTargets, flight);
  const wEvents = updatePlayerWeapons(mission, flight, command, map, dt);

  for (const ally of mission.allies) {
    if (mission.phase !== 'ambush') stepAircraftAI(ally, mission, flight, map, dt);
  }
  for (const enemy of mission.enemies) {
    stepAircraftAI(enemy, mission, flight, map, dt);
  }
  stepGroundTargets(mission, flight, map, dt);
  const sEvents = updateShots(mission, flight, map, dt);
  mission.target = acquireTarget(mission.enemies, mission.groundTargets, flight);

  // Active Volcano (Map 0) rising ember & volcanic smoke plume particles at [0, 0]
  if (
    map === 0 &&
    mission.effects.length < 220 &&
    dist3(flight.pos, [VOLCANO.x, VOLCANO.tunnelAltitude, VOLCANO.z]) < 2800 &&
    Math.random() < dt * 11
  ) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 88;
    const isEmber = Math.random() < 0.58;
    mission.effects.push({
      kind: isEmber ? (Math.random() < 0.5 ? 'spark' : 'fire') : 'smoke',
      pos: [VOLCANO.x + Math.cos(a) * r, 58 + Math.random() * 14, VOLCANO.z + Math.sin(a) * r],
      velocity: [(Math.random() - 0.5) * 14, isEmber ? 42 + Math.random() * 34 : 32 + Math.random() * 24, (Math.random() - 0.5) * 14],
      life: isEmber ? 2.4 + Math.random() * 1.4 : 4.2 + Math.random() * 1.8,
      size: isEmber ? 4.5 + Math.random() * 3.5 : 14 + Math.random() * 10,
    });
  }

  for (const item of mission.effects) {
    item.pos = add(item.pos, scale(item.velocity, dt));
    item.life -= dt;
  }
  mission.effects = mission.effects.filter((e) => e.life > 0);

  // Scripted time/half-kills beats
  if (mission.level && mission.phase !== 'complete' && mission.phase !== 'failed') {
    for (const beat of mission.level.script) {
      const key = `${beat.trigger}-${beat.timeSec ?? 0}`;
      if (mission.triggeredBeats.has(key)) continue;
      if (beat.trigger === 'time' && beat.timeSec !== undefined && mission.time >= beat.timeSec) {
        mission.triggeredBeats.add(key);
        tell(mission, `${beat.speaker} • ${beat.line}`);
      } else if (
        beat.trigger === 'half-kills' &&
        mission.kills + mission.groundKills >= Math.max(2, Math.floor((mission.level.enemyCount + (mission.level.groundTargets ?? 0)) / 2))
      ) {
        mission.triggeredBeats.add(key);
        tell(mission, `${beat.speaker} • ${beat.line}`);
      }
    }
  }

  // Time limit check
  if (
    mission.timeLimitRemaining !== null &&
    mission.phase !== 'complete' &&
    mission.phase !== 'failed'
  ) {
    mission.timeLimitRemaining = Math.max(0, mission.timeLimitRemaining - dt);
    if (mission.timeLimitRemaining <= 0) {
      mission.phase = 'failed';
      tell(mission, 'MISSION FAILED • Time limit expired');
    }
  }

  // Low-ceiling check (Level 5)
  if (
    mission.level?.ceilingLimit &&
    mission.phase === 'rings' &&
    flight.death <= 0
  ) {
    const agl = flight.pos[1] - height(flight.pos[0], flight.pos[2], map);
    if (agl > mission.level.ceilingLimit) {
      mission.ceilingViolationTime += dt;
      if (mission.ceilingViolationTime > 4.5) {
        tell(mission, 'RADAR LOCK! Drop below ' + mission.level.ceilingLimit + 'm AGL!');
        mission.ceilingViolationTime = 2;
      }
    } else {
      mission.ceilingViolationTime = Math.max(0, mission.ceilingViolationTime - dt);
    }
  }

  const hullRatio = flight.hull / Math.max(1, flight.maxHull);

  // Immediate Mission Failed transition on hull 0 / terrain impact in story, timetrial, survival
  if (
    (mission.mode === 'story' || mission.mode === 'timetrial' || mission.mode === 'survival') &&
    mission.phase !== 'complete' &&
    mission.phase !== 'failed' &&
    (flight.hull <= 0 || flight.death > 0)
  ) {
    mission.phase = 'failed';
    tell(mission, 'MISSION FAILED • Aircraft destroyed');
  }

  // Central Volcano Refuel & Rearm Station (all maps & all modes)
  let rearmed = false;
  if (
    flight.death <= 0 &&
    mission.phase !== 'complete' &&
    mission.phase !== 'failed' &&
    mission.refuelCooldown <= 0 &&
    dist3(flight.pos, centralRefuelPosition(map)) <= CENTRAL_REFUEL_RADIUS
  ) {
    const freshArms = createWeapons(flight.type);
    flight.fuel = flight.maxFuel;
    flight.lowFuel = false;
    flight.flameout = false;
    flight.hull = flight.maxHull;
    mission.arms.missiles = freshArms.missiles;
    mission.arms.rockets = freshArms.rockets;
    mission.arms.flaresLeft = freshArms.flaresLeft;
    mission.arms.heat = 0;
    mission.arms.overheated = false;
    mission.refuelCooldown = 4.0;
    rearmed = true;
    tell(mission, 'VOLCANO CORE DEPOT • Fuel 100%, Hull repaired & Weapons rearmed!');
  }

  // Ring / Rearm ring collisions
  let ringPassed = false;
  if (flight.death <= 0 && mission.rings.length > 0 && mission.phase !== 'failed') {
    if (mission.phase === 'rings') {
      const nextRing = mission.rings[mission.nextRingIndex];
      if (nextRing && !nextRing.passed && dist3(flight.pos, nextRing.pos) <= nextRing.radius) {
        nextRing.passed = true;
        mission.nextRingIndex++;
        ringPassed = true;
        tell(mission, `CHECKPOINT ${mission.nextRingIndex} / ${mission.rings.length}`);
        if (mission.nextRingIndex >= mission.rings.length) {
          mission.phase = 'complete';
          mission.rank = computeRank(mission.time, mission.level?.parTimeSec ?? 95, hullRatio);
          tell(mission, `COURSE COMPLETE • ${mission.time.toFixed(1)}s`);
        }
      }
    } else {
      // Mid-air rearm/repair rings in Survival
      for (const ring of mission.rings) {
        if (ring.isRearm && !ring.passed && dist3(flight.pos, ring.pos) <= ring.radius) {
          ring.passed = true;
          ringPassed = true;
          rearmed = true;
          flight.hull = flight.maxHull;
          flight.fuel = flight.maxFuel;
          flight.lowFuel = false;
          flight.flameout = false;
          mission.arms = createWeapons(flight.type);
          tell(mission, 'REARM RING • Fuel 100%, Hull repaired & missiles reloaded!');
        }
      }
    }
  }

  // Phase completion logic per mode
  if (mission.mode === 'story' && mission.level && mission.phase !== 'failed') {
    const lvl = mission.level;
    if (lvl.archetype === 'dead-air') {
      if (mission.phase === 'combat' && mission.enemies.length === 0) {
        mission.phase = 'jammed';
        mission.phaseTime = 0;
        tell(mission, 'RADIO JAMMED • Command cannot hear you');
      } else if (mission.phase === 'jammed' && mission.phaseTime >= 2.2) {
        mission.phase = 'relay';
        mission.phaseTime = 0;
        tell(mission, 'THREE RELAYS FOUND • Choose one on the map (1/2/3)');
      } else if (mission.phase === 'relay' && !flight.death) {
        const next = RELAYS.find((r) => r.id === mission.chosenRelay);
        if (next) {
          const delta = sub(flight.pos, relayPosition(next, map));
          if (Math.hypot(delta[0], delta[2]) <= 105 && Math.abs(delta[1]) <= 155) {
            mission.signal = true;
            mission.phase = 'complete';
            mission.rank = computeRank(mission.time, lvl.parTimeSec, hullRatio);
            tell(mission, 'SIGNAL RESTORED • ' + next.name);
          }
        }
      }
    } else if (mission.phase === 'combat') {
      const activeGround = mission.groundTargets.filter((g) => !g.destroyed && !g.friendly).length;
      const enemiesClear = mission.enemies.length === 0;
      const groundClear = activeGround === 0;

      if (lvl.archetype === 'escort' && mission.allies.length === 0) {
        mission.phase = 'failed';
        tell(mission, 'MISSION FAILED • Escort flight lost');
      } else if (enemiesClear && groundClear) {
        if (mission.wave < mission.maxWaves) {
          mission.wave++;
          const diff: BotDifficulty =
            mission.wave >= 3 ? 'ace' : lvl.difficulty;
          mission.enemies = spawnEnemyWave(flight, lvl.enemyCount, diff, mission.wave, false);
          if (lvl.archetype === 'survival') {
            mission.rings = [spawnRearmRing(flight, map)];
          }
          tell(mission, `WAVE ${mission.wave} / ${mission.maxWaves} INBOUND`);
        } else {
          mission.phase = 'complete';
          mission.rank = computeRank(mission.time, lvl.parTimeSec, hullRatio);
          const doneBeat = lvl.script.find((b) => b.trigger === 'complete');
          tell(
            mission,
            doneBeat ? `${doneBeat.speaker} • ${doneBeat.line}` : `MISSION COMPLETE • ${lvl.title}`
          );
        }
      }
    }
  } else if (mission.mode === 'skirmish' && mission.phase === 'combat') {
    if (mission.enemies.length === 0) {
      mission.phase = 'complete';
      mission.rank = computeRank(mission.time, 120, hullRatio);
      tell(mission, 'SKIRMISH VICTORY • All hostiles splashed');
    }
  } else if (mission.mode === 'survival' && mission.phase === 'combat') {
    if (mission.enemies.length === 0) {
      mission.wave++;
      const count = Math.min(8, 2 + mission.wave);
      const diff: BotDifficulty =
        mission.wave >= 5 ? 'ace' : mission.wave >= 3 ? 'veteran' : 'standard';
      mission.enemies = spawnEnemyWave(flight, count, diff, mission.wave, false);
      mission.rings = [spawnRearmRing(flight, map)];
      tell(mission, `WAVE ${mission.wave} • ${count} ${diff.toUpperCase()} HOSTILES · Rearm ring deployed`);
    }
  }

  return {
    ...wEvents,
    ...sEvents,
    ringPassed,
    rearmed,
    phaseChanged: mission.phase !== phaseBefore,
  };
}
