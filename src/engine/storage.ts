import type { GameSettings, KeyBindings, MedalRank, PilotLog } from './types';
import { clamp, maps, planes } from './world';

const SETTINGS_KEY = 'legends-flight-v2';
const LOG_KEY = 'legends-pilot-log-v1';

export const DEFAULT_BINDINGS: KeyBindings = {
  climb: 'w',
  dive: 's',
  left: 'a',
  right: 'd',
  boost: 'shift',
  brake: 'b',
  roll: 'e',
  view: ' ',
  gun: 'g',
  missile: 'm',
  rocket: 'x',
  flare: 'f',
  map: 'r',
};

export const DEFAULT_SETTINGS: GameSettings = {
  map: 0,
  atmosphere: 'day',
  night: false,
  plane: 0,
  quality: 640,
  sound: true,
  music: true,
  volume: 0.45,
  musicVolume: 0.35,
  pointer: false,
  mouseAim: false,
  invert: false,
  flightModel: 'arcade',
  sensitivity: 1.0,
  repository: 'https://github.com/amateuristrying/Legends-of-Jets',
  bindings: { ...DEFAULT_BINDINGS },
};

export const DEFAULT_PILOT_LOG: PilotLog = {
  flightSeconds: 0,
  totalKills: 0,
  totalGroundKills: 0,
  totalSorties: 0,
  campaignProgress: {},
  bestTimeTrials: {},
  bestSurvivalWave: 0,
  bestSurvivalKills: 0,
};

export function loadSettings(): GameSettings {
  const result: GameSettings = {
    ...DEFAULT_SETTINGS,
    bindings: { ...DEFAULT_BINDINGS },
  };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof raw.map === 'number' && maps[raw.map]) result.map = raw.map;
    if (['day', 'golden', 'night', 'storm', 'aurora'].includes(raw.atmosphere)) {
      result.atmosphere = raw.atmosphere;
    }
    if (typeof raw.night === 'boolean') result.night = raw.night;
    if (typeof raw.plane === 'number' && planes[raw.plane]) result.plane = raw.plane;
    if ([480, 640, 800].includes(raw.quality)) result.quality = raw.quality;
    if (typeof raw.sound === 'boolean') result.sound = raw.sound;
    if (typeof raw.music === 'boolean') result.music = raw.music;
    if (typeof raw.volume === 'number') result.volume = clamp(raw.volume, 0, 1);
    if (typeof raw.musicVolume === 'number') result.musicVolume = clamp(raw.musicVolume, 0, 1);
    if (typeof raw.pointer === 'boolean') result.pointer = raw.pointer;
    if (typeof raw.mouseAim === 'boolean') result.mouseAim = raw.mouseAim;
    if (typeof raw.invert === 'boolean') result.invert = raw.invert;
    if (raw.flightModel === 'arcade' || raw.flightModel === 'sim-lite') {
      result.flightModel = raw.flightModel;
    }
    if (typeof raw.sensitivity === 'number') result.sensitivity = clamp(raw.sensitivity, 0.4, 2.0);
    if (typeof raw.repository === 'string') result.repository = raw.repository;
    if (raw.bindings && typeof raw.bindings === 'object') {
      for (const k of Object.keys(DEFAULT_BINDINGS) as Array<keyof KeyBindings>) {
        if (typeof raw.bindings[k] === 'string' && raw.bindings[k].length > 0) {
          result.bindings[k] = raw.bindings[k].toLowerCase();
        }
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return result;
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota/privacy errors */
  }
}

export function loadPilotLog(): PilotLog {
  const result: PilotLog = {
    ...DEFAULT_PILOT_LOG,
    campaignProgress: {},
    bestTimeTrials: {},
  };
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) || '{}');
    if (typeof raw.flightSeconds === 'number') result.flightSeconds = raw.flightSeconds;
    if (typeof raw.totalKills === 'number') result.totalKills = raw.totalKills;
    if (typeof raw.totalGroundKills === 'number') result.totalGroundKills = raw.totalGroundKills;
    if (typeof raw.totalSorties === 'number') result.totalSorties = raw.totalSorties;
    if (raw.campaignProgress && typeof raw.campaignProgress === 'object') {
      result.campaignProgress = raw.campaignProgress;
    }
    if (raw.bestTimeTrials && typeof raw.bestTimeTrials === 'object') {
      result.bestTimeTrials = raw.bestTimeTrials;
    }
    if (typeof raw.bestSurvivalWave === 'number') result.bestSurvivalWave = raw.bestSurvivalWave;
    if (typeof raw.bestSurvivalKills === 'number') result.bestSurvivalKills = raw.bestSurvivalKills;
  } catch {
    /* localStorage unavailable */
  }
  return result;
}

export function savePilotLog(log: PilotLog): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* ignore */
  }
}

const RANK_SCORE: Record<MedalRank, number> = { S: 4, A: 3, B: 2, C: 1 };

export function recordCampaignClear(
  log: PilotLog,
  levelId: number,
  elapsedSec: number,
  rank: MedalRank
): PilotLog {
  const prev = log.campaignProgress[levelId];
  const updated: PilotLog = {
    ...log,
    campaignProgress: {
      ...log.campaignProgress,
      [levelId]: {
        completed: true,
        bestTime: prev ? Math.min(prev.bestTime, elapsedSec) : elapsedSec,
        rank: prev && RANK_SCORE[prev.rank] > RANK_SCORE[rank] ? prev.rank : rank,
      },
    },
  };
  savePilotLog(updated);
  return updated;
}

export function countClearedLevels(log: PilotLog): number {
  return Object.values(log.campaignProgress).filter((r) => r.completed).length;
}

export function isPlaneUnlocked(planeId: number, log: PilotLog): boolean {
  const spec = planes[planeId];
  if (!spec || !spec.unlockRequirement) return true;
  const req = spec.unlockRequirement;
  const cleared = countClearedLevels(log);
  if (req.minCampaignCleared !== undefined && cleared >= req.minCampaignCleared) return true;
  if (req.minTotalKills !== undefined && log.totalKills >= req.minTotalKills) return true;
  return false;
}
