import { bad, internal, readBody, reply } from './http.js';
import { ROOM_ID } from './room.js';

export { CrewDirectory } from './directory.js';
export { CrewRoom } from './room.js';

const api = '/api/crew/';
const mutations = new Set([
  'session', 'session/keepalive', 'session/end', 'invite', 'respond', 'create',
  'room-response', 'socket-ticket', 'room-session', 'close',
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(api)) return env.ASSETS.fetch(request);
    const path = url.pathname.slice(api.length);
    if ((request.method === 'POST' || path.startsWith('socket/')) && request.headers.get('Origin') !== url.origin) {
      return bad('Request must originate from Legends of Jets.', 403);
    }

    const roomWorker = id => env.CREW_ROOMS.get(env.CREW_ROOMS.idFromName(id));
    try {
      if (path === 'status' && request.method === 'GET') return reply({ available: true });
      if (path.startsWith('socket/')) {
        const id = path.slice('socket/'.length);
        if (!ROOM_ID.test(id)) return bad('Invalid room.', 404);
        return await roomWorker(id).fetch(request);
      }
      if (!(path === 'home' && request.method === 'GET') && !(mutations.has(path) && request.method === 'POST')) {
        return bad('Not found.', 404);
      }
      const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9-]{36})$/i)?.[1];
      if (path !== 'session' && !token) return bad('Open Crew to get a pilot code.', 401);
      let body = {};
      if (request.method === 'POST') {
        try { body = await readBody(request); } catch { return bad('Invalid request.'); }
      }
      if (path === 'room-session') {
        if (typeof body.room !== 'string' || !ROOM_ID.test(body.room)) return bad('Invalid room.', 404);
        return await roomWorker(body.room).fetch(internal('/session', { token, body }));
      }
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const directory = env.CREW_DIRECTORY.get(env.CREW_DIRECTORY.idFromName('guest:' + url.hostname));
      const payload = { token, body, ip };
      if (path === 'socket-ticket') {
        const response = await directory.fetch(internal('/room', payload));
        if (!response.ok) return response;
        const { me, room } = await response.json();
        const plane = [0,1,2,3,4].includes(body.plane) ? body.plane : 0;
        return await roomWorker(room.id).fetch(internal('/ticket', { me, room, plane }));
      }
      const response = await directory.fetch(internal('/' + path, payload));
      if (path === 'close' && response.ok) {
        ctx.waitUntil(roomWorker(body.room).fetch(internal('/terminate', {})));
      }
      if (path === 'session/end' && response.ok) {
        const { closedRooms } = await response.json();
        ctx.waitUntil(Promise.all(closedRooms.map(id => roomWorker(id).fetch(internal('/terminate', {})))));
        return reply({ ok: true });
      }
      return response;
    } catch (error) {
      console.error('Crew request failed:', error?.name);
      return bad('Crew is temporarily unavailable. Try again.', 500);
    }
  },
};
