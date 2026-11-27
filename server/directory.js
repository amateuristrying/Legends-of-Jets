import { DurableObject } from 'cloudflare:workers';
import { GuestDirectory } from './guest-directory.js';
import { readBody } from './http.js';

export class CrewDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.guests = new GuestDirectory();
    this.sweepTimer = null;
  }

  scheduleSweep() {
    if (this.guests.sessions.size === 0) {
      if (this.sweepTimer !== null) clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
      return;
    }
    if (this.sweepTimer !== null) return;
    // Keep the in-memory directory alive between heartbeats from background tabs.
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      this.guests.sweep(Date.now(), true);
      this.scheduleSweep();
    }, 45_000);
  }

  async fetch(request) {
    const response = this.guests.handle(new URL(request.url).pathname, await readBody(request));
    this.scheduleSweep();
    return response;
  }
}
