import { DurableObject } from 'cloudflare:workers';
import { GuestDirectory } from './guest-directory.js';
import { readBody } from './http.js';

export class CrewDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.guests = new GuestDirectory();
  }

  async fetch(request) {
    return this.guests.handle(new URL(request.url).pathname, await readBody(request));
  }
}
