import { DurableObject } from 'cloudflare:workers';
import { bad, readBody, reply } from './http.js';
import { createMatch, setMatchInput, snapshot, STEP, tickMatch } from './match.js';

export const PROTOCOL = 'legends.crew.v1';
export const ROOM_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export class CrewRoom extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.clients = new Map();
    this.tickets = new Map();
    this.resumes = new Map();
    this.plan = null;
    this.match = null;
    this.closed = false;
    this.timer = null;
  }

  send(client, payload) {
    try { client.ws.send(payload); } catch { /* the close event removes disconnected pilots */ }
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const client of this.clients.values()) this.send(client,payload);
  }

  lobby() {
    this.broadcast({
      t:'lobby', host:this.plan.host, phase:this.match?.phase ?? 'lobby', rules:this.plan.rules,
      members:this.plan.members.map(member=>({
        id:member.id, name:member.name, online:this.clients.has(member.id),
        plane:this.clients.get(member.id)?.plane ?? 0,
      })),
    });
  }

  terminate() {
    this.closed = true;
    this.stop();
    for (const client of this.clients.values()) client.ws.close(1000, 'Host closed this lobby');
    this.clients.clear();
    this.tickets.clear();
    this.resumes.clear();
  }

  issueTicket(id, plane) {
    const now = Date.now();
    for (const [key, ticket] of this.tickets) {
      if (ticket.expiry < now || ticket.id === id) this.tickets.delete(key);
    }
    const ticket = crypto.randomUUID();
    this.tickets.set(ticket, { id, plane, expiry: now + 45_000 });
    return reply({ ticket });
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/terminate' && request.method==='POST') {
      this.terminate();
      return reply({ ok:true });
    }
    if (this.closed) return bad('This lobby is closed.',410);
    if (path === '/session' && request.method === 'POST') {
      const { token, body } = await readBody(request);
      const entry = [...this.resumes].find(([, resume]) => resume === token);
      if (!entry) return bad('This lobby session is no longer available.', 410);
      const [id] = entry;
      if (body.action === 'close' && id !== this.plan.host) return bad('Only the host can close the lobby.', 403);
      if (body.action === 'leave' || body.action === 'close') {
        if (id === this.plan.host) this.terminate();
        else {
          this.resumes.delete(id);
          for (const [key, ticket] of this.tickets) {
            if (ticket.id === id) this.tickets.delete(key);
          }
          const client = this.clients.get(id);
          if (client) {
            this.remove(client);
            client.ws.close(1000, 'Left this lobby');
          }
        }
        return reply({ ok: true });
      }
      if (body.action !== 'resume') return bad('Invalid room action.');
      const plane = [0, 1, 2, 3, 4].includes(body.plane) ? body.plane : 0;
      return this.issueTicket(id, plane);
    }
    if (path === '/ticket' && request.method==='POST') {
      const { me,room,plane } = await readBody(request);
      this.plan ??= room;
      if (!this.plan.members.some(member=>member.id===me.id)) return bad('Invalid seat.',403);
      return this.issueTicket(me.id, plane);
    }
    if (request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return bad('WebSocket required.',426);
    const [protocol, token] = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(value=>value.trim());
    const ticket = this.tickets.get(token);
    if (protocol!==PROTOCOL || !ticket || ticket.expiry<Date.now()) return bad('Connection ticket expired.',403);
    this.tickets.delete(token);
    const [clientSocket, serverSocket] = Object.values(new WebSocketPair());
    serverSocket.accept();
    const previous = this.clients.get(ticket.id);
    const client = { id:ticket.id, plane:ticket.plane, ws:serverSocket, rateWindow:0, rate:0 };
    this.clients.set(client.id,client);
    previous?.ws.close(1000,'Replaced by a new connection');
    serverSocket.addEventListener('message',event=>this.message(client,event.data));
    serverSocket.addEventListener('close',()=>this.remove(client));
    serverSocket.addEventListener('error',()=>this.remove(client));
    let resume = this.resumes.get(client.id);
    if (!resume) {
      resume = crypto.randomUUID();
      this.resumes.set(client.id, resume);
    }
    this.send(client,JSON.stringify({ t:'you',id:client.id,resume }));
    this.lobby();
    if (this.match) this.send(client,JSON.stringify(snapshot(this.match,Date.now())));
    return new Response(null,{
      status:101, webSocket:clientSocket, headers:{ 'Sec-WebSocket-Protocol':PROTOCOL },
    });
  }

  remove(client) {
    if (this.clients.get(client.id)!==client) return;
    this.clients.delete(client.id);
    if (this.match) setMatchInput(this.match,client.id,null,Date.now());
    if (this.plan) this.lobby();
  }

  message(client,value) {
    if (this.clients.get(client.id)!==client || typeof value!=='string' || value.length>900) return;
    const now = Date.now(), window = Math.floor(now/1000);
    if (window!==client.rateWindow) { client.rateWindow=window; client.rate=0; }
    if (++client.rate>65) return;
    let message;
    try { message = JSON.parse(value); } catch { return; }
    if (!message || typeof message!=='object') return;
    if (message.t === 'ping' && typeof message.at === 'number' && Number.isFinite(message.at)) {
      this.send(client, JSON.stringify({ t: 'pong', at: message.at }));
    } else if (message.t==='input' && this.match &&
        (message.matchId === undefined || message.matchId === this.match.start)) {
      setMatchInput(this.match,client.id,message.command,now,message.sequence);
    } else if (message.t==='start' && client.id===this.plan.host && this.match?.phase!=='playing') {
      if (this.plan.members.some(member=>!this.clients.has(member.id))) {
        this.send(client,JSON.stringify({t:'error',message:'Wait for every invited pilot to join.'}));
        return;
      }
      const members = this.plan.members.map(member=>({ ...member, plane:this.clients.get(member.id).plane }));
      this.match = createMatch(this.plan.rules,members,now);
      this.lastTick = now;
      this.elapsed = 0;
      this.frames = 0;
      this.lobby();
      this.broadcast(snapshot(this.match,now));
      this.timer = setInterval(()=>this.tick(),25);
    }
  }

  tick() {
    const now = Date.now();
    this.elapsed += Math.min(200,now-this.lastTick)/1000;
    this.lastTick = now;
    let steps = 0;
    while (this.elapsed >= STEP && this.match.phase==='playing') {
      tickMatch(this.match,now);
      this.elapsed -= STEP;
      steps++;
    }
    this.frames = (this.frames ?? 0) + steps;
    if (this.frames >= 2 || this.match.phase==='finished') {
      this.frames %= 2;
      this.broadcast(snapshot(this.match,now));
    }
    if (this.match.phase==='finished') {
      this.stop();
      this.lobby();
    }
  }

  stop() {
    if (this.timer!==null) clearInterval(this.timer);
    this.timer = null;
  }
}
