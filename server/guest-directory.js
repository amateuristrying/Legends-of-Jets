import { bad, reply } from './http.js';
import { validateRules } from './match.js';

export const SESSION_LIFE = 10 * 60 * 1000;
const ROOM_LIFE = 90 * 60 * 1000;
const REQUEST_LIFE = 10 * 60 * 1000;
const SESSION_LIMIT = 35;
const INVITE_LIMIT = 40;
const SESSION_CAPACITY = 20_000;
const FRIEND_CAPACITY = 120;
const publicPilot = ({ id, name, code }) => ({ id, name, code });

export class GuestDirectory {
  constructor() {
    this.sessions = new Map();
    this.codes = new Map();
    this.retiredCodes = new Map();
    this.rooms = new Map();
    this.rate = new Map();
    this.nextSweep = 0;
  }

  allow(key, count, now) {
    const window = Math.floor(now / 60_000);
    const previous = this.rate.get(key);
    const used = previous?.window === window ? previous.used + 1 : 1;
    this.rate.set(key, { window, used });
    return used <= count;
  }

  removeRoom(room) {
    this.rooms.delete(room.id);
    for (const { pilot } of room.seats) pilot.rooms.delete(room.id);
  }

  removePilot(pilot, now) {
    this.sessions.delete(pilot.token);
    this.codes.delete(pilot.code);
    this.retiredCodes.set(pilot.code, now + SESSION_LIFE);
    for (const other of pilot.links.values()) other.pilot.links.delete(pilot.id);
    const closedRooms = [];
    for (const id of pilot.rooms) {
      const room = this.rooms.get(id);
      if (room.host === pilot.id) {
        this.removeRoom(room);
        closedRooms.push(id);
      } else {
        room.seats.find(seat => seat.pilot === pilot).state = 'left';
        pilot.rooms.delete(id);
      }
    }
    return closedRooms;
  }

  sweep(now, force = false) {
    if (!force && now < this.nextSweep) return;
    this.nextSweep = now + 15_000;
    for (const room of this.rooms.values()) {
      if (room.expires <= now) this.removeRoom(room);
    }
    for (const pilot of this.sessions.values()) {
      if (pilot.expires <= now) {
        this.removePilot(pilot, now);
        continue;
      }
      for (const [id, link] of pilot.links) {
        if (link.state.status === 'pending' && link.state.expires <= now) {
          pilot.links.delete(id);
          link.pilot.links.delete(pilot.id);
        }
      }
    }
    for (const [code, expires] of this.retiredCodes) {
      if (expires <= now) this.retiredCodes.delete(code);
    }
    const window = Math.floor(now / 60_000);
    for (const [key, rate] of this.rate) {
      if (rate.window < window) this.rate.delete(key);
    }
  }

