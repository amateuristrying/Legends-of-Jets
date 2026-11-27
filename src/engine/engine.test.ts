import { describe, expect, it } from 'vitest';
import {
  AIRCRAFT_WING_GEOMETRY,
  aircraftBasis,
  applyTerrainImpact,
  carveLandmark,
  centralRefuelPosition,
  consumeTerrainDirty,
  ELEVATION_STEP,
  GLACIER_VAULT,
  glacierDensity,
  getTerrainRevision,
  planes,
  pruneTrail,
  recordTrailSample,
  resetTerrainDamage,
  sampleElevationRGWindow,
  sampleElevationWindow,
  shiftElevationRGWindow,
  scorchAt,
  solidAt,
  TERRAIN_SIZE,
  terrainHeight,
  TRAIL_MAX_AGE,
  VOLCANO,
  volcanoDensity,
  WING_Y_OFFSET,
  WINGTIP_OFFSETS,
  wingtipPositions,
} from './world';
import { getLandmarkChunks } from './landmarks';
import { interpolateFlight, newFlight, SIM_STEP, stepFlight } from './flight';
import { CAMPAIGN_LEVELS, RELAYS, relayPosition } from './campaign';
import {
  buildCalderaRings,
  buildGlacierRings,
  computeRank,
  createMission,
  selectRelay,
  stepMission,
} from './modes';
import {
  BOSS_PROFILE_LABELS,
  bossProfileForName,
  stepAircraftAI,
  updateShots,
} from './combat';
import { Radar } from './radar';
import {
  DEFAULT_PILOT_LOG,
  findNewlyUnlockedPlanes,
  isPlaneUnlocked,
  recordCampaignClear,
  resetPilotLog,
} from './storage';
import type { CampaignArchetype, ControlInput, GroundTarget, TrailSample } from './types';

const IDLE: ControlInput = {
  turn: 0,
  pitch: 0,
  boost: false,
  brake: false,
  roll: false,
  fire: false,
  missile: false,
  rocket: false,
  flare: false,
};

