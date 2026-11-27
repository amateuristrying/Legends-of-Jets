# Legends of Jets

An atmospheric **WebGL2** aerial combat and free-flight game built with **Vite + React 19 + TypeScript**, featuring non-repeating procedural terrain with real-time weapon crater deformation, origin-centered active and dormant volcano landmarks, a 30-level 5-Act campaign, and authoritative **Crew** multiplayer powered by **Cloudflare Workers + Durable Objects + Supabase Auth**.

---

## Key Features

### World, Landmarks & Deformable Terrain
* **Non-Repeating Procedural Worlds**: Continuous aperiodic hash-lattice fBm, domain-warped ridge chains, varied canyons, and sliding-window `gl.CLAMP_TO_EDGE` GPU heightmap streaming across two distinct theatres:
  * **Ember Canyon (*Ashmouth Caldera*)**: Sandstone canyons surrounding an **active volcano** at `[0, 0]` with molten lava crust, glowing magma veins, rising ember/smoke plumes, and four flyable cardinal tunnels.
  * **Frostline Reach (*Glacier Vault*)**: Arctic peaks and glacial channels surrounding a **dormant volcano** at `[0, 0]` with cooled obsidian rock, interior frost shelves, a cathedral skylight, and four flyable tunnels.
* **Weapon-Scaled Terrain & Landmark Destruction**: Real-time dual-channel `gl.RG8` heightmap & scorch streaming (`gl.texSubImage2D`) synced with CPU collision and minimap elevation tiles:
  * **Cannon**: `6m` micro-impact chips (`2.4m` depth) & scorch marks.
  * **Rockets**: `26m` blast craters (`30m` depth) & volcano wall carving.
  * **Missiles**: `48m` deep craters (`66m` depth), glowing ember/dark-basalt scorch rims, shockwave debris, and localized landmark carving.
  * **Target Ruins**: Destroyed radar, AA, relay, and core ground installations leave smoking, charred ruins on the battlefield.

### Flight Physics, Fuel & Combat Systems
* **Arcade & Sim-Lite Flight Models**: Toggleable handling with dive acceleration, climb speed bleed, high-G energy loss, stall warning/recovery, and full 3D wingtip contrails anchored to each jet's exact wing geometry.
* **Dynamic Fuel & Central Refuel Depot**: Unified fuel burn scaled by throttle/airspeed, climbing, high-G turns, and afterburner (`~3x` burn), triggering **BINGO FUEL** (`<20%`) alerts and **Engine Flameout** (`0%`). Flying into the central depot at `[0, tunnelAltitude, 0]` inside either volcano restores **100% fuel**, **hull**, and **missiles/rockets/flares**.
* **Diegetic Cockpits, Tactical Radar & Audio**: Per-jet Canvas 2D cockpits with 360° RWR, dynamic gun lead pip, off-screen threat arrows, Boss HP bar, live tactical minimap (`R`), and a Web Audio synthesizer (per-jet turbine profiles, IR lock growl, GPWS pull-up alerts, and toggleable synth soundtrack).

### 5 Playable Airframes

| Airframe | Role | Top Speed | Turn | Hull | Fuel | Missiles / Rockets / Flares | Unlock |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Needle F-5** | Light Interceptor | 102 | 1.28 | 100 | 240 | 3 / 6 / 4 | Starter |
| **Mirage M-III** | Heavy Delta Striker | 90 | 0.90 | 135 | 300 | 4 / 12 / 4 | Starter |
| **Spectre SU-27** | Air Superiority | 118 | 1.08 | 115 | 340 | 5 / 8 / 5 | Starter |
| **Wraith YF-23** | Stealth Interceptor (`-35%` enemy lock range) | 124 | 1.16 | 105 | 280 | 5 / 8 / 6 | 6 Campaign levels or 25 kills |
| **Valkyrie XV-9** | Ace Experimental | 128 | 1.32 | 125 | 320 | 6 / 12 / 6 | 15 Campaign levels or 75 kills |

