# Legends of Jets (v1.0 — Vite + React + TypeScript)

An atmospheric WebGL2 aerial combat and free-flight game migrated to **Vite + React + TypeScript**, retaining full compatibility with the Cloudflare Workers + Durable Objects + Supabase Auth **Crew** multiplayer backend.

## Quick Start

```bash
npm install
npm run dev        # Start local Vite dev server (http://localhost:5173)
npm run build      # Typecheck (tsc --noEmit) + production Vite build to dist/
npm run preview    # Preview the production dist/ bundle locally
npm test           # Run Vitest v1.0 engine & campaign test suite
npm run dev:online # Run Cloudflare Worker + Crew multiplayer locally
```

## What's New in v1.0

* **Vite + React + TypeScript Architecture**: Modular `src/engine/*` WebGL2/physics/AI core paired with React UI modals (`src/components/*`), strict TypeScript typing, Vitest suite, and decoupled `server/sim/*` for Cloudflare Workers.
* **30-Level Scripted Campaign (5 Acts)**: Continues directly from *Chapter 01: Dead Air* across *Act I: Dead Air*, *Act II: Northern Crossing*, *Act III: Scorched Horizon*, *Act IV: Arctic Siege*, and *Act V: Legends of the Sky* — featuring pre-mission briefings, multi-beat radio dialogue, tunnel strikes, low-ceiling stealth, escort defense, ground SEAD strikes, relay blitz, survival waves, and 5 Ace Boss fights.
* **Frostline Reach 3D Landmark — Glacier Vault**: A new marching-tetrahedra 3D crystalline ice cavern with four flyable tunnels and a cathedral skylight, matching Ashmouth Caldera's unified GPU render + CPU collision pipeline.
* **New Game Modes**:
  * **Offline Bot Skirmish**: 1v1, 1v3, 2v2, and 3v3 against Standard, Veteran, or Ace bots across both maps and all weather presets.
  * **Ring Time Trials**: 8-ring precision circuits through Ashmouth Caldera and Glacier Vault with personal best persistence.
  * **Endless Wave Survival**: Escalating waves with mid-air green rearm/repair rings.
* **Flight Physics & 5 Airframes**: Toggleable **Arcade** and **Sim-Lite** (gravity/dive acceleration, climb speed bleed, high-G bleed, stall warning/recovery, afterburner fuel). Five distinct jets: **Needle F-5**, **Mirage M-III**, **Spectre SU-27**, plus unlockable **Wraith YF-23** (stealth) and **Valkyrie XV-9** (twin-boom experimental).
* **Visuals, Cockpits & Combat HUD**: 5 atmosphere presets (Day, Golden Hour, Night, Storm with rain/snow streaks, Arctic Aurora), universal contrails for all jets, missile smoke trails, low-hull smoke/fire, multi-stage explosions, 3D ground structures, 5 per-jet diegetic Canvas 2D cockpits with 360° RWR, dynamic gun lead pip, off-screen directional threat arrows, hit markers, and live killfeed.
* **Tactical Audio & Controls**: Per-jet turbine profiles, IR missile seeker lock growl, GPWS pull-up warnings, afterburner boom, toggleable dynamic synth soundtrack, Gamepad API support, Mouse-Aim cursor reticle, full key rebinding, Pilot Log persistence, and Crew lobby aircraft switching + live ping.
