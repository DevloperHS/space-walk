/**
 * 100% Procedural, Non-Copyrighted Generative Deep-Space Cinema Audio Engine.
 * Synthesizes an evolving polyphonic ambient orchestral soundscape inspired by
 * deep-space radio plasma & cinema scores, dynamically modulated by orbital
 * velocity, planetary gravity wells, lateral steering inertia, and stereo-panned
 * Doppler debris flybys: zero external MP3 assets, zero 404s, instant playback.
 */

interface HarmonicChord {
  root: number;
  notes: number[];
  filterCutoff: number;
}

// Curated modal chord palette mapped across Solar System landmarks (Hz)
const SECTOR_CHORDS: HarmonicChord[] = [
  { root: 49.0, notes: [98.0, 146.83, 220.0, 293.66], filterCutoff: 520 },     // 0 Neptune: deep G Dorian open fifths
  { root: 55.0, notes: [110.0, 164.81, 246.94, 329.63], filterCutoff: 580 },   // 1 Uranus: translucent A suspended
  { root: 58.27, notes: [116.54, 174.61, 261.63, 392.0], filterCutoff: 760 },  // 2 Saturn: shimmering Bb Lydian ring plane
  { root: 43.65, notes: [87.31, 130.81, 174.61, 261.63], filterCutoff: 460 },  // 3 Jupiter: massive F sub-brass gravitas
  { root: 51.91, notes: [103.83, 155.56, 207.65, 311.13], filterCutoff: 640 }, // 4 Asteroid Belt: tense Ab minor pulse
  { root: 55.0, notes: [110.0, 146.83, 220.0, 329.63], filterCutoff: 590 },    // 5 Mars: stark D/A arid fifths
  { root: 65.41, notes: [130.81, 196.0, 246.94, 329.63], filterCutoff: 840 },  // 6 Earth & Moon: poignant Cmaj7 warmth
  { root: 61.74, notes: [123.47, 185.0, 246.94, 369.99], filterCutoff: 680 },  // 7 Venus: dense B veiled haze
  { root: 69.3, notes: [138.59, 207.65, 277.18, 415.3], filterCutoff: 780 },   // 8 Mercury: bright C# metallic shimmer
  { root: 73.42, notes: [146.83, 220.0, 293.66, 440.0], filterCutoff: 1180 },  // 9 Sun Perihelion: radiant D harmonic bloom
];

