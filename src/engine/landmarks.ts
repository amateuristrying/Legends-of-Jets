import {
  consumeLandmarkDirty,
  getLandmarkRevision,
  glacierDensity,
  GLACIER_VAULT,
  landmarkScorchAt,
  mix,
  norm,
  volcanoDensity,
  VOLCANO,
  type DirtyLandmarkBox,
} from './world';
import type { Vec3 } from './types';

export interface LandmarkMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface LandmarkChunk {
  key: string;
  center: Vec3;
  radius: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  vertices: Float32Array;
  indices: Uint32Array;
  version: number;
}

const CHUNK_CELLS = 18;
const STEP = 6;

const tetrahedra = [
  [0, 1, 3, 7],
  [0, 1, 5, 7],
  [0, 2, 3, 7],
  [0, 2, 6, 7],
  [0, 4, 5, 7],
  [0, 4, 6, 7],
];
const corners = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

interface ChunkGridSpec {
  map: number;
  densityFn: (x: number, y: number, z: number) => number;
  originX: number;
  originZ: number;
  radius: number;
  ceiling: number;
  sideCells: number;
  levelCells: number;
  cxCount: number;
  cyCount: number;
  czCount: number;
}

interface LandmarkChunkCache {
  spec: ChunkGridSpec;
  chunks: Map<string, LandmarkChunk>;
  activeList: LandmarkChunk[];
  revision: number;
  nextVersion: number;
}

function makeSpec(map: number): ChunkGridSpec {
  const isGlacier = map === 1;
  const lm = isGlacier ? GLACIER_VAULT : VOLCANO;
  const radius = isGlacier ? 348 : 378;
  const ceiling = isGlacier ? 420 : 468;
  const sideCells = (2 * radius) / STEP;
  const levelCells = ceiling / STEP;
  return {
    map,
    densityFn: isGlacier ? glacierDensity : volcanoDensity,
    originX: lm.x,
    originZ: lm.z,
    radius,
    ceiling,
    sideCells,
    levelCells,
    cxCount: Math.ceil(sideCells / CHUNK_CELLS),
    cyCount: Math.ceil(levelCells / CHUNK_CELLS),
    czCount: Math.ceil(sideCells / CHUNK_CELLS),
  };
}

