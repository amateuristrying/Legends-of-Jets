import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AtmospherePreset,
  BotDifficulty,
  ControlInput,
  FlightState,
  GameMode,
  GameSettings,
  MissionState,
  PilotLog,
  SkirmishConfig,
  Vec3,
} from './engine/types';
import {
  add,
  centralRefuelPosition,
  clamp,
  forward,
  GLACIER_VAULT,
  height,
  maps,
  mix,
  planes,
  pruneTrail,
  recordTrailSample,
  resetTerrainDamage,
  scale,
  solidAt,
  VOLCANO,
  wingtipPositions,
} from './engine/world';
import { cameraAt, Renderer, type CameraState, type RenderObject, type TrailSample } from './engine/renderer';
import { interpolateFlight, newFlight, SIM_STEP, stepFlight, views } from './engine/flight';
import { drawCockpit } from './engine/cockpit';
import { drawCombatHud, Radar } from './engine/radar';
import { missileWarning } from './engine/combat';
import { CAMPAIGN_LEVELS, getCampaignLevel, RELAYS, relayPosition } from './engine/campaign';
import { createMission, selectRelay, stepMission } from './engine/modes';
import { TacticalAudio } from './engine/audio';
import {
  isPlaneUnlocked,
  loadPilotLog,
  loadSettings,
  recordCampaignClear,
  savePilotLog,
  saveSettings,
} from './engine/storage';
import { CrewClient, type CrewSnapshot } from './engine/crew';
import { CampaignModal } from './components/CampaignModal';
import { CrewModal } from './components/CrewModal';
import { SettingsModal } from './components/SettingsModal';
import { PilotLogModal } from './components/PilotLogModal';

type ModalId =
  | null
  | 'maps'
  | 'planes'
  | 'settings'
  | 'campaign'
  | 'skirmish'
  | 'timetrial'
  | 'pilotlog'
  | 'crew'
  | 'pause'
  | 'debrief'
  | 'crew-results';

interface HudSnapshot {
  speed: number;
  altitude: number;
  clearance: number;
  groundPct: number;
  altPct: number;
  hull: number;
  maxHull: number;
  dead: boolean;
  stalling: boolean;
  fuelPct: number;
  fuelBurnRate: number;
  lowFuel: boolean;
  flameout: boolean;
  heat: number;
  overheated: boolean;
  missiles: number;
  rockets: number;
  flareText: string;
  flaresLeft: number;
  kills: number;
  hostilesLeft: number;
  missileAlert: boolean;
  objective: string;
  radio: string;
  phase: MissionState['phase'];
  chosenRelay: string | null;
  killFeed: MissionState['killFeed'];
  timeLimit: number | null;
  crewClock?: string;
  crewScore?: string;
  crewOutside?: number | null;
  crewConnected: boolean;
  pingMs: number | null;
}

const INITIAL_HUD: HudSnapshot = {
  speed: 0,
  altitude: 0,
  clearance: 0,
  groundPct: 0,
  altPct: 0,
  hull: 100,
  maxHull: 100,
  dead: false,
  stalling: false,
  fuelPct: 100,
  fuelBurnRate: 1,
  lowFuel: false,
  flameout: false,
  heat: 0,
  overheated: false,
  missiles: 3,
  rockets: 6,
  flareText: 'READY',
  flaresLeft: 4,
  kills: 0,
  hostilesLeft: 0,
  missileAlert: false,
  objective: '',
  radio: '',
  phase: 'free-flight',
  chosenRelay: null,
  killFeed: [],
  timeLimit: null,
  crewConnected: true,
  pingMs: null,
};

function clearCamera(position: Vec3, desired: Vec3, map: number): Vec3 {
  const offset: Vec3 = [
    desired[0] - position[0],
    desired[1] - position[1],
    desired[2] - position[2],
  ];
  const point = (fraction: number): Vec3 => add(position, scale(offset, fraction));
  const steps = Math.ceil(Math.hypot(offset[0], offset[1], offset[2]) / 9);
  for (let step = 1; step <= steps; step++) {
    let past = step / steps;
    const p = point(past);
    if (!solidAt(p[0], p[1], p[2], map, 3)) continue;
    let before = (step - 1) / steps;
    for (let refine = 0; refine < 4; refine++) {
      const middle = (before + past) / 2;
      const mp = point(middle);
      if (solidAt(mp[0], mp[1], mp[2], map, 3)) past = middle;
      else before = middle;
    }
    return point(before);
  }
  return desired;
}

