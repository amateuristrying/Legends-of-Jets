export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const mix = (from, to, amount) => from + (to - from) * amount;

export const maps = [
  {
    id: 0,
    name: 'Ember Canyon',
    region: 'THE RED FRONTIER',
    landmarkName: 'Ashmouth Caldera',
    description: 'Jagged sandstone canyons and Ashmouth Caldera. Four volcanic tunnels cut through its glowing rim.',
  },
  {
    id: 1,
    name: 'Frostline Reach',
    region: 'THE NORTHERN FRONT',
    landmarkName: 'Glacier Vault',
    description: 'Broken glacier shelves, snow peaks, and the dormant Glacier Vault caldera carved through cooled obsidian and arctic ice.',
  },
];

export const planes = [
  {
    id: 0,
    name: 'Needle F-5',
    role: 'LIGHT INTERCEPTOR',
    description: 'Slim, razor-agile twin-engine interceptor with rapid-fire cannon and crisp cornering.',
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
    color: [0.65, 0.72, 0.75],
    accent: [1, 0.32, 0.12],
  },
  {
    id: 1,
    name: 'Mirage M-III',
    role: 'HEAVY DELTA STRIKER',
    description: 'Broad delta wing with reinforced hull, heavy rocket pod, and steady ground-attack stability.',
    speed: 90,
    turn: 0.9,
    size: 1.12,
    hull: 135,
    fuelCapacity: 300,
    missiles: 3,
    rockets: 12,
    flares: 4,
    gunRate: 0.105,
    gunHeatPerShot: 0.056,
    stealthFactor: 1.0,
    color: [0.71, 0.64, 0.48],
    accent: [1, 0.65, 0.16],
  },
  {
    id: 2,
    name: 'Spectre SU-27',
    role: 'AIR SUPERIORITY',
    description: 'Wide swept wings, twin tails, and twin afterburners built for high-speed BVR dominance.',
    speed: 118,
    turn: 1.08,
    size: 1.16,
    hull: 115,
    fuelCapacity: 340,
    missiles: 3,
    rockets: 8,
    flares: 5,
    gunRate: 0.095,
    gunHeatPerShot: 0.055,
    stealthFactor: 0.95,
    color: [0.4, 0.57, 0.65],
    accent: [0.28, 0.85, 0.88],
  },
  {
    id: 3,
    name: 'Wraith YF-23',
    role: 'STEALTH INTERCEPTOR',
    description: 'Diamond-wing low-observable striker. Cuts enemy missile lock range by 35% with blazing top speed.',
    speed: 124,
    turn: 1.16,
    size: 1.06,
    hull: 105,
    fuelCapacity: 280,
    missiles: 3,
    rockets: 8,
    flares: 6,
    gunRate: 0.09,
    gunHeatPerShot: 0.048,
    stealthFactor: 0.65,
    color: [0.26, 0.3, 0.36],
    accent: [0.55, 0.92, 1.0],
  },
  {
    id: 4,
    name: 'Valkyrie XV-9',
    role: 'ACE EXPERIMENTAL',
    description: 'Twin-boom forward-swept prototype with six-missile rack, rapid gun cooling, and unmatched energy.',
    speed: 128,
    turn: 1.32,
    size: 1.14,
    hull: 125,
    fuelCapacity: 320,
    missiles: 3,
    rockets: 12,
    flares: 6,
    gunRate: 0.08,
    gunHeatPerShot: 0.042,
    stealthFactor: 0.82,
    color: [0.85, 0.84, 0.8],
    accent: [1.0, 0.24, 0.36],
  },
];

export const VOLCANO = { x: 0, z: 0, radius: 360, tunnelAltitude: 137 };
export const GLACIER_VAULT = { x: 0, z: 0, radius: 330, tunnelAltitude: 124 };
export const CENTRAL_REFUEL_RADIUS = 54;

export function centralRefuelPosition(map = 0) {
  const landmark = map === 1 ? GLACIER_VAULT : VOLCANO;
  return [landmark.x, landmark.tunnelAltitude, landmark.z];
}

export const TERRAIN_SIZE = 4096;
export const TERRAIN_TEXELS = 1024;
export const TERRAIN_HEIGHT = 640;
export const TERRAIN_GRID = 8;

const CHUNK_CELLS = 16;
const CHUNK_SIZE = CHUNK_CELLS * TERRAIN_GRID;
const MAX_CACHED_CHUNKS = 6000;
const chunkCaches = [new Map(), new Map()];
const tiles = [];

const smooth = t => t * t * (3 - 2 * t);
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