function extractChunk(
  spec: ChunkGridSpec,
  cx: number,
  cy: number,
  cz: number,
  version: number
): LandmarkChunk {
  const x0 = cx * CHUNK_CELLS;
  const x1 = Math.min(spec.sideCells, x0 + CHUNK_CELLS);
  const y0 = Math.max(5, cy * CHUNK_CELLS);
  const y1 = Math.min(spec.levelCells - 1, (cy + 1) * CHUNK_CELLS);
  const z0 = cz * CHUNK_CELLS;
  const z1 = Math.min(spec.sideCells, z0 + CHUNK_CELLS);

  const minX = x0 * STEP - spec.radius;
  const maxX = x1 * STEP - spec.radius;
  const minY = y0 * STEP;
  const maxY = Math.max(minY, y1 * STEP);
  const minZ = z0 * STEP - spec.radius;
  const maxZ = z1 * STEP - spec.radius;
  const center: Vec3 = [
    spec.originX + (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    spec.originZ + (minZ + maxZ) * 0.5,
  ];
  const boundRadius = Math.hypot((maxX - minX) * 0.5, (maxY - minY) * 0.5, (maxZ - minZ) * 0.5) + 4;
  const key = `${cx},${cy},${cz}`;

  if (y0 >= y1 || x0 >= x1 || z0 >= z1) {
    return {
      key,
      center,
      radius: boundRadius,
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
      vertices: new Float32Array(0),
      indices: new Uint32Array(0),
      version,
    };
  }

  const nx = x1 - x0 + 1;
  const ny = y1 - y0 + 1;
  const nz = z1 - z0 + 1;
  const layer = nx * nz;
  const samples = new Float32Array(nx * ny * nz);

  for (let ly = 0; ly < ny; ly++) {
    const wy = (y0 + ly) * STEP;
    for (let lz = 0; lz < nz; lz++) {
      const wz = (z0 + lz) * STEP - spec.radius;
      const rowOff = ly * layer + lz * nx;
      for (let lx = 0; lx < nx; lx++) {
        const wx = (x0 + lx) * STEP - spec.radius;
        samples[rowOff + lx] = spec.densityFn(wx, wy, wz);
      }
    }
  }

  const data: number[] = [];
  const faces: number[] = [];
  const edgeVertices = new Map<number, number>();
  const cornerOffsets = corners.map(([dx, dy, dz]) => dx + dy * layer + dz * nx);
  const density = new Float32Array(8);

  const pushVertex = (x: number, y: number, z: number): number => {
    const d = 1.25;
    const normal = norm([
      spec.densityFn(x - d, y, z) - spec.densityFn(x + d, y, z),
      spec.densityFn(x, y - d, z) - spec.densityFn(x, y + d, z),
      spec.densityFn(x, y, z - d) - spec.densityFn(x, y, z + d),
    ]);
    const scorch = landmarkScorchAt(x, y, z, spec.map);
    const index = data.length / 7;
    data.push(x + spec.originX, y, z + spec.originZ, normal[0], normal[1], normal[2], scorch);
    return index;
  };

  for (let ly = 0; ly < ny - 1; ly++) {
    for (let lz = 0; lz < nz - 1; lz++) {
      for (let lx = 0; lx < nx - 1; lx++) {
        const first = ly * layer + lz * nx + lx;
        let inside = 0;
        for (let i = 0; i < 8; i++) {
          density[i] = samples[first + cornerOffsets[i]];
          if (density[i] > 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;

        const edge = (a: number, b: number): number => {
          const ia = first + cornerOffsets[a];
          const ib = first + cornerOffsets[b];
          const edgeKey = Math.min(ia, ib) * samples.length + Math.max(ia, ib);
          const old = edgeVertices.get(edgeKey);
          if (old !== undefined) return old;
          const t = density[a] / (density[a] - density[b]);
          const p = corners[a];
          const q = corners[b];
          const index = pushVertex(
            (x0 + lx + mix(p[0], q[0], t)) * STEP - spec.radius,
            (y0 + ly + mix(p[1], q[1], t)) * STEP,
            (z0 + lz + mix(p[2], q[2], t)) * STEP - spec.radius
          );
          edgeVertices.set(edgeKey, index);
          return index;
        };

        for (const tetrahedron of tetrahedra) {
          const rock: number[] = [];
          const air: number[] = [];
          for (const i of tetrahedron) (density[i] > 0 ? rock : air).push(i);
          if (!rock.length || !air.length) continue;
          if (rock.length === 2) {
            const a = edge(rock[0], air[0]);
            const b = edge(rock[0], air[1]);
            const c = edge(rock[1], air[0]);
            const d = edge(rock[1], air[1]);
            faces.push(a, b, c, c, b, d);
          } else {
            const single = rock.length === 1 ? rock : air;
            const others = rock.length === 1 ? air : rock;
            for (const i of others) faces.push(edge(single[0], i));
          }
        }
      }
    }
  }

  return {
    key,
    center,
    radius: boundRadius,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    vertices: new Float32Array(data),
    indices: new Uint32Array(faces),
    version,
  };
}

const chunkCaches: Array<LandmarkChunkCache | undefined> = [undefined, undefined];

function boxIntersectsChunk(box: DirtyLandmarkBox, chunk: LandmarkChunk): boolean {
  return (
    box.maxX >= chunk.minX &&
    box.minX <= chunk.maxX &&
    box.maxY >= chunk.minY &&
    box.minY <= chunk.maxY &&
    box.maxZ >= chunk.minZ &&
    box.minZ <= chunk.maxZ
  );
}

function buildAllChunks(map: number): LandmarkChunkCache {
  const spec = makeSpec(map);
  const chunks = new Map<string, LandmarkChunk>();
  const activeList: LandmarkChunk[] = [];
  for (let cy = 0; cy < spec.cyCount; cy++) {
    for (let cz = 0; cz < spec.czCount; cz++) {
      for (let cx = 0; cx < spec.cxCount; cx++) {
        const chunk = extractChunk(spec, cx, cy, cz, 1);
        chunks.set(chunk.key, chunk);
        if (chunk.indices.length > 0) activeList.push(chunk);
      }
    }
  }
  const cache: LandmarkChunkCache = {
    spec,
    chunks,
    activeList,
    revision: getLandmarkRevision(map),
    nextVersion: 2,
  };
  consumeLandmarkDirty(map);
  chunkCaches[map] = cache;
  return cache;
}

export function getLandmarkChunks(map: number): LandmarkChunk[] {
  const m = map === 1 ? 1 : 0;
  let cache = chunkCaches[m];
  const rev = getLandmarkRevision(m);
  if (!cache) {
    return buildAllChunks(m).activeList;
  }
  if (cache.revision === rev) {
    return cache.activeList;
  }
  const dirty = consumeLandmarkDirty(m);
  if (dirty.full) {
    return buildAllChunks(m).activeList;
  }
  cache.revision = rev;
  if (dirty.boxes.length === 0) return cache.activeList;

  let anyUpdated = false;
  for (let cy = 0; cy < cache.spec.cyCount; cy++) {
    for (let cz = 0; cz < cache.spec.czCount; cz++) {
      for (let cx = 0; cx < cache.spec.cxCount; cx++) {
        const key = `${cx},${cy},${cz}`;
        const existing = cache.chunks.get(key);
        if (!existing) continue;
        if (!dirty.boxes.some((box) => boxIntersectsChunk(box, existing))) continue;
        const rebuilt = extractChunk(cache.spec, cx, cy, cz, cache.nextVersion++);
        cache.chunks.set(key, rebuilt);
        anyUpdated = true;
      }
    }
  }
  if (anyUpdated) {
    cache.activeList = [];
    for (const chunk of cache.chunks.values()) {
      if (chunk.indices.length > 0) cache.activeList.push(chunk);
    }
  }
  return cache.activeList;
}

function mergeChunks(chunks: LandmarkChunk[]): LandmarkMesh {
  let vertFloats = 0;
  let indexCount = 0;
  for (const c of chunks) {
    vertFloats += c.vertices.length;
    indexCount += c.indices.length;
  }
  const vertices = new Float32Array(vertFloats);
  const indices = new Uint32Array(indexCount);
  let vOff = 0;
  let iOff = 0;
  let baseVertex = 0;
  for (const c of chunks) {
    vertices.set(c.vertices, vOff);
    for (let i = 0; i < c.indices.length; i++) {
      indices[iOff + i] = c.indices[i] + baseVertex;
    }
    vOff += c.vertices.length;
    iOff += c.indices.length;
    baseVertex += c.vertices.length / 7;
  }
  return { vertices, indices };
}

export function volcanoSurface(): LandmarkMesh {
  return mergeChunks(getLandmarkChunks(0));
}

export function glacierSurface(): LandmarkMesh {
  return mergeChunks(getLandmarkChunks(1));
}
