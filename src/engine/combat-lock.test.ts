import { describe, expect, it } from 'vitest';
import { LOCK_SECONDS, stepFlarePattern } from '../../shared/combat-rules.js';
import { createAircraft, createWeapons, updatePlayerWeapons, updateShots, updateTargetLock } from './combat';
import { newFlight } from './flight';
import { createMission, stepMission } from './modes';
import type { ControlInput, Vec3 } from './types';

const idle: ControlInput = {
  turn: 0, pitch: 0, boost: false, brake: false, roll: false,
  fire: false, missile: false, rocket: false, flare: false,
};
const view = { aspect: 16 / 9, cockpit: true };
const dt = 1 / 120;

describe('Combat targeting and support', () => {
  it('charges on the reticle, keeps the same visible target, and loses it at the edge', () => {
    const flight = newFlight(0, [0, 750, 0]);
    const mission = createMission('endless', flight);
    const lead = createAircraft('lead', 'Lead', 0, [0, 750, 420], false, 0);
    const other = createAircraft('other', 'Other', 1, [210, 750, 420], false, 1);
    mission.enemies = [lead, other];

    updateTargetLock(mission, flight, 0, LOCK_SECONDS / 2, view);
    expect(mission.target).toBe(lead);
    expect(mission.lockProgress).toBeCloseTo(0.5);
    expect(updatePlayerWeapons(mission, flight, { ...idle, missile: true }, 0, dt).firedMissile).toBe(false);
    expect(mission.arms.missiles).toBe(3);
    updatePlayerWeapons(mission, flight, { ...idle, fire: true }, 0, dt);
    expect(mission.shots[0]).toMatchObject({ kind: 'tracer', assisted: false, damage: 20 });

    updateTargetLock(mission, flight, 0, LOCK_SECONDS / 2, view);
    lead.pos = [300, 750, 420];
    other.pos = [0, 750, 420];
    updateTargetLock(mission, flight, 0, dt, view);
    expect(mission.target).toBe(lead);
    expect(mission.lockProgress).toBe(1);
    expect(updatePlayerWeapons(mission, flight, { ...idle, missile: true }, 0, dt).firedMissile).toBe(true);
    expect(mission.shots.at(-1)).toMatchObject({ kind: 'missile', target: lead, damage: 80 });

    lead.pos = [650, 750, 250];
    updateTargetLock(mission, flight, 0, dt, view);
    expect(mission.target).toBe(other);
    expect(mission.lockProgress).toBeLessThan(1);
  });

  it('uses 100, 125 and 150 HP for bot tiers and requires multiple actual hits', () => {
    const flight = newFlight(0, [0, 750, 0]);
    const mission = createMission('endless', flight);
    const enemies = (['standard', 'veteran', 'ace'] as const).map((difficulty, index) =>
      createAircraft(String(index), difficulty, index, [index * 70, 750, 140], false, index, difficulty));
    expect(enemies.map(enemy => enemy.hp)).toEqual([100, 125, 150]);
    const [target] = enemies;
    mission.enemies = [target];
    const hit = (kind: 'tracer' | 'missile', damage: number, lateral = 0) => {
      mission.shots.push({
        kind, damage, size: 4, ownerName: 'YOU', assisted: false,
        pos: [lateral, 750, 120], velocity: [0, 0, 800], life: 0.25,
      });
      updateShots(mission, flight, 0, 0.05);
      mission.shots.length = 0;
    };
    hit('tracer', 20, 8);
    expect(target.hp).toBe(100);
    hit('missile', 80);
    expect(target.hp).toBe(20);
    hit('tracer', 20);
    expect(target.hp).toBe(0);
    expect(mission.kills).toBe(1);
    expect([0, 1, 2, 3, 4].map(plane => createWeapons(plane).missiles)).toEqual([3, 3, 3, 3, 3]);
  });

  it('drops three separate pods, blooms each one, and spends one flare charge', () => {
    const flight = newFlight(0, [0, 750, 0]);
    const arms = createWeapons(0);
    for (const step of [1 / 120, 1 / 40]) {
      Object.assign(arms, createWeapons(0));
      const events: Array<{ at: number; count: number }> = [];
      for (let index = 0; index * step <= 1.2; index++) {
        let count = 0;
        stepFlarePattern(arms, flight, index === 0, step, () => count++);
        if (count) events.push({ at: index * step, count });
      }
      expect(events.map(event => event.count)).toEqual([1, 7, 1, 7, 1, 7]);
      const expected = [0, 0.14, 0.44, 0.58, 0.88, 1.02];
      events.forEach((event, index) => expect(Math.abs(event.at - expected[index])).toBeLessThan(step + 1e-8));
      expect(arms.flaresLeft).toBe(arms.maxFlares - 1);
    }
  });

  it('refills missiles and flares only through the opening of a ready ring on either map', () => {
    for (const map of [0, 1]) {
      const flight = newFlight(0);
      const mission = createMission('endless', flight, { map });
      const ring = mission.rearmRings[0];
      const normal = [Math.sin(ring.yaw), 0, Math.cos(ring.yaw)];
      const point = (offset: number, height: number): Vec3 => [
        ring.pos[0] + normal[0] * offset, ring.pos[1] + height, ring.pos[2] + normal[2] * offset,
      ];
      const pass = (height: number) => {
        flight.pos = point(12, height);
        return stepMission(mission, flight, idle, map, dt, view, point(-12, height));
      };
      mission.arms.missiles = 0;
      mission.arms.flaresLeft = 0;
      expect(pass(ring.radius + 5).rearmed).toBe(false);
      expect(pass(0).rearmed).toBe(true);
      expect(mission.arms.missiles).toBe(3);
      expect(mission.arms.flaresLeft).toBe(mission.arms.maxFlares);
      mission.arms.missiles--;
      expect(pass(0).rearmed).toBe(false);
      mission.time += 16;
      expect(pass(0).rearmed).toBe(true);
    }
  });
});
