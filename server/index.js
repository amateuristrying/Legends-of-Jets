import { authClient, authConfigured, authRoute } from './auth.js';
import { bad, internal, readBody, reply } from './http.js';
import { ROOM_ID } from './room.js';

export { CrewDirectory } from './directory.js';
export { CrewRoom } from './room.js';

const api = '/api/crew/';
const mutations = new Set(['invite','respond','create','room-response','socket-ticket','close']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(api)) return env.ASSETS.fetch(request);
    const path = url.pathname.slice(api.length);
    if ((request.method==='POST' || path.startsWith('socket/')) && request.headers.get('Origin')!==url.origin) {
      return bad('Request must originate from Legends of Jets.',403);
    }
    try {
      if (path==='status' && request.method==='GET') return reply({ available:authConfigured(env) });
      if (path.startsWith('auth/')) return await authRoute(request,env,path.slice(5));
      if (path.startsWith('socket/')) {
        const id = path.slice('socket/'.length);
        if (!ROOM_ID.test(id)) return bad('Invalid room.',404);
        return await env.CREW_ROOMS.get(env.CREW_ROOMS.idFromName(id)).fetch(request);
      }
      if (!authConfigured(env)) return bad('Crew sign-in is not configured on this server.',503);
      if (!(path==='home' && request.method==='GET') && !(mutations.has(path) && request.method==='POST')) {
        return bad('Not found.',404);
      }
      let body = {};
      if (request.method==='POST') {
        try { body = await readBody(request); } catch { return bad('Invalid request.'); }
      }
      const { client,apply } = authClient(request,env);
      const { data,error } = await client.auth.getUser();
      if (error || !data.user) return apply(bad('Sign in to play Crew.',401));
      const { id,user_metadata } = data.user;
      const user = { id,name:user_metadata?.display_name || user_metadata?.full_name || user_metadata?.name || 'Pilot' };
      const directory = env.CREW_DIRECTORY.get(env.CREW_DIRECTORY.idFromName('pilot-directory'));
      if (path==='socket-ticket') {
        const response = await directory.fetch(internal('/room',{ user,body }));
        if (!response.ok) return apply(response);
        const { me,room } = await response.json();
        const plane = [0,1,2,3,4].includes(body.plane) ? body.plane : 0;
        const stub = env.CREW_ROOMS.get(env.CREW_ROOMS.idFromName(room.id));
        return apply(await stub.fetch(internal('/ticket',{ me,room,plane })));
      }
      const response = await directory.fetch(internal('/'+path,{user,body}));
      if (path==='close' && response.ok) {
        await env.CREW_ROOMS.get(env.CREW_ROOMS.idFromName(body.room)).fetch(internal('/terminate',{}));
      }
      return apply(response);
    } catch (error) {
      console.error('Crew request failed:',error?.name);
      return bad('Crew is temporarily unavailable. Try again.',500);
    }
  },
};
