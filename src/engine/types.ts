export type Vec3 = [number, number, number];

export type AtmospherePreset = 'day' | 'golden' | 'night' | 'storm' | 'aurora';
export type FlightModelMode = 'arcade' | 'sim-lite';
export type BotDifficulty = 'standard' | 'veteran' | 'ace';
export type GameMode = 'endless' | 'story' | 'skirmish' | 'timetrial' | 'survival' | 'crew';
export type MedalRank = 'S' | 'A' | 'B' | 'C';

export interface MapSpec {
  id: number;
  name: string;
  region: string;
  landmarkName: string;
  description: string;
}

export interface PlaneSpec {
  id: number;
  name: string;
  role: string;
  description: string;
  speed: number;
  turn: number;
  size: number;
  hull: number;
  fuelCapacity: number;
  missiles: number;
  rockets: number;
  flares: number;
  gunRate: number;
  gunHeatPerShot: number;
  stealthFactor: number; // < 1 reduces enemy lock range
  enginePitch: number;
  color: Vec3;
  accent: Vec3;
  unlockRequirement?: {
    label: string;
    minCampaignCleared?: number;
    minTotalKills?: number;
  };
}

export interface FlightState {
  type: number;
  pos: Vec3;
  yaw: number;
  pitch: number;
  bank: number;
  roll: number;
  stunt: number;
  speed: number;
  boost: number;
  fuel: number;
  maxFuel: number;
  fuelBurnRate: number;
  lowFuel: boolean;
  flameout: boolean;
  stalling: boolean;
  gLoad: number;
  death: number;
  recovered: boolean;
  hull: number;
  maxHull: number;
}

export interface ControlInput {
  turn: number;
  pitch: number;
  boost: boolean;
  brake: boolean;
  roll: boolean;
  fire: boolean;
  missile: boolean;
  rocket: boolean;
  flare: boolean;
}

export interface WeaponsState {
  heat: number;
  overheated: boolean;
  gunDelay: number;
  missileDelay: number;
  rocketDelay: number;
  missiles: number;
  maxMissiles: number;
  rockets: number;
  maxRockets: number;
  flare: number;
  flaresLeft: number;
  maxFlares: number;
  evade: number;
}

export interface TrailSample {
  time: number;
  left: Vec3;
  right: Vec3;
}

export type BossProfile = 'joust' | 'stealth' | 'razor' | 'volley' | 'sovereign';

export interface AircraftEntity {
  id: string;
  name: string;
  type: number;
  pos: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  bank: number;
  speed: number;
  boost: number;
  tint: Vec3;
  friendly: boolean;
  isBoss?: boolean;
  bossProfile?: BossProfile;
  bossPhaseTimer?: number;
  bossOverdrive?: boolean;
  isEscortTarget?: boolean;
  extracted?: boolean;
  index: number;
  hp: number;
  maxHp: number;
  fire: number;
  gunBurst: number;
  flareCooldown: number;
  missiles: number;
  difficulty: BotDifficulty;
  trail: TrailSample[];
  lastTrailTime: number;
}

export interface ShotEntity {
  kind: 'tracer' | 'enemyTracer' | 'missile' | 'enemyMissile' | 'rocket';
  pos: Vec3;
  velocity: Vec3;
  life: number;
  size: number;
  damage: number;
  target?: AircraftEntity | FlightState | GroundTarget | null;
  visual?: boolean;
  ownerName?: string;
  fromTeam?: number;
  smokeTimer?: number;
}

export interface EffectEntity {
  kind: 'spark' | 'flare' | 'smoke' | 'fire' | 'beacon' | 'ring' | 'rearm' | 'debris';
  pos: Vec3;
  velocity: Vec3;
  life: number;
  size: number;
}

export interface GroundTarget {
  id: string;
  name: string;
  kind: 'radar' | 'aa' | 'relay' | 'core';
  pos: Vec3;
  hp: number;
  maxHp: number;
  fireCooldown: number;
  friendly?: boolean;
  destroyed: boolean;
}

export interface RingCheckpoint {
  id: number;
  pos: Vec3;
  radius: number;
  passed: boolean;
  isRearm?: boolean;
}

