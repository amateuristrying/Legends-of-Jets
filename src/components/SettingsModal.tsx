import React, { useEffect, useState } from 'react';
import type { AtmospherePreset, GameSettings, KeyBindings } from '../engine/types';
import { DEFAULT_BINDINGS } from '../engine/storage';

interface Props {
  settings: GameSettings;
  onUpdate: (patch: Partial<GameSettings>) => void;
  onClose: () => void;
}

const ATMOS: Array<[string, AtmospherePreset]> = [
  ['Day', 'day'],
  ['Golden Hour', 'golden'],
  ['Night', 'night'],
  ['Storm', 'storm'],
  ['Aurora', 'aurora'],
];

const BINDING_LABELS: Array<[keyof KeyBindings, string]> = [
  ['climb', 'Climb'],
  ['dive', 'Dive'],
  ['left', 'Turn Left'],
  ['right', 'Turn Right'],
  ['boost', 'Afterburner'],
  ['brake', 'Airbrake'],
  ['roll', 'Barrel Roll'],
  ['view', 'Camera View'],
  ['gun', 'Cannon'],
  ['missile', 'Missile'],
  ['rocket', 'Rocket'],
  ['flare', 'Flare'],
  ['map', 'Minimap'],
];

export const SettingsModal: React.FC<Props> = ({ settings, onUpdate, onClose }) => {
  const [capturing, setCapturing] = useState<keyof KeyBindings | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const k = e.key.toLowerCase();
      if (k !== 'escape') {
        onUpdate({ bindings: { ...settings.bindings, [capturing]: k } });
      }
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, settings.bindings, onUpdate]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow">FLIGHT DECK</span>
        <h2>Settings &amp; Controls</h2>

        <div className="row">
          <label>Flight Physics Model</label>
          <div className="segmented">
            <button
              className={settings.flightModel === 'arcade' ? 'active' : ''}
              onClick={() => onUpdate({ flightModel: 'arcade' })}
            >
              Arcade
            </button>
            <button
              className={settings.flightModel === 'sim-lite' ? 'active' : ''}
              onClick={() => onUpdate({ flightModel: 'sim-lite' })}
            >
              Sim-Lite (Energy &amp; Stall)
            </button>
          </div>
        </div>

        <div className="row">
          <label>Atmosphere &amp; Weather</label>
          <div className="segmented">
            {ATMOS.map(([label, val]) => (
              <button
                key={val}
                className={settings.atmosphere === val ? 'active' : ''}
                onClick={() =>
                  onUpdate({ atmosphere: val, night: val === 'night' || val === 'aurora' })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <label>Pixel Detail</label>
          <div className="segmented">
            {([['Coarse', 480], ['Standard', 640], ['Fine', 800]] as const).map(([label, q]) => (
              <button
                key={q}
                className={settings.quality === q ? 'active' : ''}
                onClick={() => onUpdate({ quality: q })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <label>Engine &amp; Tactical Audio</label>
          <div className="segmented">
            <button
              className={!settings.sound ? 'active' : ''}
              onClick={() => onUpdate({ sound: false })}
            >
              Off
            </button>
            <button
              className={settings.sound ? 'active' : ''}
              onClick={() => onUpdate({ sound: true })}
            >
              On
            </button>
          </div>
        </div>

        <div className="row">
          <label>SFX Volume ({Math.round(settings.volume * 100)}%)</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => onUpdate({ volume: e.target.valueAsNumber })}
          />
        </div>

        <div className="row">
          <label>Dynamic Synth Soundtrack</label>
          <div className="segmented">
            <button
              className={!settings.music ? 'active' : ''}
              onClick={() => onUpdate({ music: false })}
            >
              Off
            </button>
            <button
              className={settings.music ? 'active' : ''}
              onClick={() => onUpdate({ music: true })}
            >
              On
            </button>
          </div>
        </div>

        <div className="row">
          <label>Steering Mode (Gamepad supported automatically)</label>
          <div className="segmented">
            <button
              className={!settings.pointer && !settings.mouseAim ? 'active' : ''}
              onClick={() => onUpdate({ pointer: false, mouseAim: false })}
            >
              Keyboard / Pad
            </button>
            <button
              className={settings.mouseAim ? 'active' : ''}
              onClick={() => onUpdate({ mouseAim: true, pointer: false })}
            >
              Mouse-Aim Reticle
            </button>
            <button
              className={settings.pointer && !settings.mouseAim ? 'active' : ''}
              onClick={() => onUpdate({ pointer: true, mouseAim: false })}
            >
              Raw Pointer
            </button>
          </div>
        </div>

        <div className="row">
          <label>Sensitivity ({settings.sensitivity.toFixed(1)}x)</label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={settings.sensitivity}
            onChange={(e) => onUpdate({ sensitivity: e.target.valueAsNumber })}
          />
        </div>

        <div className="row">
          <label>Pitch Axis</label>
          <div className="segmented">
            <button
              className={!settings.invert ? 'active' : ''}
              onClick={() => onUpdate({ invert: false })}
            >
              Standard
            </button>
            <button
              className={settings.invert ? 'active' : ''}
              onClick={() => onUpdate({ invert: true })}
            >
              Inverted
            </button>
          </div>
        </div>

        <h3>Key Bindings</h3>
        <div className="keybind-grid">
          {BINDING_LABELS.map(([key, label]) => (
            <div key={key} className="keybind-item">
              <span>{label}</span>
              <button onClick={() => setCapturing(key)}>
                {capturing === key
                  ? 'PRESS KEY…'
                  : settings.bindings[key] === ' '
                    ? 'SPACE'
                    : settings.bindings[key]}
              </button>
            </div>
          ))}
        </div>

        <div className="btn-row">
          <button className="primary" onClick={onClose}>
            Done
          </button>
          <button
            className="secondary"
            onClick={() => onUpdate({ bindings: { ...DEFAULT_BINDINGS } })}
          >
            Reset Keys
          </button>
        </div>
      </div>
    </div>
  );
};
