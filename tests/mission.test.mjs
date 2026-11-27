import assert from 'node:assert/strict';
import test from 'node:test';
import { clamp, solidAt, sub, VOLCANO } from '../server/sim/world.js';
import { newFlight, SIM_STEP, stepFlight } from '../server/sim/flight.js';
import { missileWarning, newMission, RELAYS, relayPosition, selectRelay, stepMission } from '../server/sim/mission.js';

const idle = { turn: 0, pitch: 0, boost: false };
const tick = (mission, flight, command = idle) => stepMission(mission, flight, command, 0, SIM_STEP);

test('the caldera connects four flyable mouths and retains solid rock between them', () => {
  const { x, z, tunnelAltitude: altitude } = VOLCANO;
  for (const [dx, dz] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    for (let step = 0; step <= 445; step += 2) {
      assert.equal(solidAt(x + dx * step, altitude, z + dz * step, 0, 7), false, `opening ${dx},${dz} at ${step}`);
    }
  }
  assert.ok(solidAt(x + 135, altitude, z + 145, 0));
  assert.ok(solidAt(x - 135, altitude, z - 145, 0));
  assert.ok(solidAt(x, 40, z, 0));
});

test('a Mirage can brake inside Ashmouth and exit through the eastern tunnel', () => {
  const { x, z, tunnelAltitude: altitude } = VOLCANO;
  const flight = newFlight(1, [x, altitude, z-445]);
  for (let step = 0; step < 120 * 19 && flight.pos[0] < x + 405; step++) {
    // Start the turn one braked turn radius before the chamber center.
    const targetHeading = flight.pos[2] > z - 85 || flight.pos[0] > x + 6 ? Math.PI / 2 : 0;
    const turn = clamp((targetHeading - flight.yaw) * 4, -1, 1);
    stepFlight(flight, { ...idle, turn, brake: true }, 0, SIM_STEP);
    assert.equal(flight.death, 0);
  }
  assert.ok(flight.pos[0] >= x + 405);
});

test('unlimited rounds overheat and cycle, while the missile rack starts at three', () => {
  const flight = newFlight(0, [0,700,0]);
  const mission = newMission('endless', flight, false);
  assert.equal(mission.arms.missiles, 3);
  for (let frame = 0; frame < 230; frame++) tick(mission, flight, { ...idle, fire: true });
  assert.equal(mission.arms.overheated, true);
  for (let frame = 0; frame < 230; frame++) tick(mission, flight);
  assert.equal(mission.arms.overheated, false);
  tick(mission, flight, { ...idle, fire: true });
  assert.ok(mission.shots.some(shot => shot.kind === 'tracer'));
  assert.equal(mission.arms.missiles, 3);
});

test('flares divert a threat and a boosted hard turn can break a close lock', () => {
  const flight = newFlight(0, [0,700,0]);
  const mission = newMission('endless', flight, false);
  const threat = () => ({ kind: 'enemyMissile', pos: [0,700,-118], velocity: [0,0,212], life: 4, target: flight });
  mission.shots.push(threat());
  assert.ok(missileWarning(mission, flight));
  tick(mission, flight, { ...idle, flare: true });
  assert.equal(missileWarning(mission, flight), false);
  assert.ok(mission.effects.some(item => item.kind === 'flare'));
  mission.arms.evade = 0;
  mission.shots.push(threat());
  flight.boost = .85;
  flight.bank = .65;
  tick(mission, flight);
  assert.equal(missileWarning(mission, flight), false);
  assert.equal(flight.hull, 100);
});

function fight(flight, mission) {
  const targets = mission.enemies.map(enemy => {
    const pos = sub(enemy.pos, flight.pos);
    const relative = Math.atan2(pos[0],pos[2])-flight.yaw;
    const turn = Math.atan2(Math.sin(relative),Math.cos(relative));
    return { pos, turn, score: Math.hypot(...pos) * (1 + Math.abs(turn)*1.5) };
  }).sort((a,b) => a.score-b.score);
  if (!targets[0]) return idle;
  const { pos, turn } = targets[0];
  return {
    ...idle, turn: clamp(turn*2.2,-1,1),
    pitch: clamp(Math.atan2(pos[1],Math.hypot(pos[0],pos[2]))*1.18,-.65,.65),
    fire: Boolean(mission.target) && mission.arms.heat < .85,
    missile: Boolean(mission.target) && Math.abs(turn) < .28 && mission.arms.missiles > 0,
    flare: missileWarning(mission, flight),
  };
}

test('Dead Air progresses from a five-contact ambush through combat, jamming and each possible relay', () => {
  const flight = newFlight(2, [0,555,-420]);
  const mission = newMission('story', flight);
  assert.equal(mission.allies.length, 2);
  assert.equal(mission.enemies.length, 5);
  assert.ok(mission.enemies.every(enemy => enemy.pos[2] < flight.pos[2]));
  const phases = new Set([mission.phase]);
  for (let frame=0; frame < 120 * 85 && mission.phase !== 'relay'; frame++) {
    const command = mission.phase === 'combat' ? fight(flight, mission) : idle;
    stepFlight(flight, command, 0, SIM_STEP);
    tick(mission, flight, command);
    phases.add(mission.phase);
  }
  assert.deepEqual([...phases], ['ambush','combat','jammed','relay']);
  assert.equal(mission.allies.length, 0);
  assert.equal(mission.kills, 5);
  assert.ok(mission.arms.missiles < 3);
  assert.equal(mission.signal, false);
  for (const relay of RELAYS) {
    const selected = { ...mission, phase: 'relay', effects: [], shots: [] };
    selectRelay(selected, relay.id);
    flight.pos = relayPosition(relay);
    tick(selected, flight);
    assert.equal(selected.phase, 'complete');
    assert.equal(selected.signal, true);
    assert.match(selected.message, new RegExp(relay.name));
  }
});
