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
      'Broken glacier shelves, snow peaks, and the dormant Glacier Vault caldera carved through cooled obsidian and arctic ice.',
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

export const VOLCANO = { x: 0, z: 0, radius: 360, tunnelAltitude: 137 };
export const GLACIER_VAULT = { x: 0, z: 0, radius: 330, tunnelAltitude: 124 };
export const CENTRAL_REFUEL_RADIUS = 54;

export function centralRefuelPosition(map: number): Vec3 {
  const landmark = map === 1 ? GLACIER_VAULT : VOLCANO;
  return [landmark.x, landmark.tunnelAltitude, landmark.z];
}

export const TERRAIN_SIZE = 4096;
export const TERRAIN_TEXELS = 1024;
export const TERRAIN_HEIGHT = 640;
export const TERRAIN_GRID = 8;
export const ELEVATION_SPAN = 8192;
export const ELEVATION_TEXELS = 1024;
export const ELEVATION_STEP = ELEVATION_SPAN / ELEVATION_TEXELS;

export interface DirtyBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface DirtyLandmarkBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface LandmarkCarve {
  x: number;
  y: number;
  z: number;
  radius: number;
  scorch: number;
}

const CHUNK_CELLS = 16;
const CHUNK_SIZE = CHUNK_CELLS * TERRAIN_GRID;
const MAX_CACHED_CHUNKS = 6000;
const chunkCaches: Array<Map<string, Uint8Array>> = [new Map(), new Map()];
const deformCaches: Array<Map<string, Float32Array>> = [new Map(), new Map()];
const scorchCaches: Array<Map<string, Uint8Array>> = [new Map(), new Map()];
const tiles: Array<Uint8Array | undefined> = [];
const terrainRevisions = [0, 0];
const terrainFullDirty = [false, false];
const dirtyTerrainBounds: Array<DirtyBounds | null> = [null, null];

const landmarkCarves: Array<LandmarkCarve[]> = [[], []];
const landmarkRevisions = [0, 0];
const landmarkFullDirty = [false, false];
const dirtyLandmarkBoxes: Array<DirtyLandmarkBox[]> = [[], []];

const smooth = (t: number): number => t * t * (3 - 2 * t);
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

// Aperiodic 2D integer-lattice hash (never wraps via period bitmask)
function hash2D(ix: number, iz: number, seed: number): number {
  let h =
    Math.imul(ix | 0, 374761393) +
    Math.imul(iz | 0, 668265263) +
    Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Continuous aperiodic 2D value noise
function noise2D(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const sx = fade(x - ix);
  const sz = fade(z - iz);
  const a = hash2D(ix, iz, seed);
  const b = hash2D(ix + 1, iz, seed);
  const c = hash2D(ix, iz + 1, seed);
  const d = hash2D(ix + 1, iz + 1, seed);
  return mix(mix(a, b, sx), mix(c, d, sx), sz);
}

// Rotated-octave aperiodic fBm to eliminate grid-aligned artifacts and repetition
function fbm2D(
  x: number,
  z: number,
  octaves: number,
  lacunarity: number,
  gain: number,
  seed: number
): number {
  let sum = 0;
  let amp = 1;
  let normFactor = 0;
  let px = x;
  let pz = z;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D(px, pz, seed + i * 131);
    normFactor += amp;
    const rx = (px * 0.8 + pz * 0.6) * lacunarity + 17.31;
    const rz = (-px * 0.6 + pz * 0.8) * lacunarity + 29.17;
    px = rx;
    pz = rz;
    amp *= gain;
  }
  return sum / normFactor;
}

function ridged2D(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let normFactor = 0;
  let px = x;
  let pz = z;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(2 * noise2D(px, pz, seed + i * 197) - 1);
    sum += amp * n;
    normFactor += amp;
    const rx = (px * 0.8 - pz * 0.6) * 2.07 + 11.43;
    const rz = (px * 0.6 + pz * 0.8) * 2.07 + 23.89;
    px = rx;
    pz = rz;
    amp *= 0.5;
  }
  return sum / normFactor;
}

