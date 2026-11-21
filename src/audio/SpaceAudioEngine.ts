/**
 * 100% Procedural, Non-Copyrighted Generative Deep-Space Cinema Audio Engine.
 * Synthesizes an evolving polyphonic ambient score combining:
 *   - Stereo-evolving spectral pad (per-voice prime-cycle breathing LFOs + subtle FM bowed glass)
 *   - Dual-delay shimmer reverb bus + sparse acoustic felt-piano/celesta modal motifs
 *   - Binaural sub-harmonic tidal gravity wells + warm saturated sub-brass swells
 *   - True Hann-windowed granular synthesis for cryogenic ice-dust, mineral micrometeorite
 *     impacts, and perihelion basalt thermal creaks
 *   - Tactile stereo-panned steering rumble, Doppler flybys, rock/ice impact fractures,
 *     and recharge stasis acoustics
 * Zero external audio assets, zero 404s, instant playback, minimal CPU overhead.
 */

interface HarmonicChord {
  root: number;
  notes: number[];
  filterCutoff: number;
  fmDepth: number;      // Crystalline FM glassiness per sector
  shimmerMix: number;   // Shimmer cloud send amount per sector
}

// Curated modal chord palette mapped across Solar System landmarks (Hz)
const SECTOR_CHORDS: HarmonicChord[] = [
  { root: 49.0,  notes: [98.0,  146.83, 220.0,  293.66], filterCutoff: 500,  fmDepth: 14, shimmerMix: 0.42 }, // 0 Neptune: deep G Dorian open fifths
  { root: 55.0,  notes: [110.0, 164.81, 246.94, 329.63], filterCutoff: 560,  fmDepth: 22, shimmerMix: 0.50 }, // 1 Uranus: translucent A suspended
  { root: 58.27, notes: [116.54, 174.61, 261.63, 392.0], filterCutoff: 740,  fmDepth: 34, shimmerMix: 0.68 }, // 2 Saturn: shimmering Bb Lydian ring plane
  { root: 43.65, notes: [87.31, 130.81, 174.61, 261.63], filterCutoff: 440,  fmDepth: 10, shimmerMix: 0.30 }, // 3 Jupiter: massive F sub-brass gravitas
  { root: 51.91, notes: [103.83, 155.56, 207.65, 311.13], filterCutoff: 600, fmDepth: 16, shimmerMix: 0.34 }, // 4 Asteroid Belt: tense Ab minor pulse
  { root: 55.0,  notes: [110.0, 146.83, 220.0,  329.63], filterCutoff: 580,  fmDepth: 15, shimmerMix: 0.40 }, // 5 Mars: stark D/A arid fifths
  { root: 65.41, notes: [130.81, 196.0, 246.94, 329.63], filterCutoff: 820,  fmDepth: 28, shimmerMix: 0.66 }, // 6 Earth & Moon: poignant Cmaj7 warmth
  { root: 61.74, notes: [123.47, 185.0, 246.94, 369.99], filterCutoff: 650,  fmDepth: 20, shimmerMix: 0.44 }, // 7 Venus: dense B veiled haze
  { root: 69.3,  notes: [138.59, 207.65, 277.18, 415.3], filterCutoff: 780,  fmDepth: 36, shimmerMix: 0.56 }, // 8 Mercury: bright C# metallic shimmer
  { root: 73.42, notes: [146.83, 220.0, 293.66, 440.0],  filterCutoff: 1120, fmDepth: 46, shimmerMix: 0.72 }, // 9 Sun Perihelion: radiant D harmonic bloom
];

// Stereo placement & mutually prime breathing rates (Hz) for the 4 spectral pad voices
const VOICE_PANS = [-0.66, -0.22, 0.22, 0.66];
const VOICE_BREATH_RATES = [0.053, 0.071, 0.041, 0.089];

export class SpaceAudioEngine {
  private ctx: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private masterGain: GainNode | null = null;

  // Spectral stereo pad voices (D)
  private padFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private padPrimaryOscs: OscillatorNode[] = [];
  private padDetuneOscs: OscillatorNode[] = [];
  private padFmModOscs: OscillatorNode[] = [];
  private padFmDepthGains: GainNode[] = [];

  // Shimmer reverb bus (D)
  private reverbNode: ConvolverNode | null = null;
  private shimmerSend: GainNode | null = null;
  private shimmerWetGain: GainNode | null = null;

