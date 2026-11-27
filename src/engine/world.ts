import type { MapSpec, PlaneSpec, TrailSample, Vec3 } from './types';

export const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

export const mix = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;

export const maps: MapSpec[] = [
  {
    id: 0,
    name: 'Ember Canyon',
    region: 'THE RED FRONTIER',
    landmarkName: 'Ashmouth Caldera',
    description:
      'Jagged sandstone canyons and Ashmouth Caldera. Four volcanic tunnels cut through its glowing rim.',
  },
  {
    id: 1,
    name: 'Frostline Reach',
    region: 'THE NORTHERN FRONT',
    landmarkName: 'Glacier Vault',
    description:
      'Broken glacier shelves, snow peaks, and the subterranean Glacier Vault carved through solid arctic ice.',
  },
];

export const planes: PlaneSpec[] = [
  {
    id: 0,
    name: 'Needle F-5',
    role: 'LIGHT INTERCEPTOR',
    description:
      'Slim, razor-agile twin-engine interceptor with rapid-fire cannon and crisp cornering.',
    speed: 102,
    turn: 1.28,
    size: 0.85,
    hull: 100,
    fuelCapacity: 240,
    missiles: 3,
    rockets: 6,
    flares: 4,
    gunRate: 0.088,
    gunHeatPerShot: 0.052,
    stealthFactor: 1.0,
    enginePitch: 1.15,
    color: [0.65, 0.72, 0.75],
    accent: [1, 0.32, 0.12],
  },
  {
    id: 1,
    name: 'Mirage M-III',
    role: 'HEAVY DELTA STRIKER',
    description:
      'Broad delta wing with reinforced hull, heavy rocket pod, and steady ground-attack stability.',
    speed: 90,
    turn: 0.9,
    size: 1.12,
    hull: 135,
    fuelCapacity: 300,
    missiles: 4,
    rockets: 12,
    flares: 4,
    gunRate: 0.105,
    gunHeatPerShot: 0.056,
    stealthFactor: 1.0,
    enginePitch: 0.86,
    color: [0.71, 0.64, 0.48],
    accent: [1, 0.65, 0.16],
  },
  {
    id: 2,
    name: 'Spectre SU-27',
    role: 'AIR SUPERIORITY',
    description:
      'Wide swept wings, twin tails, and twin afterburners built for high-speed BVR dominance.',
    speed: 118,
    turn: 1.08,
    size: 1.16,
    hull: 115,
    fuelCapacity: 340,
    missiles: 5,
    rockets: 8,
    flares: 5,
    gunRate: 0.095,
    gunHeatPerShot: 0.055,
    stealthFactor: 0.95,
    enginePitch: 1.0,
    color: [0.4, 0.57, 0.65],
    accent: [0.28, 0.85, 0.88],
  },
  {
    id: 3,
    name: 'Wraith YF-23',
    role: 'STEALTH INTERCEPTOR',
    description:
      'Diamond-wing low-observable striker. Cuts enemy missile lock range by 35% with blazing top speed.',
    speed: 124,
    turn: 1.16,
    size: 1.06,
    hull: 105,
    fuelCapacity: 280,
    missiles: 5,
    rockets: 8,
    flares: 6,
    gunRate: 0.09,
    gunHeatPerShot: 0.048,
    stealthFactor: 0.65,
    enginePitch: 1.24,
    color: [0.26, 0.3, 0.36],
    accent: [0.55, 0.92, 1.0],
    unlockRequirement: {
      label: 'Clear 6 Campaign levels or score 25 total kills',
      minCampaignCleared: 6,
      minTotalKills: 25,
    },
  },
  {
    id: 4,
    name: 'Valkyrie XV-9',
    role: 'ACE EXPERIMENTAL',
    description:
      'Twin-boom forward-swept prototype with six-missile rack, rapid gun cooling, and unmatched energy.',
    speed: 128,
    turn: 1.32,
    size: 1.14,
    hull: 125,
    fuelCapacity: 320,
    missiles: 6,
    rockets: 12,
    flares: 6,
    gunRate: 0.08,
    gunHeatPerShot: 0.042,
    stealthFactor: 0.82,
    enginePitch: 1.32,
    color: [0.85, 0.84, 0.8],
    accent: [1.0, 0.24, 0.36],
    unlockRequirement: {
      label: 'Clear 15 Campaign levels or score 75 total kills',
      minCampaignCleared: 15,
      minTotalKills: 75,
    },
  },
];

