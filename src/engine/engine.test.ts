import { describe, expect, it } from 'vitest';
import {
  GLACIER_VAULT,
  glacierDensity,
  planes,
  solidAt,
  VOLCANO,
  volcanoDensity,
} from './world';
import { interpolateFlight, newFlight, SIM_STEP, stepFlight } from './flight';
import { CAMPAIGN_LEVELS } from './campaign';
import { createMission, selectRelay, stepMission } from './modes';
import { isPlaneUnlocked, DEFAULT_PILOT_LOG } from './storage';
import type { ControlInput } from './types';

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
});
