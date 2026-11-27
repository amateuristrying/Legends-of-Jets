import {
  glacierDensity,
  GLACIER_VAULT,
  mix,
  norm,
  volcanoDensity,
  VOLCANO,
} from './world';

export interface LandmarkMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

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

function extractMarchingTetrahedra(
  densityFn: (x: number, y: number, z: number) => number,
  originX: number,
  originZ: number,
  radius: number,
  ceiling: number,
  step = 6
): LandmarkMesh {
  const side = (2 * radius) / step + 1;
  const levels = ceiling / step + 1;
  const layer = side * side;
  const samples = new Float32Array(side * side * levels);

  for (let y = 0; y < levels; y++) {
    for (let z = 0; z < side; z++) {
      for (let x = 0; x < side; x++) {
        samples[y * layer + z * side + x] = densityFn(
          x * step - radius,
          y * step,
          z * step - radius
        );
      }
    }
  }

  const data: number[] = [];
  const faces: number[] = [];
  const edgeVertices = new Map<number, number>();

  const vertex = (x: number, y: number, z: number): number[] => {
    const d = 1.25;
    const normal = norm([
      densityFn(x - d, y, z) - densityFn(x + d, y, z),
      densityFn(x, y - d, z) - densityFn(x, y + d, z),
      densityFn(x, y, z - d) - densityFn(x, y, z + d),
    ]);
    return [x + originX, y, z + originZ, normal[0], normal[1], normal[2]];
  };

  const indices = corners.map(([x, y, z]) => x + y * layer + z * side);
  const density = new Float32Array(8);

  for (let y = 5; y < levels - 1; y++) {
    for (let z = 0; z < side - 1; z++) {
      for (let x = 0; x < side - 1; x++) {
        const first = y * layer + z * side + x;
        let inside = 0;
        for (let i = 0; i < 8; i++) {
          density[i] = samples[first + indices[i]];
          if (density[i] > 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;

        const edge = (a: number, b: number): number => {
          const ia = first + indices[a];
          const ib = first + indices[b];
          const key = Math.min(ia, ib) * samples.length + Math.max(ia, ib);
          const old = edgeVertices.get(key);
          if (old !== undefined) return old;
          const t = density[a] / (density[a] - density[b]);
          const p = corners[a];
          const q = corners[b];
          const index = data.length / 6;
          data.push(
            ...vertex(
              (x + mix(p[0], q[0], t)) * step - radius,
              (y + mix(p[1], q[1], t)) * step,
              (z + mix(p[2], q[2], t)) * step - radius
            )
          );
          edgeVertices.set(key, index);
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

  return { vertices: new Float32Array(data), indices: new Uint32Array(faces) };
}

let cachedVolcano: LandmarkMesh | undefined;
let cachedGlacier: LandmarkMesh | undefined;

export function volcanoSurface(): LandmarkMesh {
  if (cachedVolcano) return cachedVolcano;
  cachedVolcano = extractMarchingTetrahedra(volcanoDensity, VOLCANO.x, VOLCANO.z, 378, 468, 6);
  return cachedVolcano;
}

export function glacierSurface(): LandmarkMesh {
  if (cachedGlacier) return cachedGlacier;
  cachedGlacier = extractMarchingTetrahedra(
    glacierDensity,
    GLACIER_VAULT.x,
    GLACIER_VAULT.z,
    348,
    420,
    6
  );
  return cachedGlacier;
}
