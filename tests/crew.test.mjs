import assert from 'node:assert/strict';
import test from 'node:test';
import { ARENA_CENTER, ARENA_RADIUS, createMatch, normalizeInput, setMatchInput, snapshot, STEP, tickMatch, validateRules } from '../server/match.js';
import { newFlight } from '../server/sim/flight.js';
import { newMission, stepMission } from '../server/sim/mission.js';
import { centralRefuelPosition, planes } from '../server/sim/world.js';

const config = { seats: 2, mode: 'duel', seconds: 180, difficulty: 'veteran', map: 0, night: false };
const pilots = [{ id: 'blue', name: 'Azure', plane: 0 }, { id: 'red', name: 'Crimson', plane: 2 }];
const init = (rules = {}) => createMatch({ ...config, ...rules }, pilots, 0);

test('Endless stays empty even after prolonged play', () => {
  const flight = newFlight(0, [0, 720, 0]);
  const mission = newMission('endless', flight);
  for (let frame = 0; frame < 4500; frame++) stepMission(mission, flight, {}, 0, STEP);
  assert.deepEqual(mission.enemies, []);
  assert.equal(mission.phase, 'free-flight');
});

test('duel and bot lobbies enforce supported options and form the right teams', () => {
  assert.deepEqual(validateRules(config), config);
  assert.equal(validateRules({ ...config, seconds: 120 }), null);
  assert.equal(validateRules({ ...config, seats: 3 }), null);
  const members = [...pilots, { id: 'third', name: 'Third', plane: 3 }, { id: 'fourth', name: 'Fourth', plane: 4 }];
  const duel = createMatch({ ...config, seats: 4 }, members, 4900);
  assert.deepEqual(duel.pilots.map(p => p.team), [0, 1, 0, 1]);
  assert.deepEqual(duel.pilots.map(p => p.flight.type), [0, 2, 3, 4]);
  const cooperative = createMatch({ ...config, seats: 4, mode: 'bots', seconds: 300, difficulty: 'ace' }, members, 4900);
  assert.equal(cooperative.end, 304900);
  assert.deepEqual(cooperative.pilots.map(p => [p.bot, p.team]), [
    [false, 0], [false, 0], [false, 0], [false, 0], [true, 1], [true, 1], [true, 1], [true, 1],
  ]);
});

test('boundary explodes at ten seconds, gives no free points, and respawns inside', () => {
  const match = init();
  const pilot = match.pilots[0];
  pilot.flight.pos = [ARENA_RADIUS + 40, 730, ARENA_CENTER[2]];
  for (let step = 1; step < 400; step++) tickMatch(match, step * 25);
  assert.ok(pilot.outside > 9);
  assert.equal(pilot.flight.death, 0);
  tickMatch(match, 10000);
  assert.ok(pilot.flight.death > 0);
  assert.match(pilot.armory.message, /COMBAT ZONE/);
  assert.deepEqual(snapshot(match, 10000).score, [0, 0]);
  for (let step = 401; step < 465; step++) tickMatch(match, step * 25);
  assert.equal(pilot.deaths, 1);
  assert.equal(pilot.flight.death, 0);
  assert.equal('lives' in pilot.flight, false);
  assert.equal(pilot.flight.hull, 100);
  assert.ok(Math.hypot(pilot.flight.pos[0] - ARENA_CENTER[0], pilot.flight.pos[2] - ARENA_CENTER[2]) < ARENA_RADIUS);
});

test('re-entry clears the outside timer and untrusted input is limited to controls', () => {
  assert.deepEqual(normalizeInput({ turn: -8, pitch: '1', boost: 1, rocket: true, roll: true, pos: [0, 0, 0] }),
    { turn: -1, pitch: 0, boost: false, brake: false, fire: false, missile: false, rocket: true, flare: false, roll: true });
  const match = init();
  const pilot = match.pilots[0];
  pilot.flight.pos = [ARENA_RADIUS + 200, 730, ARENA_CENTER[2]];
  for (let step = 1; step <= 200; step++) tickMatch(match, step * 25);
  assert.ok(pilot.outside >= 4.99);
  pilot.flight.pos = [0, 730, ARENA_CENTER[2]];
  tickMatch(match, 5025);
  assert.equal(pilot.outside, 0);
  assert.equal(pilot.flight.death, 0);
});

