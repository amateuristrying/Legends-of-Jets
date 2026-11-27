import React from 'react';
import type { PilotLog } from '../engine/types';
import { countClearedLevels, isPlaneUnlocked } from '../engine/storage';
import { planes } from '../engine/world';

interface Props {
  pilotLog: PilotLog;
  onClose: () => void;
}

export const PilotLogModal: React.FC<Props> = ({ pilotLog, onClose }) => {
  const cleared = countClearedLevels(pilotLog);
  const sRanks = Object.values(pilotLog.campaignProgress).filter((r) => r.rank === 'S').length;
  const mins = Math.floor(pilotLog.flightSeconds / 60);
  const secs = Math.floor(pilotLog.flightSeconds % 60);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
        <span className="eyebrow">SERVICE RECORD</span>
        <h2>Pilot Log &amp; Unlocks</h2>

        <div className="kpi-grid">
          <div className="kpi-card">
            <small>FLIGHT TIME</small>
            <strong>
              {mins}m {String(secs).padStart(2, '0')}s
            </strong>
          </div>
          <div className="kpi-card">
            <small>AIR KILLS</small>
            <strong>{pilotLog.totalKills}</strong>
          </div>
          <div className="kpi-card">
            <small>GROUND TARGETS</small>
            <strong>{pilotLog.totalGroundKills}</strong>
          </div>
          <div className="kpi-card">
            <small>CAMPAIGN</small>
            <strong>
              {cleared} / 30 ({sRanks} S)
            </strong>
          </div>
          <div className="kpi-card">
            <small>SURVIVAL BEST</small>
            <strong>
              W{pilotLog.bestSurvivalWave} · {pilotLog.bestSurvivalKills}K
            </strong>
          </div>
          <div className="kpi-card">
            <small>TIME TRIALS</small>
            <strong style={{ fontSize: 18 }}>
              Caldera: {pilotLog.bestTimeTrials.caldera ? `${pilotLog.bestTimeTrials.caldera.toFixed(1)}s` : '—'}
              <br />
              Glacier: {pilotLog.bestTimeTrials.glacier ? `${pilotLog.bestTimeTrials.glacier.toFixed(1)}s` : '—'}
            </strong>
          </div>
        </div>

        <h3>Airframe Clearances</h3>
        <ul className="crew-list">
          {planes.map((p) => {
            const unlocked = isPlaneUnlocked(p.id, pilotLog);
            return (
              <li key={p.id}>
                <strong>
                  {p.name} · {p.role}
                </strong>
                <span style={{ color: unlocked ? '#87f4ce' : '#f99a72' }}>
                  {unlocked ? 'UNLOCKED' : p.unlockRequirement?.label}
                </span>
              </li>
            );
          })}
        </ul>

        <button className="primary" onClick={onClose}>
          Close Log
        </button>
      </div>
    </div>
  );
};