function hash2D(ix, iz, seed) {
  let h =
    Math.imul(ix | 0, 374761393) +
    Math.imul(iz | 0, 668265263) +
    Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise2D(x, z, seed) {
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

function fbm2D(x, z, octaves, lacunarity, gain, seed) {
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

function ridged2D(x, z, octaves, seed) {
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

function mountain(x, z, map) {
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

  const gDist = Math.hypot(x - GLACIER_VAULT.x, z - GLACIER_VAULT.z);
  const gCross = Math.min(Math.abs(x - GLACIER_VAULT.x), Math.abs(z - GLACIER_VAULT.z));
  const gApproach =
    (1 - smooth(clamp((gCross - 46) / 72, 0, 1))) *
    (1 - smooth(clamp((gDist - 450) / 105, 0, 1)));
  const gSurround = smooth(clamp((gDist - 265) / 150, 0, 1));
  return mix(24, baseIce, gSurround * (1 - gApproach));
}

function mapIndex(map) {
  return map === 1 ? 1 : 0;
}

function getTerrainChunk(map, cx, cz) {
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

function cellCoords(wx, wz) {
  const gx = Math.round(wx / TERRAIN_GRID);
  const gz = Math.round(wz / TERRAIN_GRID);
  const cx = Math.floor(gx / CHUNK_CELLS);
  const cz = Math.floor(gz / CHUNK_CELLS);
  const lx = gx - cx * CHUNK_CELLS;
  const lz = gz - cz * CHUNK_CELLS;
  return { cx, cz, idx: lz * CHUNK_CELLS + lx };
}

export function terrainTile(map) {
  const m = mapIndex(map);
  if (tiles[m]) return tiles[m];
  const tile = new Uint8Array(TERRAIN_TEXELS ** 2);
  const step = TERRAIN_SIZE / TERRAIN_TEXELS;
  for (let row = 0; row < TERRAIN_TEXELS; row++) {
    const wz = -TERRAIN_SIZE / 2 + row * step;
    const rowOff = row * TERRAIN_TEXELS;
    for (let col = 0; col < TERRAIN_TEXELS; col++) {
      const wx = -TERRAIN_SIZE / 2 + col * step;
      const { cx, cz, idx } = cellCoords(wx, wz);
      tile[rowOff + col] = getTerrainChunk(m, cx, cz)[idx];
    }
  }
  tiles[m] = tile;
  return tile;
}

function gridHeight(x, z, map) {
  const m = mapIndex(map);
  const { cx, cz, idx } = cellCoords(x, z);
  const chunk = getTerrainChunk(m, cx, cz);
  const rawH = (chunk[idx] * TERRAIN_HEIGHT) / 255;
  return Math.max(10, Math.floor(rawH / 4) * 4);
}

// Match the two fixed triangles in each render cell, including their shared diagonal.
export function terrainHeight(x, z, map) {
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

export function volcanoRadius(x, z) {
  return Math.hypot(x, z) + 13 * Math.sin(x * 0.023 + z * 0.031) * Math.sin(z * 0.025 - x * 0.012);
}

function volcanoTop(radius) {
  return 34 + 419 * Math.pow(clamp(1 - (radius - 113) / 249, 0, 1), 1.25);
}

// Positive density is rock. Ashmouth Caldera + 4 cardinal tunnels.
export function volcanoDensity(x, y, z, clearance = 0) {
  const radius = volcanoRadius(x, z);
  const shell = Math.min(volcanoTop(radius) - y, 362 - radius, y - 15);
  const crater = Math.min(138 + (y - 47) * 0.12 - radius, y - 48);
  const crossAxis = Math.min(Math.abs(x), Math.abs(z));
  const along = Math.max(Math.abs(x), Math.abs(z));
  const center = VOLCANO.tunnelAltitude - (along - 140) * 0.07;
  const tunnel = (1 - Math.hypot(crossAxis / 49, (y - center) / 43)) * 43;
  return Math.min(shell, -Math.max(crater, tunnel)) + clearance;
}

export function glacierRadius(x, z) {
  return Math.hypot(x, z) + 16 * Math.cos(x * 0.028 - z * 0.021) * Math.sin(z * 0.024 + x * 0.017);
}

function glacierTop(radius) {
  return 28 + 370 * Math.pow(clamp(1 - (radius - 95) / 238, 0, 1), 1.12);
}

// Dormant Glacier Vault on Frostline Reach: faceted ice dome with central atrium, skylight, and 4 tunnels.
export function glacierDensity(x, y, z, clearance = 0) {
  const radius = glacierRadius(x, z);
  const shell = Math.min(glacierTop(radius) - y, 332 - radius, y - 14);
  const atrium = Math.min(125 - radius * 0.92, 245 - y, y - 42);
  const skylight = Math.min(68 - radius, y - 180);
  const crossAxis = Math.min(Math.abs(x), Math.abs(z));
  const along = Math.max(Math.abs(x), Math.abs(z));
  const center = GLACIER_VAULT.tunnelAltitude - (along - 125) * 0.05;
  const tunnel = (1 - Math.hypot(crossAxis / 52, (y - center) / 46)) * 46;
  return Math.min(shell, -Math.max(atrium, skylight, tunnel)) + clearance;
}

export function landmarkDensityAt(x, y, z, map, clearance = 0) {
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

export function height(x, z, map = 0) {
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

export function solidAt(x, y, z, map, clearance = 0) {
  if (y <= terrainHeight(x, z, map) + clearance) return true;
  return landmarkDensityAt(x, y, z, map, clearance) >= 0;
}

export function respawnPosition(position, map) {
  return [position[0], Math.max(position[1], height(position[0], position[2], map) + 95, 110), position[2]];
}

export function forward(yaw, pitch = 0) {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, factor) => [a[0] * factor, a[1] * factor, a[2] * factor];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
