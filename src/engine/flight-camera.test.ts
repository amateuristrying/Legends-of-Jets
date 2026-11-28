import { describe, expect, it } from 'vitest';
import { advanceFlightCamera, sampleFlightCamera } from './flight-camera';
import { newFlight } from './flight';
import type { Vec3 } from './types';
import { dist3, sub } from './world';

const jitter: Vec3 = [0, 0, 0];

describe('flight camera handoff', () => {
  it('finishes the close-up before removing the jet and revealing the cockpit', () => {
    const flight = newFlight(0, [0, 800, 0]);
    const samples = Array.from({ length: 101 }, (_, i) => sampleFlightCamera(flight, i / 100, 0, 16 / 9, jitter));
    const closeUp = samples[64];
    expect(dist3(flight.pos, closeUp.eye)).toBeLessThan(dist3(flight.pos, samples[0].eye) / 3);
    expect(closeUp).toMatchObject({ exteriorOpacity: 1, cockpitOpacity: 0 });
    expect(samples[70].eye).toEqual(closeUp.eye);
    expect(samples[70].exteriorOpacity).toBeCloseTo(0.5);
    expect(samples[76]).toMatchObject({ eye: closeUp.eye, exteriorOpacity: 0, cockpitOpacity: 0 });
    expect(samples[89].cockpitOpacity).toBeGreaterThan(0);
    expect(samples.every(view => view.exteriorOpacity === 0 || view.cockpitOpacity === 0)).toBe(true);
    expect(samples[100]).toMatchObject({ eye: [0, 803, 4], target: [0, 803, 5], fov: 0.74, cockpitOpacity: 1 });
  });

  it('follows the aircraft and reverses from the current frame without resetting the path', () => {
    const flight = newFlight(2, [50, 800, 50]);
    const progress = advanceFlightCamera(0, true, 0.52);
    const view = sampleFlightCamera(flight, progress, 0, 16 / 9, jitter);
    flight.pos = [150, 850, 250];
    const moved = sampleFlightCamera(flight, progress, 0, 16 / 9, jitter);
    expect(sub(moved.eye, view.eye)).toEqual([100, 50, 200]);

    const reverse = advanceFlightCamera(progress, false, 1 / 120);
    const reversing = sampleFlightCamera(flight, reverse, 0, 16 / 9, jitter);
    expect(reverse).toBeLessThan(progress);
    expect(dist3(reversing.eye, moved.eye)).toBeLessThan(1);
    expect(advanceFlightCamera(reverse, false, 2)).toBe(0);
    expect(advanceFlightCamera(progress, true, 2)).toBe(1);
  });
});