export class SpaceAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private subGain: GainNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private steerFilter: BiquadFilterNode | null = null;
  private steerGain: GainNode | null = null;
  private steerPanner: StereoPannerNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private initialized = false;
  private muted = false;
  private paused = false;
  private currentHarmonicIndex = -1;
  private lastWhooshAt = 0;
  private lastShimmerAt = 0;

  public isMuted(): boolean {
    return this.muted;
  }

  public isRunning(): boolean {
    return this.initialized && !this.muted && this.ctx?.state === 'running';
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    // Warm pink-tinted noise (Paul Kellet filter)
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
    }
    return buffer;
  }

  private createSpaceReverbImpulse(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const duration = 3.2;
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const channel = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - i / length, 2.6);
        channel[i] = (Math.random() * 2 - 1) * decay * 0.5;
      }
    }
    return impulse;
  }

  public unlock(): boolean {
    if (typeof window === 'undefined') return false;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.initialized) {
      try {
        const ctx = new AudioCtx();
        this.ctx = ctx;

        const master = ctx.createGain();
        master.gain.value = 0.0001;
        master.connect(ctx.destination);
        this.masterGain = master;

        // Lush cosmic reverb bus
        const reverb = ctx.createConvolver();
        reverb.buffer = this.createSpaceReverbImpulse(ctx);
        const wetGain = ctx.createGain();
        wetGain.gain.value = 0.55;
        reverb.connect(wetGain);
        wetGain.connect(master);
        this.reverbNode = reverb;

        // Evolving polyphonic ambient pad voices
        const padFilter = ctx.createBiquadFilter();
        padFilter.type = 'lowpass';
        padFilter.frequency.value = 540;
        padFilter.Q.value = 1.1;

        const padGain = ctx.createGain();
        padGain.gain.value = 0.15;
        padFilter.connect(padGain);
        padGain.connect(master);
        padGain.connect(reverb);
        this.padFilter = padFilter;
        this.padGain = padGain;

        // Slow organic breathing LFO modulating pad filter warmth (~12.5s cycle)
        const breathLfo = ctx.createOscillator();
        breathLfo.type = 'sine';
        breathLfo.frequency.value = 0.08;
        const breathDepth = ctx.createGain();
        breathDepth.gain.value = 85;
        breathLfo.connect(breathDepth);
        breathDepth.connect(padFilter.frequency);
        breathLfo.start();

        const initChord = SECTOR_CHORDS[0];
        this.padOscs = [];
        for (let i = 0; i < initChord.notes.length; i++) {
          // Slightly detuned stereo-rich pair per note
          const oscA = ctx.createOscillator();
          oscA.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
          oscA.frequency.value = initChord.notes[i];
          oscA.detune.value = (i - 1.5) * 4.5;

          const voiceGain = ctx.createGain();
          voiceGain.gain.value = i === 0 ? 0.28 : 0.18;
          oscA.connect(voiceGain);
          voiceGain.connect(padFilter);
          oscA.start();
          this.padOscs.push(oscA);
        }

        // Deep planetary sub-octave gravity drone
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.value = initChord.root;
        const subGain = ctx.createGain();
        subGain.gain.value = 0.14;
        subOsc.connect(subGain);
        subGain.connect(master);
        subOsc.start();
        this.subOsc = subOsc;
        this.subGain = subGain;

        // Continuous solar-wind & cosmic dust airflow noise
        const noiseBuf = this.createNoiseBuffer(ctx);
        this.noiseBuffer = noiseBuf;

        const windSrc = ctx.createBufferSource();
        windSrc.buffer = noiseBuf;
        windSrc.loop = true;

        const windFilter = ctx.createBiquadFilter();
        windFilter.type = 'bandpass';
        windFilter.frequency.value = 160;
        windFilter.Q.value = 0.9;

        const windGain = ctx.createGain();
        windGain.gain.value = 0.08;

        windSrc.connect(windFilter);
        windFilter.connect(windGain);
        windGain.connect(master);
        windGain.connect(reverb);
        windSrc.start();
        this.windFilter = windFilter;
        this.windGain = windGain;

        // Lateral steering inertial basalt rumble / banking swoosh
        const steerSrc = ctx.createBufferSource();
        steerSrc.buffer = noiseBuf;
        steerSrc.loop = true;

        const steerFilter = ctx.createBiquadFilter();
        steerFilter.type = 'lowpass';
        steerFilter.frequency.value = 140;
        steerFilter.Q.value = 2.4;

        const steerGain = ctx.createGain();
        steerGain.gain.value = 0.0001;

        const steerPanner = ctx.createStereoPanner();
        steerPanner.pan.value = 0;

        steerSrc.connect(steerFilter);
        steerFilter.connect(steerGain);
        steerGain.connect(steerPanner);
        steerPanner.connect(master);
        steerSrc.start();
        this.steerFilter = steerFilter;
        this.steerGain = steerGain;
        this.steerPanner = steerPanner;

        this.initialized = true;
        this.currentHarmonicIndex = 0;
      } catch {
        return false;
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    if (!this.muted && this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0.75, now, 0.35);
    }

    return true;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted && !this.initialized) {
      this.unlock();
      return;
    }
    if (!this.ctx || !this.masterGain) return;
    if (!muted && !this.paused && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(muted || this.paused ? 0.0001 : 0.75, now, 0.22);
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx || !this.masterGain) return;
    if (!paused && !this.muted && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(paused || this.muted ? 0.0001 : 0.75, now, 0.16);
  }

  public updateTelemetry(
    harmonicIndex: number,
    velocityNorm: number,
    gravityStrength: number,
    solarHeat: number,
    steerAmount: number,
    isRecharging = false,
    rechargeProgress = 0,
  ): void {
    if (!this.initialized || !this.ctx || this.muted || this.paused || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Glide harmonic chord smoothly whenever entering a new planetary sector
    const idx = Math.max(0, Math.min(SECTOR_CHORDS.length - 1, harmonicIndex));
    if (idx !== this.currentHarmonicIndex) {
      this.currentHarmonicIndex = idx;
      const chord = SECTOR_CHORDS[idx];
      this.subOsc?.frequency.setTargetAtTime(chord.root, now, 1.8);
      for (let i = 0; i < this.padOscs.length; i++) {
        this.padOscs[i].frequency.setTargetAtTime(chord.notes[i % chord.notes.length], now, 1.8);
      }
    }

    const chord = SECTOR_CHORDS[idx];
    // During 1-minute recharge stasis, hush the pad filter softly and slowly brighten as health restores
    const stasisCutoff = 210 + rechargeProgress * 310;
    const cutoff = isRecharging
      ? stasisCutoff
      : chord.filterCutoff + velocityNorm * 340 + solarHeat * 680 + gravityStrength * 220;

    this.padFilter?.frequency.setTargetAtTime(cutoff, now, 0.45);
    this.padGain?.gain.setTargetAtTime(
      isRecharging ? 0.11 + rechargeProgress * 0.05 : 0.13 + gravityStrength * 0.09 + solarHeat * 0.07,
      now,
      0.45,
    );
    this.subGain?.gain.setTargetAtTime(
      isRecharging ? 0.07 + rechargeProgress * 0.06 : 0.11 + gravityStrength * 0.16 + solarHeat * 0.12,
      now,
      0.4,
    );

    // Solar wind & orbital speed hiss (drops to whisper-quiet vacuum during travel halt)
    this.windFilter?.frequency.setTargetAtTime(
      isRecharging ? 110 : 140 + velocityNorm * 520 + solarHeat * 640,
      now,
      0.3,
    );
    this.windGain?.gain.setTargetAtTime(
      isRecharging ? 0.022 : 0.05 + velocityNorm * 0.14 + solarHeat * 0.16,
      now,
      0.3,
    );

    // Tactile steering banking inertia sound panned toward the active turn side
    const absSteer = isRecharging ? 0 : Math.abs(steerAmount);
    this.steerGain?.gain.setTargetAtTime(absSteer > 0.05 ? 0.04 + absSteer * 0.16 : 0.0001, now, 0.12);
    this.steerFilter?.frequency.setTargetAtTime(110 + absSteer * 210, now, 0.12);
    this.steerPanner?.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, steerAmount * 0.75)), now, 0.08);

    // Periodic celestial bowed-glass overtone swell so the ambient score stays alive & evolving
    const nowMs = performance.now();
    if (!isRecharging && velocityNorm > 0.08 && nowMs - this.lastShimmerAt > 8500) {
      this.lastShimmerAt = nowMs;
      this.triggerCelestialShimmer(chord, solarHeat);
    }
  }

  /**
   * Subtle stereo-drifting high harmonic bloom drawn from the current planet's modal scale.
   */
  private triggerCelestialShimmer(chord: HarmonicChord, solarHeat: number): void {
    if (!this.ctx || !this.masterGain || !this.reverbNode || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const note = chord.notes[Math.floor(Math.random() * chord.notes.length)] * 2;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(note, now);
    osc.frequency.exponentialRampToValueAtTime(note * 1.006, now + 4.4);

    const panner = ctx.createStereoPanner();
    const startPan = (Math.random() - 0.5) * 1.2;
    panner.pan.setValueAtTime(startPan, now);
    panner.pan.linearRampToValueAtTime(-startPan * 0.8, now + 4.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.026 + solarHeat * 0.02, now + 1.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.8);

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.reverbNode);
    panner.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 4.9);
  }

  /**
   * Warm deep-space ignition swell when Play opens the Solar System voyage.
   */
  public triggerVoyageLaunch(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const chord = SECTOR_CHORDS[Math.max(0, this.currentHarmonicIndex)];

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(36, now);
    sub.frequency.exponentialRampToValueAtTime(chord.root * 1.5, now + 1.6);

    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0001, now);
    subG.gain.linearRampToValueAtTime(0.22, now + 0.45);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);

    sub.connect(subG);
    subG.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 2.3);

    const fifth = ctx.createOscillator();
    fifth.type = 'triangle';
    fifth.frequency.setValueAtTime(chord.notes[2], now + 0.08);
    const fifthG = ctx.createGain();
    fifthG.gain.setValueAtTime(0.0001, now + 0.08);
    fifthG.gain.linearRampToValueAtTime(0.065, now + 0.55);
    fifthG.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);

    fifth.connect(fifthG);
    fifthG.connect(this.masterGain);
    if (this.reverbNode) fifthG.connect(this.reverbNode);
    fifth.start(now + 0.08);
    fifth.stop(now + 2.7);
  }

  /**
   * Stereo-panned Doppler flyby whoosh + icy crystalline chime or basalt crackle
   * triggered when a debris boulder whips closely past the foreground rim.
   */
  public triggerDebrisFlyby(pan: number, intensity: number, isIce: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) {
      return;
    }
    const nowMs = performance.now();
    if (nowMs - this.lastWhooshAt < 180) return;
    this.lastWhooshAt = nowMs;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const clampedPan = Math.max(-0.92, Math.min(0.92, pan));
    const amp = Math.max(0.15, Math.min(1, intensity));

    // Doppler pitch-sweeping filtered noise burst
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = isIce ? 3.2 : 1.6;
    const startFreq = isIce ? 1450 + amp * 900 : 480 + amp * 420;
    const endFreq = isIce ? 320 : 88;
    filter.frequency.setValueAtTime(startFreq, now);
    filter.frequency.exponentialRampToValueAtTime(endFreq, now + 0.42);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.28 * amp, now + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(clampedPan, now);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain);
    if (this.reverbNode) panner.connect(this.reverbNode);

    src.start(now, Math.random() * 1.4, 0.52);

    // Crystalline refractive ping for ice ring shards
    if (isIce) {
      const chime = ctx.createOscillator();
      chime.type = 'sine';
      const baseHz = 1180 + Math.random() * 820;
      chime.frequency.setValueAtTime(baseHz, now);
      chime.frequency.exponentialRampToValueAtTime(baseHz * 0.78, now + 0.28);

      const chimeGain = ctx.createGain();
      chimeGain.gain.setValueAtTime(0.0001, now);
      chimeGain.gain.linearRampToValueAtTime(0.065 * amp, now + 0.02);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

      chime.connect(chimeGain);
      chimeGain.connect(panner);
      chime.start(now);
      chime.stop(now + 0.36);
    }
  }

  /**
   * Visceral physical rock-fracture crunch or crystalline ice shatter when the
   * host asteroid collides with an oncoming asteroid and breaks chunks off it.
   */
  public triggerCollisionImpact(pan: number, intensity: number, isIce: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const clampedPan = Math.max(-0.92, Math.min(0.92, pan));
    const amp = Math.max(0.35, Math.min(1, intensity));

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(clampedPan, now);
    panner.connect(this.masterGain);
    if (this.reverbNode) panner.connect(this.reverbNode);

    // 1. Sub-bass physical impact thud
    const thudOsc = ctx.createOscillator();
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(isIce ? 145 : 108, now);
    thudOsc.frequency.exponentialRampToValueAtTime(28, now + 0.32);

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.linearRampToValueAtTime(0.46 * amp, now + 0.012);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

    thudOsc.connect(thudGain);
    thudGain.connect(panner);
    thudOsc.start(now);
    thudOsc.stop(now + 0.38);

    // 2. Crunchy fracture crackle burst + staggered flying chunk clatter
    const bursts = isIce ? 4 : 3;
    for (let i = 0; i < bursts; i++) {
      const delay = i * (0.032 + Math.random() * 0.035);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = isIce ? 3.8 : 1.4;
      filter.frequency.setValueAtTime(
        isIce ? 1850 + i * 420 : 620 - i * 110 + Math.random() * 180,
        now + delay,
      );
      filter.frequency.exponentialRampToValueAtTime(isIce ? 480 : 120, now + delay + 0.24);

      const gain = ctx.createGain();
      const peak = (0.34 / (i + 1)) * amp;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.linearRampToValueAtTime(peak, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.28);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      src.start(now + delay, Math.random() * 1.5, 0.3);
    }

    // 3. Crystalline high-frequency shatter harmonics for ice impacts
    if (isIce) {
      for (let i = 0; i < 3; i++) {
        const delay = i * 0.024;
        const shard = ctx.createOscillator();
        shard.type = 'triangle';
        const hz = 1600 + i * 540 + Math.random() * 480;
        shard.frequency.setValueAtTime(hz, now + delay);
        shard.frequency.exponentialRampToValueAtTime(hz * 0.72, now + delay + 0.22);

        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.0001, now + delay);
        sg.gain.linearRampToValueAtTime(0.075 * amp, now + delay + 0.01);
        sg.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.24);

        shard.connect(sg);
        sg.connect(panner);
        shard.start(now + delay);
        shard.stop(now + delay + 0.26);
      }
    }
  }

  /**
   * Subtle structural-stress resonant overtone layered on collisions as integrity depletes.
   * Tuned directly to the active sector chord so it stays musical and cinematic.
   */
  public triggerHullStress(remainingHealth: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const chord = SECTOR_CHORDS[Math.max(0, this.currentHarmonicIndex)];
    const urgency = 1 - Math.max(0, Math.min(1, remainingHealth));

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const startHz = chord.notes[1] * (1.06 + urgency * 0.35);
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(chord.notes[0] * 0.96, now + 0.52);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(920 + urgency * 700, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.08 + urgency * 0.09, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    if (this.reverbNode) gain.connect(this.reverbNode);

    osc.start(now);
    osc.stop(now + 0.64);
  }

  /**
   * Cinematic deep-space deceleration & inertia shutdown when health reaches 0.
   * Dual sub-harmonic pitch drop + decompression sweep through cosmic reverb.
   */
  public triggerTravelStall(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const chord = SECTOR_CHORDS[Math.max(0, this.currentHarmonicIndex)];

    // 1. Heavy dual-voice sub-harmonic power-down glide
    const freqs = [chord.notes[1], chord.notes[0]];
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(freqs[i], now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(26, chord.root * 0.56), now + 2.1);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(520, now);
      filter.frequency.exponentialRampToValueAtTime(75, now + 2.0);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(i === 0 ? 0.16 : 0.28, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.35);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      if (this.reverbNode) gain.connect(this.reverbNode);

      osc.start(now);
      osc.stop(now + 2.4);
    }

    // 2. Soft cosmic decompression sigh
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.8;
      filter.frequency.setValueAtTime(760, now);
      filter.frequency.exponentialRampToValueAtTime(110, now + 1.8);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.95);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      if (this.reverbNode) gain.connect(this.reverbNode);
      src.start(now, 0, 2.0);
    }
  }

  /**
   * Hypnotic, crystalline harmonic regeneration pulse synchronized with the
   * pulsing green refilling bar; ascends softly across the active sector's key.
   */
  public triggerRechargePulse(progress: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const chord = SECTOR_CHORDS[Math.max(0, this.currentHarmonicIndex)];
    const p = Math.max(0, Math.min(1, progress));

    // Gently climb harmonic overtones as the 60-second refill nears 100%
    const noteIdx = Math.min(chord.notes.length - 1, Math.floor(p * chord.notes.length));
    const baseHz = chord.notes[noteIdx] * (1.0 + p * 0.5);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseHz, now);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 1.015, now + 0.9);

    const overtone = ctx.createOscillator();
    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(baseHz * 1.5, now); // Pure fifth shimmer

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(880 + p * 900, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.048 + p * 0.032, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);

    osc.connect(filter);
    overtone.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    if (this.reverbNode) gain.connect(this.reverbNode);

    osc.start(now);
    overtone.start(now);
    osc.stop(now + 1.2);
    overtone.stop(now + 1.2);
  }

  /**
   * Radiant open-fifth harmonic bloom + warm sub-bass ignition swell when the
   * 1-minute recharge completes and the asteroid resumes its Solar System dive.
   */
  public triggerRechargeComplete(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const chord = SECTOR_CHORDS[Math.max(0, this.currentHarmonicIndex)];

    const bloomNotes = [chord.notes[0], chord.notes[1], chord.notes[2], chord.notes[3] * 2];
    for (let i = 0; i < bloomNotes.length; i++) {
      const delay = i * 0.075;
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(bloomNotes[i], now + delay);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.linearRampToValueAtTime(i === 0 ? 0.16 : 0.085, now + delay + 0.24);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 2.4);

      osc.connect(gain);
      gain.connect(this.masterGain);
      if (this.reverbNode) gain.connect(this.reverbNode);

      osc.start(now + delay);
      osc.stop(now + delay + 2.5);
    }

    // Warm sub-bass acceleration surge
    const surge = ctx.createOscillator();
    surge.type = 'sine';
    surge.frequency.setValueAtTime(34, now);
    surge.frequency.exponentialRampToValueAtTime(chord.root * 1.5, now + 1.4);

    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.linearRampToValueAtTime(0.24, now + 0.55);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.85);

    surge.connect(sg);
    sg.connect(this.masterGain);
    surge.start(now);
    surge.stop(now + 1.9);
  }

  public dispose(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.initialized = false;
  }
}