function mountain(x: number, z: number, map: number): number {
  const seed = 97 + map * 1009;
  const warpX = (fbm2D(x * 0.00034, z * 0.00034, 3, 2.04, 0.5, seed + 47) - 0.5) * 640;
  const warpZ = (fbm2D(x * 0.00034, z * 0.00034, 3, 2.04, 0.5, seed + 91) - 0.5) * 640;
  const wx = x + warpX;
  const wz = z + warpZ;

  const ridge = ridged2D(wx * 0.00125, wz * 0.00125, 3, seed + 153);
  const broad = fbm2D(x * 0.00042, z * 0.00042, 3, 2.02, 0.5, seed + 18);
  const roughness = fbm2D(wx * 0.0031, wz * 0.0031, 3, 2.1, 0.5, seed + 290);
  const chains = clamp((broad - 0.21) * 1.65 + 0.18, 0, 1);
  const peaks =
    Math.pow(ridge, 3.5) *
    (118 + 280 * fbm2D(x * 0.00082, z * 0.00082, 2, 2.03, 0.5, seed + 119)) *
    chains;

  if (map === 0) {
    // Aperiodic meandering river gorge with varied width + branching canyons + plateaus
    const riverX = (fbm2D(z * 0.00031, x * 0.00011, 3, 2.03, 0.5, 401) - 0.5) * 1320;
    const canyonHalfW = 48 + fbm2D(x * 0.00062, z * 0.00062, 2, 2.05, 0.5, 503) * 112;
    const walls = smooth(clamp((Math.abs(x - riverX) - canyonHalfW - roughness * 24) / 118, 0, 1));

    const branchField = Math.abs(fbm2D(wx * 0.00047, wz * 0.00047, 3, 2.04, 0.5, 607) - 0.5) * 2;
    const branchWidth = 0.03 + fbm2D(x * 0.0009, z * 0.0009, 2, 2.0, 0.5, 709) * 0.08;
    const ravine = smooth(clamp((branchField - branchWidth) * 6.5, 0, 1));

    const rawElev = 44 + broad * 82 + peaks + roughness * 54;
    const plateauStep = 52;
    const plateauElev = Math.floor(rawElev / plateauStep) * plateauStep + 18;
    const plateauMask =
      smooth(clamp((fbm2D(x * 0.00054, z * 0.00054, 2, 2.0, 0.5, 811) - 0.36) * 3.4, 0, 1)) * 0.52;
    const sculpted = mix(rawElev, plateauElev, plateauMask);

    const ground = 8 + walls * sculpted * mix(0.24, 1, ravine);
    const distance = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    const crossAxis = Math.min(Math.abs(x - VOLCANO.x), Math.abs(z - VOLCANO.z));
    const approach =
      (1 - smooth(clamp((crossAxis - 44) / 72, 0, 1))) *
      (1 - smooth(clamp((distance - 470) / 110, 0, 1)));
    const surroundings = smooth(clamp((distance - 280) / 160, 0, 1));
    return mix(30, ground, surroundings * (1 - approach));
  }

  // Frostline Reach: elevation-driven arctic ocean channels, glacier shelves, plateaus, and alpine peaks
  const coast = clamp(
    (broad + 0.24 * (fbm2D(wx * 0.00092, wz * 0.00092, 2, 2.02, 0.5, seed + 76) - 0.5) - 0.37) * 5.3,
    0,
    1
  );
  const shelfRaw = 24 + peaks * 1.18 + ridge * 46 + roughness * 84;
  const icePlateau = Math.floor(shelfRaw / 58) * 58 + 24;
  const shelfMask =
    smooth(clamp((fbm2D(x * 0.00058, z * 0.00058, 2, 2.0, 0.5, seed + 412) - 0.4) * 3.2, 0, 1)) * 0.42;
  const baseIce = coast * mix(shelfRaw, icePlateau, shelfMask);

  // Clear smooth approaches around Glacier Vault dormant volcano at [0, 0]
  const gDist = Math.hypot(x - GLACIER_VAULT.x, z - GLACIER_VAULT.z);
  const gCross = Math.min(Math.abs(x - GLACIER_VAULT.x), Math.abs(z - GLACIER_VAULT.z));
  const gApproach =
    (1 - smooth(clamp((gCross - 46) / 72, 0, 1))) *
    (1 - smooth(clamp((gDist - 450) / 105, 0, 1)));
  const gSurround = smooth(clamp((gDist - 265) / 150, 0, 1));
  return mix(24, baseIce, gSurround * (1 - gApproach));
}

