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
  matchId: number;
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
    inputAck: number;
    flight: FlightState;
    arms: WeaponsState;
    outside: number | null;
    target: string | null;
    incoming: boolean;
    event: number;
    message: string;
  }>;
  shots: Array<{ id: number; kind: 'tracer' | 'missile' | 'rocket'; pos: Vec3; velocity: Vec3; size: number; fromTeam: number }>;
  effects: Array<{ id: number; kind: 'spark' | 'flare'; pos: Vec3; velocity: Vec3; size: number }>;
}

async function request<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
  token?: string,
  keepalive = false,
): Promise<T> {
  if (location.protocol === 'file:') {
    throw Object.assign(new Error('Crew requires the online Cloudflare Worker server.'), { status: 503 });
  }
  const headers = new Headers();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const options: RequestInit = { credentials: 'omit', cache: 'no-store', headers, keepalive };
  if (!keepalive) options.signal = AbortSignal.timeout(9000);
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
  private inputSequence = 0;
  private retries = 0;
  private roomGeneration = 0;
  private resumeToken: string | null = null;
  private reconnectTimer: number | undefined;
  private socketWatch: number | undefined;
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
      if (this.token === token) this.token = null;
      if (retry) return request<T>(path, data, await this.session());
      throw error;
    }
  }

  startPresence(): () => void {
    if (location.protocol === 'file:') return () => {};
    let mounted = true, pageOpen = true, refreshing = false;
    const warmup = async () => {
      if (await this.checkStatus() && mounted && pageOpen) await this.session();
    };
    const maintain = async () => {
      if (!mounted || !pageOpen || refreshing) return;
      refreshing = true;
      try {
        if (this.token) await this.pilotRequest('session/keepalive', {});
        else await warmup();
      } catch (error) {
        if ((error as { status?: number }).status === 401 && mounted && pageOpen) {
          await this.session().catch(() => {});
        }
      } finally {
        refreshing = false;
      }
    };
    const pageHide = (event: PageTransitionEvent) => {
      pageOpen = false;
      if (event.persisted) return;
      this.pageGeneration++;
      const token = this.token;
      const { room, resumeToken } = this;
      this.token = null;
      this.opening = null;
      this.disconnect();
      if (token) void request('session/end', {}, token, true).catch(() => {});
      if (room && resumeToken) {
        void request('room-session', { room, action: 'leave' }, resumeToken, true).catch(() => {});
      }
    };
    const pageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      pageOpen = true;
      void maintain();
    };
    const wake = () => { if (!document.hidden) void maintain(); };
    void maintain();
    const timer = window.setInterval(() => { void maintain(); }, 40_000);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
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
    const { room, resumeToken } = this;
    if (!room) return;
    try {
      await this.pilotRequest('close', { room });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (!resumeToken || (status !== 401 && status !== 403)) throw error;
      await request('room-session', { room, action: 'close' }, resumeToken);
    }
    if (this.room === room) this.disconnect();
  }

  async connect(room: string, plane: number): Promise<void> {
    if (this.room !== room) this.disconnect();
    this.room = room;
    this.retries = 0;
    const generation = ++this.roomGeneration;
    this.stopSocket();
    this.onStatus?.('Connecting to lobby…');
    try {
      await this.openSocket(room, plane, generation);
    } catch (error) {
      if (this.roomGeneration === generation) this.disconnect();
      throw error;
    }
  }

  private async openSocket(room: string, plane: number, generation: number): Promise<void> {
    const { ticket } = this.resumeToken
      ? await request<{ ticket: string }>('room-session', { room, plane, action: 'resume' }, this.resumeToken)
      : await this.pilotRequest<{ ticket: string }>('socket-ticket', { room, plane });
    if (this.roomGeneration !== generation) return;

    const url = new URL(api + 'socket/' + room, location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url, [protocol, ticket]);
    this.socket = ws;
    let lastMessage = performance.now();
    let newestPing: number | undefined;

    ws.addEventListener('message', (event) => {
      if (this.socket !== ws) return;
      let message: { t: string; [key: string]: unknown };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      lastMessage = performance.now();
      if (message.t === 'you') {
        this.id = String(message.id);
        if (typeof message.resume === 'string') this.resumeToken = message.resume;
      } else if (message.t === 'lobby') {
        this.lobby = message as unknown as CrewLobby;
        this.retries = 0;
        this.onStatus?.('');
        this.onConnection?.(true);
        this.onLobby?.(this.lobby);
      } else if (message.t === 'frame' && this.id) {
        this.onFrame?.(message as unknown as CrewSnapshot, this.id);
      } else if (message.t === 'pong' && newestPing !== undefined && message.at === newestPing) {
        const rtt = lastMessage - newestPing;
        this.pingMs = Math.round(this.pingMs === null ? rtt : this.pingMs * 0.8 + rtt * 0.2);
      } else if (message.t === 'error') {
        this.onStatus?.(String(message.message), true);
      }
    });

    ws.addEventListener('close', (event) => {
      if (this.socket !== ws) return;
      this.stopSocket();
      if (['Host closed this lobby', 'Replaced by a new connection', 'Left this lobby'].includes(event.reason)) {
        this.endRoom(event.reason);
        return;
      }
      this.scheduleReconnect(room, plane, generation);
    });

    this.socketWatch = window.setInterval(() => {
      if (this.socket !== ws) return;
      const now = performance.now();
      if (!document.hidden && now - lastMessage > 15_000) {
        this.stopSocket();
        this.scheduleReconnect(room, plane, generation);
      } else if (this.send({ t: 'ping', at: now })) {
        newestPing = now;
      }
    }, 3000);
  }

  private scheduleReconnect(room: string, plane: number, generation: number): void {
    this.onConnection?.(false);
    if (this.retries >= 12) {
      this.endRoom('Could not reconnect to Crew. Rejoin from the hangar.');
      return;
    }
    this.onStatus?.('Connection interrupted. Reconnecting…', true);
    const delay = Math.min(500 * 2 ** this.retries++, 5000);
    this.reconnectTimer = window.setTimeout(() => {
      if (this.roomGeneration !== generation) return;
      void this.openSocket(room, plane, generation).catch((error) => {
        if (this.roomGeneration !== generation) return;
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 403 || status === 410) {
          this.endRoom('This Crew lobby has ended. Create or join a new lobby.');
        } else {
          this.scheduleReconnect(room, plane, generation);
        }
      });
    }, delay);
  }

  private endRoom(reason: string): void {
    this.disconnect();
    this.onStatus?.(reason, true);
    this.onClosed?.(reason);
  }

  async switchPlaneInLobby(plane: number): Promise<void> {
    if (this.room) await this.connect(this.room, plane);
  }

  private send(value: unknown): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount >= 4096) return false;
    this.socket.send(JSON.stringify(value));
    return true;
  }

  startMatch(): void {
    this.send({ t: 'start' });
  }

  sendControls(command: ControlInput, matchId: number): number | null {
    for (const flag of ['missile', 'rocket', 'flare', 'roll'] as const) {
      if (command[flag]) this.inputFlags[flag] = true;
    }
    const sequence = this.inputSequence + 1;
    if (!this.send({ t: 'input', matchId, sequence, command: { ...command, ...this.inputFlags } })) return null;
    this.inputFlags = {};
    this.inputSequence = sequence;
    return sequence;
  }

  private stopSocket(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.socketWatch);
    this.inputFlags = {};
    this.pingMs = null;
  }

  disconnect(): void {
    this.roomGeneration++;
    this.stopSocket();
    this.room = null;
    this.lobby = null;
    this.id = null;
    this.resumeToken = null;
    this.inputSequence = 0;
    this.onLobby?.(null);
  }
}