### Game Modes
* **30-Level Campaign (5 Acts)**: *Act I: Dead Air*, *Act II: Northern Crossing*, *Act III: Scorched Horizon*, *Act IV: Arctic Siege*, and *Act V: Legends of the Sky* — spanning 11 mission archetypes including canyon dogfights, Ridge Station defense, tunnel runs, low-ceiling stealth, convoy escort extraction, SEAD ground strikes, relay blitz, survival waves, and 5 distinct Ace Boss encounters (`CINDER-1`, `GLACIER-1`, `PYRE`, `SUBZERO`, `SOVEREIGN`).
* **Bot Skirmish**: Configurable `1v1`, `1v3`, `2v2`, and `3v3` skirmishes against Standard, Veteran, or Ace AI across both maps and 5 atmosphere presets (`day`, `golden`, `night`, `storm`, `aurora`).
* **Ring Time Trials**: 8-ring high-speed precision circuits through Ashmouth Caldera and Glacier Vault with personal-best persistence.
* **Endless Wave Survival**: Escalating hostile waves with mid-air rearm rings and the central volcano depot.
* **Free Flight (*Endless*)**: Open exploration and practice across both maps.
* **Instant Mission Retry**: Failed sorties in Campaign, Time Trial, or Survival transition directly to debrief with one-click or `Space` instant relaunch.
* **Crew Multiplayer**: Authoritative server simulation (`server/sim/*`) synced across terrain, `[0, 0]` volcano tunnels, all 5 airframes, fuel/refuel, and rockets over WebSockets / Cloudflare Durable Objects.

---

## Quick Start

### Prerequisites
* **Node.js** 20+ and **npm**

### Commands

```bash
npm install            # Install dependencies
npm run dev            # Start Vite dev server (http://localhost:5173)
npm run typecheck      # Run TypeScript check (tsc --noEmit)
npm run build          # Typecheck + production Vite build into dist/
npm run preview        # Preview the production dist/ bundle
npm test               # Run Vitest client engine & campaign suite
node --test tests/*.test.mjs  # Run Node server simulation & Crew multiplayer tests
node build-offline.mjs # Build standalone single-file HTML into play/Legends of Jets.html
npm run dev:online     # Start local Cloudflare Worker + Crew multiplayer (wrangler dev)
```

> **Offline Single-File Build**: Running `node build-offline.mjs` bundles the entire game (CSS + ES module JS) into `play/Legends of Jets.html` so it can be opened directly without a dev server.

---

## Default Controls

All bindings are customizable in **Settings**, with full support for **Mouse-Aim**, **Pointer Lock**, and the **Gamepad API**.

| Action | Default Key | Notes |
| :--- | :---: | :--- |
| Climb / Dive | `W` / `S` | Pitch control (invertible in Settings) |
| Turn Left / Right | `A` / `D` | Yaw & banked turn |
| Roll | `E` | Manual roll input |
| Afterburner | `Shift` | Speed boost (`~3x` fuel burn) |
| Airbrake | `B` | Decelerate for tight canyon/tunnel passes |
| Fire Cannon | `G` | Unlimited rounds (subject to barrel heat) |
| Launch Missile | `M` | Guided IR/radar seeker (`34m` crater on ground hit) |
| Fire Rocket | `X` | Unguided pod salvo (`18m` crater & wall carving) |
| Deploy Flare | `F` | Diverts incoming missile locks |
| Toggle Radar | `R` | Show/hide tactical minimap (click relays to inspect) |
| Camera View | `Space` | Cycle chase / cockpit view (or **Retry Sortie** on failed debrief) |

---

## Project Structure

```text
├── build-offline.mjs       # Vite single-file offline HTML builder (outputs play/)
├── server.mjs              # Minimal static HTTP server for dist/
├── vite.config.ts          # Vite & Vitest configuration
├── wrangler.jsonc          # Cloudflare Workers + Durable Objects config
├── functions/
│   └── api/crew/           # Cloudflare Pages fallback proxy for Crew API
├── server/
│   ├── index.js            # Worker entrypoint & /api/crew/* router
│   ├── auth.js             # Supabase JWT verification
│   ├── directory.js        # CrewDirectory Durable Object (matchmaking/rooms)
│   ├── room.js             # CrewRoom Durable Object (WebSocket state loop)
│   ├── match.js            # Authoritative multiplayer match simulation
│   └── sim/                # Shared server terrain, flight & mission simulation
├── src/
│   ├── App.tsx             # Game loop orchestration, HUD & scene management
│   ├── components/         # Hangar, Campaign, Crew, Pilot Log & Settings modals
│   ├── engine/             # WebGL2 renderer, procedural world, landmarks, flight,
│   │                       # combat AI, radar, cockpit HUD, audio & storage
│   └── styles/             # Tactical HUD & UI styling
└── tests/                  # Node server simulation & Crew multiplayer tests
```
