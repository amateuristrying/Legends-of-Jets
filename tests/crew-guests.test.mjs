import assert from 'node:assert/strict';
import test from 'node:test';
import { GuestDirectory, SESSION_LIFE } from '../server/guest-directory.js';

const rules = { seats: 2, mode: 'duel', seconds: 180, difficulty: 'veteran', map: 0, night: false };
const ip = '192.0.2.1';
const issue = async (directory, now = 0) => {
  const created = directory.handle('/session', { ip }, now);
  assert.equal(created.status, 201);
  return created.json();
};
const call = (directory, path, session, body = {}, now = 0) =>
  directory.handle(path, { token: session?.token, ip, body }, now);

test('each new tab gets a distinct six-digit code and only its private token opens its Crew', async () => {
  const directory = new GuestDirectory();
  const first = await issue(directory);
  const second = await issue(directory);
  assert.match(first.me.code, /^\d{6}$/);
  assert.match(second.me.code, /^\d{6}$/);
  assert.notEqual(first.me.code, second.me.code);
  assert.equal(call(directory, '/home', { token: first.me.code }).status, 401);
  const home = await call(directory, '/home', first).json();
  assert.deepEqual(home, { me: first.me, connections: [], rooms: [] });
  assert.ok(!JSON.stringify(home).includes(first.token));

  await call(directory, '/session/end', first, {}, 20).json();
  const reloaded = await issue(directory, 21);
  assert.notEqual(reloaded.me.code, first.me.code);
  assert.notEqual(reloaded.me.id, first.me.id);
  assert.equal(call(directory, '/home', first, {}, 22).status, 401);
  assert.equal(call(directory, '/invite', second, { code: first.me.code }, 22).status, 404);
});

test('a kept-open tab keeps its code, while idle sessions and in-memory state expire', async () => {
  const directory = new GuestDirectory();
  const idle = await issue(directory);
  const active = await issue(directory);
  assert.equal(call(directory, '/session/keepalive', active, {}, SESSION_LIFE - 100).status, 200);
  assert.equal(call(directory, '/home', idle, {}, SESSION_LIFE + 1).status, 401);
  assert.deepEqual((await call(directory, '/home', active, {}, SESSION_LIFE + 1).json()).me, active.me);
  assert.equal(call(new GuestDirectory(), '/home', active, {}, SESSION_LIFE + 2).status, 401);
});

test('accepted guests can join a lobby and discarding the host session revokes room access', async () => {
  const directory = new GuestDirectory();
  const host = await issue(directory), guest = await issue(directory), outside = await issue(directory);
  const pack = { rules, guests: [guest.me.id] };
  assert.equal(call(directory, '/create', host, pack).status, 403);
  assert.equal(call(directory, '/invite', host, { code: guest.me.code }).status, 200);
  assert.equal(call(directory, '/respond', host, { pilot: guest.me.id, accept: true }).status, 404);
  assert.equal(call(directory, '/respond', guest, { pilot: host.me.id, accept: true }).status, 200);
  const { room } = await call(directory, '/create', host, pack).json();
  assert.equal(call(directory, '/room', guest, { room: room.id }).status, 403);
  assert.equal(call(directory, '/room-response', guest, { room: room.id, accept: true }).status, 200);
  assert.equal(call(directory, '/room', guest, { room: room.id }).status, 200);
  assert.equal(call(directory, '/room', outside, { room: room.id }).status, 403);
  assert.deepEqual(await call(directory, '/session/end', host, {}, 1000).json(), { closedRooms: [room.id] });
  assert.equal(call(directory, '/room', guest, { room: room.id }, 1100).status, 403);
  assert.deepEqual((await call(directory, '/home', guest, {}, 1100).json()).connections, []);
});

test('a pilot cannot use a single session to guess unlimited codes', async () => {
  const directory = new GuestDirectory();
  const pilot = await issue(directory);
  const code = pilot.me.code === '111111' ? '222222' : '111111';
  for (let tryCount = 0; tryCount < 8; tryCount++) {
    assert.equal(call(directory, '/invite', pilot, { code }).status, 404);
  }
  assert.equal(call(directory, '/invite', pilot, { code }).status, 429);
  assert.equal(call(directory, '/invite', pilot, { code }, 60_001).status, 404);
});