export const App: React.FC = () => {
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [pilotLog, setPilotLog] = useState<PilotLog>(() => loadPilotLog());
  const [scene, setScene] = useState<'hangar' | 'flight'>('hangar');
  const [modal, setModal] = useState<ModalId>(null);
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState('Building terrain, caverns & aircraft');
  const [toastMsg, setToastMsg] = useState<string>('');
  const [mapVisible, setMapVisible] = useState(true);
  const [viewIndex, setViewIndex] = useState(0);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [skirmishCfg, setSkirmishCfg] = useState<SkirmishConfig>({
    map: 0,
    atmosphere: 'day',
    difficulty: 'veteran',
    preset: '2v2',
  });

  // Mutable simulation refs for zero-overhead 120Hz loop
  const settingsRef = useRef(settings);
  const pilotLogRef = useRef(pilotLog);
  const sceneStateRef = useRef(scene);
  const modalRef = useRef(modal);
  const mapVisibleRef = useRef(mapVisible);
  const viewRef = useRef(viewIndex);

  settingsRef.current = settings;
  pilotLogRef.current = pilotLog;
  sceneStateRef.current = scene;
  modalRef.current = modal;
  mapVisibleRef.current = mapVisible;
  viewRef.current = viewIndex;

  const rendererRef = useRef<Renderer | null>(null);
  const radarRef = useRef<Radar | null>(null);
  const audioRef = useRef<TacticalAudio | null>(null);
  const crewRef = useRef<CrewClient | null>(null);
  if (!crewRef.current) crewRef.current = new CrewClient();

  const flightRef = useRef<FlightState>(newFlight(0));
  const prevFlightRef = useRef<FlightState>(newFlight(0));
  const missionRef = useRef<MissionState | null>(null);
  const trailRef = useRef<TrailSample[]>([]);
  const lastTrailRef = useRef(-1);
  const simTimeRef = useRef(0);
  const keysRef = useRef<Set<string>>(new Set());
  const pressedRef = useRef<Set<string>>(new Set());
  const rollQueuedRef = useRef(false);
  const pointerRef = useRef<[number, number] | null>(null);

  const lastCameraRef = useRef<{ eye: Vec3; target: Vec3; roll: number; fov: number } | null>(null);
  const transitionRef = useRef<{
    from: { eye: Vec3; target: Vec3; roll: number; fov: number };
    opacity: number;
    elapsed: number;
  } | null>(null);
  const displayedCockpitRef = useRef(0);

  // Crew sync refs
  const crewLatestRef = useRef<CrewSnapshot | null>(null);
  const crewPrevRef = useRef<CrewSnapshot | null>(null);
  const crewSyncedRef = useRef<CrewSnapshot | null>(null);
  const crewReceivedRef = useRef(0);
  const crewIdRef = useRef<string | null>(null);
  const crewConnectedRef = useRef(true);

  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(''), 2600);
  }, []);

  const updateSettings = useCallback((patch: Partial<GameSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const activateAudio = useCallback(() => {
    if (!settingsRef.current.sound && !settingsRef.current.music) return;
    try {
      if (!audioRef.current) audioRef.current = new TacticalAudio();
      if (audioRef.current.context.state === 'suspended') {
        audioRef.current.context.resume().catch(() => {});
      }
    } catch {
      /* audio optional */
    }
  }, []);

  const activeMap = useCallback((): number => {
    const m = missionRef.current;
    if (sceneStateRef.current === 'flight' && m) {
      if (m.mode === 'crew' && crewLatestRef.current) return crewLatestRef.current.rules.map;
      if (m.mode === 'story' && m.level) return m.level.map;
      if (m.mode === 'skirmish' && m.skirmishConfig) return m.skirmishConfig.map;
      if (m.mode === 'timetrial') return m.timeTrialCourse === 'glacier' ? 1 : 0;
    }
    return settingsRef.current.map;
  }, []);

  const activeAtmosphere = useCallback((): AtmospherePreset => {
    const m = missionRef.current;
    if (sceneStateRef.current === 'flight' && m) {
      if (m.mode === 'crew' && crewLatestRef.current) {
        return crewLatestRef.current.rules.night ? 'night' : 'day';
      }
      if (m.mode === 'story' && m.level) return m.level.atmosphere;
      if (m.mode === 'skirmish' && m.skirmishConfig) return m.skirmishConfig.atmosphere;
    }
    return settingsRef.current.atmosphere;
  }, []);

  const launchMode = useCallback(
    (
      mode: GameMode,
      opts?: {
        caldera?: boolean;
        glacier?: boolean;
        levelId?: number;
        skirmish?: SkirmishConfig;
        timeTrialCourse?: 'caldera' | 'glacier';
      }
    ) => {
      if (!rendererRef.current) return;
      setModal(null);
      if (mode !== 'crew') crewRef.current?.disconnect();
      activateAudio();

      const lvl = mode === 'story' ? getCampaignLevel(opts?.levelId ?? 1) : undefined;
      const map =
        mode === 'crew' && crewLatestRef.current
          ? crewLatestRef.current.rules.map
          : mode === 'story' && lvl
            ? lvl.map
            : mode === 'skirmish' && opts?.skirmish
              ? opts.skirmish.map
              : mode === 'timetrial'
                ? opts?.timeTrialCourse === 'glacier'
                  ? 1
                  : 0
                : opts?.glacier
                  ? 1
                  : opts?.caldera
                    ? 0
                    : settingsRef.current.map;

      rendererRef.current.prepare(map);
      resetTerrainDamage();

      let position: Vec3;
      if (mode === 'story' && lvl) {
        position = [...lvl.spawnPos] as Vec3;
      } else if (opts?.caldera || opts?.timeTrialCourse === 'caldera') {
        position = [VOLCANO.x, VOLCANO.tunnelAltitude, VOLCANO.z - 436];
      } else if (opts?.glacier || opts?.timeTrialCourse === 'glacier') {
        position = [GLACIER_VAULT.x, GLACIER_VAULT.tunnelAltitude, GLACIER_VAULT.z - 420];
      } else {
        position = map === 0 ? [0, 260, -680] : [-420, 280, -640];
      }

      const ownCrew =
        mode === 'crew' && crewLatestRef.current
          ? crewLatestRef.current.pilots.find((p) => p.id === crewIdRef.current)
          : null;

      const crewFuelCap = ownCrew ? (planes[ownCrew.flight.type] ?? planes[0]).fuelCapacity : 240;
      const f = ownCrew
        ? {
            ...ownCrew.flight,
            maxHull: 100,
            fuel: crewFuelCap,
            maxFuel: crewFuelCap,
            fuelBurnRate: 1,
            lowFuel: false,
            flameout: false,
            stalling: false,
            gLoad: 1,
          }
        : newFlight(settingsRef.current.plane, position);
      flightRef.current = f;
      prevFlightRef.current = { ...f, pos: [...f.pos] as Vec3 };

      const m = createMission(mode, f, {
        levelId: opts?.levelId,
        skirmish: opts?.skirmish,
        timeTrialCourse: opts?.timeTrialCourse,
        map,
      });
      if (opts?.caldera) {
        m.message = 'ASHMOUTH CALDERA • Enter at 137 m · B airbrake · Four cardinal exits';
      } else if (opts?.glacier) {
        m.message = 'GLACIER VAULT • Enter at 124 m · Four crystalline tunnels + skylight';
      }
      missionRef.current = m;
      crewSyncedRef.current = null;
      simTimeRef.current = 0;
      trailRef.current = [];
      lastTrailRef.current = -1;
      keysRef.current.clear();
      pressedRef.current.clear();
      rollQueuedRef.current = false;
      radarRef.current?.reset();
      lastCameraRef.current = null;
      transitionRef.current = null;
      displayedCockpitRef.current = 0;
      setViewIndex(0);
      setMapVisible(true);
      setScene('flight');

      setPilotLog((prev) => {
        const next = { ...prev, totalSorties: prev.totalSorties + 1 };
        savePilotLog(next);
        return next;
      });
    },
    [activateAudio]
  );

  const returnToHangar = useCallback((keepLobby = false) => {
    trailRef.current = [];
    lastTrailRef.current = -1;
    resetTerrainDamage();
    setScene('hangar');
    if (!keepLobby) crewRef.current?.disconnect();
    setModal(null);
  }, []);

  // Instantiate Radar when flight HUD mounts #radar and dispose cleanly on hangar return
  useEffect(() => {
    if (scene !== 'flight' || !radarCanvasRef.current) {
      radarRef.current?.dispose();
      radarRef.current = null;
      return;
    }
    const radar = new Radar(radarCanvasRef.current);
    radarRef.current = radar;
    return () => {
      radar.dispose();
      if (radarRef.current === radar) radarRef.current = null;
    };
  }, [scene]);

  const cycleView = useCallback(() => {
    if (sceneStateRef.current !== 'flight' || modalRef.current) return;
    if (lastCameraRef.current) {
      transitionRef.current = {
        from: lastCameraRef.current,
        opacity: displayedCockpitRef.current,
        elapsed: 0,
      };
    }
    setViewIndex((v) => (v + 1) % views.length);
  }, []);

  // Wire Crew WebSocket callbacks
  useEffect(() => {
    const crew = crewRef.current!;
    crew.onFrame = (snapshot, id) => {
      if (!id || !snapshot.pilots.some((p) => p.id === id)) return;
      const isNew =
        !crewLatestRef.current ||
        crewLatestRef.current.phase !== 'playing' ||
        snapshot.sequence < crewLatestRef.current.sequence ||
        sceneStateRef.current !== 'flight' ||
        missionRef.current?.mode !== 'crew';
      crewIdRef.current = id;
      crewPrevRef.current = isNew ? null : crewLatestRef.current;
      crewLatestRef.current = snapshot;
      crewReceivedRef.current = performance.now();
      if (snapshot.phase === 'playing' && isNew) launchMode('crew');
    };
    crew.onConnection = (ok) => {
      crewConnectedRef.current = ok;
    };
    crew.onClosed = (reason) => {
      if (sceneStateRef.current === 'flight' && missionRef.current?.mode === 'crew') {
        returnToHangar();
      }
      showToast(reason);
    };
  }, [launchMode, returnToHangar, showToast]);

  // Input listeners (customizable keys + mouse-aim + pointer + failed debrief Space retry)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const isTyping = Boolean(
        targetEl &&
          (targetEl.tagName === 'INPUT' ||
            targetEl.tagName === 'TEXTAREA' ||
            targetEl.tagName === 'SELECT' ||
            targetEl.isContentEditable)
      );
      if (
        modalRef.current === 'debrief' &&
        missionRef.current?.phase === 'failed' &&
        !isTyping &&
        (e.code === 'Space' || e.key === ' ') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (!e.repeat) {
          const failedMission = missionRef.current;
          launchMode(failedMission.mode, {
            levelId: failedMission.levelId,
            skirmish: failedMission.skirmishConfig,
            timeTrialCourse: failedMission.timeTrialCourse,
          });
        }
        return;
      }
      if (modalRef.current || sceneStateRef.current !== 'flight' || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') {
        if (!e.repeat) setModal('pause');
        return;
      }
      const b = settingsRef.current.bindings;
      const handled = new Set([
        ...Object.values(b),
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright',
        '1',
        '2',
        '3',
      ]);
      if (!handled.has(key)) return;
      e.preventDefault();
      keysRef.current.add(key);
      if (e.repeat) return;
      if (key === b.view) cycleView();
      if (key === b.roll) rollQueuedRef.current = true;
      if (key === b.map) setMapVisible((v) => !v);
      if (key === b.missile) pressedRef.current.add('missile');
      if (key === b.rocket) pressedRef.current.add('rocket');
      if (key === b.flare) pressedRef.current.add('flare');
      if ((key === '1' || key === '2' || key === '3') && missionRef.current) {
        selectRelay(missionRef.current, RELAYS[Number(key) - 1].id);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    const onBlur = () => {
      keysRef.current.clear();
      pressedRef.current.clear();
      pointerRef.current = null;
      rollQueuedRef.current = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (modalRef.current || sceneStateRef.current !== 'flight' || e.pointerType !== 'mouse') return;
      if (e.button === 0) keysRef.current.add('mouse-fire');
      if (e.button === 2) pressedRef.current.add('rocket');
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 0) keysRef.current.delete('mouse-fire');
    };
    const onPointerMove = (e: PointerEvent) => {
      if (
        sceneStateRef.current === 'flight' &&
        (settingsRef.current.pointer || settingsRef.current.mouseAim) &&
        e.pointerType === 'mouse'
      ) {
        pointerRef.current = [
          clamp((e.clientX / innerWidth - 0.5) * 2.6, -1, 1),
          clamp((0.5 - e.clientY / innerHeight) * 2.6, -1, 1),
        ];
      }
    };
    const onContext = (e: MouseEvent) => {
      if (sceneStateRef.current === 'flight') e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('contextmenu', onContext);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('contextmenu', onContext);
    };
  }, [cycleView, launchMode]);

  // Main WebGL2 + 120Hz simulation loop
  useEffect(() => {
    const canvas = sceneRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const ctx = overlay.getContext('2d')!;

    try {
      const r = new Renderer(canvas);
      r.prepare(settingsRef.current.map);
      rendererRef.current = r;
      setTimeout(() => setLoading(false), 650);
    } catch (err) {
      setLoadStatus('WebGL2 could not start. Enable hardware acceleration in your browser.');
      return;
    }

    let rafId = 0;
    let lastTime: number | undefined;
    let accumulator = 0;
    let hudTimer = -1;
    let radarTimer = 0;
    let logAccumulator = 0;
    const preview = { pos: [50, 630, -650] as Vec3, time: 0 };
    const prevPadButtons = { missile: false, rocket: false, flare: false, roll: false, view: false };

    const sampleInput = (): ControlInput => {
      const b = settingsRef.current.bindings;
      const ks = keysRef.current;
      const held = (...names: string[]) => Number(names.some((n) => ks.has(n)));
      let turn = held(b.right, 'arrowright') - held(b.left, 'arrowleft');
      let pitch = held(b.climb, 'arrowup') - held(b.dive, 'arrowdown');
      let boost = Boolean(held(b.boost));
      let brake = Boolean(held(b.brake));
      let fire = Boolean(held(b.gun, 'mouse-fire'));
      let missile = pressedRef.current.has('missile');
      let rocket = pressedRef.current.has('rocket');
      let flare = pressedRef.current.has('flare');
      let roll = rollQueuedRef.current;

      // Gamepad API support
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads?.[0];
      if (pad) {
        const dz = (v: number) => (Math.abs(v) > 0.14 ? v : 0);
        if (!turn) turn = dz(pad.axes[0] ?? 0);
        if (!pitch) pitch = dz(-(pad.axes[1] ?? 0));
        if (pad.buttons[7]?.pressed) boost = true; // RT
        if (pad.buttons[6]?.pressed) brake = true; // LT
        if (pad.buttons[0]?.pressed) fire = true; // A / Cross
        const mNow = Boolean(pad.buttons[1]?.pressed);
        const fNow = Boolean(pad.buttons[2]?.pressed);
        const rNow = Boolean(pad.buttons[3]?.pressed);
        const rktNow = Boolean(pad.buttons[5]?.pressed);
        const vNow = Boolean(pad.buttons[4]?.pressed);
        if (mNow && !prevPadButtons.missile) missile = true;
        if (fNow && !prevPadButtons.flare) flare = true;
        if (rNow && !prevPadButtons.roll) roll = true;
        if (rktNow && !prevPadButtons.rocket) rocket = true;
        if (vNow && !prevPadButtons.view) cycleView();
        prevPadButtons.missile = mNow;
        prevPadButtons.flare = fNow;
        prevPadButtons.roll = rNow;
        prevPadButtons.rocket = rktNow;
        prevPadButtons.view = vNow;
      }

      const deadzone = (v: number) => (Math.abs(v) > 0.06 ? v : 0);
      const steer =
        (settingsRef.current.pointer || settingsRef.current.mouseAim) && pointerRef.current
          ? pointerRef.current
          : ([0, 0] as [number, number]);

      const sens = settingsRef.current.sensitivity;
      rollQueuedRef.current = false;
      pressedRef.current.clear();

      return {
        turn: clamp((turn || deadzone(steer[0])) * sens, -1, 1),
        pitch: clamp(
          (pitch || deadzone(steer[1])) * (settingsRef.current.invert ? -1 : 1) * sens,
          -1,
          1
        ),
        boost,
        brake,
        roll,
        fire,
        missile,
        rocket,
        flare,
      };
    };

    const rememberPlayerTrail = (f: FlightState, t: number) => {
      if (f.death > 0) {
        pruneTrail(trailRef.current, t);
        return;
      }
      lastTrailRef.current = recordTrailSample(
        trailRef.current,
        lastTrailRef.current,
        f.pos,
        f.type,
        f.yaw,
        f.pitch,
        f.roll,
        t,
        0.045
      );
    };

    const frame = (timestamp: number) => {
      const dt = lastTime === undefined ? 0 : Math.min(0.1, (timestamp - lastTime) / 1000);
      lastTime = timestamp;
      const time = timestamp / 1000;
      const r = rendererRef.current;
      if (!r) return;

      const curMap = activeMap();
      const curAtmo = activeAtmosphere();
      let pose: FlightState | null = null;
      let camera: CameraState;
      let objects: RenderObject[] = [];
      let allTrails: TrailSample[][] = [];
      let aglClearance = 100;

      if (sceneStateRef.current === 'flight' && missionRef.current) {
        const m = missionRef.current;
        const f = flightRef.current;

        if (!modalRef.current) {
          logAccumulator += dt;
          if (logAccumulator >= 5) {
            const addSec = logAccumulator;
            logAccumulator = 0;
            setPilotLog((prev) => {
              const next = { ...prev, flightSeconds: prev.flightSeconds + addSec };
              savePilotLog(next);
              return next;
            });
          }

          if (m.mode === 'crew' && crewLatestRef.current && crewIdRef.current) {
            const cmd = sampleInput();
            crewRef.current?.sendControls(cmd, timestamp);
            const snap = crewLatestRef.current;
            const own = snap.pilots.find((p) => p.id === crewIdRef.current);
            if (own) {
              if (crewSyncedRef.current !== snap) {
                const srv = own.flight;
                const d = Math.hypot(
                  srv.pos[0] - f.pos[0],
                  srv.pos[1] - f.pos[1],
                  srv.pos[2] - f.pos[2]
                );
                const respawned = Boolean(srv.recovered) || (f.death > 0 && srv.death <= 0) || d > 42;
                if (respawned || (f.death > 0) !== (srv.death > 0)) {
                  Object.assign(f, srv);
                  prevFlightRef.current = { ...f, pos: [...f.pos] as Vec3 };
                  if (respawned) {
                    trailRef.current = [];
                    lastTrailRef.current = -1;
                  }
                } else {
                  const proj =
                    srv.death > 0
                      ? srv.pos
                      : add(srv.pos, scale(forward(srv.yaw, srv.pitch), srv.speed * 0.02));
                  f.pos = [
                    mix(f.pos[0], proj[0], 0.34),
                    mix(f.pos[1], proj[1], 0.34),
                    mix(f.pos[2], proj[2], 0.34),
                  ];
                  const arc = Math.atan2(Math.sin(srv.yaw - f.yaw), Math.cos(srv.yaw - f.yaw));
                  f.yaw += arc * 0.28;
                  f.hull = srv.hull;
                  f.death = srv.death;
                }
                crewSyncedRef.current = snap;
              }
              const frac = clamp((timestamp - crewReceivedRef.current) / 75, 0, 1);
              const contacts = snap.pilots
                .filter((p) => p.id !== crewIdRef.current && p.flight.death <= 0)
                .map((p) => {
                  const prior = crewPrevRef.current?.pilots.find((x) => x.id === p.id);
                  const jumpDist = prior
                    ? Math.hypot(
                        prior.flight.pos[0] - p.flight.pos[0],
                        prior.flight.pos[1] - p.flight.pos[1],
                        prior.flight.pos[2] - p.flight.pos[2]
                      )
                    : 999;
                  const fp =
                    prior && !p.flight.recovered && prior.flight.death <= 0 && jumpDist < 120
                      ? interpolateFlight(prior.flight, p.flight, frac)
                      : p.flight;
                  const friendly = p.team === own.team;
                  return {
                    id: p.id,
                    name: p.name,
                    type: fp.type,
                    pos: fp.pos,
                    yaw: fp.yaw,
                    pitch: fp.pitch,
                    roll: fp.roll,
                    bank: fp.bank,
                    speed: fp.speed,
                    boost: fp.boost,
                    friendly,
                    tint: friendly ? ([0.2, 0.72, 0.86] as Vec3) : ([0.86, 0.23, 0.21] as Vec3),
                    index: 0,
                    hp: fp.hull,
                    maxHp: 100,
                    fire: 0,
                    gunBurst: 0,
                    flareCooldown: 0,
                    missiles: 0,
                    difficulty: 'standard' as const,
                    trail: [],
                    lastTrailTime: 0,
                  };
                });
              m.phase = snap.phase === 'finished' ? 'crew-finished' : 'crew-playing';
              m.allies = contacts.filter((c) => c.friendly);
              m.enemies = contacts.filter((c) => !c.friendly);
              m.target = contacts.find((c) => c.id === own.target) ?? null;
              m.arms = { ...m.arms, ...own.arms };
              m.kills = own.points;
              m.message = own.message;
              m.incoming = own.incoming;
              m.arena = snap.arena;
              m.outside = own.outside;
              m.score = [snap.score[own.team], snap.score[1 - own.team]];
              m.remaining = Math.max(0, snap.remaining - Math.min(0.5, (timestamp - crewReceivedRef.current) / 1000));
              m.shots = snap.shots.map((s) => ({
                kind: s.kind === 'missile' && s.fromTeam !== own.team ? 'enemyMissile' : s.kind,
                pos: s.pos,
                velocity: [0, 0, 0],
                life: 1,
                size: s.size,
                damage: 0,
              }));
              m.effects = snap.effects.map((e) => ({
                kind: e.kind,
                pos: e.pos,
                velocity: [0, 0, 0],
                life: 1,
                size: e.size,
              }));
              if (snap.phase === 'playing') {
                accumulator += dt;
                while (accumulator >= SIM_STEP) {
                  prevFlightRef.current = { ...f, pos: [...f.pos] as Vec3 };
                  if (!own.flight.death) {
                    stepFlight(f, cmd, curMap, SIM_STEP, 'arcade');
                    if (f.death) {
                      f.pos = [...prevFlightRef.current.pos] as Vec3;
                      f.death = 0;
                      f.hull = own.flight.hull;
                    }
                  }
                  simTimeRef.current += SIM_STEP;
                  rememberPlayerTrail(f, simTimeRef.current);
                  accumulator -= SIM_STEP;
                  cmd.roll = false;
                }
              } else if (snap.phase === 'finished' && !modalRef.current) {
                setModal('crew-results');
              }
            }
          } else {
            accumulator += dt;
            while (accumulator >= SIM_STEP) {
              prevFlightRef.current = { ...f, pos: [...f.pos] as Vec3 };
              const cmd = sampleInput();
              const warningBefore = missileWarning(m, f);
              stepFlight(f, cmd, curMap, SIM_STEP, settingsRef.current.flightModel);
              const ev = stepMission(m, f, cmd, curMap, SIM_STEP);

              const aud = audioRef.current;
              if (aud) {
                if (ev.firedGun) aud.feedback('gun', settingsRef.current);
                if (ev.firedMissile) aud.feedback('missile', settingsRef.current);
                if (ev.firedRocket) aud.feedback('rocket', settingsRef.current);
                if (ev.firedFlare) aud.feedback('flare', settingsRef.current);
                if (ev.hitEnemy || ev.hitPlayer) aud.feedback('hit', settingsRef.current);
                if (ev.killedEnemy) aud.feedback('kill', settingsRef.current);
                if (ev.ringPassed) aud.feedback('ring', settingsRef.current);
                if (ev.rearmed) aud.feedback('restored', settingsRef.current);
                if (!warningBefore && missileWarning(m, f)) aud.feedback('incoming', settingsRef.current);
                if (ev.phaseChanged && m.phase === 'jammed') aud.feedback('jammed', settingsRef.current);
                if (ev.phaseChanged && m.signal) aud.feedback('restored', settingsRef.current);
              }

              if (ev.airKillsDelta > 0 || ev.groundKillsDelta > 0) {
                setPilotLog((prev) => {
                  const next = {
                    ...prev,
                    totalKills: prev.totalKills + ev.airKillsDelta,
                    totalGroundKills: prev.totalGroundKills + ev.groundKillsDelta,
                    bestSurvivalWave:
                      m.mode === 'survival' ? Math.max(prev.bestSurvivalWave, m.wave) : prev.bestSurvivalWave,
                    bestSurvivalKills:
                      m.mode === 'survival' ? Math.max(prev.bestSurvivalKills, m.kills) : prev.bestSurvivalKills,
                  };
                  savePilotLog(next);
                  return next;
                });
              }

              if (ev.phaseChanged && (m.phase === 'complete' || m.phase === 'failed')) {
                if (m.phase === 'complete') {
                  if (m.mode === 'story' && m.levelId) {
                    setPilotLog((prev) =>
                      recordCampaignClear(prev, m.levelId!, m.time, m.rank ?? 'A')
                    );
                  } else if (m.mode === 'timetrial' && m.timeTrialCourse) {
                    const course = m.timeTrialCourse;
                    setPilotLog((prev) => {
                      const old = prev.bestTimeTrials[course];
                      const next: PilotLog = {
                        ...prev,
                        bestTimeTrials: {
                          ...prev.bestTimeTrials,
                          [course]: old ? Math.min(old, m.time) : m.time,
                        },
                      };
                      savePilotLog(next);
                      return next;
                    });
                  }
                }
                setModal('debrief');
                accumulator = 0;
                break;
              }

              simTimeRef.current += SIM_STEP;
              if (f.recovered) {
                prevFlightRef.current = { ...f, pos: [...f.pos] as Vec3 };
                trailRef.current = [];
                lastTrailRef.current = -1;
                lastCameraRef.current = null;
                transitionRef.current = null;
              }
              rememberPlayerTrail(f, simTimeRef.current);
              accumulator -= SIM_STEP;
            }
          }
        }

        pose = interpolateFlight(prevFlightRef.current, f, accumulator / SIM_STEP);

        // Camera with smooth 1.4s Chase <-> Cockpit transition + camera shake
        const front = forward(pose.yaw, pose.pitch);
        const shakeAmt = m.shake * 2.4;
        const jitter: Vec3 = shakeAmt > 0.05
          ? [(Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt, 0]
          : [0, 0, 0];

        let eye: Vec3;
        let target: Vec3;
        let roll: number;
        let fov: number;
        if (viewRef.current === 1) {
          eye = add(pose.pos, add(scale(front, 4), [jitter[0] * 0.2, 3 + jitter[1] * 0.2, 0]));
          target = add(eye, front);
          roll = pose.roll;
          fov = 0.74;
        } else {
          eye = add(
            pose.pos,
            add(scale(front, -64 - pose.boost * 9), [jitter[0], 15 + jitter[1], 0])
          );
          target = add(pose.pos, add(scale(front, 15), [0, 4, 0]));
          roll = pose.bank * 0.16;
          fov = 0.59 + pose.boost * 0.06;
          eye = clearCamera(pose.pos, eye, curMap);
        }

        const to = { eye, target, roll, fov };
        const targetCockpit = Number(viewRef.current === 1);
        if (!transitionRef.current) {
          lastCameraRef.current = to;
          displayedCockpitRef.current = targetCockpit;
          camera = cameraAt(eye, target, roll, fov);
        } else {
          transitionRef.current.elapsed = Math.min(
            1.4,
            transitionRef.current.elapsed + (modalRef.current ? 0 : dt)
          );
          const t = transitionRef.current.elapsed / 1.4;
          const eased = t * t * (3 - 2 * t);
          const from = transitionRef.current.from;
          const blend = (a: Vec3, b: Vec3): Vec3 => [
            mix(a[0], b[0], eased),
            mix(a[1], b[1], eased),
            mix(a[2], b[2], eased),
          ];
          const shortest = Math.atan2(Math.sin(roll - from.roll), Math.cos(roll - from.roll));
          lastCameraRef.current = {
            eye: blend(from.eye, eye),
            target: blend(from.target, target),
            roll: from.roll + shortest * eased,
            fov: mix(from.fov, fov, eased),
          };
          displayedCockpitRef.current = mix(transitionRef.current.opacity, targetCockpit, eased);
          if (t >= 1) transitionRef.current = null;
          const clearEye = clearCamera(pose.pos, lastCameraRef.current.eye, curMap);
          camera = cameraAt(clearEye, lastCameraRef.current.target, lastCameraRef.current.roll, lastCameraRef.current.fov);
        }

        // Collect render objects (player, allies, enemies, ground structures, rings, shots, effects)
        if (pose.death <= 0 && displayedCockpitRef.current < 0.84) {
          objects.push(pose);
          if (pose.boost > 0.16) {
            const back = scale(front, -10 * (planes[pose.type]?.size ?? 1));
            objects.push({ ...pose, kind: 'flame', pos: add(pose.pos, back), scale: 1 + pose.boost * 1.4 });
          }
        }
        objects.push(...m.allies, ...m.enemies, ...m.shots, ...m.effects);

        // 3D Central Volcano Refuel & Rearm Beacon (all maps & modes)
        objects.push({
          kind: 'refuel',
          pos: centralRefuelPosition(curMap),
          scale: 1,
          size: 3.8,
        });
        // 3D ground structures (intact or smoking/charred ruins)
        for (const gt of m.groundTargets) {
          objects.push({
            kind: gt.destroyed ? `${gt.kind}_ruin` : gt.kind,
            pos: gt.pos,
            size: gt.destroyed ? 3.2 : 3.6,
          });
        }
        // 3D glowing rings
        for (const ring of m.rings) {
          if (ring.passed) continue;
          const isNext = m.phase !== 'rings' || ring === m.rings[m.nextRingIndex];
          objects.push({
            kind: ring.isRearm ? 'rearm' : 'ring',
            pos: ring.pos,
            scale: ring.radius / 28,
            size: isNext ? 4.2 : 2.2,
          });
        }
        if (m.phase === 'relay') {
          for (const rel of RELAYS) {
            objects.push({ kind: 'relay', pos: relayPosition(rel, curMap), size: 3.8 });
          }
        }

        // Universal contrails for player + all AI aircraft (anchored to live 3D wingtips)
        if (pose.death <= 0 && trailRef.current.length >= 1) {
          const liveTips = wingtipPositions(pose.pos, pose.type, pose.yaw, pose.pitch, pose.roll);
          allTrails.push([
            ...trailRef.current,
            { time: simTimeRef.current, left: liveTips.left, right: liveTips.right },
          ]);
        } else if (trailRef.current.length >= 2) {
          allTrails.push(trailRef.current);
        }
        for (const ac of [...m.allies, ...m.enemies]) {
          if (ac.trail.length >= 1) {
            const acTips = wingtipPositions(ac.pos, ac.type, ac.yaw, ac.pitch, ac.roll);
            allTrails.push([
              ...ac.trail,
              { time: simTimeRef.current, left: acTips.left, right: acTips.right },
            ]);
          }
        }

        // Clearance calculation
        let ground = Math.max(10, height(pose.pos[0], pose.pos[2], curMap));
        if (ground > pose.pos[1] && !solidAt(pose.pos[0], pose.pos[1], pose.pos[2], curMap)) {
          ground = pose.pos[1];
          while (ground > 10 && !solidAt(pose.pos[0], ground, pose.pos[2], curMap)) ground -= 4;
        }
        aglClearance = Math.max(0, Math.round(pose.pos[1] - ground));

        // Throttled React HUD state update (~20 Hz)
        if (timestamp - hudTimer > 50) {
          hudTimer = timestamp;
          const activeGround = m.groundTargets.filter((g) => !g.destroyed && !g.friendly).length;
          const objText =
            m.mode === 'story' && m.level
              ? `CH ${String(m.level.id).padStart(2, '0')} · ${m.level.title.toUpperCase()} — ${m.level.objectiveLabel}`
              : m.mode === 'skirmish'
                ? `SKIRMISH ${m.skirmishConfig?.preset.toUpperCase()} · HOSTILES ${m.enemies.length}`
                : m.mode === 'timetrial'
                  ? `TIME TRIAL · RING ${m.nextRingIndex}/${m.rings.length} · ${m.time.toFixed(1)}S`
                  : m.mode === 'survival'
                    ? `SURVIVAL WAVE ${m.wave} · KILLS ${m.kills}`
                    : m.mode === 'crew'
                      ? 'CREW MULTIPLAYER'
                      : 'ENDLESS / FREE FLIGHT';

          const secs = Math.ceil(m.remaining ?? 0);
          const fuelRatio = f.maxFuel > 0 ? clamp(f.fuel / f.maxFuel, 0, 1) : 0;
          setHud({
            speed: Math.round(f.speed * 3.6),
            altitude: Math.round(f.pos[1]),
            clearance: aglClearance,
            groundPct: clamp((ground / 920) * 100, 0, 100),
            altPct: clamp((f.pos[1] / 920) * 100, 0, 100),
            hull: Math.round(f.hull),
            maxHull: f.maxHull,
            dead: f.death > 0,
            stalling: f.stalling,
            fuelPct: Math.round(fuelRatio * 100),
            fuelBurnRate: f.fuelBurnRate,
            lowFuel: f.lowFuel,
            flameout: f.flameout,
            heat: m.arms.heat,
            overheated: m.arms.overheated,
            missiles: m.arms.missiles,
            rockets: m.arms.rockets,
            flareText: m.arms.flare > 0 ? `${m.arms.flare.toFixed(1)}S` : 'READY',
            flaresLeft: m.arms.flaresLeft,
            kills: m.kills + m.groundKills,
            hostilesLeft: m.enemies.length + activeGround,
            missileAlert:
              (m.mode === 'crew' ? Boolean(m.incoming) : missileWarning(m, f)) && f.death <= 0,
            objective: objText,
            radio: m.message,
            phase: m.phase,
            chosenRelay: m.chosenRelay,
            killFeed: [...m.killFeed],
            timeLimit: m.timeLimitRemaining,
            crewClock:
              m.mode === 'crew'
                ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
                : undefined,
            crewScore: m.score ? m.score.join(' : ') : undefined,
            crewOutside: m.outside,
            crewConnected: crewConnectedRef.current,
            pingMs: crewRef.current?.pingMs ?? null,
          });
        }
      } else {
        // Hangar live autopilot preview
        preview.time += dt;
        const yaw = 0.12 + Math.sin(preview.time * 0.075) * 0.47;
        const bank = Math.cos(preview.time * 0.075) * -0.32;
        const nose = forward(yaw);
        preview.pos = add(preview.pos, scale(nose, 112 * dt));
        preview.pos[1] = 630 + Math.sin(preview.time * 0.095) * 27;
        const side: Vec3 = [nose[2], 0, -nose[0]];
        const dist = innerWidth / innerHeight < 0.8 ? 1.55 : 1;
        const eye = add(
          preview.pos,
          scale(add(add(scale(side, 25), scale(nose, -56)), [0, 23, 0]), dist)
        );
        camera = cameraAt(eye, add(preview.pos, [0, -2, 0]), bank * 0.16, 0.56);
        objects = [{ type: settingsRef.current.plane, pos: preview.pos, yaw, roll: bank, pitch: 0 }];
      }

      r.render(
        camera,
        {
          map: curMap,
          atmosphere: curAtmo,
          night: curAtmo === 'night' || curAtmo === 'aurora' || settingsRef.current.night,
        },
        sceneStateRef.current === 'flight' ? simTimeRef.current : time,
        objects,
        allTrails,
        settingsRef.current.quality
      );

      if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
        overlay.width = canvas.width;
        overlay.height = canvas.height;
      }
      ctx.clearRect(0, 0, overlay.width, overlay.height);

      // Storm rain/snow streaks overlay
      if (curAtmo === 'storm') {
        ctx.strokeStyle = curMap === 1 ? 'rgba(220,245,255,0.28)' : 'rgba(180,210,225,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 42; i++) {
          const rx = ((i * 97 + time * 420) % overlay.width);
          const ry = ((i * 53 + time * 580) % overlay.height);
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 4, ry + 11);
        }
        ctx.stroke();
      }

      if (pose && missionRef.current) {
        drawCockpit(
          ctx,
          overlay.width,
          overlay.height,
          pose,
          missionRef.current,
          displayedCockpitRef.current,
          aglClearance
        );
        drawCombatHud(
          ctx,
          overlay.width,
          overlay.height,
          camera,
          pose,
          missionRef.current,
          curMap,
          settingsRef.current.mouseAim ? pointerRef.current : null
        );
        if (missionRef.current.flash > 0) {
          ctx.fillStyle = `rgba(251, 146, 77, ${missionRef.current.flash * 0.3})`;
          ctx.fillRect(0, 0, overlay.width, overlay.height);
        }
        if (missionRef.current.damageFlash > 0) {
          ctx.fillStyle = `rgba(225, 45, 35, ${missionRef.current.damageFlash * 0.36})`;
          ctx.fillRect(0, 0, overlay.width, overlay.height);
        }
        if (
          mapVisibleRef.current &&
          radarRef.current &&
          (!radarRef.current.lastTerrain || timestamp - radarTimer > 65)
        ) {
          radarRef.current.draw(pose, missionRef.current, curMap);
          radarTimer = timestamp;
        }
      }

      audioRef.current?.update(
        sceneStateRef.current === 'flight' ? flightRef.current : null,
        sceneStateRef.current === 'flight' && !modalRef.current,
        settingsRef.current,
        {
          hasLock: Boolean(missionRef.current?.target),
          inCombat: Boolean(missionRef.current && missionRef.current.enemies.length > 0),
          jammed: missionRef.current?.phase === 'jammed',
          agl: aglClearance,
        }
      );

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [activeAtmosphere, activeMap, cycleView]);

  const currentPlaneSpec = planes[settings.plane] ?? planes[0];
  const currentMapSpec = maps[settings.map] ?? maps[0];

  return (
    <>
      <canvas id="scene" ref={sceneRef} aria-label="Flight world" />
      <canvas id="overlay" ref={overlayRef} aria-hidden="true" />

      {loading && (
        <div id="loading">
          <div className="brand">
            LEGENDS <span>OF</span> JETS
          </div>
          <p>PREPARING YOUR FLIGHT</p>
          <div className="loadtrack">
            <i />
          </div>
          <small style={{ color: '#8a9daa', fontSize: 12 }}>{loadStatus}</small>
        </div>
      )}

      {scene === 'hangar' && (
        <main id="hangar">
          <header>
            <a className="brand" href="#top" onClick={(e) => e.preventDefault()}>
              LEGENDS <span>OF</span> JETS
            </a>
            <nav>
              <button onClick={() => setModal('pilotlog')}>Pilot Log</button>
              <button onClick={() => setModal('maps')}>Maps</button>
              <button onClick={() => setModal('planes')}>Planes (5)</button>
              <button onClick={() => setModal('settings')}>Settings</button>
              <span className="divider">|</span>
              <button
                onClick={() =>
                  window.open(settings.repository, '_blank', 'noopener,noreferrer')
                }
              >
                GitHub
              </button>
            </nav>
          </header>

          <section className="hangar-caption">
            <span className="eyebrow">V1.0 · REACT + TYPESCRIPT + WEBGL2</span>
            <h1>
              Choose your
              <br />
              flight.
            </h1>
          </section>

          <section className="aircraft-caption">
            <span className="eyebrow">SELECTED AIRCRAFT</span>
            <h2>{currentPlaneSpec.name}</h2>
            <button onClick={() => setModal('planes')}>
              Change aircraft <span>+</span>
            </button>
          </section>

          <div className="mode-dock">
            <button className="mode" onClick={() => setModal('campaign')}>
              <span>30 LEVELS · 5 ACTS</span>
              <strong>Campaign</strong>
              <small>STORY OPERATIONS</small>
            </button>
            <button className="mode" onClick={() => setModal('skirmish')}>
              <span>OFFLINE BOTS</span>
              <strong>Skirmish</strong>
              <small>1V1 · 2V2 · 3V3</small>
            </button>
            <button className="mode" onClick={() => setModal('timetrial')}>
              <span>RING COURSES</span>
              <strong>Time Trials</strong>
              <small>CALDERA &amp; GLACIER</small>
            </button>
            <button className="mode" onClick={() => launchMode('survival')}>
              <span>ENDLESS WAVES</span>
              <strong>Survival</strong>
              <small>REARM RINGS &amp; ACES</small>
            </button>
            <button className="mode" onClick={() => setModal('crew')}>
              <span>ONLINE SQUADRON</span>
              <strong>Crew</strong>
              <small>DUELS &amp; CO-OP</small>
            </button>
            <button className="mode endless" onClick={() => launchMode('endless')}>
              <span>FREE FLIGHT</span>
              <strong>
                Endless <i>✦</i>
              </strong>
              <small>PLAY NOW</small>
            </button>
          </div>

          <footer>
            <span>
              {currentMapSpec.name.toUpperCase()} / {settings.atmosphere.toUpperCase()} ·{' '}
              {settings.flightModel.toUpperCase()}
            </span>
            <span>AUTOPILOT PREVIEW · GAMEPAD READY</span>
          </footer>
        </main>
      )}

      {scene === 'flight' && (
        <section id="hud">
          <div className="hud-top">
            <div className="brand">
              LEGENDS <span>OF</span> JETS
              <small>
                {maps[activeMap()].name.toUpperCase()} / {activeAtmosphere().toUpperCase()}
              </small>
            </div>
            <div className="hud-actions">
              <button
                aria-expanded={mapVisible}
                onClick={() => setMapVisible((v) => !v)}
              >
                MAP <kbd>{settings.bindings.map.toUpperCase()}</kbd>
              </button>
              <button onClick={cycleView}>{views[viewIndex].toUpperCase()}</button>
              <button onClick={() => setModal('pause')}>
                PAUSE <kbd>ESC</kbd>
              </button>
            </div>
          </div>

          <div id="minimap" hidden={!mapVisible}>
            <canvas
              id="radar"
              ref={radarCanvasRef}
              width={192}
              height={192}
              onClick={(e) => {
                if (missionRef.current && radarRef.current) {
                  selectRelay(missionRef.current, radarRef.current.pick(e.nativeEvent));
                }
              }}
            />
            <div className="radar-label">
              <span>TACTICAL MAP</span>
              <b id="radar-count">
                {hud.hostilesLeft} HOSTILE{hud.hostilesLeft === 1 ? '' : 'S'}
              </b>
            </div>
          </div>

          <div id="mission-hud">
            <div id="objective">
              {hud.objective}
              {hud.timeLimit !== null ? ` · ${Math.ceil(hud.timeLimit)}S LEFT` : ''}
            </div>
            <p id="radio-line" role="status">
              {hud.radio}
            </p>
            {hud.phase === 'relay' && (
              <div id="relay-options">
                {RELAYS.map((rel, idx) => (
                  <button
                    key={rel.id}
                    className={hud.chosenRelay === rel.id ? 'chosen' : ''}
                    onClick={() => missionRef.current && selectRelay(missionRef.current, rel.id)}
                  >
                    <b>
                      {idx + 1} / {rel.id}
                    </b>{' '}
                    {rel.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {hud.killFeed.length > 0 && (
            <div id="killfeed">
              {hud.killFeed.map((item) => (
                <div key={item.id} style={{ color: item.color }}>
                  {item.text}
                </div>
              ))}
            </div>
          )}

          {missionRef.current?.mode === 'crew' && (
            <div id="crew-match-hud">
              <div className="crew-match-score">
                <span style={{ marginRight: 10, color: '#a5cbd1' }}>{hud.crewClock}</span>
                <strong>{hud.crewScore}</strong>
                {hud.pingMs !== null && (
                  <span style={{ marginLeft: 10, fontSize: 10, color: '#87f4ce' }}>
                    {hud.pingMs}ms
                  </span>
                )}
              </div>
              {hud.crewOutside !== null && hud.crewOutside !== undefined && !hud.dead && (
                <div id="crew-boundary">RETURN TO ARENA · {Math.ceil(hud.crewOutside)}s</div>
              )}
              {!hud.crewConnected && <div id="crew-connection">RECONNECTING</div>}
            </div>
          )}

          <div id="altimeter" className={hud.clearance < 32 ? 'low' : ''}>
            <div>ALTITUDE</div>
            <strong>{hud.altitude}</strong>
            <small>M ASL</small>
            <div className="altitude-track">
              <i id="altitude-band" style={{ height: `${hud.groundPct}%` }} />
              <i id="altitude-needle" style={{ bottom: `${hud.altPct}%` }} />
            </div>
            <small>{hud.clearance} M AGL</small>
          </div>

          <div id="flight-stats">
            <span>
              SPD <b>{hud.speed}</b>
            </span>
            <span>
              HULL{' '}
              <b style={{ color: hud.hull < hud.maxHull * 0.35 ? '#ff7762' : '#fff' }}>
                {Math.round((hud.hull / Math.max(1, hud.maxHull)) * 100)}%
              </b>
            </span>
            <span
              className={`fuel-stat ${
                hud.lowFuel ? 'fuel-bingo' : hud.fuelPct < 40 ? 'fuel-warn' : 'fuel-ok'
              }`}
            >
              FUEL
              <span className="fuel-bar" aria-label={`Fuel ${hud.fuelPct}%`}>
                <i className="fuel-fill" style={{ width: `${hud.fuelPct}%` }} />
              </span>
              <b>{hud.fuelPct}%</b>
            </span>
          </div>

          <div id="arsenal" className={hud.overheated ? 'overheated' : ''}>
            <div>
              <span>
                GUN <b>∞</b>
              </span>
              <meter id="heat" min={0} max={1} low={0.35} high={0.82} optimum={0} value={hud.heat} />
            </div>
            <div>
              MSL <b>{hud.missiles}</b>
            </div>
            <div>
              RKT <b>{hud.rockets}</b>
            </div>
            <div>
              FLR <b>{hud.flaresLeft}</b> ({hud.flareText})
            </div>
            <div>
              DOWN <b>{hud.kills}</b>
            </div>
          </div>

          {hud.missileAlert && (
            <div id="missile-warning" role="alert">
              MISSILE INBOUND
              <span>F FLARE · SHIFT + HARD TURN TO EVADE</span>
            </div>
          )}

          {hud.stalling && !hud.dead && !hud.missileAlert && (
            <div id="missile-warning" role="alert">
              STALL WARNING
              <span>PITCH DOWN OR ENGAGE AFTERBURNER</span>
            </div>
          )}

          {(hud.flameout || hud.lowFuel) && !hud.dead && !hud.missileAlert && !hud.stalling && (
            <div id="missile-warning" role="alert">
              {hud.flameout ? 'ENGINE FLAMEOUT' : 'BINGO FUEL'}
              <span>
                {hud.flameout
                  ? 'NO THRUST · GLIDE TO VOLCANO CORE DEPOT TO REFUEL'
                  : 'FUEL BELOW 20% · FLY THROUGH CENTRAL VOLCANO DEPOT'}
              </span>
            </div>
          )}

          <div id="flight-help">
            WASD fly · Shift boost · B brake · Space view · G/LMB gun · M missile · X/RMB rocket · F flare · R map
          </div>

          {hud.dead && (
            <div id="respawn">
              <span>RELAUNCHING</span>
              <strong>Back in the sky.</strong>
              <p>Stabilizing aircraft above your last coordinates.</p>
            </div>
          )}

          <div id="touch">
            {([
              ['a', 'LEFT'],
              ['d', 'RIGHT'],
              ['w', 'CLIMB'],
              ['s', 'DIVE'],
              ['shift', 'BOOST'],
              ['b', 'BRAKE'],
              ['g', 'GUN'],
              ['m', 'MSL'],
              ['x', 'RKT'],
              ['f', 'FLARE'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (k === 'm') pressedRef.current.add('missile');
                  else if (k === 'x') pressedRef.current.add('rocket');
                  else if (k === 'f') pressedRef.current.add('flare');
                  else keysRef.current.add(k);
                }}
                onPointerUp={() => keysRef.current.delete(k)}
                onPointerCancel={() => keysRef.current.delete(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ==================== MODALS ==================== */}
      {modal === 'campaign' && (
        <CampaignModal
          pilotLog={pilotLog}
          onLaunchLevel={(id) => launchMode('story', { levelId: id })}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'settings' && (
        <SettingsModal
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'pilotlog' && (
        <PilotLogModal pilotLog={pilotLog} onClose={() => setModal(null)} />
      )}

      {modal === 'crew' && (
        <CrewModal
          crew={crewRef.current!}
          currentPlane={settings.plane}
          onChangePlane={(p) => updateSettings({ plane: p })}
          onActivateAudio={activateAudio}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'maps' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setModal(null)}>
              ×
            </button>
            <span className="eyebrow">FLIGHT REGIONS</span>
            <h2>Choose a Map &amp; Weather</h2>
            <div className="row">
              <label>Atmosphere</label>
              <div className="segmented">
                {(['day', 'golden', 'night', 'storm', 'aurora'] as AtmospherePreset[]).map((a) => (
                  <button
                    key={a}
                    className={settings.atmosphere === a ? 'active' : ''}
                    onClick={() => updateSettings({ atmosphere: a, night: a === 'night' || a === 'aurora' })}
                  >
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="cards">
              {maps.map((m) => (
                <button
                  key={m.id}
                  className={`card ${settings.map === m.id ? 'selected' : ''}`}
                  onClick={() => updateSettings({ map: m.id })}
                >
                  <div className={`map-art ${m.id === 1 ? 'ice' : ''}`} />
                  <small>
                    {m.region} · {m.landmarkName.toUpperCase()}
                  </small>
                  <h3>{m.name}</h3>
                  <p>{m.description}</p>
                </button>
              ))}
            </div>
            <div className="btn-row">
              <button className="primary" onClick={() => setModal(null)}>
                Done
              </button>
              <button className="secondary" onClick={() => launchMode('endless', { caldera: true })}>
                Launch Ashmouth Caldera Run
              </button>
              <button className="secondary" onClick={() => launchMode('endless', { glacier: true })}>
                Launch Glacier Vault Run
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'planes' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setModal(null)}>
              ×
            </button>
            <span className="eyebrow">HANGAR · 5 AIRFRAMES</span>
            <h2>Choose an Aircraft</h2>
            <div className="cards planes">
              {planes.map((p) => {
                const unlocked = isPlaneUnlocked(p.id, pilotLog);
                return (
                  <button
                    key={p.id}
                    className={`card ${settings.plane === p.id ? 'selected' : ''} ${!unlocked ? 'locked' : ''}`}
                    onClick={() => {
                      if (!unlocked) {
                        showToast(`Locked: ${p.unlockRequirement?.label}`);
                        return;
                      }
                      updateSettings({ plane: p.id });
                    }}
                  >
                    <div className={`plane-art p${p.id}`} />
                    <small>{unlocked ? p.role : 'LOCKED'}</small>
                    <h3>{p.name}</h3>
                    <p>{unlocked ? p.description : p.unlockRequirement?.label}</p>
                    <div className="stat-bars">
                      <div className="stat-bar">
                        <span>SPD</span>
                        <i>
                          <b style={{ width: `${(p.speed / 135) * 100}%` }} />
                        </i>
                        <span>{p.speed}</span>
                      </div>
                      <div className="stat-bar">
                        <span>TURN</span>
                        <i>
                          <b style={{ width: `${(p.turn / 1.4) * 100}%` }} />
                        </i>
                        <span>{Math.round(p.turn * 100)}</span>
                      </div>
                      <div className="stat-bar">
                        <span>ARM</span>
                        <i>
                          <b style={{ width: `${((p.missiles + p.rockets) / 18) * 100}%` }} />
                        </i>
                        <span>
                          {p.missiles}M/{p.rockets}R
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <button className="primary" onClick={() => setModal(null)}>
              Confirm Aircraft
            </button>
          </div>
        </div>
      )}

      {modal === 'skirmish' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setModal(null)}>
              ×
            </button>
            <span className="eyebrow">OFFLINE DOGFIGHT VS SMART BOTS</span>
            <h2>Skirmish Setup</h2>
            <div className="row">
              <label>Matchup</label>
              <div className="segmented">
                {(['1v1', '1v3', '2v2', '3v3'] as const).map((p) => (
                  <button
                    key={p}
                    className={skirmishCfg.preset === p ? 'active' : ''}
                    onClick={() => setSkirmishCfg({ ...skirmishCfg, preset: p })}
                  >
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <label>Bot Difficulty</label>
              <div className="segmented">
                {(['standard', 'veteran', 'ace'] as BotDifficulty[]).map((d) => (
                  <button
                    key={d}
                    className={skirmishCfg.difficulty === d ? 'active' : ''}
                    onClick={() => setSkirmishCfg({ ...skirmishCfg, difficulty: d })}
                  >
                    {d.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <label>Map</label>
              <div className="segmented">
                {maps.map((m) => (
                  <button
                    key={m.id}
                    className={skirmishCfg.map === m.id ? 'active' : ''}
                    onClick={() => setSkirmishCfg({ ...skirmishCfg, map: m.id })}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <label>Atmosphere</label>
              <div className="segmented">
                {(['day', 'golden', 'night', 'storm', 'aurora'] as AtmospherePreset[]).map((a) => (
                  <button
                    key={a}
                    className={skirmishCfg.atmosphere === a ? 'active' : ''}
                    onClick={() => setSkirmishCfg({ ...skirmishCfg, atmosphere: a })}
                  >
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <button className="primary" onClick={() => launchMode('skirmish', { skirmish: skirmishCfg })}>
              Launch Skirmish
            </button>
          </div>
        </div>
      )}

      {modal === 'timetrial' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setModal(null)}>
              ×
            </button>
            <span className="eyebrow">PRECISION RING COURSES</span>
            <h2>Time Trials</h2>
            <div className="cards">
              <div className="card selected">
                <div className="map-art" />
                <small>EMBER CANYON · 8 VOLCANIC RINGS</small>
                <h3>Ashmouth Caldera Circuit</h3>
                <p>
                  Enter at 137m ASL and thread all four volcanic tunnels. Best:{' '}
                  {pilotLog.bestTimeTrials.caldera ? `${pilotLog.bestTimeTrials.caldera.toFixed(1)}s` : 'Unset'}
                </p>
                <button
                  className="primary"
                  onClick={() => launchMode('timetrial', { timeTrialCourse: 'caldera' })}
                >
                  Run Caldera Circuit
                </button>
              </div>
              <div className="card selected">
                <div className="map-art ice" />
                <small>FROSTLINE REACH · 8 ARCTIC RINGS</small>
                <h3>Glacier Vault Circuit</h3>
                <p>
                  Enter at 124m ASL and carve through the crystalline ice cavern. Best:{' '}
                  {pilotLog.bestTimeTrials.glacier ? `${pilotLog.bestTimeTrials.glacier.toFixed(1)}s` : 'Unset'}
                </p>
                <button
                  className="primary"
                  onClick={() => launchMode('timetrial', { timeTrialCourse: 'glacier' })}
                >
                  Run Glacier Circuit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal === 'pause' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setModal(null)}>
              ×
            </button>
            <span className="eyebrow">{missionRef.current?.mode.toUpperCase()}</span>
            <h2>Flight Paused</h2>
            <p>
              W/S climb/dive · A/D turn · Shift afterburner · B airbrake · E roll · Space view · G/LMB gun · M missile · X/RMB rocket · F flare · R map.
            </p>
            <div className="btn-row">
              <button className="primary" onClick={() => setModal(null)}>
                Resume Flight
              </button>
              <button className="secondary" onClick={() => setModal('settings')}>
                Settings
              </button>
              <button className="secondary" onClick={() => returnToHangar()}>
                Return to Hangar
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'debrief' && missionRef.current && (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <span className="eyebrow">
              {missionRef.current.phase === 'complete' ? 'SORTIE COMPLETE' : 'SORTIE FAILED'}
            </span>
            <h2>
              {missionRef.current.phase === 'complete'
                ? missionRef.current.level
                  ? `${missionRef.current.level.title} — Rank ${missionRef.current.rank ?? 'A'}`
                  : 'Objective Complete'
                : 'Mission Failed'}
            </h2>
            <p>
              Time: <strong>{missionRef.current.time.toFixed(1)}s</strong> · Air Kills:{' '}
              <strong>{missionRef.current.kills}</strong> · Ground Targets:{' '}
              <strong>{missionRef.current.groundKills}</strong> · Hull Integrity:{' '}
              <strong>
                {Math.round(
                  (flightRef.current.hull / Math.max(1, flightRef.current.maxHull)) * 100
                )}
                %
              </strong>
            </p>
            <div className="btn-row">
              {missionRef.current.mode === 'story' &&
                missionRef.current.phase === 'complete' &&
                missionRef.current.levelId &&
                missionRef.current.levelId < CAMPAIGN_LEVELS.length && (
                  <button
                    className="primary"
                    onClick={() =>
                      launchMode('story', { levelId: (missionRef.current?.levelId ?? 1) + 1 })
                    }
                  >
                    Next Mission (CH {String((missionRef.current.levelId ?? 1) + 1).padStart(2, '0')})
                  </button>
                )}
              <button
                className={missionRef.current.phase === 'failed' ? 'primary' : 'secondary'}
                onClick={() =>
                  launchMode(missionRef.current!.mode, {
                    levelId: missionRef.current?.levelId,
                    skirmish: missionRef.current?.skirmishConfig,
                    timeTrialCourse: missionRef.current?.timeTrialCourse,
                  })
                }
              >
                {missionRef.current.phase === 'failed' ? (
                  <>
                    Retry Sortie <kbd>SPACE</kbd>
                  </>
                ) : (
                  'Replay Sortie'
                )}
              </button>
              <button className="secondary" onClick={() => returnToHangar()}>
                Return to Hangar
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'crew-results' && crewLatestRef.current && (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <span className="eyebrow">CREW MATCH COMPLETE</span>
            <h2>Match Scoreboard</h2>
            <ul className="crew-list">
              {[...crewLatestRef.current.pilots]
                .sort((a, b) => b.points - a.points || a.deaths - b.deaths)
                .map((p) => (
                  <li key={p.id}>
                    <strong>{p.name}</strong>
                    <span>
                      {p.points} down · {p.deaths} lost
                    </span>
                  </li>
                ))}
            </ul>
            <div className="btn-row">
              <button
                className="primary"
                onClick={() => {
                  returnToHangar(true);
                  setModal('crew');
                }}
              >
                Return to Lobby
              </button>
              <button className="secondary" onClick={() => returnToHangar()}>
                Return to Hangar
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && (
        <div id="toast" role="status">
          {toastMsg}
        </div>
      )}
    </>
  );
};