export interface WingGeometry {
  span: number;
  leadingBase: number;
  leadingSlope: number;
  trailingBase: number;
  trailingSlope: number;
}

export interface WingtipOffset {
  x: number;
  y: number;
  z: number;
}

export const WING_Y_OFFSET = -0.26;
export const TRAIL_MAX_AGE = 1.45;

// Shared wing silhouette parameters matching aircraftPoints() for all 5 airframes
export const AIRCRAFT_WING_GEOMETRY: readonly WingGeometry[] = [
  // 0: Needle F-5
  { span: 8.6, leadingBase: 2.5, leadingSlope: -0.48, trailingBase: -4.9, trailingSlope: 0.13 },
  // 1: Mirage M-III
  { span: 11, leadingBase: 6.5, leadingSlope: -1.22, trailingBase: -8.4, trailingSlope: 0.085 },
  // 2: Spectre SU-27
  { span: 13, leadingBase: 6.4, leadingSlope: -0.7, trailingBase: -6.5, trailingSlope: 0.16 },
  // 3: Wraith YF-23
  { span: 12.2, leadingBase: 5.2, leadingSlope: -0.75, trailingBase: -8.5, trailingSlope: 0.55 },
  // 4: Valkyrie XV-9
  { span: 12.6, leadingBase: 1.6, leadingSlope: 0.28, trailingBase: -4.2, trailingSlope: 0.15 },
];

// Exact per-jet local-space wingtip trailing-edge offsets (scaled by plane.size)
export const WINGTIP_OFFSETS: readonly WingtipOffset[] = AIRCRAFT_WING_GEOMETRY.map((w, i) => {
  const s = (planes[i] ?? planes[0]).size;
  return {
    x: w.span * s,
    y: WING_Y_OFFSET * s,
    z: (w.trailingBase + w.span * w.trailingSlope) * s,
  };
});

