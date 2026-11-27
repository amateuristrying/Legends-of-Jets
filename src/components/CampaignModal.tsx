import React, { useState } from 'react';
import type { PilotLog } from '../engine/types';
import { CAMPAIGN_LEVELS } from '../engine/campaign';
import { maps } from '../engine/world';

interface Props {
  pilotLog: PilotLog;
  onLaunchLevel: (levelId: number) => void;
  onClose: () => void;
}

const ACTS = [
  { id: 1, label: 'Act I · Dead Air' },
  { id: 2, label: 'Act II · Northern Crossing' },
  { id: 3, label: 'Act III · Scorched Horizon' },
  { id: 4, label: 'Act IV · Arctic Siege' },
  { id: 5, label: 'Act V · Legends of the Sky' },
] as const;

export const CampaignModal: React.FC<Props> = ({ pilotLog, onLaunchLevel, onClose }) => {
  const [act, setAct] = useState<number>(1);
  const actLevels = CAMPAIGN_LEVELS.filter((l) => l.act === act);
  const [selectedId, setSelectedId] = useState<number>(1);
  const selected = CAMPAIGN_LEVELS.find((l) => l.id === selectedId) ?? actLevels[0];

  const clearedCount = Object.values(pilotLog.campaignProgress).filter((r) => r.completed).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow">30-LEVEL CAMPAIGN · {clearedCount} / 30 CLEARED</span>
        <h2>Story Operations</h2>

        <div className="act-tabs" role="tablist">
          {ACTS.map((item) => (
            <button
              key={item.id}
              className={act === item.id ? 'active' : ''}
              onClick={() => {
                setAct(item.id);
                const first = CAMPAIGN_LEVELS.find((l) => l.act === item.id);
                if (first) setSelectedId(first.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="level-grid">
          {actLevels.map((lvl) => {
            const rec = pilotLog.campaignProgress[lvl.id];
            return (
              <button
                key={lvl.id}
                className={`level-card ${selected.id === lvl.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(lvl.id)}
              >
                <div className="level-head">
                  <span>
                    CH {String(lvl.id).padStart(2, '0')} · {lvl.atmosphere.toUpperCase()}
                  </span>
                  {rec?.completed && <span className="rank-badge">RANK {rec.rank}</span>}
                </div>
                <strong style={{ fontFamily: 'Barlow Condensed', fontSize: 22 }}>
                  {lvl.title}
                </strong>
                <small style={{ color: '#9ab6c2', fontSize: 11 }}>
                  {maps[lvl.map].name} · {lvl.objectiveLabel}
                </small>
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="briefing-box">
            <div className="level-head" style={{ marginBottom: 6 }}>
              <span>
                {selected.actName} · MISSION {String(selected.id).padStart(2, '0')}
              </span>
              <span>
                {maps[selected.map].name.toUpperCase()} / {selected.atmosphere.toUpperCase()} ·{' '}
                {selected.difficulty.toUpperCase()}
              </span>
            </div>
            <h3 style={{ margin: '4px 0 8px' }}>{selected.title}</h3>
            <p style={{ margin: '0 0 10px' }}>{selected.briefing}</p>
            <small style={{ display: 'block', color: '#87f4ce', fontFamily: 'monospace' }}>
              OBJECTIVE: {selected.objectiveLabel} · PAR TIME: {selected.parTimeSec}s
            </small>
            <div className="btn-row">
              <button className="primary" onClick={() => onLaunchLevel(selected.id)}>
                Launch Mission {String(selected.id).padStart(2, '0')}
              </button>
              <button className="secondary" onClick={onClose}>
                Back to Hangar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
