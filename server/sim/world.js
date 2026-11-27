export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const mix = (from, to, amount) => from + (to - from) * amount;
export const maps = [
  { name: 'Ember Canyon', region: 'THE RED FRONTIER', description: 'Jagged sandstone canyons and Ashmouth Caldera. Four tunnels cut through its volcanic rim.' },
  { name: 'Frostline Reach', region: 'THE NORTHERN FRONT', description: 'Broken glacier shelves, clustered peaks, and narrow channels through the ice.' },
];
export const planes = [
  { name: 'Needle F-5', role: 'LIGHT INTERCEPTOR', description: 'A slim, quick-turning twin-engine interceptor.', speed: 100, turn: 1.25, size: .85, color: [.65,.72,.75], accent: [1,.32,.12] },
  { name: 'Mirage M-III', role: 'HEAVY DELTA', description: 'A broad delta wing. Heavy presence, deliberate handling.', speed: 86, turn: .85, size: 1.12, color: [.71,.64,.48], accent: [1,.65,.16] },
  { name: 'Spectre SU-27', role: 'MODERN AIR SUPERIORITY', description: 'Wide swept wings, twin tails, and powerful afterburners.', speed: 116, turn: 1.05, size: 1.16, color: [.40,.57,.65], accent: [.28,.85,.88] },
];

export const VOLCANO = { x: 0, z: 1080, radius: 360, tunnelAltitude: 137 };
export const TERRAIN_SIZE = 4096;
export const TERRAIN_TEXELS = 1024;
export const TERRAIN_HEIGHT = 640;
export const TERRAIN_GRID = 8;
const tiles = [];
const mask = TERRAIN_TEXELS - 1;
const smooth = t => t * t * (3 - 2 * t);

function noise(x, z, period, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const sx = smooth(x - ix), sz = smooth(z - iz);
  const sample = (x, z) => {
    let hash = Math.imul(x & (period - 1), 374761393) + Math.imul(z & (period - 1), 668265263) + seed;
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
  };
  return mix(mix(sample(ix, iz), sample(ix + 1, iz), sx), mix(sample(ix, iz + 1), sample(ix + 1, iz + 1), sx), sz);
}

function mountain(x, z, map) {
  const u = x / TERRAIN_SIZE, v = z / TERRAIN_SIZE;
  const sample = (f, salt, du = 0, dv = 0) => noise((u + du) * f, (v + dv) * f, f, salt + map * 197);
  const warpX = (sample(8, 47) - .5) * .14;
  const warpZ = (sample(8, 91) - .5) * .14;
  const ridge = 1 - Math.abs(2 * sample(16, 153, warpX, warpZ) - 1);
  const roughness = sample(64, 290, warpX, warpZ) * .67 + sample(128, 342) * .33;
  const broad = sample(8, 18);
  const chains = clamp((broad - .20) * 1.6 + .16, 0, 1);
  const peaks = Math.pow(ridge, 4.2) * (112 + 295 * sample(16, 119)) * chains;
  if (map === 0) {
    const river = 132 * Math.sin(v * 4 * Math.PI) + 66 * Math.sin(v * 10 * Math.PI);
    const dx = Math.abs(((x - river + 2048) % 4096 + 4096) % 4096 - 2048);
    const walls = smooth(clamp((dx - 51 - roughness * 30) / 112, 0, 1));
    const ravine = smooth(clamp((Math.abs(sample(16, 34, warpX) - .5) - .025) * 7, 0, 1));
    const distance = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    const ground = 8 + walls * (42 + broad * 72 + peaks + roughness * 56) * mix(.25, 1, ravine);
    const crossAxis = Math.min(Math.abs(x - VOLCANO.x), Math.abs(z - VOLCANO.z));
    const approach = (1 - smooth(clamp((crossAxis - 42) / 71, 0, 1))) *
      (1 - smooth(clamp((distance - 452) / 104, 0, 1)));
    const surroundings = smooth(clamp((distance - 280) / 155, 0, 1));
    return mix(32, ground, surroundings * (1 - approach));
  }
  const coast = clamp((broad + .20 * (sample(32, 76, warpX, warpZ) - .5) - .39) * 5.7, 0, 1);
  return coast * (23 + peaks * 1.22 + ridge * 43 + roughness * 89);
}

