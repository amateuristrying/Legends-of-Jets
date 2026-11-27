import type { ControlInput, FlightState, Vec3, WeaponsState } from './types';

const api = '/api/crew/';
const protocol = 'legends.crew.v1';

export interface CrewRules {
  seats: 2 | 4;
  mode: 'duel' | 'bots';
  seconds: 180 | 300;
  difficulty: 'standard' | 'veteran' | 'ace';
  map: 0 | 1;
  night: boolean;
}

export interface CrewProfile {
  me: { id: string; name: string; code: string };
  connections: Array<{ id: string; name: string; status: 'accepted' | 'pending'; invited: string }>;
  rooms: Array<{
    id: string;
    state: 'invited' | 'joined';
    rules: CrewRules;
    members: Array<{ id: string; name: string; state: string }>;
  }>;
}

export interface CrewLobby {
  t: 'lobby';
  host: string;
  phase: 'lobby' | 'playing' | 'finished';
  rules: CrewRules;
  members: Array<{ id: string; name: string; online: boolean; plane: number }>;
}

export interface CrewSnapshot {
  t: 'frame';
  phase: 'playing' | 'finished';
  rules: CrewRules;
  winner: number | null;
  score: [number, number];
  sequence: number;
  time: number;
  remaining: number;
  arena: { center: Vec3; radius: number };
  pilots: Array<{
    id: string;
    name: string;
    team: number;
    bot: boolean;
    points: number;
    deaths: number;
    flight: FlightState;
    arms: WeaponsState;
    outside: number | null;
    target: string | null;
    incoming: boolean;
    event: number;
    message: string;
  }>;
  shots: Array<{ kind: 'tracer' | 'missile' | 'rocket'; pos: Vec3; size: number; fromTeam: number }>;
  effects: Array<{ kind: 'spark' | 'flare'; pos: Vec3; size: number }>;
}

async function request<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
  token?: string,
  keepalive = false,
): Promise<T> {
  const headers = new Headers();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const options: RequestInit = { credentials: 'omit', cache: 'no-store', headers, keepalive };
  if (data !== undefined) {
    options.method = 'POST';
    headers.set('Content-Type', 'application/json');
    options.body = JSON.stringify(data);
  }
  const response = await fetch(api + path, options);
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw Object.assign(new Error('Crew requires the online Cloudflare Worker server.'), { status: 503 });
  }
  const body = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(body.error || 'Crew is temporarily unavailable.'), {
      status: response.status,
    });
  }
  return body as T;
}

export class CrewClient {
  socket: WebSocket | null = null;
  room: string | null = null;
  id: string | null = null;
  lobby: CrewLobby | null = null;
  pingMs: number | null = null;
  private inputFlags: Partial<ControlInput> = {};
  private nextInput = 0;
  private lastSendAt = 0;
  private retries = 0;
  private closedSockets = new WeakSet<WebSocket>();
  private token: string | null = null;
  private opening: Promise<string> | null = null;
  private pageGeneration = 0;

  onLobby?: (lobby: CrewLobby | null) => void;
  onFrame?: (snapshot: CrewSnapshot, id: string) => void;
  onStatus?: (msg: string, isError?: boolean) => void;
  onConnection?: (connected: boolean) => void;
  onClosed?: (reason: string) => void;

  async checkStatus(): Promise<boolean> {
    if (location.protocol === 'file:') return false;
    const res = await request<{ available: boolean }>('status');
    return res.available;
  }

  private async session(): Promise<string> {
    if (this.token) return this.token;
    if (this.opening) return this.opening;
    const generation = this.pageGeneration;
    const pending = request<{ token: string }>('session', {}).then(({ token }) => {
      if (generation !== this.pageGeneration) {
        void request('session/end', {}, token, true).catch(() => {});
        throw new Error('The game tab was closed.');
      }
      this.token = token;
      return token;
    });
    this.opening = pending;
    try {
      return await pending;
    } finally {
      if (this.opening === pending) this.opening = null;
    }
  }

