import type { FlightState, MissionState, Vec3 } from './types';
import type { CameraState } from './renderer';
import {
  add,
  centralRefuelPosition,
  clamp,
  dist3,
  dot,
  forward,
  GLACIER_VAULT,
  height,
  scale,
  sub,
  VOLCANO,
} from './world';
import { isAircraft } from './combat';
import { RELAYS, relayPosition } from './campaign';

const size = 192;
const center = size / 2;
const frame = '#9bdfdf';
const hazard = '#ff6b62';
const objective = '#87f4ce';

export class Radar {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  surface: HTMLCanvasElement;
  relays: Array<{ x: number; y: number; id: string }>;
  lastTerrain: string | null;
  tileCenter: [number, number];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.surface = document.createElement('canvas');
    this.surface.width = this.surface.height = 48;
    this.relays = [];
    this.lastTerrain = null;
    this.tileCenter = [0, 0];
  }

  tile(flight: FlightState, map: number, range: number): void {
    const n = this.surface.width;
    const stride = (range * 182) / 78 / n;
    const x = Math.round(flight.pos[0] / stride) * stride;
    const z = Math.round(flight.pos[2] / stride) * stride;
    const key = [x, z, map, range].join('/');
    if (key === this.lastTerrain) return;
    this.lastTerrain = key;
    this.tileCenter = [x, z];
    const ctx = this.surface.getContext('2d')!;
    const texture = ctx.createImageData(n, n);
    const data = texture.data;
    const ice = map === 1;
    for (let row = 0; row < n; row++) {
      const worldZ = z + (n / 2 - row - 0.5) * stride;
      for (let col = 0; col < n; col++) {
        const worldX = x + (col + 0.5 - n / 2) * stride;
        const m = height(worldX, worldZ, map);
        const level = Math.floor(m / 42) * 4;
        const dilate =
          map === 0
            ? Math.hypot(worldX - VOLCANO.x, worldZ - VOLCANO.z) < 365
            : Math.hypot(worldX - GLACIER_VAULT.x, worldZ - GLACIER_VAULT.z) < 335;
        const idx = (row * n + col) * 4;
        if (m <= 10) {
          data[idx] = 12;
          data[idx + 1] = 37;
          data[idx + 2] = 51;
        } else if (dilate) {
          if (ice) {
            data[idx] = 34 + level;
            data[idx + 1] = 78 + level;
            data[idx + 2] = 96 + level;
          } else {
            data[idx] = 70 + level;
            data[idx + 1] = 37 + level;
            data[idx + 2] = 29 + level;
          }
        } else if (ice) {
          data[idx] = 25 + level;
          data[idx + 1] = 51 + level;
          data[idx + 2] = 64 + level;
        } else {
          data[idx] = 38 + level;
          data[idx + 1] = 48 + level;
          data[idx + 2] = 42 + level;
        }
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(texture, 0, 0);
  }

  draw(flight: FlightState, mission: MissionState, map: number): void {
    const ctx = this.ctx;
    const range = mission.arena ? 1560 : mission.phase === 'relay' ? 2400 : 880;
    const pixelsPerUnit = 78 / range;
    const screen = (pos: Vec3): [number, number, boolean] => {
      const x = (pos[0] - flight.pos[0]) * pixelsPerUnit;
      const y = (flight.pos[2] - pos[2]) * pixelsPerUnit;
      const distance = Math.hypot(x, y);
      const limiter = Math.min(1, 81 / Math.max(1, distance));
      return [center + x * limiter, center + y * limiter, distance > 81];
    };

    this.tile(flight, map, range);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, 87, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    const shiftX = (this.tileCenter[0] - flight.pos[0]) * pixelsPerUnit;
    const shiftY = (flight.pos[2] - this.tileCenter[1]) * pixelsPerUnit;
    ctx.drawImage(this.surface, 5 + shiftX, 5 + shiftY, size - 10, size - 10);

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#80d0d449';
    for (const radius of [28, 55, 82]) {
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(11, center);
    ctx.lineTo(181, center);
    ctx.moveTo(center, 11);
    ctx.lineTo(center, 181);
    ctx.stroke();
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = frame;
    ctx.fillText('N', center - 3, 22);

    if (mission.arena) {
      const { center: arena, radius } = mission.arena;
      const x = center + (arena[0] - flight.pos[0]) * pixelsPerUnit;
      const y = center + (flight.pos[2] - arena[2]) * pixelsPerUnit;
      ctx.strokeStyle = '#ffc878bb';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, radius * pixelsPerUnit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Landmark ring & 4 tunnel mouths (Ashmouth on Map 0, Glacier Vault on Map 1)
    const lm = map === 0 ? VOLCANO : GLACIER_VAULT;
    const [lmX, lmY, lmOff] = screen([lm.x, 0, lm.z]);
    if (!lmOff) {
      ctx.strokeStyle = map === 0 ? '#e4a280ab' : '#7ae8ffbb';
      ctx.beginPath();
      ctx.arc(lmX, lmY, Math.max(3, lm.radius * pixelsPerUnit), 0, Math.PI * 2);
      ctx.stroke();
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const [exitX, exitY] = screen([lm.x + dx * (lm.radius - 60), 0, lm.z + dz * (lm.radius - 60)]);
        ctx.fillStyle = map === 0 ? '#fdbf8d' : '#94f4ff';
        ctx.fillRect(exitX - 2, exitY - 2, 4, 4);
      }
    }

    // Central Volcano Refuel & Rearm Station diamond icon
    const refuelPos = centralRefuelPosition(map);
    const [rfX, rfY] = screen(refuelPos);
    ctx.save();
    ctx.fillStyle = flight.lowFuel ? '#ff7b66' : '#45ffd2';
    ctx.strokeStyle = '#e8fff9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rfX, rfY - 5);
    ctx.lineTo(rfX + 5, rfY);
    ctx.lineTo(rfX, rfY + 5);
    ctx.lineTo(rfX - 5, rfY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Ground targets
    for (const gt of mission.groundTargets) {
      if (gt.destroyed) continue;
      const [gx, gy] = screen(gt.pos);
      ctx.fillStyle = gt.friendly ? '#84dcf6' : '#ffb84d';
      ctx.fillRect(gx - 3, gy - 3, 6, 6);
    }

    // Next checkpoint / rearm ring
    for (const ring of mission.rings) {
      if (ring.passed) continue;
      if (mission.phase === 'rings' && ring !== mission.rings[mission.nextRingIndex]) continue;
      const [rx, ry] = screen(ring.pos);
      ctx.strokeStyle = ring.isRearm ? '#45ff9a' : '#ffe066';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rx, ry, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Aircraft blips
    for (const plane of [...mission.allies, ...mission.enemies]) {
      const [x, y] = screen(plane.pos);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(plane.yaw);
      ctx.fillStyle = plane.friendly ? '#84dcf6' : plane.isBoss ? '#ffae42' : hazard;
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(4, 4);
      ctx.lineTo(0, 2);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Incoming enemy missiles
    for (const shot of mission.shots) {
      if (shot.kind !== 'enemyMissile') continue;
      const [mx, my] = screen(shot.pos);
      ctx.fillStyle = '#fff08a';
      ctx.fillRect(mx - 2, my - 2, 4, 4);
    }

    this.relays = [];
    if (mission.phase === 'relay') {
      for (const relay of RELAYS) {
        const [x, y] = screen(relayPosition(relay, map));
        this.relays.push({ x, y, id: relay.id });
        ctx.fillStyle = mission.chosenRelay === relay.id ? '#ddff88' : objective;
        ctx.fillRect(x - 7, y - 7, 14, 14);
        ctx.fillStyle = '#092529';
        ctx.fillText(relay.id, x - 3, y + 4);
      }
    }

    ctx.translate(center, center);
    ctx.rotate(flight.yaw);
    ctx.fillStyle = '#f9fcdf';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#99e5df82';
    ctx.beginPath();
    ctx.arc(center, center, 87, 0, Math.PI * 2);
    ctx.stroke();
  }

  pick(event: MouseEvent): string | undefined {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return undefined;
    const x = ((event.clientX - rect.left) * size) / rect.width;
    const y = ((event.clientY - rect.top) * size) / rect.height;
    return this.relays.find((m) => Math.hypot(m.x - x, m.y - y) < 14)?.id;
  }

  reset(): void {
    this.relays = [];
    this.lastTerrain = null;
    this.tileCenter = [0, 0];
    this.ctx.clearRect(0, 0, size, size);
  }

  dispose(): void {
    this.reset();
  }
}

function project(point: Vec3, camera: CameraState, width: number, height: number): [number, number] | null {
  const relative = sub(point, camera.eye);
  const depth = dot(relative, camera.front);
  if (depth < 4) return null;
  return [
    width * 0.5 + (dot(relative, camera.right) / depth / camera.fov) * height * 0.5,
    height * 0.5 - (dot(relative, camera.up) / depth / camera.fov) * height * 0.5,
  ];
}

function drawEdgeArrow(
  ctx: CanvasRenderingContext2D,
  point: Vec3,
  camera: CameraState,
  width: number,
  height: number,
  color: string,
  label?: string
): void {
  const rel = sub(point, camera.eye);
  const rx = dot(rel, camera.right);
  const ry = dot(rel, camera.up);
  const rz = dot(rel, camera.front);
  const onScreen =
    rz > 4 &&
    Math.abs((rx / rz / camera.fov) * (height / width)) < 0.92 &&
    Math.abs(ry / rz / camera.fov) < 0.92;
  if (onScreen) return;

  const angle = Math.atan2(-ry, rx);
  const padX = width * 0.43;
  const padY = height * 0.41;
  const ax = width * 0.5 + Math.cos(angle) * padX;
  const ay = height * 0.5 + Math.sin(angle) * padY;

  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, -4);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (label) {
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = color;
    ctx.fillText(label, clamp(ax - 12, 10, width - 38), clamp(ay + 12, 12, height - 8));
  }
}

export function drawCombatHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: CameraState,
  flight: FlightState,
  mission: MissionState,
  map: number,
  mouseAimCursor?: [number, number] | null
): void {
  if (flight.death > 0) return;
  const aim = project(add(flight.pos, scale(forward(flight.yaw, flight.pitch), 750)), camera, width, height);
  ctx.save();

  // Mouse-aim cursor reticle
  if (mouseAimCursor) {
    const cx = (mouseAimCursor[0] * 0.5 + 0.5) * width;
    const cy = (0.5 - mouseAimCursor[1] * 0.5) * height;
    ctx.strokeStyle = '#99f0da88';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Main gun crosshair
  if (aim && mission.phase !== 'complete') {
    const [x, y] = aim;
    const r = Math.max(7, height * 0.016);
    ctx.strokeStyle = mission.target ? '#ffd37a' : '#b3efdbb3';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x - r * 0.42, y);
    ctx.moveTo(x + r * 0.42, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y - r * 0.42);
    ctx.moveTo(x, y + r * 0.42);
    ctx.lineTo(x, y + r);
    ctx.stroke();

    // Hit marker X
    if (mission.hitMarker > 0) {
      ctx.strokeStyle = '#ffdf78';
      ctx.lineWidth = 1.6;
      const hr = r * 0.9;
      ctx.beginPath();
      ctx.moveTo(x - hr, y - hr);
      ctx.lineTo(x - hr * 0.35, y - hr * 0.35);
      ctx.moveTo(x + hr, y - hr);
      ctx.lineTo(x + hr * 0.35, y - hr * 0.35);
      ctx.moveTo(x - hr, y + hr);
      ctx.lineTo(x - hr * 0.35, y + hr * 0.35);
      ctx.moveTo(x + hr, y + hr);
      ctx.lineTo(x + hr * 0.35, y + hr * 0.35);
      ctx.stroke();
    }

    // Locked target box, HP bar, range, and dynamic gun lead-indicator pip
    if (mission.target) {
      const t = mission.target;
      const marker = project(t.pos, camera, width, height);
      const range = Math.round(dist3(flight.pos, t.pos));
      if (marker) {
        const [tx, ty] = marker;
        const box = r + 4;
        ctx.strokeStyle = '#ffd37a';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(tx - box, ty - box, box * 2, box * 2);

        // Target HP bar & range label
        const hpRatio = clamp(t.hp / Math.max(1, t.maxHp), 0, 1);
        ctx.fillStyle = '#10242c';
        ctx.fillRect(tx - box, ty - box - 5, box * 2, 3);
        ctx.fillStyle = hpRatio < 0.35 ? '#ff6454' : '#ffd37a';
        ctx.fillRect(tx - box, ty - box - 5, box * 2 * hpRatio, 3);
        ctx.font = 'bold 8px monospace';
        ctx.fillStyle = '#ffd37a';
        ctx.fillText(`${t.name} · ${range}M`, tx + box + 4, ty + 3);
      }

      // Dynamic gun lead pip for moving aircraft
      if (isAircraft(t)) {
        const leadTime = range / 1020;
        const leadPos = add(t.pos, scale(forward(t.yaw, t.pitch), t.speed * leadTime));
        const pip = project(leadPos, camera, width, height);
        if (pip) {
          ctx.strokeStyle = '#8ef4ce';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(pip[0], pip[1], 4.5, 0, Math.PI * 2);
          ctx.stroke();
          if (marker) {
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(marker[0], marker[1]);
            ctx.lineTo(pip[0], pip[1]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }
  }

  // Off-screen directional arrows for hostiles and incoming missiles
  for (const enemy of mission.enemies) {
    drawEdgeArrow(
      ctx,
      enemy.pos,
      camera,
      width,
      height,
      enemy.isBoss ? '#ffb84d' : '#ff6b62',
      enemy.isBoss ? 'ACE' : undefined
    );
  }
  for (const shot of mission.shots) {
    if (shot.kind === 'enemyMissile' && shot.target === flight) {
      drawEdgeArrow(ctx, shot.pos, camera, width, height, '#fff078', 'MSL');
    }
  }

  // Next checkpoint / rearm ring waypoint diamond
  const activeRing =
    mission.phase === 'rings'
      ? mission.rings[mission.nextRingIndex]
      : mission.rings.find((r) => r.isRearm && !r.passed);
  if (activeRing) {
    const pt = project(activeRing.pos, camera, width, height);
    const d = Math.round(dist3(flight.pos, activeRing.pos));
    const col = activeRing.isRearm ? '#45ff9a' : '#ffe066';
    if (pt) {
      const rx = clamp(pt[0], 20, width - 24);
      const ry = clamp(pt[1], 20, height - 24);
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(rx, ry - 6);
      ctx.lineTo(rx + 6, ry);
      ctx.lineTo(rx, ry + 6);
      ctx.lineTo(rx - 6, ry);
      ctx.closePath();
      ctx.stroke();
      ctx.font = 'bold 9px monospace';
      ctx.fillText(
        (activeRing.isRearm ? 'REARM · ' : `RING ${activeRing.id} · `) + d + 'M',
        Math.min(rx + 9, width - 78),
        ry + 3
      );
    } else {
      drawEdgeArrow(ctx, activeRing.pos, camera, width, height, col, activeRing.isRearm ? 'REARM' : 'RING');
    }
  }

  // Central Volcano Refuel & Rearm 3D diamond icon
  const depotPos = centralRefuelPosition(map);
  const depotDist = Math.round(dist3(flight.pos, depotPos));
  const depotPt = project(depotPos, camera, width, height);
  if (depotPt) {
    const dx = clamp(depotPt[0], 22, width - 24);
    const dy = clamp(depotPt[1], 22, height - 24);
    const depotColor = flight.lowFuel || flight.flameout ? '#58ffd7' : '#45ffd2bb';
    ctx.strokeStyle = depotColor;
    ctx.fillStyle = depotColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(dx, dy - 7);
    ctx.lineTo(dx + 7, dy);
    ctx.lineTo(dx, dy + 7);
    ctx.lineTo(dx - 7, dy);
    ctx.closePath();
    ctx.stroke();
    ctx.font = 'bold 9px monospace';
    ctx.fillText(`REFUEL · ${depotDist}M`, Math.min(dx + 10, width - 86), dy + 3);
  } else if (flight.lowFuel || flight.flameout) {
    drawEdgeArrow(ctx, depotPos, camera, width, height, '#45ffd2', 'REFUEL');
  }

  // Relay objective diamond
  const currentRelay = mission.phase === 'relay' && RELAYS.find((r) => r.id === mission.chosenRelay);
  if (currentRelay) {
    const position = relayPosition(currentRelay, map);
    const delta = sub(position, flight.pos);
    const point = project(position, camera, width, height);
    if (point) {
      const x = clamp(point[0], 22, width - 24);
      const y = clamp(point[1], 22, height - 24);
      ctx.strokeStyle = objective;
      ctx.fillStyle = objective;
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.stroke();
      ctx.font = 'bold 9px monospace';
      ctx.fillText(
        currentRelay.id + ' · ' + Math.round(Math.hypot(delta[0], delta[1], delta[2])) + ' M',
        Math.min(x + 9, width - 67),
        y + 3
      );
    }
  }

  ctx.restore();
}