test('authoritative hits score one point and the timed result reflects the winning team', () => {
  const match = init();
  const [own, other] = match.pilots;
  own.flight.pos = [0, 700, -500];
  other.flight.pos = [0, 700, -385];
  other.flight.yaw = 0;
  own.spawnShield = other.spawnShield = 0;
  for (let i = 1; i < 60; i++) {
    setMatchInput(match, own.id, { fire: true }, i * 25);
    tickMatch(match, i * 25);
    if (own.points) break;
  }
  assert.equal(own.points, 1);
  assert.equal(other.deaths, 1);
  tickMatch(match, 180000);
  const result = snapshot(match, 180000);
  assert.equal(result.phase, 'finished');
  assert.equal(result.winner, 0);
  assert.deepEqual(result.score, [1, 0]);
  assert.equal(result.remaining, 0);
  assert.equal(JSON.stringify(result).includes('lastInput'), false);
});

test('Ace bots engage a live opponent with missiles and suppress friendly fire', () => {
  const match = init({ mode: 'bots', difficulty: 'ace' });
  const bot = match.pilots.find(p => p.bot);
  bot.flight.pos = [0, 720, -300]; bot.flight.yaw = 0; bot.spawnShield = 0;
  for (const pilot of match.pilots.slice(0, 2)) {
    pilot.flight.pos = [0, 720, 30]; pilot.flight.yaw = 0; pilot.spawnShield = 0;
  }
  tickMatch(match, 25);
  assert.ok(match.shots.some(shot => shot.kind === 'missile' && shot.owner.id === bot.id));
  const friend = match.pilots[1];
  friend.flight.pos = [1, 720, -430]; friend.flight.yaw = 0;
  const damageBefore = friend.flight.hull;
  const own = match.pilots[0]; own.flight.pos = [0, 720, -500];
  setMatchInput(match, own.id, { fire: true }, 50);
  for (let i = 2; i < 9; i++) tickMatch(match, i * 25);
  assert.equal(friend.flight.hull, damageBefore);
});

test('Crew match supports rockets, 5 airframes, and central [0, 0] volcano refuel/rearm on both maps', () => {
  for (const map of [0, 1]) {
    const match = createMatch(
      { ...config, map },
      [{ id: 'p1', name: 'Wraith', plane: 3 }, { id: 'p2', name: 'Valkyrie', plane: 4 }],
      0
    );
    const [p1, p2] = match.pilots;
    assert.equal(p1.flight.maxHull, planes[3].hull);
    assert.equal(p2.flight.maxHull, planes[4].hull);
    assert.equal(p1.armory.arms.rockets, planes[3].rockets);

    // Fire rocket and hit opponent
    p1.flight.pos = [0, 700, -520];
    p1.flight.yaw = 0;
    p1.flight.pitch = 0;
    p2.flight.pos = [0, 700, -480];
    p2.flight.yaw = 0;
    p1.spawnShield = p2.spawnShield = 0;
    const hullBefore = p2.flight.hull;
    setMatchInput(match, p1.id, { rocket: true }, 25);
    for (let i = 1; i <= 10; i++) tickMatch(match, i * 25);
    assert.ok(p2.flight.hull < hullBefore);
    assert.equal(p1.armory.arms.rockets, planes[3].rockets - 1);

    // Fly into central [0, tunnelAltitude, 0] depot to refuel & rearm
    p1.flight.pos = centralRefuelPosition(map);
    p1.flight.fuel = 12;
    p1.flight.lowFuel = true;
    p1.flight.flameout = true;
    p1.flight.hull = 40;
    tickMatch(match, 275);
    assert.equal(p1.flight.fuel, p1.flight.maxFuel);
    assert.equal(p1.flight.hull, p1.flight.maxHull);
    assert.equal(p1.armory.arms.rockets, planes[3].rockets);
  }
});