describe('Legends of Jets v1.0 Engine', () => {
  it('keeps shifted terrain windows identical to fresh samples across both maps', () => {
    const texels = 64;
    const shifts = [[128, 0], [-128, 128], [-128, -128], [0, -128], [0, 0], [1024, 0]];
    for (const map of [0, 1]) {
      let x = -256;
      let z = -256;
      const pixels = sampleElevationRGWindow(map, x, z, texels);
      for (const [dx, dz] of shifts) {
        shiftElevationRGWindow(map, pixels, x, z, x + dx, z + dz, texels);
        x += dx;
        z += dz;
        const fresh = sampleElevationRGWindow(map, x, z, texels);
        expect(pixels.every((value, index) => value === fresh[index])).toBe(true);
      }
    }
  });

  it('defines 5 distinct airframes with unique loadouts and unlock progression', () => {
    expect(planes).toHaveLength(5);
    expect(isPlaneUnlocked(0, DEFAULT_PILOT_LOG)).toBe(true);
    expect(isPlaneUnlocked(2, DEFAULT_PILOT_LOG)).toBe(true);
    expect(isPlaneUnlocked(3, DEFAULT_PILOT_LOG)).toBe(false);
    expect(isPlaneUnlocked(4, DEFAULT_PILOT_LOG)).toBe(false);
    expect(isPlaneUnlocked(3, { ...DEFAULT_PILOT_LOG, totalKills: 30 })).toBe(true);
    expect(isPlaneUnlocked(4, { ...DEFAULT_PILOT_LOG, totalKills: 80 })).toBe(true);
  });

  it('carves flyable tunnels through both Ashmouth Caldera (Map 0) and Glacier Vault (Map 1)', () => {
    // Ashmouth south tunnel mouth & interior
    expect(volcanoDensity(0, VOLCANO.tunnelAltitude, -260)).toBeLessThan(0);
    expect(volcanoDensity(0, VOLCANO.tunnelAltitude, 0)).toBeLessThan(0);
    expect(solidAt(VOLCANO.x, VOLCANO.tunnelAltitude, VOLCANO.z - 220, 0)).toBe(false);

    // Frostline Glacier Vault south tunnel mouth & central atrium
    expect(glacierDensity(0, GLACIER_VAULT.tunnelAltitude, -220)).toBeLessThan(0);
    expect(glacierDensity(0, GLACIER_VAULT.tunnelAltitude, 0)).toBeLessThan(0);
    expect(solidAt(GLACIER_VAULT.x, GLACIER_VAULT.tunnelAltitude, GLACIER_VAULT.z - 200, 1)).toBe(false);
  });

  it('sim-lite flight physics models dive acceleration, climb speed bleed, and dynamic fuel burn', () => {
    const climbing = newFlight(0, [0, 350, 0]);
    const diving = newFlight(0, [0, 500, 0]);
    for (let i = 0; i < 180; i++) {
      stepFlight(climbing, { pitch: 0.9, boost: false }, 0, SIM_STEP, 'sim-lite');
      stepFlight(diving, { pitch: -0.9, boost: false }, 0, SIM_STEP, 'sim-lite');
    }
    expect(diving.speed).toBeGreaterThan(climbing.speed + 20);

    const boosting = newFlight(2, [0, 350, 0]);
    const startFuel = boosting.fuel;
    for (let i = 0; i < 120; i++) {
      stepFlight(boosting, { boost: true }, 0, SIM_STEP, 'sim-lite');
    }
    expect(boosting.fuel).toBeLessThan(startFuel - 2);
  });

  it('interpolates roll across wrap boundary cleanly', () => {
    const a = newFlight(0);
    const b = newFlight(0);
    a.roll = Math.PI - 0.1;
    b.roll = -Math.PI + 0.1;
    const mid = interpolateFlight(a, b, 0.5);
    expect(Math.abs(Math.sin(mid.roll))).toBeLessThan(0.05);
  });

  it('provides a complete 30-level 5-Act campaign with unique titles and script beats', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(30);
    const ids = new Set(CAMPAIGN_LEVELS.map((l) => l.id));
    expect(ids.size).toBe(30);
    for (const lvl of CAMPAIGN_LEVELS) {
      expect(lvl.script.length).toBeGreaterThanOrEqual(3);
      expect(lvl.briefing.length).toBeGreaterThan(20);
    }
  });

  it('runs Dead Air (Level 1) through ambush, combat, jamming, and relay selection', () => {
    const flight = newFlight(0, CAMPAIGN_LEVELS[0].spawnPos);
    const mission = createMission('story', flight, { levelId: 1 });
    expect(mission.phase).toBe('ambush');
    expect(mission.allies).toHaveLength(2);
    expect(mission.enemies).toHaveLength(5);

    for (let i = 0; i < 240; i++) {
      stepMission(mission, flight, IDLE, 0, SIM_STEP);
    }
    expect(mission.phase).toBe('combat');
    expect(mission.allies).toHaveLength(0);

    // Clear hostiles -> jammed -> relay
    mission.enemies = [];
    stepMission(mission, flight, IDLE, 0, SIM_STEP);
    expect(mission.phase).toBe('jammed');
    for (let i = 0; i < 280; i++) {
      stepMission(mission, flight, IDLE, 0, SIM_STEP);
    }
    expect(mission.phase).toBe('relay');
    selectRelay(mission, 'B');
    expect(mission.chosenRelay).toBe('B');
  });

  it('supports Offline Skirmish, Time Trials, and Wave Survival modes', () => {
    const f = newFlight(2, [0, 300, 0]);
    const skirmish = createMission('skirmish', f, {
      skirmish: { map: 1, atmosphere: 'aurora', difficulty: 'ace', preset: '2v2' },
    });
    expect(skirmish.allies).toHaveLength(1);
    expect(skirmish.enemies).toHaveLength(2);

    const tt = createMission('timetrial', f, { timeTrialCourse: 'glacier' });
    expect(tt.rings).toHaveLength(8);
    expect(tt.phase).toBe('rings');

    const surv = createMission('survival', f);
    expect(surv.wave).toBe(1);
    expect(surv.rings.some((r) => r.isRearm)).toBe(true);
  });

  it('computes exact per-jet WINGTIP_OFFSETS and 3D wingtip positions across pitch and roll', () => {
    expect(WINGTIP_OFFSETS).toHaveLength(planes.length);
    for (let i = 0; i < planes.length; i++) {
      const geo = AIRCRAFT_WING_GEOMETRY[i];
      const size = planes[i].size;
      expect(WINGTIP_OFFSETS[i].x).toBeCloseTo(geo.span * size, 6);
      expect(WINGTIP_OFFSETS[i].y).toBeCloseTo(WING_Y_OFFSET * size, 6);
      expect(WINGTIP_OFFSETS[i].z).toBeCloseTo((geo.trailingBase + geo.span * geo.trailingSlope) * size, 6);
    }

    // Level flight facing +Z (yaw = 0, pitch = 0, roll = 0)
    const flat = wingtipPositions([10, 200, 30], 1, 0, 0, 0);
    const mirageTip = WINGTIP_OFFSETS[1];
    expect(flat.left[0]).toBeCloseTo(10 - mirageTip.x, 5);
    expect(flat.right[0]).toBeCloseTo(10 + mirageTip.x, 5);
    expect(flat.left[1]).toBeCloseTo(200 + mirageTip.y, 5);
    expect(flat.right[1]).toBeCloseTo(200 + mirageTip.y, 5);
    expect(flat.left[2]).toBeCloseTo(30 + mirageTip.z, 5);
    expect(flat.right[2]).toBeCloseTo(30 + mirageTip.z, 5);

    // 90-degree roll places right wingtip above aircraft and left wingtip below
    const banked = wingtipPositions([0, 300, 0], 2, 0, 0, Math.PI / 2);
    const suTip = WINGTIP_OFFSETS[2];
    expect(banked.right[1]).toBeCloseTo(300 + suTip.x, 5);
    expect(banked.left[1]).toBeCloseTo(300 - suTip.x, 5);
    expect(banked.right[2]).toBeCloseTo(suTip.z, 5);

    // Climbing pitch tilts front upward and shifts trailing-edge wingtips downward
    const pitch = Math.PI / 6;
    const basis = aircraftBasis(0, pitch, 0);
    expect(basis.front[1]).toBeCloseTo(Math.sin(pitch), 5);
    const climbed = wingtipPositions([0, 300, 0], 0, 0, pitch, 0);
    expect(climbed.left[1]).toBeLessThan(300);
    expect(climbed.right[1]).toBeLessThan(300);
  });

  it('prunes wingtip trail samples smoothly by age without abrupt truncation', () => {
    const trail: TrailSample[] = [];
    let lastTime = -1;
    for (let step = 0; step < 40; step++) {
      const t = step * 0.05;
      lastTime = recordTrailSample(trail, lastTime, [0, 300, t * 100], 0, 0, 0, 0, t, 0.05);
    }
    expect(trail.length).toBeGreaterThan(20);
    expect(trail.length).toBeLessThanOrEqual(Math.ceil(TRAIL_MAX_AGE / 0.05) + 3);

    // Stop emitting and advance time past TRAIL_MAX_AGE -> trail drains cleanly
    const stopTime = 2.0 + TRAIL_MAX_AGE + 0.5;
    pruneTrail(trail, stopTime);
    expect(trail).toHaveLength(0);
  });

  it('caches Radar terrain tiles, picks relay markers, and resets cleanly', () => {
    const makeCtx = () => {
      const ops: string[] = [];
      return {
        ops,
        imageSmoothingEnabled: true,
        lineWidth: 1,
        strokeStyle: '',
        fillStyle: '',
        font: '',
        createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => ops.push('putImageData'),
        clearRect: () => ops.push('clearRect'),
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        arc: () => {},
        clip: () => {},
        drawImage: () => {},
        stroke: () => {},
        moveTo: () => {},
        lineTo: () => {},
        fillText: () => {},
        setLineDash: () => {},
        fillRect: () => {},
        translate: () => {},
        rotate: () => {},
        closePath: () => {},
        fill: () => {},
      };
    };

    const mainCtx = makeCtx();
    const surfaceCtx = makeCtx();
    const prevDoc = globalThis.document;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => ({ width: 48, height: 48, getContext: () => surfaceCtx }),
    };

    try {
      const canvas = {
        getContext: () => mainCtx,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 192, height: 192 }),
      } as unknown as HTMLCanvasElement;

      const radar = new Radar(canvas);
      const flight = newFlight(0, [0, 300, 0]);
      const mission = createMission('story', flight, { levelId: 1 });
      mission.phase = 'relay';

      radar.draw(flight, mission, 0);
      expect(radar.lastTerrain).toBeTruthy();
      expect(surfaceCtx.ops.filter((o) => o === 'putImageData')).toHaveLength(1);
      expect(radar.relays).toHaveLength(3);

      // Second draw at same position reuses cached terrain tile
      radar.draw(flight, mission, 0);
      expect(surfaceCtx.ops.filter((o) => o === 'putImageData')).toHaveLength(1);

      // Clicking near first relay picks its ID
      const firstRelay = radar.relays[0];
      const picked = radar.pick({ clientX: firstRelay.x, clientY: firstRelay.y } as MouseEvent);
      expect(picked).toBe(firstRelay.id);

      radar.reset();
      expect(radar.lastTerrain).toBeNull();
      expect(radar.relays).toHaveLength(0);
    } finally {
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  });

  it('removes lives from FlightState and grades computeRank purely on time and hull integrity', () => {
    const flight = newFlight(0, [0, 300, 0]);
    expect('lives' in flight).toBe(false);
    expect(flight.fuel).toBe(planes[0].fuelCapacity);
    expect(flight.maxFuel).toBe(planes[0].fuelCapacity);

    expect(computeRank(75, 100, 1.0)).toBe('S');
    expect(computeRank(75, 100, 0.75)).toBe('S');
    // Fast completion with damaged hull (<75%) drops from S to A
    expect(computeRank(75, 100, 0.55)).toBe('A');
    expect(computeRank(110, 100, 0.5)).toBe('A');
    // Heavy hull damage (<45%) or slower time drops to B / C
    expect(computeRank(110, 100, 0.2)).toBe('B');
    expect(computeRank(140, 100, 0.9)).toBe('B');
    expect(computeRank(170, 100, 1.0)).toBe('C');
  });

  it('scales dynamic fuel burn across boost, cruise, climb, turn, and brake, and flames out at 0%', () => {
    const cruise = newFlight(0, [0, 400, 0]);
    const boost = newFlight(0, [0, 400, 0]);
    const brake = newFlight(0, [0, 400, 0]);
    const climb = newFlight(0, [0, 400, 0]);
    const bank = newFlight(0, [0, 400, 0]);

    for (let i = 0; i < 120; i++) {
      stepFlight(cruise, {}, 0, SIM_STEP, 'arcade');
      stepFlight(boost, { boost: true }, 0, SIM_STEP, 'sim-lite');
      stepFlight(brake, { brake: true }, 0, SIM_STEP, 'arcade');
      stepFlight(climb, { pitch: 0.9 }, 0, SIM_STEP, 'arcade');
      stepFlight(bank, { turn: 1 }, 0, SIM_STEP, 'arcade');
    }

    const cruiseBurn = cruise.maxFuel - cruise.fuel;
    const boostBurn = boost.maxFuel - boost.fuel;
    const brakeBurn = brake.maxFuel - brake.fuel;
    const climbBurn = climb.maxFuel - climb.fuel;
    const bankBurn = bank.maxFuel - bank.fuel;

    expect(boostBurn).toBeGreaterThan(cruiseBurn * 2.4);
    expect(boostBurn).toBeLessThan(cruiseBurn * 3.4);
    expect(brakeBurn).toBeLessThan(cruiseBurn * 0.6);
    expect(climbBurn).toBeGreaterThan(cruiseBurn * 1.15);
    expect(bankBurn).toBeGreaterThan(cruiseBurn * 1.1);

    // Low fuel alert below 20%
    const low = newFlight(0, [0, 400, 0]);
    low.fuel = low.maxFuel * 0.19;
    stepFlight(low, {}, 0, SIM_STEP, 'arcade');
    expect(low.lowFuel).toBe(true);
    expect(low.flameout).toBe(false);

    // Flameout at 0% fuel: disables boost and bleeds airspeed into a glide
    const empty = newFlight(0, [0, 500, 0]);
    empty.fuel = 0.001;
    const startSpeed = empty.speed;
    for (let i = 0; i < 180; i++) {
      stepFlight(empty, { boost: true }, 0, SIM_STEP, 'arcade');
    }
    expect(empty.fuel).toBe(0);
    expect(empty.flameout).toBe(true);
    expect(empty.lowFuel).toBe(true);
    expect(empty.boost).toBeLessThan(0.05);
    expect(empty.speed).toBeLessThan(startSpeed * 0.75);
  });

  it('transitions immediately to failed on hull 0 in story/timetrial/survival while keeping respawn in endless/skirmish', () => {
    for (const mode of ['story', 'timetrial', 'survival'] as const) {
      const f = newFlight(0, [0, 300, 0]);
      const m = createMission(mode, f, { levelId: 2, timeTrialCourse: 'caldera', map: 0 });
      f.hull = 0;
      f.death = 1.45;
      const ev = stepMission(m, f, IDLE, 0, SIM_STEP);
      expect(m.phase).toBe('failed');
      expect(ev.phaseChanged).toBe(true);
    }

    const endlessFlight = newFlight(0, [0, 300, 0]);
    const endlessMission = createMission('endless', endlessFlight, { map: 0 });
    endlessFlight.hull = 0;
    endlessFlight.death = 0.01;
    stepFlight(endlessFlight, IDLE, 0, 0.02, 'arcade');
    stepMission(endlessMission, endlessFlight, IDLE, 0, 0.02);
    expect(endlessFlight.recovered).toBe(true);
    expect(endlessMission.phase).toBe('free-flight');
  });

  it('restores fuel, repairs hull, and replenishes munitions at the central volcano refuel station on both maps', () => {
    for (const map of [0, 1] as const) {
      const depot = centralRefuelPosition(map);
      expect(solidAt(depot[0], depot[1], depot[2], map, 4)).toBe(false);

      const flight = newFlight(2, depot);
      const mission = createMission('story', flight, { levelId: map === 0 ? 2 : 11, map });
      flight.fuel = flight.maxFuel * 0.1;
      flight.lowFuel = true;
      flight.flameout = true;
      flight.hull = 25;
      mission.arms.missiles = 0;
      mission.arms.rockets = 1;
      mission.arms.flaresLeft = 0;
      mission.arms.heat = 0.9;
      mission.arms.overheated = true;

      const ev = stepMission(mission, flight, IDLE, map, SIM_STEP);
      expect(ev.rearmed).toBe(true);
      expect(flight.fuel).toBe(flight.maxFuel);
      expect(flight.lowFuel).toBe(false);
      expect(flight.flameout).toBe(false);
      expect(flight.hull).toBe(flight.maxHull);
      expect(mission.arms.missiles).toBe(planes[2].missiles);
      expect(mission.arms.rockets).toBe(planes[2].rockets);
      expect(mission.arms.flaresLeft).toBe(planes[2].flares);
      expect(mission.arms.overheated).toBe(false);
      expect(mission.message).toMatch(/VOLCANO CORE DEPOT/i);
    }
  });

  it('generates non-repeating procedural terrain across distant coordinates without tile wrapping', () => {
    for (const map of [0, 1] as const) {
      let diffsAt4096 = 0;
      let diffsAt8192 = 0;
      for (let i = 0; i < 12; i++) {
        const x = 640 + i * 232;
        const z = -960 + i * 312;
        const h0 = terrainHeight(x, z, map);
        const h1 = terrainHeight(x + TERRAIN_SIZE, z, map);
        const h2 = terrainHeight(x, z + TERRAIN_SIZE, map);
        const h3 = terrainHeight(x + 8192, z - 4096, map);
        if (Math.abs(h0 - h1) > 1 || Math.abs(h0 - h2) > 1) diffsAt4096++;
        if (Math.abs(h0 - h3) > 1) diffsAt8192++;
      }
      expect(diffsAt4096).toBeGreaterThanOrEqual(10);
      expect(diffsAt8192).toBeGreaterThanOrEqual(10);

      const winA = sampleElevationWindow(map, -512, -512, 64, ELEVATION_STEP);
      const winB = sampleElevationWindow(map, -512 + TERRAIN_SIZE, -512, 64, ELEVATION_STEP);
      let windowDiffs = 0;
      for (let i = 0; i < winA.length; i++) {
        if (winA[i] !== winB[i]) windowDiffs++;
      }
      expect(windowDiffs).toBeGreaterThan(winA.length * 0.7);
    }
  });

  it('centers both Active (Map 0) and Dormant (Map 1) volcanoes at [0, 0] with 4 flyable cardinal tunnels', () => {
    expect(VOLCANO.x).toBe(0);
    expect(VOLCANO.z).toBe(0);
    expect(GLACIER_VAULT.x).toBe(0);
    expect(GLACIER_VAULT.z).toBe(0);
    expect(centralRefuelPosition(0)).toEqual([0, VOLCANO.tunnelAltitude, 0]);
    expect(centralRefuelPosition(1)).toEqual([0, GLACIER_VAULT.tunnelAltitude, 0]);

    for (const map of [0, 1] as const) {
      const alt = map === 0 ? VOLCANO.tunnelAltitude : GLACIER_VAULT.tunnelAltitude;
      for (const [dx, dz] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        for (let step = 0; step <= 450; step += 15) {
          expect(solidAt(dx * step, alt, dz * step, map, 7)).toBe(false);
        }
      }
      expect(solidAt(135, alt, 145, map)).toBe(true);
      expect(solidAt(-135, alt, -145, map)).toBe(true);
      expect(solidAt(0, 30, 0, map)).toBe(true);
    }

    // Active Volcano (Map 0) emits rising ember/smoke particles near [0, 0]; Dormant (Map 1) does not
    const f0 = newFlight(0, [0, 260, -680]);
    const m0 = createMission('endless', f0, { map: 0 });
    for (let i = 0; i < 60; i++) stepMission(m0, f0, IDLE, 0, 1 / 30);
    expect(m0.effects.some((e) => e.kind === 'fire' || e.kind === 'spark' || e.kind === 'smoke')).toBe(true);

    const f1 = newFlight(0, [-420, 280, -640]);
    const m1 = createMission('endless', f1, { map: 1 });
    for (let i = 0; i < 60; i++) stepMission(m1, f1, IDLE, 1, 1 / 30);
    expect(m1.effects).toHaveLength(0);
  });

  it('re-anchors all campaign spawns, time-trial rings, and relays safely without terrain collisions', () => {
    for (const lvl of CAMPAIGN_LEVELS) {
      expect(
        solidAt(lvl.spawnPos[0], lvl.spawnPos[1], lvl.spawnPos[2], lvl.map, 10),
        `Level ${lvl.id} (${lvl.title}) spawnPos collision`
      ).toBe(false);
    }

    for (const ring of buildCalderaRings()) {
      expect(solidAt(ring.pos[0], ring.pos[1], ring.pos[2], 0, 5), `Caldera ring ${ring.id}`).toBe(false);
    }
    for (const ring of buildGlacierRings()) {
      expect(solidAt(ring.pos[0], ring.pos[1], ring.pos[2], 1, 5), `Glacier ring ${ring.id}`).toBe(false);
    }

    for (const relay of RELAYS) {
      const pos = relayPosition(relay, 0);
      expect(solidAt(pos[0], pos[1], pos[2], 0, 5), `Relay ${relay.id}`).toBe(false);
    }
  });

  it('deforms terrain with weapon-scaled craters (tracer < rocket < missile), updates RG8/Radar, and resets cleanly', () => {
    resetTerrainDamage();

    // Find a high-elevation land coordinate on Map 0 (Ember Canyon)
    let landX = 960;
    let landZ = 960;
    for (let x = 640; x <= 1600; x += 32) {
      if (terrainHeight(x, 960, 0) > 65) {
        landX = x;
        break;
      }
    }
    const baseH = terrainHeight(landX, landZ, 0);
    expect(baseH).toBeGreaterThan(60);

    // 1) Cannon (tracer): small ~6m radius, ~2.4m chip (3x terrain damage)
    const revBefore = getTerrainRevision(0);
    const flight = newFlight(0, [landX, baseH + 120, landZ]);
    const mission = createMission('endless', flight, { map: 0 });
    mission.shots.push({
      kind: 'tracer',
      pos: [landX, baseH + 2, landZ],
      velocity: [0, -600, 0],
      life: 0.5,
      size: 2.8,
      damage: 28,
      ownerName: 'YOU',
    });
    updateShots(mission, flight, 0, SIM_STEP);
    const tracerDrop = baseH - terrainHeight(landX, landZ, 0);
    expect(tracerDrop).toBeGreaterThan(1.5);
    expect(tracerDrop).toBeLessThan(4.0);
    expect(scorchAt(landX, landZ, 0)).toBeGreaterThan(0.2);
    expect(getTerrainRevision(0)).toBeGreaterThan(revBefore);

    // 2) Rocket: medium ~26m radius, ~30m depth crater
    let rocketX = landX + 128;
    for (let x = landX + 128; x <= 2400; x += 32) {
      if (terrainHeight(x, landZ, 0) > 65) {
        rocketX = x;
        break;
      }
    }
    const rocketBase = terrainHeight(rocketX, landZ, 0);
    expect(rocketBase).toBeGreaterThan(50);
    mission.shots.push({
      kind: 'rocket',
      pos: [rocketX, rocketBase + 2, landZ],
      velocity: [0, -520, 0],
      life: 0.5,
      size: 4.4,
      damage: 95,
      ownerName: 'YOU',
    });
    updateShots(mission, flight, 0, SIM_STEP);
    const rocketDrop = rocketBase - terrainHeight(rocketX, landZ, 0);
    expect(rocketDrop).toBeGreaterThan(20);
    expect(rocketDrop).toBeLessThan(33);
    expect(solidAt(rocketX, rocketBase - 8, landZ, 0)).toBe(false);

    // 3) Missile: heavy ~48m radius, ~66m depth crater + dirty bounds + RG8 channels
    let missileX = rocketX + 128;
    for (let x = rocketX + 128; x <= 3200; x += 32) {
      if (terrainHeight(x, landZ, 0) > 90) {
        missileX = x;
        break;
      }
    }
    const missileBase = terrainHeight(missileX, landZ, 0);
    expect(missileBase).toBeGreaterThan(80);
    mission.shots.push({
      kind: 'missile',
      pos: [missileX, missileBase + 2, landZ],
      velocity: [0, -355, 0],
      life: 0.5,
      size: 5.2,
      damage: 110,
      ownerName: 'YOU',
    });
    updateShots(mission, flight, 0, SIM_STEP);
    const missileDrop = missileBase - terrainHeight(missileX, landZ, 0);
    expect(missileDrop).toBeGreaterThan(rocketDrop + 20);
    expect(missileDrop).toBeLessThanOrEqual(66.5);
    expect(solidAt(missileX, missileBase - 25, landZ, 0)).toBe(false);

    const dirty = consumeTerrainDirty(0);
    expect(dirty.bounds).not.toBeNull();
    expect(dirty.bounds!.minX).toBeLessThanOrEqual(landX);
    expect(dirty.bounds!.maxX).toBeGreaterThanOrEqual(missileX);

    const rg = sampleElevationRGWindow(0, missileX - 64, landZ - 64, 16, ELEVATION_STEP);
    const centerIdx = (8 * 16 + 8) * 2;
    expect(rg[centerIdx + 1]).toBeGreaterThan(200); // G channel scorch intensity

    // Radar terrain cache invalidates when terrain deforms
    const prevDoc = globalThis.document;
    let tileWrites = 0;
    const makeCtx = () => ({
      imageSmoothingEnabled: true,
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
      font: '',
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {
        tileWrites++;
      },
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      arc: () => {},
      clip: () => {},
      drawImage: () => {},
      stroke: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillText: () => {},
      setLineDash: () => {},
      fillRect: () => {},
      translate: () => {},
      rotate: () => {},
      closePath: () => {},
      fill: () => {},
    });
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => ({ width: 48, height: 48, getContext: makeCtx }),
    };
    try {
      const radar = new Radar({
        getContext: makeCtx,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 192, height: 192 }),
      } as unknown as HTMLCanvasElement);
      radar.draw(flight, mission, 0);
      expect(tileWrites).toBe(1);
      applyTerrainImpact(landX, landZ, 24, 14, 0.9, 0);
      radar.draw(flight, mission, 0);
      expect(tileWrites).toBe(2);
    } finally {
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }

    // Reset restores pristine height and clears scorch
    resetTerrainDamage(0);
    expect(terrainHeight(landX, landZ, 0)).toBeCloseTo(baseH, 4);
    expect(terrainHeight(missileX, landZ, 0)).toBeCloseTo(missileBase, 4);
    expect(scorchAt(missileX, landZ, 0)).toBe(0);
  });

  it('carves localized pockets into [0, 0] volcano walls and resets cleanly', () => {
    resetTerrainDamage();
    const initialChunks = getLandmarkChunks(0);
    expect(initialChunks.length).toBeGreaterThan(10);

    // Find a solid wall surface cell on the Ashmouth Caldera inner crater wall (diagonal off-tunnel)
    let wallX = 115;
    const wallY = 140;
    let wallZ = 115;
    for (let d = 95; d <= 180; d += 2) {
      if (solidAt(d, wallY, d, 0)) {
        wallX = d;
        wallZ = d;
        break;
      }
    }
    expect(solidAt(wallX, wallY, wallZ, 0)).toBe(true);

    // Carve with heavy missile blast
    const carved = carveLandmark(wallX, wallY, wallZ, 22, 1.0, 0);
    expect(carved).toBe(true);
    expect(solidAt(wallX, wallY, wallZ, 0)).toBe(false);

    // Only intersecting landmark chunks bump version
    const updatedChunks = getLandmarkChunks(0);
    const bumped = updatedChunks.filter((c) => c.version > 1);
    expect(bumped.length).toBeGreaterThan(0);
    expect(bumped.length).toBeLessThan(updatedChunks.length);

    // Reset restores solid volcano wall
    resetTerrainDamage(0);
    expect(solidAt(wallX, wallY, wallZ, 0)).toBe(true);
  });

  it('leaves destroyed ground targets (radar, aa, relay, core) in ruin state emitting smoke', () => {
    resetTerrainDamage();
    const flight = newFlight(0, [800, 300, 800]);
    const mission = createMission('endless', flight, { map: 0 });
    const kinds: GroundTarget['kind'][] = ['radar', 'aa', 'relay', 'core'];
    mission.groundTargets = kinds.map((kind, idx) => {
      const gx = 800 + idx * 120;
      const gz = 800;
      return {
        id: `test-${kind}`,
        name: `Test ${kind}`,
        kind,
        pos: [gx, terrainHeight(gx, gz, 0) + 12, gz],
        hp: 40,
        maxHp: 40,
        fireCooldown: 3,
        destroyed: false,
      };
    });

    // Destroy all 4 ground target types with rockets
    for (const gt of mission.groundTargets) {
      mission.shots.push({
        kind: 'rocket',
        pos: [gt.pos[0], gt.pos[1], gt.pos[2]],
        velocity: [0, -10, 0],
        life: 0.5,
        size: 4.4,
        damage: 95,
        ownerName: 'YOU',
      });
    }
    const res = updateShots(mission, flight, 0, SIM_STEP);
    expect(res.groundKillsDelta).toBe(4);
    for (const gt of mission.groundTargets) {
      expect(gt.destroyed).toBe(true);
    }

    // Clear initial explosion burst and verify ongoing ruin smoke emission
    mission.effects = [];
    for (let i = 0; i < 20; i++) {
      stepMission(mission, flight, IDLE, 0, SIM_STEP);
    }
    expect(mission.effects.some((e) => e.kind === 'smoke')).toBe(true);
    resetTerrainDamage();
  });

  it('defends friendly Ridge Station in Level 3 (defense) and fails if destroyed', () => {
    const lvl3 = CAMPAIGN_LEVELS.find((l) => l.id === 3)!;
    const flight = newFlight(0, lvl3.spawnPos);
    const mission = createMission('story', flight, { levelId: 3 });
    const station = mission.groundTargets.find((g) => g.friendly);
    expect(station).toBeDefined();
    expect(station!.name).toBe('Ridge Station');
    expect(station!.destroyed).toBe(false);

    // Clearing waves while Ridge Station survives completes the mission
    mission.enemies = [];
    stepMission(mission, flight, IDLE, lvl3.map, SIM_STEP);
    expect(mission.wave).toBe(2);
    mission.enemies = [];
    stepMission(mission, flight, IDLE, lvl3.map, SIM_STEP);
    expect(mission.phase).toBe('complete');

    // If an enemy missile destroys Ridge Station, the mission immediately fails
    const missionFail = createMission('story', flight, { levelId: 3 });
    const targetStation = missionFail.groundTargets.find((g) => g.friendly)!;
    targetStation.hp = 10;
    missionFail.shots.push({
      kind: 'enemyMissile',
      pos: [targetStation.pos[0], targetStation.pos[1], targetStation.pos[2]],
      velocity: [0, -10, 0],
      life: 1,
      size: 5,
      damage: 36,
      target: targetStation,
      ownerName: 'Obsidian-11',
    });
    stepMission(missionFail, flight, IDLE, lvl3.map, SIM_STEP);
    expect(targetStation.destroyed).toBe(true);
    expect(missionFail.phase).toBe('failed');
  });

  it('completes Level 9 (escort) when surviving convoy transports reach the extraction waypoint', () => {
    const lvl9 = CAMPAIGN_LEVELS.find((l) => l.id === 9)!;
    const flight = newFlight(2, lvl9.spawnPos);
    const mission = createMission('story', flight, { levelId: 9 });
    expect(mission.extractionPos).toBeDefined();
    expect(mission.allies.every((a) => a.isEscortTarget)).toBe(true);

    // Clear both waves while transports are still far from extraction -> stays in combat
    mission.enemies = [];
    stepMission(mission, flight, IDLE, lvl9.map, SIM_STEP);
    expect(mission.wave).toBe(2);
    mission.enemies = [];
    stepMission(mission, flight, IDLE, lvl9.map, SIM_STEP);
    expect(mission.phase).toBe('combat');
    expect(mission.message).toMatch(/extraction/i);

    // Move surviving transport into extraction zone -> mission completes cleanly
    mission.allies[0].pos = [...mission.extractionPos!];
    stepAircraftAI(mission.allies[0], mission, flight, lvl9.map, SIM_STEP);
    stepMission(mission, flight, IDLE, lvl9.map, SIM_STEP);
    expect(mission.allies[0].extracted).toBe(true);
    expect(mission.phase).toBe('complete');

    // Losing all escort transports fails the mission
    const failMission = createMission('story', flight, { levelId: 9 });
    failMission.allies = [];
    stepMission(failMission, flight, IDLE, lvl9.map, SIM_STEP);
    expect(failMission.phase).toBe('failed');
  });

  it('gives each Ace boss a distinct behavior profile and overdrive phase', () => {
    expect(bossProfileForName('CINDER-1')).toBe('joust');
    expect(bossProfileForName('GLACIER-1')).toBe('stealth');
    expect(bossProfileForName('PYRE')).toBe('razor');
    expect(bossProfileForName('SUBZERO')).toBe('volley');
    expect(bossProfileForName('SOVEREIGN')).toBe('sovereign');
    expect(Object.keys(BOSS_PROFILE_LABELS)).toHaveLength(5);

    // SOVEREIGN triggers Overdrive below 55% HP
    const lvl30 = CAMPAIGN_LEVELS.find((l) => l.id === 30)!;
    const flight = newFlight(4, lvl30.spawnPos);
    const mission = createMission('story', flight, { levelId: 30 });
    const boss = mission.enemies.find((e) => e.isBoss)!;
    expect(boss.name).toBe('SOVEREIGN');
    expect(boss.bossProfile).toBe('sovereign');
    expect(boss.bossOverdrive).toBe(false);
    boss.hp = boss.maxHp * 0.4;
    stepAircraftAI(boss, mission, flight, lvl30.map, SIM_STEP);
    expect(boss.bossOverdrive).toBe(true);
    expect(mission.message).toMatch(/Overdrive/i);
  });

  it('detects newly unlocked airframes for debrief celebration banners', () => {
    let log = { ...DEFAULT_PILOT_LOG, campaignProgress: {}, bestTimeTrials: {} };
    for (let id = 1; id <= 5; id++) {
      log = recordCampaignClear(log, id, 90, 'A');
    }
    expect(findNewlyUnlockedPlanes(DEFAULT_PILOT_LOG, log)).toEqual([]);

    const log6 = recordCampaignClear(log, 6, 95, 'A');
    expect(findNewlyUnlockedPlanes(log, log6)).toEqual([3]); // Wraith YF-23

    const logKill75 = { ...log6, totalKills: 75 };
    expect(findNewlyUnlockedPlanes(log6, logKill75)).toEqual([4]); // Valkyrie XV-9
  });

  it('exercises and completes all 11 campaign archetypes cleanly', () => {
    const archetypes: CampaignArchetype[] = [
      'dead-air',
      'dogfight',
      'defense',
      'tunnel',
      'low-ceiling',
      'boss',
      'recon-rings',
      'escort',
      'ground-strike',
      'survival',
      'relay-blitz',
    ];

    for (const archetype of archetypes) {
      const lvl = CAMPAIGN_LEVELS.find((l) => l.archetype === archetype)!;
      expect(lvl, `Missing level for archetype ${archetype}`).toBeDefined();
      const flight = newFlight(2, lvl.spawnPos);
      const mission = createMission('story', flight, { levelId: lvl.id });

      if (archetype === 'dead-air') {
        for (let i = 0; i < 240; i++) stepMission(mission, flight, IDLE, lvl.map, SIM_STEP);
        mission.enemies = [];
        for (let i = 0; i < 280; i++) stepMission(mission, flight, IDLE, lvl.map, SIM_STEP);
        selectRelay(mission, RELAYS[0].id);
        flight.pos = relayPosition(RELAYS[0], lvl.map);
        stepMission(mission, flight, IDLE, lvl.map, SIM_STEP);
      } else if (archetype === 'low-ceiling' || archetype === 'recon-rings') {
        expect(mission.phase).toBe('rings');
        for (const ring of mission.rings) {
          flight.pos = [...ring.pos];
          stepMission(mission, flight, IDLE, lvl.map, SIM_STEP);
        }
      } else {
        for (let w = 0; w < mission.maxWaves; w++) {
          mission.enemies = [];
          for (const gt of mission.groundTargets) {
            if (!gt.friendly) gt.destroyed = true;
          }
          if (archetype === 'escort' && w === mission.maxWaves - 1 && mission.extractionPos) {
            mission.allies[0].pos = [...mission.extractionPos];
            mission.allies[0].extracted = true;
          }
          stepMission(mission, flight, IDLE, lvl.map, SIM_STEP);
        }
      }

      expect(mission.phase, `Archetype ${archetype} did not complete`).toBe('complete');
    }
  });

  it('resetPilotLog restores default pilot log and re-locks unlockable airframes', () => {
    let progressed = { ...DEFAULT_PILOT_LOG, totalKills: 30, totalSorties: 8, campaignProgress: {}, bestTimeTrials: {} };
    progressed = recordCampaignClear(progressed, 1, 75, 'S');
    expect(isPlaneUnlocked(3, progressed)).toBe(true);

    const reset = resetPilotLog();
    expect(reset.totalKills).toBe(0);
    expect(reset.totalSorties).toBe(0);
    expect(Object.keys(reset.campaignProgress)).toHaveLength(0);
    expect(Object.keys(reset.bestTimeTrials)).toHaveLength(0);
    expect(isPlaneUnlocked(3, reset)).toBe(false);
    expect(isPlaneUnlocked(4, reset)).toBe(false);
    expect(isPlaneUnlocked(0, reset)).toBe(true);
  });
});
