import assert from 'node:assert/strict';
import test from 'node:test';
import { height, planes } from '../server/sim/world.js';
import { interpolateFlight, newFlight, SIM_STEP, stepFlight } from '../server/sim/flight.js';

const neutral = { turn: 0, pitch: 0, boost: false, roll: false };

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

test('boost and steering retain the differences between airframes', () => {
  const flights = planes.map((_, type) => newFlight(type, [0, 450, 0]));
  for (const flight of flights) {
    for (let frame = 0; frame < 180; frame++) {
      stepFlight(flight, { ...neutral, turn: 1, boost: true }, 0, SIM_STEP);
    }
    assert.ok(flight.speed > planes[flight.type].speed * 1.65);
    assert.ok(flight.yaw > 0);
  }
  assert.ok(flights[0].yaw > flights[2].yaw && flights[2].yaw > flights[1].yaw);
  assert.ok(flights[2].speed > flights[0].speed && flights[0].speed > flights[1].speed);
});

test('render interpolation takes the short rotation through the roll wrap', () => {
  const flight = newFlight(0);
  const angle = interpolateFlight({ ...flight, roll: 2 * Math.PI - .06 }, flight, .5).roll;
  assert.ok(Math.abs(Math.sin(angle) + .03) < .001);
});