  private async pilotRequest<T>(path: string, data?: unknown, retry = false): Promise<T> {
    const token = await this.session();
    try {
      return await request<T>(path, data, token);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) throw error;
      if (this.token === token) {
        this.token = null;
        if (this.room) {
          this.disconnect();
          this.onClosed?.('Crew session expired. Share your new pilot code to reconnect.');
        }
      }
      if (retry) return request<T>(path, data, await this.session());
      throw error;
    }
  }

  startPresence(): () => void {
    if (location.protocol === 'file:') return () => {};
    let mounted = true, pageOpen = true, refreshing = false, leftRoom = false;
    const warmup = async () => {
      if (await this.checkStatus() && mounted && pageOpen) await this.session();
    };
    const maintain = async () => {
      if (!mounted || !pageOpen || !this.token || refreshing) return;
      refreshing = true;
      try {
        await this.pilotRequest('session/keepalive', {});
      } catch (error) {
        if ((error as { status?: number }).status === 401 && mounted && pageOpen) {
          await this.session().catch(() => {});
        }
      } finally {
        refreshing = false;
      }
    };
    const pageHide = () => {
      pageOpen = false;
      leftRoom = this.room !== null;
      this.pageGeneration++;
      const token = this.token;
      this.token = null;
      this.opening = null;
      this.disconnect();
      if (token) void request('session/end', {}, token, true).catch(() => {});
    };
    const pageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      pageOpen = true;
      if (leftRoom) this.onClosed?.('The previous Crew session ended. Share your new pilot code.');
      void warmup().catch(() => {});
    };
    void warmup().catch(() => {});
    const timer = window.setInterval(() => { void maintain(); }, 25_000);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
    };
  }

  async home(): Promise<CrewProfile> {
    return this.pilotRequest<CrewProfile>('home', undefined, true);
  }

  async invite(code: string): Promise<{ message: string }> {
    return this.pilotRequest('invite', { code });
  }

  async respondFriend(pilot: string, accept: boolean): Promise<{ message: string }> {
    return this.pilotRequest('respond', { pilot, accept });
  }

  async createRoom(guests: string[], rules: CrewRules): Promise<{ room: CrewProfile['rooms'][number] }> {
    return this.pilotRequest('create', { guests, rules });
  }

  async respondRoom(room: string, accept: boolean): Promise<{ room?: CrewProfile['rooms'][number] }> {
    return this.pilotRequest('room-response', { room, accept });
  }

  async closeRoom(): Promise<void> {
    if (!this.room) return;
    await this.pilotRequest('close', { room: this.room });
    this.disconnect();
  }

  async connect(room: string, plane: number, retry = false): Promise<void> {
    if (!retry) {
      this.disconnect();
      this.retries = 0;
    }
    this.room = room;
    this.onStatus?.('Connecting to lobby…', false);
    let ticket: string;
    try {
      ({ ticket } = await this.pilotRequest<{ ticket: string }>('socket-ticket', { room, plane }));
    } catch (error) {
      if (this.room === room) this.room = null;
      throw error;
    }
    if (this.room !== room) return;

    const url = new URL(api + 'socket/' + room, location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url, [protocol, ticket]);
    this.socket = ws;

    ws.addEventListener('message', (event) => {
      if (this.socket !== ws) return;
      if (this.lastSendAt > 0) {
        const rtt = Math.round(performance.now() - this.lastSendAt);
        if (rtt > 0 && rtt < 2000) this.pingMs = rtt;
      }
      let message: { t: string; [key: string]: unknown };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.t === 'you') this.id = String(message.id);
      else if (message.t === 'lobby') {
        this.lobby = message as unknown as CrewLobby;
        this.retries = 0;
        this.onStatus?.('', false);
        this.onLobby?.(this.lobby);
      } else if (message.t === 'frame' && this.id) {
        this.onFrame?.(message as unknown as CrewSnapshot, this.id);
      } else if (message.t === 'error') {
        this.onStatus?.(String(message.message), true);
      }
    });

    ws.addEventListener('close', (event) => {
      if (this.socket !== ws || this.closedSockets.has(ws)) return;
      this.socket = null;
      if (
        event.reason === 'Host closed this lobby' ||
        event.reason === 'Replaced by a new connection'
      ) {
        this.disconnect();
        this.onClosed?.(event.reason);
        return;
      }
      this.onStatus?.('Connection interrupted. Reconnecting…', true);
      this.onConnection?.(false);
      if (this.retries++ < 3) {
        setTimeout(() => {
          if (this.room !== room || this.socket) return;
          this.connect(room, plane, true).catch((err) => {
            this.onStatus?.(err.message, true);
            this.onConnection?.(false);
          });
        }, 1000 * this.retries);
      } else {
        this.onStatus?.('Could not reconnect. Open the lobby again from Crew.', true);
      }
    });

    ws.addEventListener('open', () => this.onConnection?.(true));
  }

  async switchPlaneInLobby(plane: number): Promise<void> {
    if (!this.room) return;
    await this.connect(this.room, plane, false);
  }

  send(value: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 32000) {
      this.lastSendAt = performance.now();
      this.socket.send(JSON.stringify(value));
    }
  }

  startMatch(): void {
    this.send({ t: 'start' });
  }

  sendControls(command: ControlInput, now: number): void {
    for (const flag of ['missile', 'rocket', 'flare', 'roll'] as const) {
      this.inputFlags[flag] = Boolean(this.inputFlags[flag] || command[flag]);
    }
    if (now < this.nextInput) return;
    this.send({ t: 'input', command: { ...command, ...this.inputFlags } });
    this.inputFlags = {};
    this.nextInput = now + 40;
  }

  disconnect(): void {
    if (this.socket) {
      this.closedSockets.add(this.socket);
      this.socket.close();
    }
    this.socket = null;
    this.room = null;
    this.lobby = null;
    this.id = null;
    this.pingMs = null;
    this.inputFlags = {};
    this.onLobby?.(null);
  }
}
