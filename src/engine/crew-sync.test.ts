import { describe, expect, it } from 'vitest';
import type { CrewSnapshot } from './crew';
import { CREW_STEP, CrewPrediction, CrewTimeline, sampleCrewEntities, sampleCrewPilot } from './crew-sync';
import { newFlight, stepFlight } from './flight';
import type { ControlInput } from './types';

type Pilot = CrewSnapshot['pilots'][number];
const neutral: ControlInput = {
  turn: 0, pitch: 0, boost: false, brake: false, roll: false,
  fire: false, missile: false, rocket: false, flare: false,
};

function frame(sequence: number, time: number): CrewSnapshot {
  const flight = newFlight(0, [0, 750, time * 100]);
  const pilot = { id: 'wingman', flight, deaths: 0 } as Pilot;
  return { sequence, time, pilots: [pilot] } as CrewSnapshot;
}

describe('Crew snapshot playback', () => {
  it('advances smoothly through late and bunched snapshots and bounds extrapolation', () => {
    const timeline = new CrewTimeline();
    const arrivals = [0, 0.06, 0.155, 0.157, 0.26, 0.262, 0.32, 0.41, 0.44];
    let next = 0;
    let previousPosition = 0;
    let movingFrames = 0;
    for (let index = 0; index <= 42; index++) {
      const now = index / 60;
      while (next < arrivals.length && arrivals[next] <= now) {
        timeline.push(frame(next + 1, next * 0.05), 5 + arrivals[next]);
        next++;
      }
      const view = timeline.sample(5 + now)!;
      const position = sampleCrewPilot(view.from.pilots[0], view).pos[2];
      expect(position).toBeGreaterThanOrEqual(previousPosition);
      if (index * (1 / 60) >= 0.2 && position > previousPosition) movingFrames++;
      previousPosition = position;
    }
    expect(movingFrames).toBeGreaterThan(12);
    expect(timeline.sample(20)?.time).toBeCloseTo(0.5);
  });

  it('matches projectiles by ID and never interpolates a respawn across the map', () => {
    const before = frame(1, 0);
    const after = frame(2, 0.05);
    after.pilots[0].flight.pos = [1500, 750, 1500];
    after.pilots[0].flight.recovered = true;
    const view = { from: before, to: after, time: 0.025 };
    expect(sampleCrewPilot(before.pilots[0], view).pos).toEqual(before.pilots[0].flight.pos);
    const tracer = { id: 1, pos: [0, 0, 0] as [number, number, number], velocity: [400, 0, 0] as [number, number, number] };
    const next = { ...tracer, pos: [20, 0, 0] as typeof tracer.pos };
    expect(sampleCrewEntities([tracer], [{ ...next, id: 2 }, next], view)[0].pos).toEqual([10, 0, 0]);
  });
});

describe('Crew local prediction', () => {
  it('replays only unacknowledged inputs and decays correction smoothly', () => {
    const prediction = new CrewPrediction();
    const initial = newFlight(0, [0, 750, 0]);
    const turn = { ...neutral, turn: 1, roll: true };
    const first = prediction.step(initial, neutral, 0, 1);
    const local = prediction.step(first, turn, 0, 2);
    const authority = { ...first, pos: [first.pos[0] + 2, first.pos[1], first.pos[2]] as typeof first.pos };
    const expected = { ...authority };
    stepFlight(expected, turn, 0, CREW_STEP);
    const corrected = prediction.reconcile(local, authority, 1, 0, false);

    expect(corrected).toEqual(expected);
    prediction.smooth(corrected, 0).pos.forEach((value, index) => {
      expect(value).toBeCloseTo(local.pos[index], 10);
    });
    expect(prediction.smooth(corrected, 0.5).pos[0]).toBeCloseTo(corrected.pos[0], 2);
    expect(prediction.reconcile(corrected, corrected, 2, 0, false)).toEqual(corrected);
  });

  it('snaps to an authoritative respawn without predicting through terrain', () => {
    const prediction = new CrewPrediction();
    const previous = newFlight(0, [0, 750, 0]);
    const respawn = newFlight(0, [100, 750, 250]);
    expect(prediction.smooth(prediction.reconcile(previous, respawn, 0, 0, true), 0).pos).toEqual(respawn.pos);
    const underground = newFlight(0, [0, -50, 0]);
    expect(prediction.step(underground, neutral, 0, 1)).toBe(underground);
  });
});