export interface KillFeedItem {
  id: number;
  text: string;
  color: string;
  time: number;
}

export type CampaignArchetype =
  | 'dead-air'
  | 'dogfight'
  | 'defense'
  | 'tunnel'
  | 'low-ceiling'
  | 'boss'
  | 'recon-rings'
  | 'escort'
  | 'ground-strike'
  | 'survival'
  | 'relay-blitz';

export interface ScriptBeat {
  trigger: 'start' | 'half-kills' | 'clear-enemies' | 'boss-spawn' | 'low-hull' | 'complete' | 'time';
  timeSec?: number;
  speaker: string;
  line: string;
}

export interface CampaignLevel {
  id: number; // 1..30
  act: 1 | 2 | 3 | 4 | 5;
  actName: string;
  title: string;
  map: number;
  atmosphere: AtmospherePreset;
  archetype: CampaignArchetype;
  difficulty: BotDifficulty;
  briefing: string;
  objectiveLabel: string;
  spawnPos: Vec3;
  enemyCount: number;
  allyCount: number;
  waves?: number;
  groundTargets?: number;
  ringCount?: number;
  ceilingLimit?: number;
  timeLimitSec?: number;
  bossName?: string;
  bossPlane?: number;
  parTimeSec: number;
  script: ScriptBeat[];
}

export interface MissionState {
  mode: GameMode;
  levelId?: number;
  level?: CampaignLevel;
  skirmishConfig?: SkirmishConfig;
  timeTrialCourse?: 'caldera' | 'glacier';
  phase:
    | 'ambush'
    | 'combat'
    | 'jammed'
    | 'relay'
    | 'rings'
    | 'complete'
    | 'failed'
    | 'free-flight'
    | 'crew-playing'
    | 'crew-finished';
  time: number;
  phaseTime: number;
  kills: number;
  groundKills: number;
  wave: number;
  maxWaves: number;
  signal: boolean;
  chosenRelay: string | null;
  allies: AircraftEntity[];
  enemies: AircraftEntity[];
  groundTargets: GroundTarget[];
  rings: RingCheckpoint[];
  nextRingIndex: number;
  extractionPos?: Vec3;
  shots: ShotEntity[];
  effects: EffectEntity[];
  arms: WeaponsState;
  target: AircraftEntity | GroundTarget | null;
  message: string;
  flash: number;
  shake: number;
  hitMarker: number;
  damageFlash: number;
  event: number;
  killFeed: KillFeedItem[];
  ceilingViolationTime: number;
  timeLimitRemaining: number | null;
  refuelCooldown: number;
  triggeredBeats: Set<string>;
  // Crew-specific overlay fields
  arena?: { center: Vec3; radius: number };
  outside?: number | null;
  score?: [number, number];
  remaining?: number;
  incoming?: boolean;
  rank?: MedalRank;
}

export interface SkirmishConfig {
  map: number;
  atmosphere: AtmospherePreset;
  difficulty: BotDifficulty;
  preset: '1v1' | '1v3' | '2v2' | '3v3';
}

export interface KeyBindings {
  climb: string;
  dive: string;
  left: string;
  right: string;
  boost: string;
  brake: string;
  roll: string;
  view: string;
  gun: string;
  missile: string;
  rocket: string;
  flare: string;
  map: string;
}

export interface GameSettings {
  map: number;
  atmosphere: AtmospherePreset;
  night: boolean;
  plane: number;
  quality: 480 | 640 | 800;
  sound: boolean;
  music: boolean;
  volume: number;
  musicVolume: number;
  pointer: boolean;
  mouseAim: boolean;
  invert: boolean;
  flightModel: FlightModelMode;
  sensitivity: number;
  repository: string;
  bindings: KeyBindings;
}

export interface LevelRecord {
  completed: boolean;
  bestTime: number;
  rank: MedalRank;
}

export interface PilotLog {
  flightSeconds: number;
  totalKills: number;
  totalGroundKills: number;
  totalSorties: number;
  campaignProgress: Record<number, LevelRecord>;
  bestTimeTrials: {
    caldera?: number;
    glacier?: number;
  };
  bestSurvivalWave: number;
  bestSurvivalKills: number;
}