  // Binaural sub-harmonic gravity well + silky warm gravity cello/pad layer (C)
  private subOscL: OscillatorNode | null = null;
  private subOscR: OscillatorNode | null = null;
  private subGain: GainNode | null = null;
  private gravityWarmOsc: OscillatorNode | null = null;
  private gravityWarmGain: GainNode | null = null;

  // Bone-conducted vacuum hull hum & granular micrometeorite bus (B)
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private granularBusGain: GainNode | null = null;
  private hannCurve: Float32Array<ArrayBuffer> | null = null;

  // Lateral steering inertial basalt rumble
  private steerFilter: BiquadFilterNode | null = null;
  private steerGain: GainNode | null = null;
  private steerPanner: StereoPannerNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;

  private initialized = false;
  private muted = false;
  private paused = false;
  private currentHarmonicIndex = -1;
  private lastWhooshAt = 0;
  private lastShimmerAt = 0;
  private lastMotifAt = 0;
  private nextMotifIntervalMs = 8200;
  private lastGrainAt = 0;
  private nextGrainIntervalMs = 260;

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

  /**
   * Dark, velvety 3.6-second stereo space reverb impulse with progressive high-frequency
   * damping so tails bloom smoothly like an infinite void without harsh noise hiss.
   */
  private createSpaceReverbImpulse(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const duration = 3.6;
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const channel = impulse.getChannelData(ch);
      let lpState = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const decay = Math.pow(1 - t, 2.75);
        // Smooth early attack (18 ms) to avoid metallic pre-ringing
        const fadeIn = i < sampleRate * 0.018 ? i / (sampleRate * 0.018) : 1;
        // Progressive dark damping across the tail
        const alpha = 0.34 * (1 - t * 0.72) + 0.05;
        const white = Math.random() * 2 - 1;
        lpState += alpha * (white - lpState);
        channel[i] = lpState * decay * fadeIn * 0.65;
      }
    }
    return impulse;
  }

  /**
   * Reusable 64-point Hann bell curve (0 -> 1 -> 0) for click-free granular synthesis.
   */
  private createHannCurve(): Float32Array<ArrayBuffer> {
    const n = 64;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      curve[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }
    // Keep strictly positive floor at endpoints for clean Web Audio automation
    curve[0] = 0.0001;
    curve[n - 1] = 0.0001;
    return curve;
  }

  public unlock(): boolean {
    if (typeof window === 'undefined') return false;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.initialized) {
      try {
        const ctx = new AudioCtx();
        this.ctx = ctx;

        // Master output stage with gentle glue compression to keep dynamics rich and clip-free
        const masterBus = ctx.createGain();
        masterBus.gain.value = 1.0;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -13;
        compressor.knee.value = 18;
        compressor.ratio.value = 3.2;
        compressor.attack.value = 0.025;
        compressor.release.value = 0.24;

        const master = ctx.createGain();
        master.gain.value = 0.0001;

        masterBus.connect(compressor);
        compressor.connect(master);
        master.connect(ctx.destination);
        this.masterBus = masterBus;
        this.masterGain = master;

        // 1. Lush dark cosmic convolution reverb bus
        const reverb = ctx.createConvolver();
        reverb.buffer = this.createSpaceReverbImpulse(ctx);
        const wetGain = ctx.createGain();
        wetGain.gain.value = 0.56;
        reverb.connect(wetGain);
        wetGain.connect(masterBus);
        this.reverbNode = reverb;

        // 2. Dual-delay ethereal shimmer feedback bus (D)
        const shimmerSend = ctx.createGain();
        shimmerSend.gain.value = 0.45;

        const delayL = ctx.createDelay(1.2);
        delayL.delayTime.value = 0.43;
        const delayR = ctx.createDelay(1.2);
        delayR.delayTime.value = 0.67;

        const shimmerTone = ctx.createBiquadFilter();
        shimmerTone.type = 'bandpass';
        shimmerTone.frequency.value = 1380;
        shimmerTone.Q.value = 0.65;

        const shimmerFeedback = ctx.createGain();
        shimmerFeedback.gain.value = 0.36; // Bounded well below 1.0 for total stability

        const panL = ctx.createStereoPanner();
        panL.pan.value = -0.72;
        const panR = ctx.createStereoPanner();
        panR.pan.value = 0.72;

        const shimmerWetGain = ctx.createGain();
        shimmerWetGain.gain.value = 0.42;

        shimmerSend.connect(shimmerTone);
        shimmerTone.connect(delayL);
        delayL.connect(delayR);
        delayR.connect(shimmerFeedback);
        shimmerFeedback.connect(shimmerTone);

        delayL.connect(panL);
        delayR.connect(panR);
        panL.connect(shimmerWetGain);
        panR.connect(shimmerWetGain);
        shimmerWetGain.connect(reverb);
        shimmerWetGain.connect(masterBus);

        this.shimmerSend = shimmerSend;
        this.shimmerWetGain = shimmerWetGain;

        // 3. Stereo-evolving spectral pad with prime-cycle voice breathing & FM bowed glass (D)
        const padFilter = ctx.createBiquadFilter();
        padFilter.type = 'lowpass';
        padFilter.frequency.value = 500;
        padFilter.Q.value = 1.05;

        const padGain = ctx.createGain();
        padGain.gain.value = 0.14;
        padFilter.connect(padGain);
        padGain.connect(masterBus);
        padGain.connect(reverb);
        padGain.connect(shimmerSend);
        this.padFilter = padFilter;
        this.padGain = padGain;

        // Global slow harmonic warmth sweep (~14.3 s)
        const breathLfo = ctx.createOscillator();
        breathLfo.type = 'sine';
        breathLfo.frequency.value = 0.07;
        const breathDepth = ctx.createGain();
        breathDepth.gain.value = 82;
        breathLfo.connect(breathDepth);
        breathDepth.connect(padFilter.frequency);
        breathLfo.start();

        const initChord = SECTOR_CHORDS[0];
        this.padPrimaryOscs = [];
        this.padDetuneOscs = [];
        this.padFmModOscs = [];
        this.padFmDepthGains = [];

        for (let i = 0; i < initChord.notes.length; i++) {
          const noteHz = initChord.notes[i];
          const isGlassVoice = i === 1 || i === 3;

          const voicePanner = ctx.createStereoPanner();
          voicePanner.pan.value = VOICE_PANS[i % VOICE_PANS.length];
          voicePanner.connect(padFilter);

          // Independent organic breathing gain per voice so chord voicings shift slowly in space
          const voiceGain = ctx.createGain();
          const baseLevel = i === 0 ? 0.24 : isGlassVoice ? 0.14 : 0.17;
          voiceGain.gain.value = baseLevel;
          voiceGain.connect(voicePanner);

          const voiceLfo = ctx.createOscillator();
          voiceLfo.type = 'sine';
          voiceLfo.frequency.value = VOICE_BREATH_RATES[i % VOICE_BREATH_RATES.length];
          const voiceLfoDepth = ctx.createGain();
          voiceLfoDepth.gain.value = baseLevel * 0.34;
          voiceLfo.connect(voiceLfoDepth);
          voiceLfoDepth.connect(voiceGain.gain);
          voiceLfo.start();

          if (isGlassVoice) {
            // Bowed-glass subtle FM voice (sine carrier modulated by 2x harmonic sine)
            const carrier = ctx.createOscillator();
            carrier.type = 'sine';
            carrier.frequency.value = noteHz;
            carrier.detune.value = (i - 1.5) * 3.5;

            const mod = ctx.createOscillator();
            mod.type = 'sine';
            mod.frequency.value = noteHz * 2.0;

            const fmDepth = ctx.createGain();
            fmDepth.gain.value = initChord.fmDepth;

            mod.connect(fmDepth);
            fmDepth.connect(carrier.frequency);
            carrier.connect(voiceGain);

            carrier.start();
            mod.start();

            this.padPrimaryOscs.push(carrier);
            this.padFmModOscs.push(mod);
            this.padFmDepthGains.push(fmDepth);
          } else {
            // Velvety dual-detuned pad pair (triangle + sine, zero low-end sawtooth buzz)
            const oscA = ctx.createOscillator();
            oscA.type = 'triangle';
            oscA.frequency.value = noteHz;
            oscA.detune.value = -4.5;

            const oscB = ctx.createOscillator();
            oscB.type = 'sine';
            oscB.frequency.value = noteHz;
            oscB.detune.value = 4.5;

            const pairMixA = ctx.createGain();
            pairMixA.gain.value = 0.54;
            const pairMixB = ctx.createGain();
            pairMixB.gain.value = 0.62;

            oscA.connect(pairMixA);
            oscB.connect(pairMixB);
            pairMixA.connect(voiceGain);
            pairMixB.connect(voiceGain);

            oscA.start();
            oscB.start();

            this.padPrimaryOscs.push(oscA);
            this.padDetuneOscs.push(oscB);
          }
        }

        // 4. Binaural sub-harmonic gravity well + pure warm octave swell (C)
        const subGain = ctx.createGain();
        subGain.gain.value = 0.12;
        subGain.connect(masterBus);

        const subOscL = ctx.createOscillator();
        subOscL.type = 'sine';
        subOscL.frequency.value = initChord.root - 0.06;
        const subPanL = ctx.createStereoPanner();
        subPanL.pan.value = -0.3;
        subOscL.connect(subPanL);
        subPanL.connect(subGain);
        subOscL.start();

        const subOscR = ctx.createOscillator();
        subOscR.type = 'sine';
        subOscR.frequency.value = initChord.root + 0.06;
        const subPanR = ctx.createStereoPanner();
        subPanR.pan.value = 0.3;
        subOscR.connect(subPanR);
        subPanR.connect(subGain);
        subOscR.start();

        this.subOscL = subOscL;
        this.subOscR = subOscR;
        this.subGain = subGain;

        // Pure undistorted warm octave harmonic swell near massive planets (zero distortion/buzz)
        const gravityWarmOsc = ctx.createOscillator();
        gravityWarmOsc.type = 'sine';
        gravityWarmOsc.frequency.value = initChord.root * 2;

        const gravityWarmGain = ctx.createGain();
        gravityWarmGain.gain.value = 0.01;

        gravityWarmOsc.connect(gravityWarmGain);
        gravityWarmGain.connect(reverb);
        gravityWarmGain.connect(masterBus);
        gravityWarmOsc.start();

        this.gravityWarmOsc = gravityWarmOsc;
        this.gravityWarmGain = gravityWarmGain;

        // 5. Whisper-soft cosmic void air + granular micrometeorite bus (B)
        const noiseBuf = this.createNoiseBuffer(ctx);
        this.noiseBuffer = noiseBuf;
        this.hannCurve = this.createHannCurve();

        const windSrc = ctx.createBufferSource();
        windSrc.buffer = noiseBuf;
        windSrc.loop = true;

        // Gentle, non-resonant high-mid cosmic hush (never rumbles or revs like an engine)
        const windFilter = ctx.createBiquadFilter();
        windFilter.type = 'bandpass';
        windFilter.frequency.value = 460;
        windFilter.Q.value = 0.5;

        const windGain = ctx.createGain();
        windGain.gain.value = 0.012;

        windSrc.connect(windFilter);
        windFilter.connect(windGain);
        windGain.connect(reverb);
        windGain.connect(masterBus);
        windSrc.start();
        this.windFilter = windFilter;
        this.windGain = windGain;

        const granularBusGain = ctx.createGain();
        granularBusGain.gain.value = 0.055;
        granularBusGain.connect(masterBus);
        granularBusGain.connect(reverb);
        this.granularBusGain = granularBusGain;

        // 6. Subtle weightless lateral drift air (no lowpass resonant motor rumble)
        const steerSrc = ctx.createBufferSource();
        steerSrc.buffer = noiseBuf;
        steerSrc.loop = true;

        const steerFilter = ctx.createBiquadFilter();
        steerFilter.type = 'bandpass';
        steerFilter.frequency.value = 540;
        steerFilter.Q.value = 0.7;

        const steerGain = ctx.createGain();
        steerGain.gain.value = 0.0001;

        const steerPanner = ctx.createStereoPanner();
        steerPanner.pan.value = 0;

        steerSrc.connect(steerFilter);
        steerFilter.connect(steerGain);
        steerGain.connect(steerPanner);
        steerPanner.connect(reverb);
        steerPanner.connect(masterBus);
        steerSrc.start();
        this.steerFilter = steerFilter;
        this.steerGain = steerGain;
        this.steerPanner = steerPanner;

        this.initialized = true;
        this.currentHarmonicIndex = 0;
        const nowMs = performance.now();
        this.lastShimmerAt = nowMs - 3000;
        this.lastMotifAt = nowMs - 3500;
        this.lastGrainAt = nowMs;
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
      this.masterGain.gain.setTargetAtTime(0.78, now, 0.35);
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
    this.masterGain.gain.setTargetAtTime(muted || this.paused ? 0.0001 : 0.78, now, 0.22);
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx || !this.masterGain) return;
    if (!paused && !this.muted && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(paused || this.muted ? 0.0001 : 0.78, now, 0.16);
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
    if (!this.initialized || !this.ctx || this.muted || this.paused || this.ctx.state !== 'running') {
      return;
    }
    const now = this.ctx.currentTime;

    // Glide harmonic chord smoothly whenever entering a new planetary sector
    const idx = Math.max(0, Math.min(SECTOR_CHORDS.length - 1, harmonicIndex));
    const chord = SECTOR_CHORDS[idx];

    if (idx !== this.currentHarmonicIndex) {
      this.currentHarmonicIndex = idx;
      this.gravityWarmOsc?.frequency.setTargetAtTime(chord.root * 2, now, 2.2);

      let detuneIdx = 0;
      let fmIdx = 0;
      for (let i = 0; i < this.padPrimaryOscs.length; i++) {
        const noteHz = chord.notes[i % chord.notes.length];
        this.padPrimaryOscs[i].frequency.setTargetAtTime(noteHz, now, 1.9);
        const isGlassVoice = i === 1 || i === 3;
        if (isGlassVoice) {
          this.padFmModOscs[fmIdx]?.frequency.setTargetAtTime(noteHz * 2.0, now, 1.9);
          fmIdx++;
        } else {
          this.padDetuneOscs[detuneIdx]?.frequency.setTargetAtTime(noteHz, now, 1.9);
          detuneIdx++;
        }
      }
    }

    // Ultra-slow meditative binaural sub-sine drift (never flutters or revs)
    const beatHz = isRecharging
      ? 0.09
      : 0.11 + gravityStrength * 0.1 + solarHeat * 0.07;
    this.subOscL?.frequency.setTargetAtTime(chord.root - beatHz * 0.5, now, 1.8);
    this.subOscR?.frequency.setTargetAtTime(chord.root + beatHz * 0.5, now, 1.8);

    // Subtle FM bowed-glass overtone brightness
    const targetFmDepth = isRecharging
      ? chord.fmDepth * (0.35 + rechargeProgress * 0.45)
      : chord.fmDepth + solarHeat * 22 + gravityStrength * 10;
    for (let i = 0; i < this.padFmDepthGains.length; i++) {
      this.padFmDepthGains[i].gain.setTargetAtTime(targetFmDepth, now, 0.9);
    }

    // Spectral pad filter & shimmer cloud blend (gentle velocity lift, never revving)
    const stasisCutoff = 260 + rechargeProgress * 280;
    const cutoff = isRecharging
      ? stasisCutoff
      : chord.filterCutoff + velocityNorm * 95 + solarHeat * 480 + gravityStrength * 140;

    this.padFilter?.frequency.setTargetAtTime(cutoff, now, 0.7);
    this.padGain?.gain.setTargetAtTime(
      isRecharging
        ? 0.11 + rechargeProgress * 0.05
        : 0.14 + gravityStrength * 0.06 + solarHeat * 0.05,
      now,
      0.6,
    );

    // Bloom shimmer reverb wider during quiet 360 recharge stasis, Saturn rings, Earth, and Perihelion
    const targetShimmer = isRecharging
      ? 0.58 + rechargeProgress * 0.18
      : chord.shimmerMix + solarHeat * 0.18;
    this.shimmerWetGain?.gain.setTargetAtTime(Math.min(0.75, targetShimmer), now, 0.85);

    // Smooth pure-sine gravity well + warm octave harmonic swell
    this.subGain?.gain.setTargetAtTime(
      isRecharging
        ? 0.06 + rechargeProgress * 0.04
        : 0.09 + gravityStrength * 0.1 + solarHeat * 0.07,
      now,
      0.6,
    );

    const gravityWarmLevel = isRecharging
      ? 0.008
      : 0.01 + gravityStrength * 0.055 + solarHeat * 0.035;
    this.gravityWarmGain?.gain.setTargetAtTime(gravityWarmLevel, now, 0.8);

    // Whisper-soft cosmic hush (constant airy texture, no accelerator sweep)
    this.windFilter?.frequency.setTargetAtTime(
      isRecharging ? 400 : 440 + solarHeat * 140,
      now,
      0.8,
    );
    this.windGain?.gain.setTargetAtTime(
      isRecharging ? 0.006 : 0.012 + velocityNorm * 0.012 + solarHeat * 0.012,
      now,
      0.6,
    );

    // Granular micrometeorite & crystalline dust bus level
    this.granularBusGain?.gain.setTargetAtTime(
      isRecharging ? 0.025 : 0.045 + velocityNorm * 0.045 + solarHeat * 0.04,
      now,
      0.4,
    );

    // Subtle airy orbital drift sound panned toward the active turn side
    const absSteer = isRecharging ? 0 : Math.abs(steerAmount);
    this.steerGain?.gain.setTargetAtTime(
      absSteer > 0.08 ? 0.012 + absSteer * 0.038 : 0.0001,
      now,
      0.18,
    );
    this.steerFilter?.frequency.setTargetAtTime(520 + absSteer * 140, now, 0.2);
    this.steerPanner?.pan.setTargetAtTime(
      Math.max(-0.8, Math.min(0.8, steerAmount * 0.7)),
      now,
      0.12,
    );

    const nowMs = performance.now();

    // B: Granular synthesis scheduler (ice dust -> belt grit -> perihelion basalt creaks)
    if (nowMs - this.lastGrainAt >= this.nextGrainIntervalMs) {
      this.lastGrainAt = nowMs;
      this.triggerMicroGrain(idx, velocityNorm, solarHeat, isRecharging);
      // Pace density cleanly so CPU stays minimal (< 5 grains/sec)
      const densityFactor = isRecharging
        ? 0.22
        : 0.45 + velocityNorm * 0.75 + (idx === 4 ? 0.35 : 0) + solarHeat * 0.3;
      const baseInterval = 390 / Math.max(0.2, densityFactor);
      this.nextGrainIntervalMs = baseInterval * (0.65 + Math.random() * 0.8);
    }

    // D: Periodic celestial bowed-glass overtone swell
    if (!isRecharging && velocityNorm > 0.08 && nowMs - this.lastShimmerAt > 9200) {
      this.lastShimmerAt = nowMs;
      this.triggerCelestialShimmer(chord, solarHeat);
    }

    // D: Sparse acoustic felt-piano / celesta modal motif floating through shimmer reverb
    if (nowMs - this.lastMotifAt >= this.nextMotifIntervalMs) {
      this.lastMotifAt = nowMs;
      this.nextMotifIntervalMs = (isRecharging ? 11500 : 8400) + Math.random() * 6200;
      this.triggerSparseAcousticMotif(chord, gravityStrength, solarHeat, isRecharging);
    }
  }

  /**
   * B: Schedules a single Hann-windowed granular micro-impact or thermal hull grain.
   * Morphs timbre automatically across the Solar System:
   *   - Outer System / Saturn Rings (0..2): glassy cryogenic ice-dust micro-pings
   *   - Jupiter & Main Belt (3..4): dry lithic/mineral micrometeorite dust grains
   *   - Inner System & Sun (5..9): warm basalt thermal-expansion creaks & coronal crackles
   */
  private triggerMicroGrain(
    sectorIdx: number,
    velocityNorm: number,
    solarHeat: number,
    isRecharging: boolean,
  ): void {
    if (!this.ctx || !this.noiseBuffer || !this.granularBusGain || !this.hannCurve || this.muted) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const isOuterIce = sectorIdx <= 2;
    const isInnerThermal = sectorIdx >= 6 || solarHeat > 0.38;

    const dur = isOuterIce
      ? 0.045 + Math.random() * 0.075
      : isInnerThermal
        ? 0.075 + Math.random() * 0.115
        : 0.04 + Math.random() * 0.085;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';

    let startFreq: number;
    let endFreq: number;
    if (isOuterIce) {
      // High-Q glassy cryogenic dust pings
      filter.Q.value = 11 + Math.random() * 6;
      startFreq = 1850 + Math.random() * 2600;
      endFreq = startFreq * (0.95 + Math.random() * 0.04);
    } else if (isInnerThermal) {
      // Delicate high crystalline thermal shimmer & micro-ticks
      filter.Q.value = 10 + Math.random() * 6;
      startFreq = 1400 + Math.random() * 2400;
      endFreq = startFreq * (0.9 + Math.random() * 0.06);
    } else {
      // Subtle mineral dust shimmer in Main Belt & Jupiter zone
      filter.Q.value = 9 + Math.random() * 5;
      startFreq = 950 + Math.random() * 1650;
      endFreq = startFreq * (0.9 + Math.random() * 0.08);
    }

    filter.frequency.setValueAtTime(startFreq, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, endFreq), now + dur);

    // Click-free Hann window envelope using preallocated curve
    const envGain = ctx.createGain();
    try {
      envGain.gain.setValueCurveAtTime(this.hannCurve, now, dur);
    } catch {
      envGain.gain.setValueAtTime(0.0001, now);
      envGain.gain.linearRampToValueAtTime(0.8, now + dur * 0.45);
      envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    }

    // Per-grain dynamic level variation so grains feel natural and organic
    const grainTrim = ctx.createGain();
    const ampScale = (isRecharging ? 0.45 : 0.5 + velocityNorm * 0.5) * (0.4 + Math.random() * 0.6);
    grainTrim.gain.value = ampScale;

    const panner = ctx.createStereoPanner();
    panner.pan.value = (Math.random() * 2 - 1) * 0.85;

    src.connect(filter);
    filter.connect(envGain);
    envGain.connect(grainTrim);
    grainTrim.connect(panner);
    panner.connect(this.granularBusGain);

    const maxOffset = Math.max(0.1, this.noiseBuffer.duration - dur - 0.05);
    src.start(now, Math.random() * maxOffset, dur + 0.015);
  }

  /**
   * D: Sparse, poignant felt-piano / acoustic celesta motif drawn from the active planet's
   * modal scale, blooming gently through the dual-delay shimmer reverb bus.
   */
  private triggerSparseAcousticMotif(
    chord: HarmonicChord,
    gravityStrength: number,
    solarHeat: number,
    isRecharging: boolean,
  ): void {
    if (!this.ctx || !this.masterBus || !this.shimmerSend || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1 or 2 delicate spaced notes (like distant acoustic piano harmonics in space)
    const noteCount = !isRecharging && (gravityStrength > 0.35 || Math.random() < 0.45) ? 2 : 1;
    const baseNoteIdx = Math.floor(Math.random() * chord.notes.length);

    for (let k = 0; k < noteCount; k++) {
      const delay = k * (0.95 + Math.random() * 0.65);
      const noteIdx = (baseNoteIdx + k * 2) % chord.notes.length;
      const octaveMul = Math.random() < 0.65 ? 2 : 1;
      const hz = chord.notes[noteIdx] * octaveMul;

      // Warm felt-piano fundamental (triangle) + glassy octave shimmer harmonic (sine)
      const bodyOsc = ctx.createOscillator();
      bodyOsc.type = 'triangle';
      bodyOsc.frequency.setValueAtTime(hz, now + delay);

      const overtoneOsc = ctx.createOscillator();
      overtoneOsc.type = 'sine';
      overtoneOsc.frequency.setValueAtTime(hz * 2.0, now + delay);

      const overtoneGain = ctx.createGain();
      overtoneGain.gain.value = 0.24 + solarHeat * 0.14;

      // Soft felt-hammer lowpass envelope (opens briefly on attack, warms into darkness)
      const toneFilter = ctx.createBiquadFilter();
      toneFilter.type = 'lowpass';
      toneFilter.frequency.setValueAtTime(2100 + solarHeat * 650, now + delay);
      toneFilter.frequency.exponentialRampToValueAtTime(340, now + delay + 3.4);

      const env = ctx.createGain();
      const peak = (isRecharging ? 0.036 : 0.048 + gravityStrength * 0.02) / (k * 0.35 + 1);
      env.gain.setValueAtTime(0.0001, now + delay);
      env.gain.linearRampToValueAtTime(peak, now + delay + 0.045);
      env.gain.exponentialRampToValueAtTime(0.0001, now + delay + 4.4);

      const panner = ctx.createStereoPanner();
      panner.pan.value = (k === 0 ? -1 : 1) * (0.2 + Math.random() * 0.45) * (Math.random() < 0.5 ? 1 : -1);

      bodyOsc.connect(toneFilter);
      overtoneOsc.connect(overtoneGain);
      overtoneGain.connect(toneFilter);
      toneFilter.connect(env);
      env.connect(panner);
      panner.connect(this.masterBus);
      panner.connect(this.shimmerSend);
      if (this.reverbNode) panner.connect(this.reverbNode);

      bodyOsc.start(now + delay);
      overtoneOsc.start(now + delay);
      bodyOsc.stop(now + delay + 4.55);
      overtoneOsc.stop(now + delay + 4.55);
    }
  }

  /**
   * Subtle stereo-drifting high harmonic bloom drawn from the current planet's modal scale,
   * feeding the shimmer reverb bus for infinite depth.
   */
  private triggerCelestialShimmer(chord: HarmonicChord, solarHeat: number): void {
    if (!this.ctx || !this.masterBus || !this.reverbNode || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const note = chord.notes[Math.floor(Math.random() * chord.notes.length)] * 2;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(note, now);
    osc.frequency.exponentialRampToValueAtTime(note * 1.006, now + 4.6);

    // Delicate +fifth octave overtone for authentic shimmer-reverb halo
    const fifthOsc = ctx.createOscillator();
    fifthOsc.type = 'sine';
    fifthOsc.frequency.setValueAtTime(note * 1.5, now);

    const fifthGain = ctx.createGain();
    fifthGain.gain.value = 0.28;

    const panner = ctx.createStereoPanner();
    const startPan = (Math.random() - 0.5) * 1.3;
    panner.pan.setValueAtTime(startPan, now);
    panner.pan.linearRampToValueAtTime(-startPan * 0.85, now + 4.6);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.024 + solarHeat * 0.018, now + 1.9);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.0);

    osc.connect(gain);
    fifthOsc.connect(fifthGain);
    fifthGain.connect(gain);
    gain.connect(panner);
    panner.connect(this.reverbNode);
    if (this.shimmerSend) panner.connect(this.shimmerSend);
    panner.connect(this.masterBus);

    osc.start(now);
    fifthOsc.start(now);
    osc.stop(now + 5.15);
    fifthOsc.stop(now + 5.15);
  }

  /**
   * Warm deep-space ignition swell when Play opens the Solar System voyage.
   */
  public triggerVoyageLaunch(): void {
    if (!this.initialized || !this.ctx || !this.masterBus || this.muted) return;
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
    subG.connect(this.masterBus);
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
    fifthG.connect(this.masterBus);
    if (this.reverbNode) fifthG.connect(this.reverbNode);
    if (this.shimmerSend) fifthG.connect(this.shimmerSend);
    fifth.start(now + 0.08);
    fifth.stop(now + 2.7);
  }

  /**
   * Stereo-panned Doppler flyby whoosh + icy crystalline chime or basalt crackle
   * triggered when a debris boulder whips closely past the foreground rim.
   */
  public triggerDebrisFlyby(pan: number, intensity: number, isIce: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterBus || !this.noiseBuffer || this.muted) {
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
    panner.connect(this.masterBus);
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
      if (this.shimmerSend) chimeGain.connect(this.shimmerSend);
      chime.start(now);
      chime.stop(now + 0.36);
    }
  }

  /**
   * Visceral physical rock-fracture crunch or crystalline ice shatter when the
   * host asteroid collides with an oncoming asteroid and breaks chunks off it.
   */
  public triggerCollisionImpact(pan: number, intensity: number, isIce: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterBus || !this.noiseBuffer || this.muted) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const clampedPan = Math.max(-0.92, Math.min(0.92, pan));
    const amp = Math.max(0.35, Math.min(1, intensity));

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(clampedPan, now);
    panner.connect(this.masterBus);
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
    if (!this.initialized || !this.ctx || !this.masterBus || this.muted) return;
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
    gain.connect(this.masterBus);
    if (this.reverbNode) gain.connect(this.reverbNode);

    osc.start(now);
    osc.stop(now + 0.64);
  }

  /**
   * Cinematic deep-space deceleration & inertia shutdown when health reaches 0.
   * Dual sub-harmonic pitch drop + decompression sweep through cosmic reverb.
   */
  public triggerTravelStall(): void {
    if (!this.initialized || !this.ctx || !this.masterBus || this.muted) return;
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
      gain.connect(this.masterBus);
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
      gain.connect(this.masterBus);
      if (this.reverbNode) gain.connect(this.reverbNode);
      src.start(now, 0, 2.0);
    }
  }

  /**
   * Hypnotic, crystalline harmonic regeneration pulse synchronized with the
   * pulsing green refilling bar; ascends softly across the active sector's key.
   */
  public triggerRechargePulse(progress: number): void {
    if (!this.initialized || !this.ctx || !this.masterBus || this.muted) return;
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
    gain.connect(this.masterBus);
    if (this.reverbNode) gain.connect(this.reverbNode);
    if (this.shimmerSend) gain.connect(this.shimmerSend);

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
    if (!this.initialized || !this.ctx || !this.masterBus || this.muted) return;
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
      gain.connect(this.masterBus);
      if (this.reverbNode) gain.connect(this.reverbNode);
      if (this.shimmerSend) gain.connect(this.shimmerSend);

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
    sg.connect(this.masterBus);
    surge.start(now);
    surge.stop(now + 1.9);
  }

  public dispose(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.masterBus = null;
    this.masterGain = null;
    this.padFilter = null;
    this.padGain = null;
    this.padPrimaryOscs = [];
    this.padDetuneOscs = [];
    this.padFmModOscs = [];
    this.padFmDepthGains = [];
    this.reverbNode = null;
    this.shimmerSend = null;
    this.shimmerWetGain = null;
    this.subOscL = null;
    this.subOscR = null;
    this.subGain = null;
    this.gravityWarmOsc = null;
    this.gravityWarmGain = null;
    this.windFilter = null;
    this.windGain = null;
    this.granularBusGain = null;
    this.hannCurve = null;
    this.steerFilter = null;
    this.steerGain = null;
    this.steerPanner = null;
    this.noiseBuffer = null;
    this.initialized = false;
  }
}
