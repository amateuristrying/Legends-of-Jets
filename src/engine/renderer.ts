import type { AtmospherePreset, TrailSample, Vec3 } from './types';
import {
  add,
  AIRCRAFT_WING_GEOMETRY,
  aircraftBasis,
  clamp,
  cross,
  dot,
  GLACIER_VAULT,
  norm,
  planes,
  scale,
  sub,
  TERRAIN_GRID,
  TERRAIN_HEIGHT,
  TERRAIN_SIZE,
  TERRAIN_TEXELS,
  terrainTile,
  TRAIL_MAX_AGE,
  VOLCANO,
  WING_Y_OFFSET,
} from './world';
import { glacierSurface, volcanoSurface, type LandmarkMesh } from './landmarks';

export type { TrailSample };

export interface CameraState {
  eye: Vec3;
  front: Vec3;
  right: Vec3;
  up: Vec3;
  fov: number;
}

export interface RenderObject {
  kind?: string;
  type?: number;
  pos: Vec3;
  yaw?: number;
  pitch?: number;
  roll?: number;
  scale?: number;
  size?: number;
  tint?: Vec3;
}

export interface RenderState {
  map: number;
  atmosphere: AtmospherePreset;
  night: boolean;
}

function atmosphereIndex(preset: AtmospherePreset, night: boolean): number {
  if (preset === 'golden') return 1;
  if (preset === 'night') return 2;
  if (preset === 'storm') return 3;
  if (preset === 'aurora') return 4;
  return night ? 2 : 0;
}

const skyVertex = `#version 300 es
in vec2 a;
out vec2 uv;
void main() {
  uv = a;
  gl_Position = vec4(a, 1., 1.);
}`;

const atmosphereGLSL = `
uniform vec3 eye;
uniform float clock, night;
uniform int atmo;
float hash(vec2 p) {
  vec3 q = fract(p.xyx * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float broadNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(cell), hash(cell + vec2(1.,0.)), f.x),
             mix(hash(cell + vec2(0.,1.)), hash(cell + vec2(1.,1.)), f.x), f.y);
}
vec3 skyColor(vec3 ray) {
  float h = clamp(ray.y * 1.55, 0., 1.);
  vec3 sky;
  if (atmo == 1) {
    // Golden hour / sunset
    sky = mix(vec3(.93,.54,.32), vec3(.22,.21,.42), pow(h, .68));
    float sun = pow(max(0., dot(ray, normalize(vec3(-.75,.18,.63)))), 180.);
    sky += sun * vec3(1.1,.78,.42);
  } else if (atmo == 3) {
    // Storm / overcast
    sky = mix(vec3(.24,.30,.35), vec3(.10,.14,.19), h);
  } else if (atmo == 2 || atmo == 4 || night > .5) {
    sky = mix(vec3(.13,.21,.34), vec3(.02,.05,.12), h);
    float moon = pow(max(0., dot(ray, normalize(vec3(-.6,.4,.8)))), 360.);
    sky += moon * vec3(.52,.64,.75);
    if (ray.y > .08) {
      vec2 stars = ray.xz / max(ray.y,.1) * 280.;
      float mask = step(.997, hash(floor(stars))) * (1.-smoothstep(.10,.41,length(fract(stars)-.5)));
      sky += mask * smoothstep(.08,.24,ray.y) * .48;
    }
    if (atmo == 4 && ray.y > .05) {
      // Arctic Aurora ribbons
      vec2 ap = ray.xz / max(ray.y, .16) * 2.2;
      float wave = sin(ap.x * 2.3 + clock * .28 + sin(ap.y * 1.7 - clock * .18) * 1.4);
      float band = smoothstep(.18, .92, wave * .5 + .5) * smoothstep(.05, .28, ray.y) * (1. - smoothstep(.42, .88, ray.y));
      float shimmer = broadNoise(ap * 3.5 + vec2(clock * .15, -clock * .1));
      vec3 aurCol = mix(vec3(.12,.92,.62), vec3(.38,.45,.98), smoothstep(.2, .65, ray.y));
      sky += aurCol * band * (.35 + shimmer * .55) * .68;
    }
  } else {
    sky = mix(vec3(.69,.83,.89), vec3(.20,.48,.70), h);
    float sun = pow(max(0., dot(ray, normalize(vec3(-.6,.4,.8)))), 390.);
    sky += sun * vec3(.89,.62,.32);
  }
  return sky;
}
vec3 clouds(vec3 underneath, vec3 sky, vec3 ray, float distance) {
  if (abs(ray.y) < .001) return underneath;
  float cloudDistance = (196. - eye.y) / ray.y;
  if (cloudDistance <= 0. || cloudDistance >= min(distance, 3460.)) return underneath;
  vec2 p = (eye.xz + ray.xz * cloudDistance) * .008 + vec2(clock * (atmo == 3 ? .022 : .008), 0.);
  float shape = broadNoise(p) * .72 + broadNoise(p * 2.1 + 3.7) * .28;
  float lowCut = atmo == 3 ? .40 : .60;
  float opacity = smoothstep(lowCut, lowCut + .10, shape) * (1.-smoothstep(1900.,3460.,cloudDistance));
  opacity *= smoothstep(12.,135.,cloudDistance);
  vec3 lit = atmo == 1 ? vec3(.98,.72,.52) : atmo == 3 ? vec3(.38,.43,.48) :
    mix(vec3(.96,.97,.96), vec3(.34,.46,.60), float(atmo == 2 || atmo == 4 || night > .5));
  lit *= .82 + smoothstep(lowCut, .82, shape) * .18;
  return mix(underneath, mix(lit, sky, 1.-exp(-cloudDistance*.00036)), opacity * (atmo == 3 ? .88 : .72));
}`;

const skyFragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform vec3 right, up, front;
uniform float aspect, fov;
${atmosphereGLSL}
void main() {
  vec3 ray = normalize(front + right * uv.x * aspect * fov + up * uv.y * fov);
  vec3 sky = skyColor(ray);
  color = vec4(clouds(sky, sky, ray, 4700.), 1.);
}`;

const surfaceVertex = `#version 300 es
precision highp float;
in vec3 a, n;
in vec2 tileOrigin;
out vec3 world, direction, normal;
uniform vec3 eye, right, up, front;
uniform float aspect, fov, landmark;
uniform sampler2D elevation;
float groundAt(vec2 p) {
  float h = textureLod(elevation, p / ${TERRAIN_SIZE}.0, 0.).r * ${TERRAIN_HEIGHT}.0;
  return max(10., floor(h * .25 + .0001) * 4.);
}
void main() {
  world = a + vec3(tileOrigin.x, 0., tileOrigin.y);
  if (landmark > .5) normal = n;
  else {
    vec2 p = world.xz;
    world.y = groundAt(p);
    float dx = groundAt(p + vec2(12.,0.)) - groundAt(p - vec2(12.,0.));
    float dz = groundAt(p + vec2(0.,12.)) - groundAt(p - vec2(0.,12.));
    normal = normalize(vec3(-dx,24.,-dz));
  }
  direction = world - eye;
  float z = dot(direction, front);
  gl_Position = vec4(dot(direction,right)/(aspect*fov), dot(direction,up)/fov, (z-1.)*.999, z);
}`;

const surfaceFragment = `#version 300 es
precision highp float;
in vec3 world, direction, normal;
out vec4 color;
uniform vec3 jet;
uniform float landmark;
uniform int map;
uniform sampler2D elevation;
${atmosphereGLSL}
void main() {
  float distance = length(direction);
  vec3 ray = direction / max(distance, 1.);
  vec3 sky = skyColor(ray);
  float fogRate = atmo == 3 ? .00052 : .00028;
  float fog = max(1.-exp(-distance*fogRate), smoothstep(atmo == 3 ? 1600. : 2400., 3850., distance));
  if (fog > .999) { color = vec4(clouds(sky, sky, ray, distance), 1.); return; }
  vec3 p = world;
  vec3 surfaceNormal = normalize(normal);
  float footprint = length(fwidth(p.xz));
  if (landmark < .5) {
    vec3 facet = cross(dFdx(p), dFdy(p));
    if (dot(facet,facet) > .00001) {
      facet = normalize(facet);
      if (facet.y < 0.) facet = -facet;
      surfaceNormal = normalize(mix(surfaceNormal,facet,.29*(1.-smoothstep(4.,23.,footprint))));
    }
  }
  float slope = 1. - max(0.,surfaceNormal.y);
  float detail = 1.-smoothstep(300.,2100.,distance);
  vec3 c, emission = vec3(0.);
  if (landmark > .5 && map == 0) {
    // Ashmouth Caldera
    vec2 q = p.xz - vec2(${VOLCANO.x}.0,${VOLCANO.z}.0);
    float veins = pow(max(0.,sin(q.x*.13 + sin(q.y*.082)*2. + p.y*.20)
      * sin(q.y*.109 - p.y*.27)), 5.);
    c = mix(vec3(.20,.17,.19), vec3(.37,.32,.34), smoothstep(0.,330.,p.y));
    c += (broadNoise(p.xz*.046 + p.y*.034)-.5) * .10 * detail;
    float inside = smoothstep(.04,.45, -surfaceNormal.y) + 1.-smoothstep(100.,155.,length(q));
    emission = vec3(.94,.21,.035) * veins * (.34 + min(1.,inside)*.26) * detail;
    if (p.y < 61. && length(q) < 138.) {
      emission += vec3(.87,.19,.029) * (.74 + broadNoise(q*.05 + clock*.025)*.29);
    }
    vec2 axis = abs(q);
    if (min(axis.x,axis.y)>33. && min(axis.x,axis.y)<51. && abs(p.y-136.)<12.) {
      float strip = 1.-smoothstep(2.,6.,abs(mod(max(axis.x,axis.y), 35.)-17.5));
      emission += vec3(1.,.43,.13) * strip * .62 * detail;
    }
  } else if (landmark > .5 && map == 1) {
    // Frostline Glacier Vault (3D crystalline ice cavern)
    vec2 q = p.xz - vec2(${GLACIER_VAULT.x}.0,${GLACIER_VAULT.z}.0);
    float veins = pow(max(0., sin(q.x*.11 + p.y*.18) * cos(q.y*.11 - p.y*.21)), 4.);
    c = mix(vec3(.28,.54,.72), vec3(.82,.94,.98), smoothstep(20.,310.,p.y));
    c += (broadNoise(p.xz*.05 + p.y*.03)-.5) * .09 * detail;
    float inside = smoothstep(.04,.45, -surfaceNormal.y) + 1.-smoothstep(95.,145.,length(q));
    emission = vec3(.14,.78,.95) * veins * (.26 + min(1.,inside)*.34) * detail;
    vec2 axis = abs(q);
    if (min(axis.x,axis.y)>34. && min(axis.x,axis.y)<54. && abs(p.y-124.)<14.) {
      float strip = 1.-smoothstep(2.,6.,abs(mod(max(axis.x,axis.y), 32.)-16.));
      emission += vec3(.32,.96,1.) * strip * .72 * detail;
    }
  } else if (p.y <= 10.015) {
    float shelves = texture(elevation, p.xz / ${TERRAIN_SIZE}.0).r * ${TERRAIN_HEIGHT}.0;
    c = map == 0 ? vec3(.10,.34,.35) : vec3(.063,.26,.46);
    c = mix(c, map == 0 ? vec3(.22,.48,.42) : vec3(.16,.52,.63), smoothstep(4.,13.,shelves)*.67);
    float swell = sin(p.x*.085 + p.z*.13 + clock * 1.1 + broadNoise(p.xz*.044)*3.);
    c += (smoothstep(.68,.99,swell)-.2) * .034 * detail;
    surfaceNormal = vec3(0.,1.,0.);
  } else {
    float bands = sin(p.y*.14 + broadNoise(p.xz*.018)*2.2);
    float stone = broadNoise(p.xz*.033);
    float grain = broadNoise(p.xz*.083 + p.y*.016) - .5;
    float grainContrast = .068 * (1.-smoothstep(2.5,11.,footprint));
    if (map == 0) {
      c = mix(vec3(.46,.22,.14),vec3(.78,.49,.31),smoothstep(20.,235.,p.y));
      c = mix(c,vec3(.38,.18,.16),slope*.63);
      c = mix(c,vec3(.84,.68,.47),smoothstep(250.,412.,p.y)*.62);
      c += (smoothstep(-.24,.47,bands) - .5) * .086 * (1.-smoothstep(8.,28.,footprint));
    } else {
      float snow = smoothstep(84.,247.,p.y + (stone-.5)*43.) * (1.-slope*.59);
      c = mix(vec3(.23,.46,.63),vec3(.84,.91,.93),snow);
      c = mix(c,vec3(.19,.34,.48),slope*.26);
      c += bands*.018*detail;
    }
    c += (stone-.5) * .090 * detail + grain * grainContrast;
  }
  vec3 sunDir = atmo == 1 ? normalize(vec3(-.75,.32,.63)) : normalize(vec3(-.59,.71,.38));
  float light = max(0.,dot(surfaceNormal,sunDir));
  c *= .58 + .42 * light;
  if (atmo == 1) c *= vec3(1.14, .88, .76);
  else if (atmo == 3) c *= vec3(.72, .78, .84);
  vec2 shadow = (p.xz - jet.xz + (jet.y - p.y) * vec2(.18,-.12)) / vec2(11.,15.);
  float below = smoothstep(-1.,4.,jet.y-p.y);
  c *= 1. - (1.-smoothstep(.5,1.2,dot(shadow,shadow))) * .23 * below;
  float isNight = float(atmo == 2 || atmo == 4 || night > .5);
  c = mix(c,c*vec3(.51,.65,.86)+vec3(.035,.050,.079), isNight) + emission;
  if (atmo == 4) c += vec3(.02, .09, .08) * max(0., surfaceNormal.y);
  c = mix(c,sky,fog);
  color = vec4(clouds(c, sky, ray, distance),1.);
}`;

const pointVertex = `#version 300 es
precision highp float;
in vec3 a;
in vec3 c;
out vec3 col;
uniform vec3 eye,right,up,front,origin;
uniform vec3 axisX,axisY,axisZ;
uniform float aspect,fov,size,screenHeight;
void main(){
  vec3 world=origin+axisX*a.x+axisY*a.y+axisZ*a.z;
  vec3 d=world-eye;
  float z=dot(d,front);
  gl_Position=vec4(dot(d,right)/(aspect*fov),dot(d,up)/fov,(z-1.)*.999,z);
  gl_PointSize=clamp(size*screenHeight/(max(z,1.)*2.*fov),1.,90.);
  if(z<1.)gl_Position=vec4(2,2,2,1);
  col=c;
}`;

const pointFragment = `#version 300 es
precision highp float;
in vec3 col;
out vec4 color;
uniform float night,tintStrength,emissive;
uniform vec3 tint;
void main(){
  vec3 base=mix(col,tint*(.48+col.r*.52),tintStrength);
  color=vec4(mix(base,base*vec3(.64,.74,.91)+.045,night*(1.-emissive)),1.);
}`;

const trailVertex = `#version 300 es
precision highp float;
in vec3 a;
in float alpha;
out float vAlpha;
uniform vec3 eye,right,up,front;
uniform float aspect,fov;
void main(){
  vec3 d=a-eye;
  float z=dot(d,front);
  gl_Position=vec4(dot(d,right)/(aspect*fov),dot(d,up)/fov,(z-1.)*.999,z);
  vAlpha=alpha;
}`;

const trailFragment = `#version 300 es
precision highp float;
in float vAlpha;
out vec4 color;
uniform float night;
void main(){
  vec3 base=mix(vec3(.88,.96,1.),vec3(.56,.70,.88),night);
  color=vec4(base,clamp(vAlpha,0.,1.));
}`;

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile error');
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vertex);
  gl.attachShader(prog, fragment);
  gl.linkProgram(prog);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || 'Program link error');
  }
  return prog;
}

export function aircraftPoints(type: number): Float32Array {
  const plane = planes[type] ?? planes[0];
  const points: number[] = [];
  const delta = type === 1;
  const modern = type === 2;
  const stealth = type === 3;
  const twinBoom = type === 4;
  const step = 0.4;

  function sample(x: number, y: number, z: number): Vec3 | null {
    const side = Math.abs(x);
    const noseWidth =
      z > 6
        ? Math.max(0, (15 - z) * (stealth ? 0.22 : 0.18))
        : delta
          ? 1.85
          : modern
            ? 2.05
            : stealth
              ? 2.3
              : twinBoom
                ? 1.5
                : 1.32;
    const body =
      side ** 2 / Math.max(0.01, noseWidth) ** 2 + (y * y) / (z > 6 ? 0.72 : 1.55) ** 2 < 1 &&
      z > -10 &&
      z < 15;
    const canopy =
      (x / (modern || stealth ? 1.31 : 0.97)) ** 2 +
        ((z - 4.7) / 4.2) ** 2 +
        ((y - 0.68) / 1.44) ** 2 <
        1 && y > 0.73;

    const wingGeo = AIRCRAFT_WING_GEOMETRY[type] ?? AIRCRAFT_WING_GEOMETRY[0];
    const span = wingGeo.span;
    const leading = wingGeo.leadingBase + side * wingGeo.leadingSlope;
    const trailing = wingGeo.trailingBase + side * wingGeo.trailingSlope;

    const wing =
      side < span && z < leading && z > trailing && Math.abs(y - WING_Y_OFFSET) < 0.34 - side / 95;

    const elevator =
      !stealth &&
      z > -10.8 + side * 0.16 &&
      z < -6.4 - side * 0.44 &&
      side < (modern || twinBoom ? 6.4 : 4.5) &&
      Math.abs(y - 0.02) < 0.25;

    const finOffset = modern ? 2.5 + y * 0.23 : stealth ? 2.1 + y * 0.75 : twinBoom ? 4.2 : 0;
    const fin =
      z > -10.5 &&
      z < -5.5 - y * 0.95 &&
      Math.abs(side - finOffset) < 0.36 &&
      y > 0.45 &&
      y < (modern || stealth ? 3.55 : 4.25);

    const boom =
      twinBoom &&
      Math.abs(side - 4.2) < 0.65 &&
      Math.abs(y + 0.1) < 0.55 &&
      z > -10.8 &&
      z < 2.2;

    const intakeX = modern ? 2.45 : delta ? 1.65 : stealth ? 2.1 : twinBoom ? 4.2 : 1.06;
    const nacelle =
      z < (modern ? 1.5 : -0.4) &&
      z > -10.2 &&
      ((side - intakeX) / (modern ? 1.05 : 0.72)) ** 2 + ((y + 0.5) / 0.83) ** 2 < 1;

    if (!(body || canopy || wing || elevator || fin || nacelle || boom)) return null;
    if (canopy) return y > 1.5 && x > 0 ? [0.34, 0.66, 0.7] : [0.074, 0.22, 0.28];
    if (nacelle && z < -9.3) return [0.15, 0.17, 0.19];
    if ((wing && side > span - 1.45) || (fin && y > 2.82)) return plane.accent;
    if (wing && side > 3 && side < 4.2 && z > -3.8 && z < -1.2) return [0.8, 0.79, 0.66];
    const panelLine =
      Math.abs(z - 3) < 0.22 ||
      Math.abs(z + 5.4) < 0.21 ||
      (wing && Math.abs(side - 6.2) < 0.19);
    const bevel = wing && (z > leading - 0.64 || z < trailing + 0.46) ? 0.83 : 1;
    const light = (0.58 + (y + 1.4) * 0.12 + (x > 0 ? 0.06 : 0)) * bevel * (panelLine ? 0.77 : 1);
    const shade = (Math.sin(x * 31 + z * 17 - y * 12) + 1) * 0.022;
    return [
      plane.color[0] * light + shade,
      plane.color[1] * light + shade,
      plane.color[2] * light + shade,
    ];
  }

  for (let y = -1.4; y <= 4.6; y += step) {
    for (let z = -11; z <= 15; z += step) {
      for (let x = -13.2; x <= 13.2; x += step) {
        const color = sample(x, y, z);
        if (color) {
          points.push(x * plane.size, y * plane.size, z * plane.size, color[0], color[1], color[2]);
        }
      }
    }
  }
  return new Float32Array(points);
}

function buildStructurePoints(kind: 'radar' | 'aa' | 'relay' | 'core' | 'ring' | 'rearm'): Float32Array {
  const pts: number[] = [];
  if (kind === 'ring' || kind === 'rearm') {
    const col: Vec3 = kind === 'rearm' ? [0.22, 1.0, 0.62] : [1.0, 0.82, 0.24];
    const segs = 36;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(Math.cos(a) * 28, Math.sin(a) * 28, 0, col[0], col[1], col[2]);
      if (i % 3 === 0) {
        pts.push(Math.cos(a) * 32, Math.sin(a) * 32, 0, 1, 1, 1);
      }
    }
    return new Float32Array(pts);
  }
  if (kind === 'radar') {
    // Concrete base + geodesic dome
    for (let y = 0; y <= 14; y += 2.2) {
      const r = y < 5 ? 11 : Math.sqrt(Math.max(0, 81 - (y - 6) ** 2));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const c: Vec3 = y < 5 ? [0.42, 0.45, 0.48] : [0.92, 0.94, 0.96];
        pts.push(Math.cos(a) * r, y, Math.sin(a) * r, c[0], c[1], c[2]);
      }
    }
    pts.push(0, 16, 0, 1.0, 0.28, 0.2);
  } else if (kind === 'aa') {
    for (let y = 0; y <= 10; y += 2.2) {
      const r = 8 - y * 0.35;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        pts.push(Math.cos(a) * r, y, Math.sin(a) * r, 0.48, 0.42, 0.38);
      }
    }
    for (let t = 0; t < 6; t++) {
      pts.push(0, 10 + t * 2, t * 1.4, 0.95, 0.35, 0.22);
    }
  } else if (kind === 'core') {
    for (let y = -10; y <= 10; y += 2.5) {
      const r = 10 - Math.abs(y) * 0.5;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        pts.push(Math.cos(a) * r, y, Math.sin(a) * r, 1.0, 0.46, 0.14);
      }
    }
  } else {
    // Relay tower
    for (let y = 0; y <= 38; y += 3) {
      const r = Math.max(1.5, 6 - y * 0.12);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        pts.push(Math.cos(a) * r, y, Math.sin(a) * r, 0.72, 0.85, 0.88);
      }
    }
    pts.push(0, 41, 0, 0.28, 1.0, 0.82);
  }
  return new Float32Array(pts);
}

const patchSize = 512;
const mapRadius = 3900;

function terrainPatch(): { vertices: Float32Array; indices: Uint16Array } {
  const cells = patchSize / TERRAIN_GRID;
  const stride = cells + 1;
  const vertices = new Float32Array(stride * stride * 3);
  const indices = new Uint16Array(cells * cells * 6);
  let cursor = 0;
  for (let z = 0; z <= cells; z++) {
    for (let x = 0; x <= cells; x++) {
      const first = z * stride + x;
      vertices.set([x * TERRAIN_GRID, 0, z * TERRAIN_GRID], first * 3);
      if (x === cells || z === cells) continue;
      const next = first + stride;
      indices.set([first, first + 1, next, first + 1, next + 1, next], cursor);
      cursor += 6;
    }
  }
  return { vertices, indices };
}

function visibleBounds(
  center: Vec3,
  radius: number,
  camera: CameraState,
  aspect: number,
  range: number
): boolean {
  const offset = sub(center, camera.eye);
  const depth = dot(offset, camera.front);
  if (depth < -radius || Math.hypot(offset[0], offset[1], offset[2]) > range + radius) return false;
  const horizontal = aspect * camera.fov;
  const vertical = camera.fov;
  return (
    Math.abs(dot(offset, camera.right)) <= depth * horizontal + radius * Math.hypot(1, horizontal) &&
    Math.abs(dot(offset, camera.up)) <= depth * vertical + radius * Math.hypot(1, vertical)
  );
}

interface BufferHandle {
  buffer: WebGLBuffer;
  count: number;
}

interface SurfaceHandle {
  vao: WebGLVertexArrayObject;
  count: number;
  type: number;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  sky: WebGLProgram;
  terrain: WebGLProgram;
  points: WebGLProgram;
  trailProgram: WebGLProgram;
  skyPosition: number;
  terrainPosition: number;
  terrainNormal: number;
  terrainOffset: number;
  pointPosition: number;
  pointColor: number;
  trailPosition: number;
  trailAlpha: number;
  skyVao: WebGLVertexArrayObject;
  trailVao: WebGLVertexArrayObject;
  patch: SurfaceHandle;
  instances: WebGLBuffer;
  origins: Float32Array;
  models: BufferHandle[];
  flame: BufferHandle;
  structures: Map<string, BufferHandle>;
  effects: Map<string, BufferHandle>;
  locations: Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>;
  elevations: Map<number, WebGLTexture>;
  trailBuffer: WebGLBuffer;
  trailData: Float32Array;
  caldera?: SurfaceHandle;
  glacier?: SurfaceHandle;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 is required. Please enable hardware acceleration in your browser.');
    }
    this.gl = gl;
    this.sky = createProgram(gl, skyVertex, skyFragment);
    this.terrain = createProgram(gl, surfaceVertex, surfaceFragment);
    this.points = createProgram(gl, pointVertex, pointFragment);
    this.trailProgram = createProgram(gl, trailVertex, trailFragment);

    this.skyPosition = gl.getAttribLocation(this.sky, 'a');
    this.terrainPosition = gl.getAttribLocation(this.terrain, 'a');
    this.terrainNormal = gl.getAttribLocation(this.terrain, 'n');
    this.terrainOffset = gl.getAttribLocation(this.terrain, 'tileOrigin');
    this.pointPosition = gl.getAttribLocation(this.points, 'a');
    this.pointColor = gl.getAttribLocation(this.points, 'c');
    this.trailPosition = gl.getAttribLocation(this.trailProgram, 'a');
    this.trailAlpha = gl.getAttribLocation(this.trailProgram, 'alpha');

    const quad = gl.createBuffer()!;
    this.skyVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.skyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(this.skyPosition);
    gl.vertexAttribPointer(this.skyPosition, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.patch = this.surfaceBuffer(terrainPatch());
    this.instances = gl.createBuffer()!;
    gl.bindVertexArray(this.patch.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.enableVertexAttribArray(this.terrainOffset);
    gl.vertexAttribPointer(this.terrainOffset, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.terrainOffset, 1);
    gl.bindVertexArray(null);

    this.origins = new Float32Array((Math.ceil(mapRadius / patchSize) * 2 + 3) ** 2 * 2);
    this.models = planes.map((_, index) => this.buffer(aircraftPoints(index)));
    this.flame = this.buffer(
      new Float32Array([
        0, 0, 0, 1, 0.34, 0.05,
        0, 0, -1, 1, 0.55, 0.09,
        0, 0, -2, 1, 0.82, 0.3,
        0, 0, -3, 1, 0.35, 0.06,
      ])
    );

    this.structures = new Map([
      ['radar', this.buffer(buildStructurePoints('radar'))],
      ['aa', this.buffer(buildStructurePoints('aa'))],
      ['relay', this.buffer(buildStructurePoints('relay'))],
      ['core', this.buffer(buildStructurePoints('core'))],
      ['ring', this.buffer(buildStructurePoints('ring'))],
      ['rearm', this.buffer(buildStructurePoints('rearm'))],
    ]);

    this.effects = new Map(
      Object.entries({
        tracer: [1, 0.78, 0.25],
        enemyTracer: [1, 0.36, 0.24],
        missile: [1, 0.69, 0.36],
        enemyMissile: [1, 0.29, 0.19],
        rocket: [1, 0.52, 0.18],
        flare: [1, 0.9, 0.55],
        spark: [1, 0.44, 0.15],
        fire: [1, 0.3, 0.08],
        smoke: [0.65, 0.7, 0.74],
        debris: [0.32, 0.34, 0.36],
        beacon: [0.3, 1, 0.84],
      }).map(([kind, color]) => [kind, this.buffer(new Float32Array([0, 0, 0, ...color]))])
    );

    this.locations = new Map();
    this.elevations = new Map();
    this.trailBuffer = gl.createBuffer()!;
    this.trailData = new Float32Array(64 * 2 * 4);
    this.trailVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.trailVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuffer);
    gl.enableVertexAttribArray(this.trailPosition);
    gl.vertexAttribPointer(this.trailPosition, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.trailAlpha);
    gl.vertexAttribPointer(this.trailAlpha, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);
  }

  buffer(data: Float32Array): BufferHandle {
    const gl = this.gl;
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, count: data.length / 6 };
  }

  uniform(prog: WebGLProgram, name: string, value: number | Vec3): void {
    const gl = this.gl;
    let map = this.locations.get(prog);
    if (!map) {
      map = new Map();
      this.locations.set(prog, map);
    }
    if (!map.has(name)) map.set(name, gl.getUniformLocation(prog, name));
    const location = map.get(name);
    if (!location) return;
    if (Array.isArray(value)) gl.uniform3fv(location, value);
    else if (name === 'map' || name === 'atmo') gl.uniform1i(location, value);
    else gl.uniform1f(location, value);
  }

  setup(prog: WebGLProgram, camera: CameraState, state: RenderState, time: number): void {
    this.gl.useProgram(prog);
    const { eye, right, up, front, fov } = camera;
    const atmo = atmosphereIndex(state.atmosphere, state.night);
    const isNight = atmo === 2 || atmo === 4 || state.night ? 1 : 0;
    const values: Record<string, number | Vec3> = {
      eye,
      right,
      up,
      front,
      fov,
      aspect: this.canvas.width / this.canvas.height,
      night: isNight,
      atmo,
      clock: time,
      map: state.map,
      screenHeight: this.canvas.height,
    };
    for (const [name, value] of Object.entries(values)) this.uniform(prog, name, value);
  }

  elevationTexture(map: number): WebGLTexture {
    const existing = this.elevations.get(map);
    if (existing) return existing;
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      TERRAIN_TEXELS,
      TERRAIN_TEXELS,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      terrainTile(map)
    );
    this.elevations.set(map, texture);
    return texture;
  }

  surfaceBuffer(
    mesh: { vertices: Float32Array; indices: Uint16Array | Uint32Array },
    withNormals = false
  ): SurfaceHandle {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const vertexBuffer = gl.createBuffer()!;
    const indexBuffer = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.terrainPosition);
    gl.vertexAttribPointer(this.terrainPosition, 3, gl.FLOAT, false, withNormals ? 24 : 12, 0);
    if (withNormals) {
      gl.enableVertexAttribArray(this.terrainNormal);
      gl.vertexAttribPointer(this.terrainNormal, 3, gl.FLOAT, false, 24, 12);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return {
      vao,
      count: mesh.indices.length,
      type: withNormals ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    };
  }

  prepare(map: number): void {
    this.elevationTexture(map);
    if (map === 0 && !this.caldera) {
      this.caldera = this.surfaceBuffer(volcanoSurface() as LandmarkMesh, true);
    } else if (map === 1 && !this.glacier) {
      this.glacier = this.surfaceBuffer(glacierSurface() as LandmarkMesh, true);
    }
  }

  drawSurfaces(
    camera: CameraState,
    state: RenderState,
    time: number,
    objects: RenderObject[],
    aspect: number
  ): void {
    const gl = this.gl;
    this.setup(this.terrain, camera, state, time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.elevationTexture(state.map));
    const player = objects.find((obj) => !obj.kind);
    this.uniform(this.terrain, 'jet', player?.pos ?? [1e8, 0, 1e8]);

    const centerX = Math.floor(camera.eye[0] / patchSize);
    const centerZ = Math.floor(camera.eye[2] / patchSize);
    const reach = Math.ceil(mapRadius / patchSize);
    const patches: Array<[number, number, number]> = [];
    for (let z = centerZ - reach; z <= centerZ + reach; z++) {
      for (let x = centerX - reach; x <= centerX + reach; x++) {
        const cornerX = x * patchSize;
        const cornerZ = z * patchSize;
        const center: Vec3 = [cornerX + patchSize / 2, TERRAIN_HEIGHT / 2, cornerZ + patchSize / 2];
        if (!visibleBounds(center, 484, camera, aspect, mapRadius)) continue;
        patches.push([
          cornerX,
          cornerZ,
          Math.hypot(center[0] - camera.eye[0], center[2] - camera.eye[2]),
        ]);
      }
    }
    patches.sort((a, b) => a[2] - b[2]);
    for (let i = 0; i < patches.length; i++) {
      this.origins[2 * i] = patches[i][0];
      this.origins[2 * i + 1] = patches[i][1];
    }

    this.uniform(this.terrain, 'landmark', 0);
    gl.bindVertexArray(this.patch.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferData(gl.ARRAY_BUFFER, this.origins.subarray(0, patches.length * 2), gl.STREAM_DRAW);
    gl.enable(gl.CULL_FACE);
    gl.drawElementsInstanced(gl.TRIANGLES, this.patch.count, this.patch.type, 0, patches.length);
    gl.disable(gl.CULL_FACE);

    if (
      state.map === 0 &&
      visibleBounds([VOLCANO.x, 220, VOLCANO.z], 435, camera, aspect, mapRadius)
    ) {
      if (!this.caldera) this.caldera = this.surfaceBuffer(volcanoSurface(), true);
      this.uniform(this.terrain, 'landmark', 1);
      gl.bindVertexArray(this.caldera.vao);
      gl.drawElements(gl.TRIANGLES, this.caldera.count, this.caldera.type, 0);
    } else if (
      state.map === 1 &&
      visibleBounds([GLACIER_VAULT.x, 200, GLACIER_VAULT.z], 400, camera, aspect, mapRadius)
    ) {
      if (!this.glacier) this.glacier = this.surfaceBuffer(glacierSurface(), true);
      this.uniform(this.terrain, 'landmark', 1);
      gl.bindVertexArray(this.glacier.vao);
      gl.drawElements(gl.TRIANGLES, this.glacier.count, this.glacier.type, 0);
    }

    gl.bindVertexArray(null);
  }

  render(
    camera: CameraState,
    state: RenderState,
    time: number,
    objects: RenderObject[],
    trails: TrailSample[][],
    target = 640
  ): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const pixelScale = Math.min(1, target / innerWidth, (target * 0.85) / innerHeight);
    const width = Math.max(1, Math.round(innerWidth * pixelScale));
    const height = Math.max(1, Math.round(innerHeight * pixelScale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.depthMask(false);
    this.setup(this.sky, camera, state, time);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    this.drawSurfaces(camera, state, time, objects, width / height);
    this.setup(this.points, camera, state, time);
    for (const object of objects) this.draw(object);

    if (trails.length > 0) {
      this.setup(this.trailProgram, camera, state, time);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindVertexArray(this.trailVao);
      for (const trail of trails) this.drawTrail(trail, time);
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  pointAttributes(buffer: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [location, offset] of [
      [this.pointPosition, 0],
      [this.pointColor, 12],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 24, offset);
    }
  }

  drawTrail(trail: TrailSample[], time: number): void {
    if (trail.length < 2) return;
    const gl = this.gl;
    const maxSamples = Math.floor(this.trailData.length / 8);
    const start = Math.max(0, trail.length - maxSamples);
    const count = trail.length - start;
    let offset = 0;
    for (const wing of ['left', 'right'] as const) {
      for (let i = start; i < trail.length; i++) {
        const point = trail[i];
        const age = Math.max(0, time - point.time);
        const fade = clamp(1 - age / TRAIL_MAX_AGE, 0, 1);
        const alpha = fade * fade * 0.72;
        const w = point[wing];
        this.trailData[offset++] = w[0];
        this.trailData[offset++] = w[1];
        this.trailData[offset++] = w[2];
        this.trailData[offset++] = alpha;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.trailData.subarray(0, offset), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, count);
    gl.drawArrays(gl.LINE_STRIP, count, count);
  }

  draw(object: RenderObject): void {
    const gl = this.gl;
    const isFlame = object.kind === 'flame';
    const structure = object.kind ? this.structures.get(object.kind) : undefined;
    const effect = object.kind ? this.effects.get(object.kind) : undefined;
    const planeType = object.type ?? 0;
    const model =
      structure ?? effect ?? (isFlame ? this.flame : this.models[planeType] ?? this.models[0]);

    const { front, rolledRight, rolledUp } = aircraftBasis(
      object.yaw || 0,
      object.pitch || 0,
      object.roll || 0
    );
    const modelScale = object.scale ?? 1;

    const pointSize = structure
      ? object.size ?? 3.4
      : effect
        ? object.size ?? 3
        : isFlame
          ? 1.5
          : 0.5 * (planes[planeType]?.size ?? 1);

    const values: Record<string, number | Vec3> = {
      origin: object.pos,
      axisX: scale(rolledRight, modelScale),
      axisY: scale(rolledUp, modelScale),
      axisZ: scale(front, modelScale),
      size: pointSize,
      emissive: Number(Boolean(effect || isFlame || structure)),
      tintStrength: Number(Boolean(object.tint)),
      tint: object.tint ?? [0, 0, 0],
    };
    for (const [name, value] of Object.entries(values)) this.uniform(this.points, name, value);
    this.pointAttributes(model.buffer);
    gl.drawArrays(gl.POINTS, 0, model.count);
  }
}

export function cameraAt(eye: Vec3, target: Vec3, roll = 0, fov = 0.65): CameraState {
  const front = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  let right = norm(cross([0, 1, 0], front));
  if (Math.hypot(right[0], right[1], right[2]) < 0.01) right = [1, 0, 0];
  const up = cross(front, right);
  return {
    eye,
    front,
    fov,
    right: add(scale(right, Math.cos(roll)), scale(up, Math.sin(roll))),
    up: add(scale(up, Math.cos(roll)), scale(right, -Math.sin(roll))),
  };
}
