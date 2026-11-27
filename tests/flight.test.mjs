import assert from 'node:assert/strict';
import test from 'node:test';
import { height, planes, TERRAIN_SIZE, terrainHeight } from '../server/sim/world.js';
import { interpolateFlight, newFlight, SIM_STEP, stepFlight } from '../server/sim/flight.js';

const neutral = { turn: 0, pitch: 0, boost: false, brake: false, roll: false };

test('crash recovers above the exact horizontal impact position on both maps', () => {
  for (const map of [0, 1]) {
    const flight = newFlight(2, [121, 220, 13]);
    const dive = { ...neutral, pitch: -1 };
    for (let frame = 0; frame < 1200 && !flight.death; frame++) stepFlight(flight, dive, map, SIM_STEP);
    assert.ok(flight.death > 0);
    const [x, , z] = flight.pos;
    while (flight.death) stepFlight(flight, neutral, map, SIM_STEP);
    assert.deepEqual([flight.pos[0], flight.pos[2]], [x, z]);
    assert.ok(flight.pos[1] >= height(x, z, map) + 95);
    assert.equal(flight.recovered, true);
    assert.equal('lives' in flight, false);
    assert.equal(flight.type, 2);
    assert.equal(flight.pitch, 0);
  }
});

test('boost and steering retain the differences across all 5 airframes', () => {
  assert.equal(planes.length, 5);
  const flights = planes.map((_, type) => newFlight(type, [0, 450, 0]));
  for (const flight of flights) {
    assert.equal(flight.hull, planes[flight.type].hull);
    assert.equal(flight.fuel, planes[flight.type].fuelCapacity);
    for (let frame = 0; frame < 180; frame++) {
      stepFlight(flight, { ...neutral, turn: 1, boost: true }, 0, SIM_STEP);
    }
    assert.ok(flight.speed > planes[flight.type].speed * 1.65);
    assert.ok(flight.yaw > 0);
    assert.ok(flight.fuel < flight.maxFuel);
  }
  assert.ok(flights[4].yaw > flights[0].yaw && flights[0].yaw > flights[2].yaw && flights[2].yaw > flights[1].yaw);
  assert.ok(flights[4].speed > flights[3].speed && flights[3].speed > flights[2].speed && flights[2].speed > flights[0].speed && flights[0].speed > flights[1].speed);
});

test('server fuel engine scales burn dynamically, alerts bingo <20%, and flames out at 0%', () => {
  const cruise = newFlight(0, [0, 450, 0]);
  const boost = newFlight(0, [0, 450, 0]);
  for (let i = 0; i < 120; i++) {
    stepFlight(cruise, neutral, 0, SIM_STEP);
    stepFlight(boost, { ...neutral, boost: true }, 0, SIM_STEP);
  }
  assert.ok((boost.maxFuel - boost.fuel) > (cruise.maxFuel - cruise.fuel) * 2.4);

  const empty = newFlight(3, [0, 500, 0]);
  empty.fuel = 0.001;
  const startSpeed = empty.speed;
  for (let i = 0; i < 180; i++) {
    stepFlight(empty, { ...neutral, boost: true }, 0, SIM_STEP);
  }
  assert.equal(empty.fuel, 0);
  assert.equal(empty.flameout, true);
  assert.equal(empty.lowFuel, true);
  assert.ok(empty.boost < 0.05);
  assert.ok(empty.speed < startSpeed * 0.75);
});

test('server terrain is aperiodic and non-repeating across 4096m offsets', () => {
  for (const map of [0, 1]) {
    let diffs = 0;
    for (let i = 0; i < 10; i++) {
      const x = 640 + i * 240;
      const z = -900 + i * 290;
      if (Math.abs(terrainHeight(x, z, map) - terrainHeight(x + TERRAIN_SIZE, z, map)) > 1) diffs++;
    }
    assert.ok(diffs >= 8);
  }
});

test('render interpolation takes the short rotation through the roll wrap', () => {
  const flight = newFlight(0);
  const angle = interpolateFlight({ ...flight, roll: 2 * Math.PI - 0.06 }, flight, 0.5).roll;
  assert.ok(Math.abs(Math.sin(angle) + 0.03) < 0.001);
});
