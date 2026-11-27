import type { FlightState, MissionState } from './types';
import { missileWarning } from './combat';

const glass = '#a8f5bf';
const trim = '#293543';
const outline = '#101823';
const edge = '#586474';
const amber = '#f39b55';
const danger = '#ff6b57';

const CANOPY_ARCHES: Array<Array<[number, number]>> = [
  // 0: Needle F-5 (classic rounded twin-arch)
  [[-12, 135], [12, 106], [43, 76], [80, 49], [125, 27], [176, 10], [227, -1], [274, -8]],
  // 1: Mirage M-III (heavy angular delta frame)
  [[-10, 148], [22, 108], [62, 68], [110, 38], [168, 18], [238, 6], [285, -4]],
  // 2: Spectre SU-27 (wide bubble canopy)
  [[-12, 118], [14, 88], [48, 56], [96, 30], [156, 12], [224, -4], [270, -10]],
  // 3: Wraith YF-23 (faceted stealth canopy)
  [[-12, 128], [32, 92], [86, 52], [155, 22], [240, 2], [282, -8]],
  // 4: Valkyrie XV-9 (sleek experimental teardrop)
  [[-10, 122], [18, 90], [60, 58], [116, 32], [186, 10], [256, -6]],
];

export function drawCockpit(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  flight: FlightState,
  mission: MissionState | null,
  opacity: number,
  aglClearance = 100
): void {
  if (!opacity) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.scale(width / 640, height / 360);

  const path = (
    points: Array<[number, number]>,
    fill: string | null,
    stroke: string | null,
    lineWidth = 1
  ) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (fill) {
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  };
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const text = (
    value: string,
    x: number,
    y: number,
    size = 10,
    align: CanvasTextAlign = 'center',
    color = glass
  ) => {
    ctx.font = `bold ${size}px monospace`;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };

  const arch = CANOPY_ARCHES[flight.type] ?? CANOPY_ARCHES[0];
  const canopy = (points: Array<[number, number]>) => {
    path(points, null, outline, 11);
    path(points, null, edge, 7);
    path(points.map(([x, y]) => [x, y - 1]), null, trim, 5);
    for (const [first, last] of [[1, 2], [3, 4]]) {
      const a = points[first];
      const b = points[last];
      if (!a || !b) continue;
      const segment: Array<[number, number]> = [0.16, 0.86].map((t) => [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t - 1,
      ]);
      path(segment, null, '#733d28', 4);
      path(segment, null, amber, 2.5);
    }
    for (const [x, y] of points.slice(1, -1)) {
      rect(x - 1, y - 2, 2, 3, '#182330');
      rect(x, y - 2, 1, 1, '#9aa4ae');
    }
  };
  canopy(arch);
  canopy(arch.map(([x, y]) => [640 - x, y]));

  // Glare shield & instrument dash
  const seam: Array<[number, number]> = [
    [0, 294], [44, 315], [98, 337], [209, 337], [239, 320], [267, 316],
    [373, 316], [401, 320], [431, 337], [542, 337], [596, 315], [640, 294],
  ];
  path([...seam, [640, 360], [0, 360]], '#151e2a', null);
  path(seam, null, outline, 7);
  path(seam.map(([x, y]) => [x, y + 1]), null, edge, 2);
  path(
    [[0, 310], [42, 334], [93, 348], [215, 348], [250, 331], [390, 331], [425, 348], [547, 348], [598, 334], [640, 310]],
    null,
    '#333e4c',
    3
  );
  path([[294, 320], [346, 320], [340, 324], [300, 324]], '#854524', null);
  rect(301, 320, 38, 2, amber);

  // HUD glass symbology
  ctx.shadowColor = '#102f28b0';
  ctx.shadowBlur = 2;
  const speed = String(Math.round(flight.speed * 3.6)).padStart(3, '0');
  const altitude = String(Math.round(flight.pos[1])).padStart(4, '0');

  for (const [x, value, label, side] of [
    [212, speed, 'SPD', 1] as const,
    [428, altitude, 'ALT', -1] as const,
  ]) {
    text(value, x, 112, 11);
    text(label, x, 123, 7);
    path([[x, 129], [x, 211]], null, '#a8f5bfad');
    for (let row = 0; row <= 6; row++) {
      const y = 132 + row * 13;
      const length = row % 3 === 0 ? 7 : 4;
      path([[x, y], [x + length * side, y]], null, glass, 1);
    }
  }

  // Diegetic Fuel, Burn State & G-Load readout (left glass)
  const fuelRatio = flight.maxFuel > 0 ? Math.max(0, Math.min(1, flight.fuel / flight.maxFuel)) : 0;
  const fuelPct = Math.round(fuelRatio * 100);
  const fuelColor = flight.lowFuel || fuelRatio < 0.2 ? danger : fuelRatio < 0.4 ? amber : glass;
  const burnState = flight.flameout
    ? 'OUT'
    : flight.boost > 0.35
      ? 'AB'
      : flight.fuelBurnRate < 0.65
        ? 'IDL'
        : 'CRZ';
  text('FUEL', 184, 149, 7, 'right', fuelColor);
  rect(187, 152, 4, 58, '#1a3630');
  const fillH = Math.round(fuelRatio * 58);
  rect(187, 210 - fillH, 4, fillH, fuelColor);
  text(`${fuelPct}%`, 184, 212, 7, 'right', fuelColor);
  text(`G ${flight.gLoad.toFixed(1)}`, 212, 224, 8);
  text(`${burnState} ${flight.fuelBurnRate.toFixed(1)}/S`, 212, 234, 7, 'center', fuelColor);

  // Pitch ladder
  ctx.save();
  ctx.translate(320, 181);
  ctx.rotate(-flight.roll);
  const vertical = Math.sin(flight.pitch) * 69;
  for (let i = -2; i <= 2; i++) {
    const y = Math.round(vertical + i * 17);
    const length = i === 0 ? 57 : 26;
    path([[-length, y], [-16, y]], null, i === 0 ? glass : '#a8f5bf85');
    path([[16, y], [length, y]], null, i === 0 ? glass : '#a8f5bf85');
  }
  ctx.restore();

  // Heading tape
  const heading = ((Math.round((flight.yaw * 180) / Math.PI) % 360) + 360) % 360;
  text(String(heading).padStart(3, '0') + '°', 320, 232, 10);
  path([[273, 242], [367, 242]], null, '#a8f5bfaf');
  for (let i = 0; i < 13; i++) {
    const x = 278 + i * 7;
    path([[x, 242], [x, 238 - (i % 3 === 0 ? 3 : 0)]], null, glass);
  }

  // Diegetic Weapons & Lock Status inside HUD glass
  if (mission) {
    const { arms } = mission;
    text(`MSL ${arms.missiles}`, 428, 224, 8, 'center', arms.missiles > 0 ? glass : amber);
    text(`RKT ${arms.rockets}`, 428, 234, 8, 'center', arms.rockets > 0 ? glass : '#89a89d');
    text(`FLR ${arms.flaresLeft}`, 428, 244, 8, 'center', arms.flare > 0 ? amber : glass);

    // Gun heat bar on right HUD glass
    rect(450, 152, 4, 58, '#1a3630');
    const heatH = Math.round(arms.heat * 58);
    rect(450, 210 - heatH, 4, heatH, arms.overheated ? danger : arms.heat > 0.7 ? amber : glass);

    if (mission.target) {
      text('LOCK', 320, 104, 9, 'center', amber);
    }

    // 360-degree Radar Warning Receiver (RWR) dial on lower-left glare shield
    const rwrX = 165;
    const rwrY = 304;
    const rwrR = 22;
    ctx.beginPath();
    ctx.arc(rwrX, rwrY, rwrR, 0, Math.PI * 2);
    ctx.fillStyle = '#09181ee6';
    ctx.fill();
    ctx.strokeStyle = '#6ec9ad88';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    text('RWR', rwrX, rwrY + 3, 6, 'center', '#7cd4b7');

    for (const enemy of mission.enemies) {
      const dx = enemy.pos[0] - flight.pos[0];
      const dz = enemy.pos[2] - flight.pos[2];
      const relAngle = Math.atan2(dx, dz) - flight.yaw;
      const dist = Math.hypot(dx, dz);
      const rr = Math.min(rwrR - 4, (dist / 1200) * (rwrR - 4));
      const bx = rwrX + Math.sin(relAngle) * rr;
      const by = rwrY - Math.cos(relAngle) * rr;
      rect(bx - 1.5, by - 1.5, 3, 3, enemy.isBoss ? amber : danger);
    }

    // Warnings (MISSILE, FLAMEOUT, STALL, PULL UP, BINGO FUEL)
    const incoming = mission.mode === 'crew' ? Boolean(mission.incoming) : missileWarning(mission, flight);
    if (incoming) {
      text('MISSILE ALERT', 320, 134, 10, 'center', danger);
    } else if (flight.flameout) {
      text('ENGINE FLAMEOUT', 320, 134, 10, 'center', danger);
    } else if (flight.stalling) {
      text('STALL · NOSE DOWN', 320, 134, 10, 'center', danger);
    } else if (aglClearance < 26 && flight.pitch < -0.15) {
      text('PULL UP', 320, 134, 11, 'center', danger);
    }
    if (flight.lowFuel && !flight.flameout) {
      text('BINGO FUEL', 320, 146, 9, 'center', danger);
    }
  }

  ctx.restore();
}