export function aircraftBasis(
  yaw: number,
  pitch = 0,
  roll = 0
): { front: Vec3; rolledRight: Vec3; rolledUp: Vec3 } {
  const front = forward(yaw, pitch);
  let right = cross([0, 1, 0], front);
  const rightLen = Math.hypot(right[0], right[1], right[2]);
  right = rightLen > 1e-4 ? scale(right, 1 / rightLen) : [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = cross(front, right);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  return {
    front,
    rolledRight: add(scale(right, cr), scale(up, sr)),
    rolledUp: add(scale(up, cr), scale(right, -sr)),
  };
}

export function wingtipPositions(
  pos: Vec3,
  type: number,
  yaw: number,
  pitch = 0,
  roll = 0
): { left: Vec3; right: Vec3 } {
  const tip = WINGTIP_OFFSETS[type] ?? WINGTIP_OFFSETS[0];
  const { front, rolledRight, rolledUp } = aircraftBasis(yaw, pitch, roll);
  const center = add(pos, add(scale(rolledUp, tip.y), scale(front, tip.z)));
  const wingOffset = scale(rolledRight, tip.x);
  return {
    left: sub(center, wingOffset),
    right: add(center, wingOffset),
  };
}

export function pruneTrail(trail: TrailSample[], simTime: number, maxAge = TRAIL_MAX_AGE): void {
  // Keep one sample past maxAge so the tail segment fades smoothly to alpha=0 before dropping
  while (trail.length > 2 && simTime - trail[1].time > maxAge) {
    trail.shift();
  }
  while (trail.length > 0 && simTime - trail[0].time > maxAge + 0.15) {
    trail.shift();
  }
}

export function recordTrailSample(
  trail: TrailSample[],
  lastTrailTime: number,
  pos: Vec3,
  type: number,
  yaw: number,
  pitch: number,
  roll: number,
  simTime: number,
  interval = 0.045,
  maxAge = TRAIL_MAX_AGE
): number {
  pruneTrail(trail, simTime, maxAge);
  if (simTime - lastTrailTime < interval) return lastTrailTime;
  const { left, right } = wingtipPositions(pos, type, yaw, pitch, roll);
  trail.push({ time: simTime, left, right });
  if (trail.length > 56) trail.shift();
  return simTime;
}

export const VOLCANO = { x: 0, z: 1080, radius: 360, tunnelAltitude: 137 };
export const GLACIER_VAULT = { x: 240, z: 980, radius: 330, tunnelAltitude: 124 };
export const CENTRAL_REFUEL_RADIUS = 54;

export function centralRefuelPosition(map: number): Vec3 {
  const landmark = map === 1 ? GLACIER_VAULT : VOLCANO;
  return [landmark.x, landmark.tunnelAltitude, landmark.z];
}

export const TERRAIN_SIZE = 4096;
export const TERRAIN_TEXELS = 1024;
export const TERRAIN_HEIGHT = 640;
export const TERRAIN_GRID = 8;

const tiles: Array<Uint8Array | undefined> = [];
const mask = TERRAIN_TEXELS - 1;
const smooth = (t: number): number => t * t * (3 - 2 * t);

function noise(x: number, z: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const sx = smooth(x - ix);
  const sz = smooth(z - iz);
  const sample = (sx0: number, sz0: number): number => {
    let hash =
      Math.imul(sx0 & (period - 1), 374761393) +
      Math.imul(sz0 & (period - 1), 668265263) +
      seed;
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
  };
  return mix(
    mix(sample(ix, iz), sample(ix + 1, iz), sx),
    mix(sample(ix, iz + 1), sample(ix + 1, iz + 1), sx),
    sz
  );
}

function mountain(x: number, z: number, map: number): number {
  const u = x / TERRAIN_SIZE;
  const v = z / TERRAIN_SIZE;
  const sample = (f: number, salt: number, du = 0, dv = 0): number =>
    noise((u + du) * f, (v + dv) * f, f, salt + map * 197);
  const warpX = (sample(8, 47) - 0.5) * 0.14;
  const warpZ = (sample(8, 91) - 0.5) * 0.14;
  const ridge = 1 - Math.abs(2 * sample(16, 153, warpX, warpZ) - 1);
  const roughness = sample(64, 290, warpX, warpZ) * 0.67 + sample(128, 342) * 0.33;
  const broad = sample(8, 18);
  const chains = clamp((broad - 0.2) * 1.6 + 0.16, 0, 1);
  const peaks = Math.pow(ridge, 4.2) * (112 + 295 * sample(16, 119)) * chains;
  if (map === 0) {
    const river = 132 * Math.sin(v * 4 * Math.PI) + 66 * Math.sin(v * 10 * Math.PI);
    const dx = Math.abs((((x - river + 2048) % 4096) + 4096) % 4096 - 2048);
    const walls = smooth(clamp((dx - 51 - roughness * 30) / 112, 0, 1));
    const ravine = smooth(clamp((Math.abs(sample(16, 34, warpX) - 0.5) - 0.025) * 7, 0, 1));
    const distance = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    const ground = 8 + walls * (42 + broad * 72 + peaks + roughness * 56) * mix(0.25, 1, ravine);
    const crossAxis = Math.min(Math.abs(x - VOLCANO.x), Math.abs(z - VOLCANO.z));
    const approach =
      (1 - smooth(clamp((crossAxis - 42) / 71, 0, 1))) *
      (1 - smooth(clamp((distance - 452) / 104, 0, 1)));
    const surroundings = smooth(clamp((distance - 280) / 155, 0, 1));
    return mix(32, ground, surroundings * (1 - approach));
  }
  const coast = clamp((broad + 0.2 * (sample(32, 76, warpX, warpZ) - 0.5) - 0.39) * 5.7, 0, 1);
  const baseIce = coast * (23 + peaks * 1.22 + ridge * 43 + roughness * 89);
  // Clear smooth approaches around Glacier Vault on Frostline Reach
  const gDist = Math.hypot(x - GLACIER_VAULT.x, z - GLACIER_VAULT.z);
  const gCross = Math.min(Math.abs(x - GLACIER_VAULT.x), Math.abs(z - GLACIER_VAULT.z));
  const gApproach =
    (1 - smooth(clamp((gCross - 44) / 70, 0, 1))) *
    (1 - smooth(clamp((gDist - 430) / 100, 0, 1)));
  const gSurround = smooth(clamp((gDist - 260) / 145, 0, 1));
  return mix(24, baseIce, gSurround * (1 - gApproach));
}

export function terrainTile(map: number): Uint8Array {
  const existing = tiles[map];
  if (existing) return existing;
  const tile = new Uint8Array(TERRAIN_TEXELS ** 2);
  const cell = TERRAIN_SIZE / TERRAIN_TEXELS;
  for (let row = 0; row < TERRAIN_TEXELS; row++) {
    let z = (row + 0.5) * cell;
    if (z >= TERRAIN_SIZE / 2) z -= TERRAIN_SIZE;
    for (let col = 0; col < TERRAIN_TEXELS; col++) {
      let x = (col + 0.5) * cell;
      if (x >= TERRAIN_SIZE / 2) x -= TERRAIN_SIZE;
      tile[row * TERRAIN_TEXELS + col] = Math.round(
        (clamp(mountain(x, z, map), 0, TERRAIN_HEIGHT) * 255) / TERRAIN_HEIGHT
      );
    }
  }
  tiles[map] = tile;
  return tile;
}

function baseHeight(x: number, z: number, map: number): number {
  const tile = terrainTile(map);
  const px = (x * TERRAIN_TEXELS) / TERRAIN_SIZE - 0.5;
  const pz = (z * TERRAIN_TEXELS) / TERRAIN_SIZE - 0.5;
  const left = Math.floor(px);
  const top = Math.floor(pz);
  const sx = px - left;
  const sz = pz - top;
  const a = (top & mask) * TERRAIN_TEXELS;
  const b = ((top + 1) & mask) * TERRAIN_TEXELS;
  const l = left & mask;
  const r = (left + 1) & mask;
  return (
    (mix(mix(tile[a + l], tile[a + r], sx), mix(tile[b + l], tile[b + r], sx), sz) *
      TERRAIN_HEIGHT) /
    255
  );
}

function gridHeight(x: number, z: number, map: number): number {
  return Math.max(10, Math.floor(baseHeight(x, z, map) / 4) * 4);
}

export function terrainHeight(x: number, z: number, map: number): number {
  const step = TERRAIN_GRID;
  const left = Math.floor(x / step) * step;
  const top = Math.floor(z / step) * step;
  const u = (x - left) / step;
  const v = (z - top) / step;
  const topRight = gridHeight(left + step, top, map);
  const bottomLeft = gridHeight(left, top + step, map);
  if (u + v <= 1) {
    return gridHeight(left, top, map) * (1 - u - v) + topRight * u + bottomLeft * v;
  }
  return gridHeight(left + step, top + step, map) * (u + v - 1) + topRight * (1 - v) + bottomLeft * (1 - u);
}

export function volcanoRadius(x: number, z: number): number {
  return Math.hypot(x, z) + 13 * Math.sin(x * 0.023 + z * 0.031) * Math.sin(z * 0.025 - x * 0.012);
}

function volcanoTop(radius: number): number {
  return 34 + 419 * Math.pow(clamp(1 - (radius - 113) / 249, 0, 1), 1.25);
}

// Positive density is rock. Ashmouth Caldera + 4 cardinal tunnels.
export function volcanoDensity(x: number, y: number, z: number, clearance = 0): number {
  const radius = volcanoRadius(x, z);
  const shell = Math.min(volcanoTop(radius) - y, 362 - radius, y - 15);
  const crater = Math.min(138 + (y - 47) * 0.12 - radius, y - 48);
  const crossAxis = Math.min(Math.abs(x), Math.abs(z));
  const along = Math.max(Math.abs(x), Math.abs(z));
  const center = VOLCANO.tunnelAltitude - (along - 140) * 0.07;
  const tunnel = (1 - Math.hypot(crossAxis / 49, (y - center) / 43)) * 43;
  return Math.min(shell, -Math.max(crater, tunnel)) + clearance;
}

// Glacier Vault on Frostline Reach: faceted ice dome with central cathedral atrium and 4 crystalline tunnels.
export function glacierRadius(x: number, z: number): number {
  return Math.hypot(x, z) + 16 * Math.cos(x * 0.028 - z * 0.021) * Math.sin(z * 0.024 + x * 0.017);
}

function glacierTop(radius: number): number {
  return 28 + 370 * Math.pow(clamp(1 - (radius - 95) / 238, 0, 1), 1.12);
}

export function glacierDensity(x: number, y: number, z: number, clearance = 0): number {
  const radius = glacierRadius(x, z);
  const shell = Math.min(glacierTop(radius) - y, 332 - radius, y - 14);
  // Vaulted dome interior (skylight opening at the very top)
  const atrium = Math.min(125 - radius * 0.92, 245 - y, y - 42);
  const skylight = Math.min(68 - radius, y - 180);
  const crossAxis = Math.min(Math.abs(x), Math.abs(z));
  const along = Math.max(Math.abs(x), Math.abs(z));
  const center = GLACIER_VAULT.tunnelAltitude - (along - 125) * 0.05;
  const tunnel = (1 - Math.hypot(crossAxis / 52, (y - center) / 46)) * 46;
  return Math.min(shell, -Math.max(atrium, skylight, tunnel)) + clearance;
}

export function height(x: number, z: number, map = 0): number {
  const ground = terrainHeight(x, z, map);
  if (map === 0 && Math.abs(x - VOLCANO.x) < 380 && Math.abs(z - VOLCANO.z) < 380) {
    const radius = volcanoRadius(x - VOLCANO.x, z - VOLCANO.z);
    return radius < 362 ? Math.max(ground, volcanoTop(radius)) : ground;
  }
  if (map === 1 && Math.abs(x - GLACIER_VAULT.x) < 355 && Math.abs(z - GLACIER_VAULT.z) < 355) {
    const radius = glacierRadius(x - GLACIER_VAULT.x, z - GLACIER_VAULT.z);
    return radius < 332 ? Math.max(ground, glacierTop(radius)) : ground;
  }
  return ground;
}

export function solidAt(x: number, y: number, z: number, map: number, clearance = 0): boolean {
  if (y <= terrainHeight(x, z, map) + clearance) return true;
  if (map === 0) {
    const vx = x - VOLCANO.x;
    const vz = z - VOLCANO.z;
    if (Math.abs(vx) < 390 && Math.abs(vz) < 390 && volcanoDensity(vx, y, vz, clearance) >= 0) {
      return true;
    }
  } else if (map === 1) {
    const gx = x - GLACIER_VAULT.x;
    const gz = z - GLACIER_VAULT.z;
    if (Math.abs(gx) < 360 && Math.abs(gz) < 360 && glacierDensity(gx, y, gz, clearance) >= 0) {
      return true;
    }
  }
  return false;
}

export function respawnPosition(position: Vec3, map: number): Vec3 {
  return [
    position[0],
    Math.max(position[1], height(position[0], position[2], map) + 95, 110),
    position[2],
  ];
}

export function forward(yaw: number, pitch = 0): Vec3 {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
export const dist3 = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
