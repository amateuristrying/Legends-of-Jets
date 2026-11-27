import { DurableObject } from 'cloudflare:workers';
import { bad, readBody, reply } from './http.js';
import { validateRules } from './match.js';

const ROOM_LIFE = 90 * 60 * 1000;
const REQUEST_LIFE = 7 * 24 * 60 * 60 * 1000;
const pair = (a,b) => a < b ? [a,b] : [b,a];
const nickname = value => (typeof value==='string' ? value : 'Pilot').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').trim().slice(0,28) || 'Pilot';

export class CrewDirectory extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS links(a TEXT, b TEXT, invited TEXT NOT NULL, status TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(a,b));
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, host TEXT NOT NULL, rules TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS seats(room TEXT REFERENCES rooms(id) ON DELETE CASCADE, pilot TEXT NOT NULL, slot INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY(room,pilot));
      CREATE INDEX IF NOT EXISTS seat_pilots ON seats(pilot);
      CREATE INDEX IF NOT EXISTS room_expiry ON rooms(expires);
      CREATE INDEX IF NOT EXISTS linked_b ON links(b);
      CREATE TABLE IF NOT EXISTS rate(id TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
    `);
  }

  row(query,...bindings) { return this.sql.exec(query,...bindings).toArray()[0]; }

  profile(user) {
    const old = this.row('SELECT * FROM profiles WHERE id = ?', user.id);
    if (old) return old;
    for (let tries=0; tries<35; tries++) {
      const random = crypto.getRandomValues(new Uint32Array(1))[0];
      const code = String(random % 1000000).padStart(6,'0');
      const record = this.row('INSERT OR IGNORE INTO profiles VALUES (?,?,?) RETURNING *',user.id,nickname(user.name),code);
      if (record) return record;
    }
    throw Error('Could not assign pilot code');
  }

  roomInfo(id, pilot, now = Date.now()) {
    const room = this.row(`SELECT r.*, s.state FROM rooms r JOIN seats s ON s.room = r.id
      WHERE r.id = ? AND s.pilot = ? AND r.expires > ?`,id,pilot,now);
    if (!room) return null;
    const members = this.sql.exec(`SELECT p.id, p.name, s.slot, s.state FROM seats s JOIN profiles p ON p.id = s.pilot
       WHERE s.room = ? ORDER BY s.slot`,id).toArray();
    return { id:room.id, host:room.host, state:room.state, rules:JSON.parse(room.rules), members };
  }

  async fetch(request) {
    const { user, body } = await readBody(request);
    const me = this.profile(user), id = me.id, now = Date.now();
    switch (new URL(request.url).pathname) {
      case '/home': {
        const connections = this.sql.exec(`SELECT p.id, p.name, l.status, l.invited FROM links l JOIN profiles p
          ON p.id = CASE WHEN l.a = ? THEN l.b ELSE l.a END
          WHERE (l.a = ? OR l.b = ?) AND (l.status='accepted' OR l.updated>?) ORDER BY p.name LIMIT 120`,id,id,id,now-REQUEST_LIFE).toArray();
        const rooms = this.sql.exec(`SELECT r.id FROM rooms r JOIN seats s ON s.room=r.id
          WHERE s.pilot=? AND s.state!='declined' AND r.expires>? ORDER BY r.expires DESC LIMIT 8`,id,now).toArray();
        return reply({ me, connections, rooms:rooms.map(room=>this.roomInfo(room.id,id,now)) });
      }
      case '/invite': {
        if (!/^\d{6}$/.test(body.code ?? '')) return bad('Enter a six-digit pilot code.');
        const window = Math.floor(now/60000);
        const rate = this.row(`INSERT INTO rate VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET
          count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count`,id,window);
        if (rate.count > 8) return bad('Too many invite attempts. Try again in a minute.',429);
        const friend = this.row('SELECT id FROM profiles WHERE code = ?',body.code);
        if (!friend || friend.id===id) return bad('No other pilot was found with that code.',404);
        const [a,b] = pair(id,friend.id);
        const existing = this.row('SELECT * FROM links WHERE a=? AND b=?',a,b);
        if (existing?.status==='accepted') return reply({ message:'This pilot is already in your crew.' });
        if (existing && existing.updated>now-REQUEST_LIFE) {
          return reply({ message:existing.invited===id ? 'Invite already sent.' : 'This pilot invited you. Accept the request below.' });
        }
        const total = this.row(`SELECT COUNT(*) AS total FROM links WHERE invited=? AND status='pending' AND updated>?`,id,now-REQUEST_LIFE);
        if (total.total>=24) return bad('You have too many open requests.',429);
        this.sql.exec(`INSERT INTO links VALUES(?,?,?,'pending',?) ON CONFLICT(a,b) DO UPDATE SET
          status='pending', updated=excluded.updated, invited=excluded.invited`,a,b,id,now);
        return reply({ message:'Crew invite sent.' });
      }
      case '/respond': {
        if (typeof body.pilot!=='string' || typeof body.accept!=='boolean') return bad('Invalid invitation.');
        const [a,b] = pair(id,body.pilot);
        const invite = this.row(`SELECT invited FROM links WHERE a=? AND b=? AND status='pending' AND updated>?`,a,b,now-REQUEST_LIFE);
        if (!invite || invite.invited===id) return bad('This request is no longer available.',404);
        if (body.accept) this.sql.exec(`UPDATE links SET status='accepted',updated=? WHERE a=? AND b=?`,now,a,b);
        else this.sql.exec('DELETE FROM links WHERE a=? AND b=?',a,b);
        return reply({ message:body.accept?'Pilot added to your crew.':'Request declined.' });
      }
      case '/create': {
        const rules = validateRules(body.rules);
        const guests = body.guests;
        if (!rules || !Array.isArray(guests) || guests.length!==rules.seats-1 ||
            new Set(guests).size!==guests.length || guests.some(guest=>typeof guest!=='string' || guest===id)) {
          return bad('Choose one accepted crewmate for each open seat.');
        }
        for (const guest of guests) {
          if (!this.row(`SELECT 1 FROM links WHERE a=? AND b=? AND status='accepted'`,...pair(guest,id))) {
            return bad('Only accepted crewmates can join.',403);
          }
        }
        const quantity = this.row('SELECT COUNT(*) AS count FROM rooms WHERE host=? AND expires>?',id,now);
        if (quantity.count>=6) return bad('Close an existing lobby before making a new one.',429);
        const room = crypto.randomUUID();
        this.ctx.storage.transactionSync(() => {
          this.sql.exec('DELETE FROM rooms WHERE expires<=?',now);
          this.sql.exec('INSERT INTO rooms VALUES(?,?,?,?)',room,id,JSON.stringify(rules),now+ROOM_LIFE);
          [id,...guests].forEach((pilot,slot)=>{
            this.sql.exec('INSERT INTO seats VALUES(?,?,?,?)',room,pilot,slot,slot===0?'joined':'invited');
          });
        });
        return reply({ room:this.roomInfo(room,id,now) },201);
      }
      case '/room-response': {
        const room = typeof body.room==='string' && this.roomInfo(body.room,id,now);
        if (!room || room.state!=='invited' || typeof body.accept!=='boolean') return bad('Room invitation unavailable.',404);
        this.sql.exec('UPDATE seats SET state=? WHERE room=? AND pilot=?',body.accept?'joined':'declined',room.id,id);
        return reply({ room:body.accept?this.roomInfo(room.id,id,now):null });
      }
      case '/room': {
        const room = typeof body.room==='string' && this.roomInfo(body.room,id,now);
        return room?.state==='joined' ? reply({ me:{id:me.id,name:me.name},room }) : bad('You do not have access to this room.',403);
      }
      case '/close': {
        const room = typeof body.room==='string' && this.roomInfo(body.room,id,now);
        if (!room || room.host!==id) return bad('Only the host can close the lobby.',403);
        this.sql.exec('DELETE FROM rooms WHERE id=?',room.id);
        return reply({ ok:true });
      }
      default: return bad('Not found.',404);
    }
  }
}