  issue(ip, now) {
    if (!this.allow('issue:' + ip, SESSION_LIMIT, now)) {
      return bad('Too many new codes requested. Try again in a minute.', 429);
    }
    if (this.sessions.size >= SESSION_CAPACITY) return bad('Crew is busy. Try again shortly.', 503);
    let code;
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = crypto.getRandomValues(new Uint32Array(1))[0];
      const candidate = String(value % 1_000_000).padStart(6, '0');
      if (!this.codes.has(candidate) && !this.retiredCodes.has(candidate)) { code = candidate; break; }
    }
    if (!code) return bad('Could not assign a Crew code. Try again.', 503);
    const pilot = {
      id: crypto.randomUUID(), token: crypto.randomUUID(), code, name: 'Pilot ' + code,
      expires: now + SESSION_LIFE, links: new Map(), rooms: new Set(),
    };
    this.sessions.set(pilot.token, pilot);
    this.codes.set(code, pilot);
    return reply({ token: pilot.token, me: publicPilot(pilot) }, 201);
  }

  roomInfo(room, pilot, now) {
    if (!room || room.expires <= now) return null;
    const seat = room.seats.find(item => item.pilot === pilot);
    if (!seat) return null;
    return {
      id: room.id, host: room.host, state: seat.state, rules: room.rules,
      members: room.seats.map(({ pilot: member, state }, slot) => ({ id: member.id, name: member.name, slot, state })),
    };
  }

  invite(pilot, code, ip, now) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return bad('Enter a six-digit pilot code.');
    if (!this.allow('invite-ip:' + ip, INVITE_LIMIT, now) || !this.allow('invite:' + pilot.id, 8, now)) {
      return bad('Too many invite attempts. Try again in a minute.', 429);
    }
    const other = this.codes.get(code);
    if (!other || other === pilot || other.expires <= now) {
      return bad('No active pilot found. Ask your friend for the code on their current tab.', 404);
    }
    const existing = pilot.links.get(other.id)?.state;
    if (existing?.status === 'accepted') return reply({ message: 'This pilot is already in your crew.' });
    if (existing?.expires > now) {
      return reply({ message: existing.invited === pilot.id
        ? 'Invite already sent.' : 'This pilot invited you. Accept the request below.' });
    }
    if (pilot.links.size >= FRIEND_CAPACITY || other.links.size >= FRIEND_CAPACITY) {
      return bad('One pilot has too many crew connections.', 429);
    }
    const state = { status: 'pending', invited: pilot.id, expires: now + REQUEST_LIFE };
    pilot.links.set(other.id, { pilot: other, state });
    other.links.set(pilot.id, { pilot, state });
    return reply({ message: 'Crew invite sent.' });
  }

  respond(pilot, body, now) {
    if (typeof body.pilot !== 'string' || typeof body.accept !== 'boolean') return bad('Invalid invitation.');
    const link = pilot.links.get(body.pilot);
    if (!link || link.state.status !== 'pending' || link.state.invited === pilot.id ||
        link.state.expires <= now || link.pilot.expires <= now) {
      return bad('This request is no longer available.', 404);
    }
    if (body.accept) link.state.status = 'accepted';
    else {
      link.pilot.links.delete(pilot.id);
      pilot.links.delete(body.pilot);
    }
    return reply({ message: body.accept ? 'Pilot added to your crew.' : 'Request declined.' });
  }

  create(pilot, body, now) {
    const rules = validateRules(body.rules), guests = body.guests;
    if (!rules || !Array.isArray(guests) || guests.length !== rules.seats - 1 ||
        new Set(guests).size !== guests.length || guests.some(id => typeof id !== 'string' || id === pilot.id)) {
      return bad('Choose one accepted crewmate for each open seat.');
    }
    const links = guests.map(id => pilot.links.get(id));
    if (links.some(link => link?.state.status !== 'accepted' || link.pilot.expires <= now)) {
      return bad('Only active, accepted crewmates can join.', 403);
    }
    if ([...pilot.rooms].filter(id => this.rooms.get(id)?.host === pilot.id).length >= 6) {
      return bad('Close an existing lobby before making a new one.', 429);
    }
    const seats = [
      { pilot, state: 'joined' },
      ...links.map(link => ({ pilot: link.pilot, state: 'invited' })),
    ];
    const room = { id: crypto.randomUUID(), host: pilot.id, rules, seats, expires: now + ROOM_LIFE };
    this.rooms.set(room.id, room);
    for (const seat of seats) seat.pilot.rooms.add(room.id);
    return reply({ room: this.roomInfo(room, pilot, now) }, 201);
  }

  handle(path, { token, body = {}, ip }, now = Date.now()) {
    this.sweep(now);
    if (path === '/session') return this.issue(ip, now);
    const pilot = this.sessions.get(token);
    if (!pilot || pilot.expires <= now) return bad('Your pilot code expired. Get a new code in Crew.', 401);
    pilot.expires = now + SESSION_LIFE;
    const room = this.rooms.get(body.room);
    const access = this.roomInfo(room, pilot, now);
    switch (path) {
      case '/session/keepalive': return reply({ ok: true });
      case '/session/end': return reply({ closedRooms: this.removePilot(pilot, now) });
      case '/home': {
        const connections = [];
        for (const { pilot: other, state } of pilot.links.values()) {
          if (other.expires <= now || (state.status === 'pending' && state.expires <= now)) continue;
          connections.push({ id: other.id, name: other.name, status: state.status, invited: state.invited });
        }
        const rooms = [...pilot.rooms].reverse().map(id => this.roomInfo(this.rooms.get(id), pilot, now))
          .filter(item => item && (item.state === 'joined' || item.state === 'invited')).slice(0, 8);
        return reply({ me: publicPilot(pilot), connections, rooms });
      }
      case '/invite': return this.invite(pilot, body.code, ip, now);
      case '/respond': return this.respond(pilot, body, now);
      case '/create': return this.create(pilot, body, now);
      case '/room-response': {
        if (access?.state !== 'invited' || typeof body.accept !== 'boolean') {
          return bad('Room invitation unavailable.', 404);
        }
        room.seats.find(seat => seat.pilot === pilot).state = body.accept ? 'joined' : 'declined';
        return reply({ room: body.accept ? this.roomInfo(room, pilot, now) : null });
      }
      case '/room':
        return access?.state === 'joined' ? reply({ me: { id: pilot.id, name: pilot.name }, room: access })
          : bad('You do not have access to this room.', 403);
      case '/close':
        if (access?.host !== pilot.id) return bad('Only the host can close the lobby.', 403);
        this.removeRoom(room);
        return reply({ ok: true });
      default: return bad('Not found.', 404);
    }
  }
}
