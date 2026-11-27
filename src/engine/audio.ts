import type { FlightState, GameSettings } from './types';
import { planes } from './world';

export type SoundCue =
  | 'gun'
  | 'missile'
  | 'rocket'
  | 'flare'
  | 'hit'
  | 'kill'
  | 'ring'
  | 'jammed'
  | 'restored'
  | 'incoming'
  | 'boom'
  | 'pullup';

export class TacticalAudio {
  context: AudioContext;
  noise: AudioBuffer;
  filter: BiquadFilterNode;
  level: GainNode;
  turbineOsc: OscillatorNode;
  turbineGain: GainNode;
  seekerOsc: OscillatorNode;
  seekerGain: GainNode;
  musicGain: GainNode;
  musicTimer: number | null = null;
  musicStep = 0;
  intensity = 0;
  jammed = false;
  lastBoost = 0;
  lastPullup = 0;

  constructor() {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new AudioCtx();
    const ctx = this.context;

    // White noise buffer for jet roar & explosions
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buffer;
    noiseSrc.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    noiseSrc.connect(this.filter).connect(this.level).connect(ctx.destination);
    noiseSrc.start();

    // Per-jet turbine whine oscillator
    this.turbineOsc = ctx.createOscillator();
    this.turbineOsc.type = 'sawtooth';
    const turbineFilter = ctx.createBiquadFilter();
    turbineFilter.type = 'bandpass';
    turbineFilter.frequency.value = 420;
    turbineFilter.Q.value = 3;
    this.turbineGain = ctx.createGain();
    this.turbineGain.gain.value = 0;
    this.turbineOsc.connect(turbineFilter).connect(this.turbineGain).connect(ctx.destination);
    this.turbineOsc.start();

    // IR missile seeker growl (classic Sidewinder tone that shifts pitch on lock)
    this.seekerOsc = ctx.createOscillator();
    this.seekerOsc.type = 'triangle';
    this.seekerOsc.frequency.value = 260;
    this.seekerGain = ctx.createGain();
    this.seekerGain.gain.value = 0;
    this.seekerOsc.connect(this.seekerGain).connect(ctx.destination);
    this.seekerOsc.start();

    // Procedural synth soundtrack bus
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(ctx.destination);
    this.startMusicLoop();
  }

  private startMusicLoop(): void {
    const bassNotes = [55, 55, 65.41, 73.42, 55, 55, 82.41, 73.42];
    const arpNotes = [220, 261.63, 329.63, 392, 440, 392, 329.63, 293.66];
    this.musicTimer = window.setInterval(() => {
      if (this.context.state !== 'running' || this.musicGain.gain.value < 0.002 || this.jammed) return;
      const now = this.context.currentTime;
      const step = this.musicStep++ % 8;

      // Deep synth bass pulse
      const bass = this.context.createOscillator();
      const bGain = this.context.createGain();
      const bFilter = this.context.createBiquadFilter();
      bass.type = 'sawtooth';
      bass.frequency.setValueAtTime(bassNotes[step], now);
      bFilter.type = 'lowpass';
      bFilter.frequency.setValueAtTime(220 + this.intensity * 480, now);
      bGain.gain.setValueAtTime(0.001, now);
      bGain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
      bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      bass.connect(bFilter).connect(bGain).connect(this.musicGain);
      bass.start(now);
      bass.stop(now + 0.26);

      // Combat arpeggio layer when intensity > 0.35
      if (this.intensity > 0.35) {
        const arp = this.context.createOscillator();
        const aGain = this.context.createGain();
        arp.type = 'triangle';
        arp.frequency.setValueAtTime(arpNotes[(step * 2) % arpNotes.length], now);
        aGain.gain.setValueAtTime(0.001, now);
        aGain.gain.exponentialRampToValueAtTime(0.07 * this.intensity, now + 0.015);
        aGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        arp.connect(aGain).connect(this.musicGain);
        arp.start(now);
        arp.stop(now + 0.18);
      }
    }, 240);
  }