function mapIndex(map: number): number {
  return map === 1 ? 1 : 0;
}

function getTerrainChunk(map: number, cx: number, cz: number): Uint8Array {
  const m = mapIndex(map);
  const cache = chunkCaches[m];
  const key = `${cx},${cz}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const chunk = new Uint8Array(CHUNK_CELLS * CHUNK_CELLS);
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  for (let lz = 0; lz < CHUNK_CELLS; lz++) {
    const wz = baseZ + lz * TERRAIN_GRID;
    const rowOff = lz * CHUNK_CELLS;
    for (let lx = 0; lx < CHUNK_CELLS; lx++) {
      const wx = baseX + lx * TERRAIN_GRID;
      chunk[rowOff + lx] = Math.round(
        (clamp(mountain(wx, wz, m), 0, TERRAIN_HEIGHT) * 255) / TERRAIN_HEIGHT
      );
    }
  }
  cache.set(key, chunk);
  if (cache.size > MAX_CACHED_CHUNKS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return chunk;
}

function getOrCreateDeformChunk(m: number, key: string): Float32Array {
  let chunk = deformCaches[m].get(key);
  if (!chunk) {
    chunk = new Float32Array(CHUNK_CELLS * CHUNK_CELLS);
    deformCaches[m].set(key, chunk);
  }
  return chunk;
}

function getOrCreateScorchChunk(m: number, key: string): Uint8Array {
  let chunk = scorchCaches[m].get(key);
  if (!chunk) {
    chunk = new Uint8Array(CHUNK_CELLS * CHUNK_CELLS);
    scorchCaches[m].set(key, chunk);
  }
  return chunk;
}

function cellCoords(wx: number, wz: number): { cx: number; cz: number; idx: number } {
  const gx = Math.round(wx / TERRAIN_GRID);
  const gz = Math.round(wz / TERRAIN_GRID);
  const cx = Math.floor(gx / CHUNK_CELLS);
  const cz = Math.floor(gz / CHUNK_CELLS);
  const lx = gx - cx * CHUNK_CELLS;
  const lz = gz - cz * CHUNK_CELLS;
  return { cx, cz, idx: lz * CHUNK_CELLS + lx };
}

function liveElevationByte(m: number, wx: number, wz: number): number {
  const { cx, cz, idx } = cellCoords(wx, wz);
  const key = `${cx},${cz}`;
  const baseByte = getTerrainChunk(m, cx, cz)[idx];
  const deformChunk = deformCaches[m].get(key);
  if (!deformChunk) return baseByte;
  const deform = deformChunk[idx];
  if (deform <= 0) return baseByte;
  const rawH = (baseByte * TERRAIN_HEIGHT) / 255;
  const baseH = Math.max(10, Math.floor(rawH / 4) * 4);
  const effectiveH = Math.max(10, baseH - deform);
  return Math.round((clamp(effectiveH, 0, TERRAIN_HEIGHT) * 255) / TERRAIN_HEIGHT);
}

function liveScorchByte(m: number, wx: number, wz: number): number {
  const { cx, cz, idx } = cellCoords(wx, wz);
  const scorchChunk = scorchCaches[m].get(`${cx},${cz}`);
  return scorchChunk ? scorchChunk[idx] : 0;
}

export function getTerrainRevision(map: number): number {
  return terrainRevisions[mapIndex(map)];
}

export function consumeTerrainDirty(map: number): { full: boolean; bounds: DirtyBounds | null } {
  const m = mapIndex(map);
  const full = terrainFullDirty[m];
  const bounds = dirtyTerrainBounds[m];
  terrainFullDirty[m] = false;
  dirtyTerrainBounds[m] = null;
  return { full, bounds };
}

export function getLandmarkRevision(map: number): number {
  return landmarkRevisions[mapIndex(map)];
}

export function consumeLandmarkDirty(map: number): { full: boolean; boxes: DirtyLandmarkBox[] } {
  const m = mapIndex(map);
  const full = landmarkFullDirty[m];
  const boxes = dirtyLandmarkBoxes[m];
  landmarkFullDirty[m] = false;
  dirtyLandmarkBoxes[m] = [];
  return { full, boxes };
}

export function applyTerrainImpact(
  x: number,
  z: number,
  radius: number,
  depth: number,
  scorch: number,
  map: number
): boolean {
  if (radius <= 0 || (depth <= 0 && scorch <= 0)) return false;
  const m = mapIndex(map);
  const minGx = Math.floor((x - radius) / TERRAIN_GRID);
  const maxGx = Math.ceil((x + radius) / TERRAIN_GRID);
  const minGz = Math.floor((z - radius) / TERRAIN_GRID);
  const maxGz = Math.ceil((z + radius) / TERRAIN_GRID);

  let changed = false;
  for (let gz = minGz; gz <= maxGz; gz++) {
    const wz = gz * TERRAIN_GRID;
    const dz = wz - z;
    const cz = Math.floor(gz / CHUNK_CELLS);
    const lz = gz - cz * CHUNK_CELLS;
    for (let gx = minGx; gx <= maxGx; gx++) {
      const wx = gx * TERRAIN_GRID;
      const dist = Math.hypot(wx - x, dz);
      if (dist > radius) continue;

      const t = dist / radius;
      const depthFalloff = smooth(clamp(1 - t, 0, 1));
      const scorchFalloff = smooth(clamp(1 - t * 0.92, 0, 1));

      const cx = Math.floor(gx / CHUNK_CELLS);
      const lx = gx - cx * CHUNK_CELLS;
      const key = `${cx},${cz}`;
      const idx = lz * CHUNK_CELLS + lx;

      if (depth > 0) {
        const baseChunk = getTerrainChunk(m, cx, cz);
        const rawH = (baseChunk[idx] * TERRAIN_HEIGHT) / 255;
        const baseH = Math.max(10, Math.floor(rawH / 4) * 4);
        const maxCarve = Math.max(0, baseH - 10);
        if (maxCarve > 0) {
          const deformChunk = getOrCreateDeformChunk(m, key);
          const nextDeform = Math.min(maxCarve, deformChunk[idx] + depth * depthFalloff);
          if (nextDeform > deformChunk[idx]) {
            deformChunk[idx] = nextDeform;
            changed = true;
          }
        }
      }

      if (scorch > 0) {
        const scorchByte = Math.round(clamp(scorch * scorchFalloff, 0, 1) * 255);
        if (scorchByte > 0) {
          const scorchChunk = getOrCreateScorchChunk(m, key);
          if (scorchByte > scorchChunk[idx]) {
            scorchChunk[idx] = scorchByte;
            changed = true;
          }
        }
      }
    }
  }

  if (changed) {
    tiles[m] = undefined;
    terrainRevisions[m]++;
    const pad = TERRAIN_GRID;
    const minX = minGx * TERRAIN_GRID - pad;
    const minZ = minGz * TERRAIN_GRID - pad;
    const maxX = maxGx * TERRAIN_GRID + pad;
    const maxZ = maxGz * TERRAIN_GRID + pad;
    const prev = dirtyTerrainBounds[m];
    if (prev) {
      prev.minX = Math.min(prev.minX, minX);
      prev.minZ = Math.min(prev.minZ, minZ);
      prev.maxX = Math.max(prev.maxX, maxX);
      prev.maxZ = Math.max(prev.maxZ, maxZ);
    } else {
      dirtyTerrainBounds[m] = { minX, minZ, maxX, maxZ };
    }
  }
  return changed;
}

export function resetTerrainDamage(map?: number): void {
  const targets = map === undefined ? [0, 1] : [mapIndex(map)];
  for (const m of targets) {
    deformCaches[m].clear();
    scorchCaches[m].clear();
    tiles[m] = undefined;
    dirtyTerrainBounds[m] = null;
    terrainFullDirty[m] = true;
    terrainRevisions[m]++;

    landmarkCarves[m] = [];
    dirtyLandmarkBoxes[m] = [];
    landmarkFullDirty[m] = true;
    landmarkRevisions[m]++;
  }
}

export function scorchAt(x: number, z: number, map: number): number {
  return liveScorchByte(mapIndex(map), x, z) / 255;
}

export function sampleElevationWindow(
  map: number,
  originX: number,
  originZ: number,
  texels = ELEVATION_TEXELS,
  step = ELEVATION_STEP,
  out?: Uint8Array
): Uint8Array {
  const m = mapIndex(map);
  const buf = out && out.length === texels * texels ? out : new Uint8Array(texels * texels);
  if (
    step === TERRAIN_GRID &&
    originX % CHUNK_SIZE === 0 &&
    originZ % CHUNK_SIZE === 0 &&
    texels % CHUNK_CELLS === 0
  ) {
    const chunksPerSide = texels / CHUNK_CELLS;
    const startCx = originX / CHUNK_SIZE;
    const startCz = originZ / CHUNK_SIZE;
    for (let czOff = 0; czOff < chunksPerSide; czOff++) {
      const baseRow = czOff * CHUNK_CELLS;
      for (let cxOff = 0; cxOff < chunksPerSide; cxOff++) {
        const cx = startCx + cxOff;
        const cz = startCz + czOff;
        const baseChunk = getTerrainChunk(m, cx, cz);
        const deformChunk = deformCaches[m].get(`${cx},${cz}`);
        const baseCol = cxOff * CHUNK_CELLS;
        for (let lz = 0; lz < CHUNK_CELLS; lz++) {
          const rowDst = (baseRow + lz) * texels + baseCol;
          const rowSrc = lz * CHUNK_CELLS;
          if (!deformChunk) {
            buf.set(baseChunk.subarray(rowSrc, rowSrc + CHUNK_CELLS), rowDst);
          } else {
            for (let lx = 0; lx < CHUNK_CELLS; lx++) {
              const deform = deformChunk[rowSrc + lx];
              if (deform <= 0) {
                buf[rowDst + lx] = baseChunk[rowSrc + lx];
              } else {
                const rawH = (baseChunk[rowSrc + lx] * TERRAIN_HEIGHT) / 255;
                const baseH = Math.max(10, Math.floor(rawH / 4) * 4);
                buf[rowDst + lx] = Math.round(
                  (clamp(Math.max(10, baseH - deform), 0, TERRAIN_HEIGHT) * 255) / TERRAIN_HEIGHT
                );
              }
            }
          }
        }
      }
    }
    return buf;
  }
  for (let row = 0; row < texels; row++) {
    const wz = originZ + row * step;
    const rowOff = row * texels;
    for (let col = 0; col < texels; col++) {
      const wx = originX + col * step;
      buf[rowOff + col] = liveElevationByte(m, wx, wz);
    }
  }
  return buf;
}

export function sampleElevationRGWindow(
  map: number,
  originX: number,
  originZ: number,
  texels = ELEVATION_TEXELS,
  step = ELEVATION_STEP,
  out?: Uint8Array
): Uint8Array {
  const m = mapIndex(map);
  const buf = out && out.length === texels * texels * 2 ? out : new Uint8Array(texels * texels * 2);
  if (
    step === TERRAIN_GRID &&
    originX % CHUNK_SIZE === 0 &&
    originZ % CHUNK_SIZE === 0 &&
    texels % CHUNK_CELLS === 0
  ) {
    const chunksPerSide = texels / CHUNK_CELLS;
    const startCx = originX / CHUNK_SIZE;
    const startCz = originZ / CHUNK_SIZE;
    for (let czOff = 0; czOff < chunksPerSide; czOff++) {
      const baseRow = czOff * CHUNK_CELLS;
      for (let cxOff = 0; cxOff < chunksPerSide; cxOff++) {
        const cx = startCx + cxOff;
        const cz = startCz + czOff;
        const key = `${cx},${cz}`;
        const baseChunk = getTerrainChunk(m, cx, cz);
        const deformChunk = deformCaches[m].get(key);
        const scorchChunk = scorchCaches[m].get(key);
        const baseCol = cxOff * CHUNK_CELLS;
        for (let lz = 0; lz < CHUNK_CELLS; lz++) {
          const rowDst = ((baseRow + lz) * texels + baseCol) * 2;
          const rowSrc = lz * CHUNK_CELLS;
          for (let lx = 0; lx < CHUNK_CELLS; lx++) {
            const idx = rowSrc + lx;
            let elevByte = baseChunk[idx];
            if (deformChunk && deformChunk[idx] > 0) {
              const rawH = (elevByte * TERRAIN_HEIGHT) / 255;
              const baseH = Math.max(10, Math.floor(rawH / 4) * 4);
              elevByte = Math.round(
                (clamp(Math.max(10, baseH - deformChunk[idx]), 0, TERRAIN_HEIGHT) * 255) / TERRAIN_HEIGHT
              );
            }
            buf[rowDst + lx * 2] = elevByte;
            buf[rowDst + lx * 2 + 1] = scorchChunk ? scorchChunk[idx] : 0;
          }
        }
      }
    }
    return buf;
  }
  for (let row = 0; row < texels; row++) {
    const wz = originZ + row * step;
    const rowOff = row * texels * 2;
    for (let col = 0; col < texels; col++) {
      const wx = originX + col * step;
      buf[rowOff + col * 2] = liveElevationByte(m, wx, wz);
      buf[rowOff + col * 2 + 1] = liveScorchByte(m, wx, wz);
    }
  }
  return buf;
}

export function sampleElevationRGRect(
  map: number,
  originX: number,
  originZ: number,
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
  texels = ELEVATION_TEXELS,
  step = ELEVATION_STEP,
  fullBuffer?: Uint8Array,
  subOut?: Uint8Array
): Uint8Array {
  const m = mapIndex(map);
  const subW = maxCol - minCol + 1;
  const subH = maxRow - minRow + 1;
  const sub = subOut && subOut.length >= subW * subH * 2 ? subOut : new Uint8Array(subW * subH * 2);
  for (let r = 0; r < subH; r++) {
    const row = minRow + r;
    const wz = originZ + row * step;
    for (let c = 0; c < subW; c++) {
      const col = minCol + c;
      const wx = originX + col * step;
      const elevByte = liveElevationByte(m, wx, wz);
      const scorchByte = liveScorchByte(m, wx, wz);
      const subIdx = (r * subW + c) * 2;
      sub[subIdx] = elevByte;
      sub[subIdx + 1] = scorchByte;
      if (fullBuffer) {
        const fullIdx = (row * texels + col) * 2;
        fullBuffer[fullIdx] = elevByte;
        fullBuffer[fullIdx + 1] = scorchByte;
      }
    }
  }
  return sub;
}

export function terrainTile(map: number): Uint8Array {
  const existing = tiles[map];
  if (existing) return existing;
  const tile = sampleElevationWindow(
    map,
    -TERRAIN_SIZE / 2,
    -TERRAIN_SIZE / 2,
    TERRAIN_TEXELS,
    TERRAIN_SIZE / TERRAIN_TEXELS
  );
  tiles[map] = tile;
  return tile;
}

function gridHeight(x: number, z: number, map: number): number {
  const m = mapIndex(map);
  const { cx, cz, idx } = cellCoords(x, z);
  const chunk = getTerrainChunk(m, cx, cz);
  const rawH = (chunk[idx] * TERRAIN_HEIGHT) / 255;
  const baseH = Math.max(10, Math.floor(rawH / 4) * 4);
  const deformChunk = deformCaches[m].get(`${cx},${cz}`);
  if (!deformChunk) return baseH;
  const deform = deformChunk[idx];
  return deform > 0 ? Math.max(10, baseH - deform) : baseH;
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

function landmarkCarveOffset(localX: number, y: number, localZ: number, map: number): number {
  const carves = landmarkCarves[mapIndex(map)];
  let offset = 0;
  for (let i = 0; i < carves.length; i++) {
    const c = carves[i];
    const d = Math.hypot(localX - c.x, y - c.y, localZ - c.z);
    if (d < c.radius) {
      offset += c.radius - d;
    }
  }
  return Math.min(84, offset);
}

export function landmarkScorchAt(localX: number, y: number, localZ: number, map: number): number {
  const carves = landmarkCarves[mapIndex(map)];
  let intensity = 0;
  for (let i = 0; i < carves.length; i++) {
    const c = carves[i];
    const rimRadius = c.radius * 1.45;
    const d = Math.hypot(localX - c.x, y - c.y, localZ - c.z);
    if (d < rimRadius) {
      const s = c.scorch * smooth(clamp(1 - d / rimRadius, 0, 1));
      if (s > intensity) intensity = s;
    }
  }
  return intensity;
}

export function carveLandmark(
  x: number,
  y: number,
  z: number,
  radius: number,
  scorch = 0.85,
  map = 0
): boolean {
  if (radius <= 0) return false;
  const m = mapIndex(map);
  const lm = m === 1 ? GLACIER_VAULT : VOLCANO;
  const lx = x - lm.x;
  const lz = z - lm.z;
  if (Math.hypot(lx, lz) > lm.radius + radius + 30 || y < 10 || y > 480) {
    return false;
  }
  const carves = landmarkCarves[m];
  const existing = carves.find(
    (c) => Math.hypot(c.x - lx, c.y - y, c.z - lz) < 4 && c.radius >= radius
  );
  if (existing) {
    existing.scorch = Math.max(existing.scorch, scorch);
    existing.radius = Math.min(48, existing.radius + radius * 0.25);
  } else {
    if (carves.length >= 128) carves.shift();
    carves.push({ x: lx, y, z: lz, radius, scorch });
  }
  const pad = radius + 14;
  dirtyLandmarkBoxes[m].push({
    minX: lx - pad,
    minY: y - pad,
    minZ: lz - pad,
    maxX: lx + pad,
    maxY: y + pad,
    maxZ: lz + pad,
  });
  landmarkRevisions[m]++;
  return true;
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
  const base = Math.min(shell, -Math.max(crater, tunnel));
  return base - landmarkCarveOffset(x, y, z, 0) + clearance;
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
  const base = Math.min(shell, -Math.max(atrium, skylight, tunnel));
  return base - landmarkCarveOffset(x, y, z, 1) + clearance;
}

export function landmarkDensityAt(x: number, y: number, z: number, map: number, clearance = 0): number {
  if (map === 0) {
    const vx = x - VOLCANO.x;
    const vz = z - VOLCANO.z;
    if (Math.abs(vx) < 390 && Math.abs(vz) < 390) {
      return volcanoDensity(vx, y, vz, clearance);
    }
  } else if (map === 1) {
    const gx = x - GLACIER_VAULT.x;
    const gz = z - GLACIER_VAULT.z;
    if (Math.abs(gx) < 360 && Math.abs(gz) < 360) {
      return glacierDensity(gx, y, gz, clearance);
    }
  }
  return -999;
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
  return landmarkDensityAt(x, y, z, map, clearance) >= 0;
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