export function terrainTile(map) {
  if (tiles[map]) return tiles[map];
  const tile = new Uint8Array(TERRAIN_TEXELS ** 2);
  const cell = TERRAIN_SIZE / TERRAIN_TEXELS;
  // Store one seamless elevation tile. GPU terrain and CPU collision sample the same bytes.
  for (let row = 0; row < TERRAIN_TEXELS; row++) {
    let z = (row + .5) * cell;
    if (z >= TERRAIN_SIZE / 2) z -= TERRAIN_SIZE;
    for (let col = 0; col < TERRAIN_TEXELS; col++) {
      let x = (col + .5) * cell;
      if (x >= TERRAIN_SIZE / 2) x -= TERRAIN_SIZE;
      tile[row * TERRAIN_TEXELS + col] = Math.round(clamp(mountain(x, z, map), 0, TERRAIN_HEIGHT) * 255 / TERRAIN_HEIGHT);
    }
  }
  tiles[map] = tile;
  return tile;
}

function baseHeight(x, z, map) {
  const tile = terrainTile(map);
  const px = x * TERRAIN_TEXELS / TERRAIN_SIZE - .5;
  const pz = z * TERRAIN_TEXELS / TERRAIN_SIZE - .5;
  const left = Math.floor(px), top = Math.floor(pz);
  const sx = px - left, sz = pz - top;
  const a = (top & mask) * TERRAIN_TEXELS, b = ((top + 1) & mask) * TERRAIN_TEXELS;
  const l = left & mask, r = (left + 1) & mask;
  return mix(mix(tile[a + l], tile[a + r], sx), mix(tile[b + l], tile[b + r], sx), sz) * TERRAIN_HEIGHT / 255;
}

function gridHeight(x, z, map) {
  return Math.max(10, Math.floor(baseHeight(x, z, map) / 4) * 4);
}

// Match the two fixed triangles in each render cell, including their shared diagonal.
export function terrainHeight(x, z, map) {
  const step = TERRAIN_GRID;
  const left = Math.floor(x / step) * step, top = Math.floor(z / step) * step;
  const u = (x - left) / step, v = (z - top) / step;
  const topRight = gridHeight(left + step, top, map);
  const bottomLeft = gridHeight(left, top + step, map);
  if (u + v <= 1) {
    return gridHeight(left, top, map) * (1 - u - v) + topRight * u + bottomLeft * v;
  }
  return gridHeight(left + step, top + step, map) * (u + v - 1) + topRight * (1 - v) + bottomLeft * (1 - u);
}

export function volcanoRadius(x, z) {
  return Math.hypot(x, z) + 13 * Math.sin(x*.023 + z*.031) * Math.sin(z*.025 - x*.012);
}

function volcanoTop(radius) {
  return 34 + 419 * Math.pow(clamp(1 - (radius - 113) / 249, 0, 1), 1.25);
}

export function height(x, z, map = 0) {
  const ground = terrainHeight(x, z, map);
  if (map !== 0 || Math.abs(x - VOLCANO.x) >= 380 || Math.abs(z - VOLCANO.z) >= 380) return ground;
  const radius = volcanoRadius(x - VOLCANO.x, z - VOLCANO.z);
  return radius < 362 ? Math.max(ground, volcanoTop(radius)) : ground;
}

// Positive density is rock. The caldera and the four tunnel branches subtract air
// from the same continuous shape used for both collision and the rendered surface.
export function volcanoDensity(x, y, z, clearance = 0) {
  const radius = volcanoRadius(x, z);
  const shell = Math.min(volcanoTop(radius) - y, 362 - radius, y - 15);
  const crater = Math.min(138 + (y - 47) * .12 - radius, y - 48);
  const crossAxis = Math.min(Math.abs(x), Math.abs(z));
  const along = Math.max(Math.abs(x), Math.abs(z));
  const center = VOLCANO.tunnelAltitude - (along - 140) * .07;
  const tunnel = (1 - Math.hypot(crossAxis / 49, (y - center) / 43)) * 43;
  return Math.min(shell, -Math.max(crater, tunnel)) + clearance;
}

export function solidAt(x, y, z, map, clearance = 0) {
  if (y <= terrainHeight(x, z, map) + clearance) return true;
  const vx = x - VOLCANO.x, vz = z - VOLCANO.z;
  return map === 0 && Math.abs(vx) < 390 && Math.abs(vz) < 390 &&
    volcanoDensity(vx, y, vz, clearance) >= 0;
}

export function respawnPosition(position, map) {
  return [position[0], Math.max(position[1], height(position[0], position[2], map) + 95, 110), position[2]];
}

export function forward(yaw, pitch = 0) {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}
export const add = (a, b) => a.map((value, axis) => value + b[axis]);
export const sub = (a, b) => a.map((value, axis) => value - b[axis]);
export const scale = (a, factor) => a.map(value => value * factor);
export const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const norm = a => scale(a, 1 / (Math.hypot(...a) || 1));