  feedback(kind: SoundCue, settings: GameSettings): void {
    const ctx = this.context;
    const now = ctx.currentTime;
    if (ctx.state !== 'running' || !settings.sound) return;

    const cues: Record<SoundCue, [number, number, number, 'noise' | OscillatorType]> = {
      gun: [1250, 0.07, 0.14, 'noise'],
      missile: [290, 0.26, 0.27, 'sawtooth'],
      rocket: [190, 0.2, 0.24, 'sawtooth'],
      flare: [550, 0.19, 0.16, 'noise'],
      hit: [110, 0.22, 0.28, 'noise'],
      kill: [740, 0.28, 0.22, 'sine'],
      ring: [880, 0.22, 0.18, 'triangle'],
      jammed: [880, 0.82, 0.35, 'noise'],
      restored: [660, 0.42, 0.19, 'sine'],
      incoming: [690, 0.35, 0.2, 'triangle'],
      boom: [72, 0.34, 0.34, 'noise'],
      pullup: [980, 0.26, 0.22, 'square'],
    };

    const [frequency, duration, volume, type] = cues[kind];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, settings.volume * volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(ctx.destination);

    if (type === 'noise') {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = kind === 'boom' ? 0.5 : 0.85;
      source.connect(filter).connect(gain);
      source.start(now);
      source.stop(now + duration + 0.01);
    } else {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, now);
      const targetFreq =
        kind === 'restored' || kind === 'kill' || kind === 'ring'
          ? frequency * 1.45
          : kind === 'pullup'
            ? frequency * 1.18
            : frequency * 0.66;
      osc.frequency.exponentialRampToValueAtTime(targetFreq, now + duration);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    }
  }

  update(
    flight: FlightState | null,
    playing: boolean,
    settings: GameSettings,
    opts: {
      hasLock: boolean;
      inCombat: boolean;
      jammed: boolean;
      agl: number;
    }
  ): void {
    const now = this.context.currentTime;
    this.jammed = opts.jammed;
    this.intensity = opts.inCombat ? 1 : 0.2;

    const spec = flight ? (planes[flight.type] ?? planes[0]) : planes[0];
    const active = playing && Boolean(flight) && settings.sound && (flight?.death ?? 1) <= 0;

    // Afterburner sonic boom thump on boost engage
    if (active && flight && flight.boost > 0.55 && this.lastBoost <= 0.55) {
      this.feedback('boom', settings);
    }
    this.lastBoost = flight?.boost ?? 0;

    // GPWS PULL UP warning
    if (active && flight && opts.agl < 26 && flight.pitch < -0.15 && now - this.lastPullup > 1.1) {
      this.lastPullup = now;
      this.feedback('pullup', settings);
    }

    this.level.gain.setTargetAtTime(
      active && flight ? settings.volume * (0.3 + flight.boost * 0.36) : 0,
      now,
      0.14
    );
    this.filter.frequency.setTargetAtTime(250 + (flight?.speed || 0) * 5.2, now, 0.18);

    this.turbineOsc.frequency.setTargetAtTime(
      (115 + (flight?.speed || 90) * 1.35) * spec.enginePitch,
      now,
      0.12
    );
    this.turbineGain.gain.setTargetAtTime(active ? settings.volume * 0.06 : 0, now, 0.15);

    // Classic IR seeker growl when target locked
    this.seekerOsc.frequency.setTargetAtTime(opts.hasLock ? 840 : 280, now, 0.05);
    this.seekerGain.gain.setTargetAtTime(
      active && opts.hasLock ? settings.volume * 0.045 : 0,
      now,
      0.06
    );

    // Dynamic music bus
    const musicTarget =
      playing && settings.music && !opts.jammed ? settings.musicVolume * 0.45 : 0;
    this.musicGain.gain.setTargetAtTime(musicTarget, now, 0.35);
  }

  dispose(): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.context.close().catch(() => {});
  }
}
