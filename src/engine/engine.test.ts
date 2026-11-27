import { describe, expect, it } from 'vitest';
import {
  AIRCRAFT_WING_GEOMETRY,
  aircraftBasis,
  GLACIER_VAULT,
  glacierDensity,
  planes,
  pruneTrail,
  recordTrailSample,
  solidAt,
  TRAIL_MAX_AGE,
  VOLCANO,
  volcanoDensity,
  WING_Y_OFFSET,
  WINGTIP_OFFSETS,
  wingtipPositions,
} from './world';
import { interpolateFlight, newFlight, SIM_STEP, stepFlight } from './flight';
import { CAMPAIGN_LEVELS } from './campaign';
import { createMission, selectRelay, stepMission } from './modes';
import { Radar } from './radar';
import { isPlaneUnlocked, DEFAULT_PILOT_LOG } from './storage';
import type { ControlInput, TrailSample } from './types';

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

  it('sim-lite flight physics models dive acceleration, climb speed bleed, and afterburner fuel', () => {
    const climbing = newFlight(0, [0, 350, 0]);
    const diving = newFlight(0, [0, 500, 0]);
    for (let i = 0; i < 180; i++) {
      stepFlight(climbing, { pitch: 0.9, boost: false }, 0, SIM_STEP, 'sim-lite');
      stepFlight(diving, { pitch: -0.9, boost: false }, 0, SIM_STEP, 'sim-lite');
    }
    expect(diving.speed).toBeGreaterThan(climbing.speed + 20);

    const boosting = newFlight(2, [0, 350, 0]);
    for (let i = 0; i < 120; i++) {
      stepFlight(boosting, { boost: true }, 0, SIM_STEP, 'sim-lite');
    }
    expect(boosting.afterburnerFuel).toBeLessThan(0.95);
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
    const flight = newFlight(0, [0, 555, -420]);
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
});
